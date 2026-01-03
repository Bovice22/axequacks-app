import { NextResponse } from "next/server";
import { getStripe } from "@/lib/server/stripe";
import { createBookingWithResources, ensureCustomerAndLinkBooking, type ActivityUI, type ComboOrder } from "@/lib/server/bookingService";
import { sendBookingConfirmationEmail } from "@/lib/server/mailer";
import { supabaseServer } from "@/lib/supabaseServer";
import { ensureWaiverForBooking } from "@/lib/server/waiverService";

function parseBookingMetadata(metadata: Record<string, string | null | undefined>) {
  const activity = metadata.activity as ActivityUI | undefined;
  const partySize = Number(metadata.party_size);
  const dateKey = String(metadata.date_key || "");
  const startMin = Number(metadata.start_min);
  const durationMinutes = Number(metadata.duration_minutes);
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

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const paymentIntentId = String(body?.payment_intent_id || "");
    if (!paymentIntentId) return NextResponse.json({ error: "Missing payment_intent_id" }, { status: 400 });

    const stripe = getStripe();
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

    const bookingInput = parseBookingMetadata(intent.metadata || {});

    if (intent.metadata?.booking_id) {
      const bookingId = intent.metadata.booking_id as string;
      const customerId = bookingInput ? await ensureCustomerAndLinkBooking(bookingInput, bookingId) : "";
      await markBookingPaid(bookingId);
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
