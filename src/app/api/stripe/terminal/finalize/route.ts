import { NextResponse } from "next/server";
import { PARTY_AREA_OPTIONS, canonicalPartyAreaName, normalizePartyAreaName, nyLocalDateKeyPlusMinutesToUTCISOString, type PartyAreaName } from "@/lib/bookingLogic";
import { getStripeTerminal } from "@/lib/server/stripe";
import { createBookingWithResources, ensureCustomerAndLinkBooking, type ActivityUI, type ComboOrder } from "@/lib/server/bookingService";
import { sendBookingConfirmationEmail, sendOwnerBookingConfirmationEmail } from "@/lib/server/mailer";
import { supabaseServer } from "@/lib/supabaseServer";
import { ensureWaiverForBooking } from "@/lib/server/waiverService";
import { recordPromoRedemption } from "@/lib/server/promoRedemptions";
import { redeemGiftCertificate } from "@/lib/server/giftCertificates";

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

type TabLineItem = {
  item_id: string;
  name: string;
  price_cents: number;
  quantity: number;
  line_total_cents: number;
};

function parseTabItems(raw?: string | null) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as TabLineItem[];
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

function formatTimeFromMinutes(minsFromMidnight: number) {
  const h24 = Math.floor(minsFromMidnight / 60);
  const m = minsFromMidnight % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

async function resolveBookingIdFromMetadata(sb: ReturnType<typeof supabaseServer>, metadata: Record<string, any>) {
  const bookingId = String(metadata?.booking_id || "").trim();
  if (bookingId) {
    const { data } = await sb.from("bookings").select("id").eq("id", bookingId).maybeSingle();
    if (data?.id) return data.id as string;
  }

  const dateKey = String(metadata?.date_key || "").trim();
  const startMin = Number(metadata?.start_min);
  let startTs = String(metadata?.lookup_start_ts || "").trim();
  if (!startTs && dateKey && Number.isFinite(startMin)) {
    startTs = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, startMin);
  }
  if (!startTs) return "";
  const parsed = new Date(startTs);
  if (Number.isNaN(parsed.getTime())) return "";
  const windowStart = new Date(parsed.getTime() - 10 * 60 * 1000).toISOString();
  const windowEnd = new Date(parsed.getTime() + 10 * 60 * 1000).toISOString();

  let query = sb.from("bookings").select("id").gte("start_ts", windowStart).lte("start_ts", windowEnd).limit(1);
  const email = String(metadata?.lookup_customer_email || metadata?.customer_email || "").trim();
  const name = String(metadata?.lookup_customer_name || metadata?.customer_name || "").trim();
  if (email) {
    query = query.ilike("customer_email", email);
  } else if (name) {
    query = query.ilike("customer_name", name);
  }
  const { data } = await query.maybeSingle();
  return data?.id ? String(data.id) : "";
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

async function recordTabSaleForBooking(intent: any) {
  const tabId = String(intent?.metadata?.tab_id || "");
  const tabItems = parseTabItems(intent?.metadata?.tab_items);
  if (!tabId || !tabItems.length) return;

  const subtotalCents = Number(intent.metadata?.tab_subtotal_cents || 0);
  const taxCents = Number(intent.metadata?.tab_tax_cents || 0);
  const totalCents = Number(intent.metadata?.tab_total_cents || 0);

  const sb = supabaseServer();
  const { data: existing } = await sb
    .from("pos_sales")
    .select("id")
    .eq("payment_intent_id", intent.id)
    .maybeSingle();
  if (existing?.id) return;

  const staffId = String(intent?.metadata?.staff_id || "");
  const { data: sale, error: saleErr } = await sb
    .from("pos_sales")
    .insert({
      staff_id: staffId || null,
      subtotal_cents: subtotalCents,
      tax_cents: taxCents,
      total_cents: totalCents,
      tip_cents: 0,
      payment_intent_id: intent.id,
      status: "PAID",
    })
    .select("id")
    .single();
  if (saleErr || !sale) {
    console.error("tab sale create error:", saleErr);
    return;
  }

  const rows = tabItems.map((item) => ({
    sale_id: sale.id,
    item_id: item.item_id,
    name: item.name,
    price_cents: item.price_cents,
    quantity: item.quantity,
    line_total_cents: item.line_total_cents,
  }));
  const { error: itemsErr } = await sb.from("pos_sale_items").insert(rows);
  if (itemsErr) {
    console.error("tab sale items error:", itemsErr);
  }

  const { error: tabErr } = await sb.from("booking_tabs").update({ status: "CLOSED" }).eq("id", tabId);
  if (tabErr) {
    console.error("tab close error:", tabErr);
  }
}

async function updateBookingTotalWithTab(bookingId: string, intent: any) {
  const bookingTotal = Number(intent?.metadata?.booking_total_after_discount || 0);
  const tabTotal = Number(intent?.metadata?.tab_total_cents || 0);
  if (!Number.isFinite(bookingTotal) || !Number.isFinite(tabTotal) || tabTotal <= 0) return;
  const sb = supabaseServer();
  const { error } = await sb.from("bookings").update({ total_cents: bookingTotal + tabTotal }).eq("id", bookingId);
  if (error) {
    console.error("booking total update error:", error);
  }
}

async function updateBookingTotalFromMetadata(bookingId: string, intent: any) {
  const bookingTotalNew = Number(intent?.metadata?.booking_total_new || 0);
  if (!Number.isFinite(bookingTotalNew) || bookingTotalNew <= 0) return;
  const sb = supabaseServer();
  const { error } = await sb.from("bookings").update({ total_cents: bookingTotalNew }).eq("id", bookingId);
  if (error) {
    console.error("booking total override error:", error);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const paymentIntentId = String(body?.payment_intent_id || "");
    if (!paymentIntentId) return NextResponse.json({ error: "Missing payment_intent_id" }, { status: 400 });

    const stripe = getStripeTerminal();
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const sb = supabaseServer();

    const bookingInput = parseBookingMetadata(intent.metadata || {});

    if (intent.metadata?.booking_id) {
      const bookingId = await resolveBookingIdFromMetadata(sb, intent.metadata || {});
      if (!bookingId) {
        console.error("booking finalize error: unable to resolve booking id", intent.metadata);
        return NextResponse.json({ ok: true, warning: "Booking not found to update." }, { status: 200 });
      }
      const customerId = bookingInput ? await ensureCustomerAndLinkBooking(bookingInput, bookingId) : "";
      await markBookingPaid(bookingId);
      await markBookingPaymentIntent(bookingId, paymentIntentId);
      await updateBookingTotalFromMetadata(bookingId, intent);
      await updateBookingTotalWithTab(bookingId, intent);
      await recordTabSaleForBooking(intent);
      await recordBookingTip(bookingId, intent);
      if (bookingInput && intent.metadata?.promo_code) {
        await recordPromoRedemption({
          promoCode: String(intent.metadata.promo_code || ""),
          customerEmail: bookingInput.customerEmail,
          customerId,
          bookingId,
        });
      }
      if (bookingInput && intent.metadata?.gift_code && intent.metadata?.gift_amount) {
        await redeemGiftCertificate({
          code: String(intent.metadata.gift_code || ""),
          customerEmail: bookingInput.customerEmail,
          amountCents: Number(intent.metadata.gift_amount || 0),
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
      if ((intent.metadata as any)?.owner_notified !== "true" && bookingInput) {
        try {
          await sendOwnerBookingConfirmationEmail({ ...bookingInput, bookingId, paid: true });
          await stripe.paymentIntents.update(paymentIntentId, {
            metadata: { ...intent.metadata, owner_notified: "true" },
          });
        } catch (notifyErr) {
          console.error("owner notify fallback error:", notifyErr);
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
      if (intent.metadata?.gift_code && intent.metadata?.gift_amount) {
        await redeemGiftCertificate({
          code: String(intent.metadata.gift_code || ""),
          customerEmail: bookingInput.customerEmail,
          amountCents: Number(intent.metadata.gift_amount || 0),
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
      if ((intent.metadata as any)?.owner_notified !== "true") {
        try {
          await sendOwnerBookingConfirmationEmail({ ...bookingInput, bookingId: result.bookingId, paid: true });
          await stripe.paymentIntents.update(paymentIntentId, {
            metadata: {
              ...intent.metadata,
              booking_id: result.bookingId,
              booking_finalized: "true",
              owner_notified: "true",
            },
          });
        } catch (notifyErr) {
          console.error("owner notify fallback error:", notifyErr);
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
