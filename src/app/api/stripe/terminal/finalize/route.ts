import { NextResponse } from "next/server";
import { PARTY_AREA_OPTIONS, canonicalPartyAreaName, normalizePartyAreaName, type PartyAreaName } from "@/lib/bookingLogic";
import { getStripeTerminal } from "@/lib/server/stripe";
import { createBookingWithResources, ensureCustomerAndLinkBooking, type ActivityUI, type ComboOrder } from "@/lib/server/bookingService";
import { sendBookingConfirmationEmail } from "@/lib/server/mailer";
import { supabaseServer } from "@/lib/supabaseServer";
import { ensureWaiverForBooking } from "@/lib/server/waiverService";
import { recordPromoRedemption } from "@/lib/server/promoRedemptions";

const PARTY_AREA_BOOKABLE_SET: Set<string> = new Set(
  PARTY_AREA_OPTIONS.filter((option) => option.visible).map((option) => normalizePartyAreaName(option.name))
);

function parsePartyAreas(value?: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const unique = new Set<string>();
    const names: PartyAreaName[] = [];
    for (const item of parsed) {
      const canonical = canonicalPartyAreaName(String(item || ""));
      if (!canonical) continue;
      const normalized = normalizePartyAreaName(canonical);
      if (!normalized || unique.has(normalized) || !PARTY_AREA_BOOKABLE_SET.has(normalized)) continue;
      unique.add(normalized);
      names.push(canonical);
    }
    return names;
  } catch {
    return [];
  }
}

function parseBookingMetadata(metadata: Record<string, string | null | undefined>) {
  const activity = metadata.activity as ActivityUI | undefined;
  const partySize = Number(metadata.party_size);
  const dateKey = String(metadata.date_key || "");
  const startMin = Number(metadata.start_min);
  const durationMinutes = Number(metadata.duration_minutes);
  const comboAxeMinutes = Number(metadata.combo_axe_minutes);
  const comboDuckpinMinutes = Number(metadata.combo_duckpin_minutes);
  const partyAreas = parsePartyAreas(metadata.party_areas);
  const partyAreaMinutes = Number(metadata.party_area_minutes);
  const partyAreaTiming = (metadata.party_area_timing as "BEFORE" | "DURING" | "AFTER" | undefined) ?? "DURING";
  const customerName = String(metadata.customer_name || "");
  const customerEmail = String(metadata.customer_email || "");
  const customerPhone = String(metadata.customer_phone || "");
  const comboOrder = (metadata.combo_order as ComboOrder | undefined) ?? "DUCKPIN_FIRST";
  const totalBefore = Number(metadata.total_before_discount);
  const discountAmount = Number(metadata.discount_amount);
  const totalCentsOverride =
    Number.isFinite(totalBefore) && Number.isFinite(discountAmount) ? Math.max(0, totalBefore - discountAmount) : undefined;

  if (!activity || !dateKey || !Number.isFinite(partySize) || !Number.isFinite(startMin) || !Number.isFinite(durationMinutes)) {
    return null;
  }

  return {
    activity,
    partySize,
    dateKey,
    startMin,
    durationMinutes,
    comboAxeMinutes: Number.isFinite(comboAxeMinutes) ? comboAxeMinutes : undefined,
    comboDuckpinMinutes: Number.isFinite(comboDuckpinMinutes) ? comboDuckpinMinutes : undefined,
    partyAreas,
    partyAreaMinutes: Number.isFinite(partyAreaMinutes) ? partyAreaMinutes : undefined,
    partyAreaTiming,
    customerName,
    customerEmail,
    customerPhone,
    comboOrder,
    totalCentsOverride,
  };
}

async function markBookingPaid(bookingId: string) {
  const sb = supabaseServer();
  const { error } = await sb.from("bookings").update({ paid: true }).eq("id", bookingId);
  if (error) {
    console.error("booking paid update error:", error);
  }
}

async function markBookingPaymentIntent(bookingId: string, paymentIntentId: string) {
  if (!paymentIntentId) return;
  const sb = supabaseServer();
  const { error } = await sb.from("bookings").update({ payment_intent_id: paymentIntentId }).eq("id", bookingId);
  if (error) {
    console.error("booking payment intent update error:", error);
  }
}

async function recordBookingTip(bookingId: string, intent: any) {
  const tipDetails = (intent?.charges?.data?.[0] as any)?.amount_details;
  const tipCents = Number(tipDetails?.tip || 0);
  if (!tipCents || tipCents <= 0) return;

  const sb = supabaseServer();
  const { data: booking, error } = await sb
    .from("bookings")
    .select("assigned_staff_id")
    .eq("id", bookingId)
    .single();
  if (error || !booking) {
    console.error("booking tip lookup error:", error);
    return;
  }

  const assignedStaffId = String((booking as any)?.assigned_staff_id || "");
  const metadataStaffId = String(intent?.metadata?.staff_id || "");
  const tipStaffId = assignedStaffId || metadataStaffId || null;

  const { error: tipErr } = await sb
    .from("bookings")
    .update({ tip_cents: tipCents, tip_staff_id: tipStaffId })
    .eq("id", bookingId);
  if (tipErr) {
    console.error("booking tip update error:", tipErr);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const paymentIntentId = String(body?.payment_intent_id || "");
    if (!paymentIntentId) return NextResponse.json({ error: "Missing payment_intent_id" }, { status: 400 });

    const stripe = getStripeTerminal();
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

    const bookingInput = parseBookingMetadata(intent.metadata || {});

    if (intent.metadata?.booking_id) {
      const bookingId = intent.metadata.booking_id as string;
      const customerId = bookingInput ? await ensureCustomerAndLinkBooking(bookingInput, bookingId) : "";
      await markBookingPaid(bookingId);
      await markBookingPaymentIntent(bookingId, paymentIntentId);
      await recordBookingTip(bookingId, intent);
      if (bookingInput && intent.metadata?.promo_code) {
        await recordPromoRedemption({
          promoCode: String(intent.metadata.promo_code || ""),
          customerEmail: bookingInput.customerEmail,
          customerId,
          bookingId,
        });
      }
      if ((intent.metadata as any)?.confirmation_email_sent !== "true") {
        if (bookingInput) {
          let waiverUrl = "";
          if (customerId) {
            try {
              const waiverResult = await ensureWaiverForBooking({ bookingId, customerId, bookingInput });
              waiverUrl = waiverResult.waiverUrl || "";
            } catch (waiverErr) {
              console.error("waiver request error:", waiverErr);
            }
          }
          try {
            const emailResult = await sendBookingConfirmationEmail({
              bookingId,
              activity: bookingInput.activity,
              partySize: bookingInput.partySize,
              dateKey: bookingInput.dateKey,
              startMin: bookingInput.startMin,
              durationMinutes: bookingInput.durationMinutes,
              customerName: bookingInput.customerName,
              customerEmail: bookingInput.customerEmail,
              customerPhone: bookingInput.customerPhone,
              comboOrder: bookingInput.comboOrder,
              waiverUrl,
              totalCents: bookingInput.totalCentsOverride,
              paid: true,
            });
            if (emailResult.sent) {
              await stripe.paymentIntents.update(paymentIntentId, {
                metadata: { ...intent.metadata, confirmation_email_sent: "true" },
              });
            }
          } catch (emailErr) {
            console.error("confirmation email error:", emailErr);
          }
        }
      }
      return NextResponse.json({ ok: true, bookingId }, { status: 200 });
    }

    if (!bookingInput) {
      return NextResponse.json({ error: "Missing booking metadata on payment intent" }, { status: 400 });
    }

    try {
      const result = await createBookingWithResources(bookingInput);
      await markBookingPaid(result.bookingId);
      await markBookingPaymentIntent(result.bookingId, paymentIntentId);
      if (intent.metadata?.promo_code) {
        await recordPromoRedemption({
          promoCode: String(intent.metadata.promo_code || ""),
          customerEmail: bookingInput.customerEmail,
          customerId: result.customerId,
          bookingId: result.bookingId,
        });
      }
      await stripe.paymentIntents.update(paymentIntentId, {
        metadata: {
          ...intent.metadata,
          booking_id: result.bookingId,
          booking_finalized: "true",
        },
      });
      if ((intent.metadata as any)?.confirmation_email_sent !== "true") {
        let waiverUrl = "";
        try {
          const waiverResult = await ensureWaiverForBooking({
            bookingId: result.bookingId,
            customerId: result.customerId,
            bookingInput,
          });
          waiverUrl = waiverResult.waiverUrl || "";
        } catch (waiverErr) {
          console.error("waiver request error:", waiverErr);
        }
        try {
          const emailResult = await sendBookingConfirmationEmail({
            bookingId: result.bookingId,
            activity: bookingInput.activity,
            partySize: bookingInput.partySize,
            dateKey: bookingInput.dateKey,
            startMin: bookingInput.startMin,
            durationMinutes: bookingInput.durationMinutes,
            customerName: bookingInput.customerName,
            customerEmail: bookingInput.customerEmail,
            customerPhone: bookingInput.customerPhone,
            comboOrder: bookingInput.comboOrder,
            waiverUrl,
            totalCents: bookingInput.totalCentsOverride,
            paid: true,
          });
          if (emailResult.sent) {
            await stripe.paymentIntents.update(paymentIntentId, {
              metadata: {
                ...intent.metadata,
                booking_id: result.bookingId,
                booking_finalized: "true",
                confirmation_email_sent: "true",
              },
            });
          }
        } catch (emailErr) {
          console.error("confirmation email error:", emailErr);
        }
      }
      return NextResponse.json({ ok: true, bookingId: result.bookingId }, { status: 200 });
    } catch (err: any) {
      await stripe.refunds.create({ payment_intent: paymentIntentId });
      return NextResponse.json({ error: err?.message || "Failed to create booking" }, { status: 500 });
    }
  } catch (e: any) {
    console.error("terminal finalize error:", e);
    return NextResponse.json({ error: e?.message || "Failed to finalize booking" }, { status: 500 });
  }
}
