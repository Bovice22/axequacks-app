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

async function finalizeBookingFromPaymentIntent(paymentIntentId: string) {
  const stripe = getStripe();
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  const meta = intent.metadata || {};
  const bookingInput = parseBookingMetadata(meta);

  if (!bookingInput) {
    throw new Error("Missing booking metadata on payment intent");
  }

  if ((intent.metadata as any)?.booking_id) {
    return { bookingId: intent.metadata.booking_id as string, bookingInput, intent };
  }

  try {
    const result = await createBookingWithResources(bookingInput);
    await stripe.paymentIntents.update(paymentIntentId, {
      metadata: {
        ...intent.metadata,
        booking_id: result.bookingId,
        booking_finalized: "true",
      },
    });
    return { bookingId: result.bookingId as string, bookingInput, intent, customerId: result.customerId };
  } catch (err: any) {
    await stripe.refunds.create({ payment_intent: paymentIntentId });
    throw err;
  }
}

async function markBookingPaid(sb: ReturnType<typeof supabaseServer>, bookingId: string) {
  const { error } = await sb.from("bookings").update({ paid: true }).eq("id", bookingId);
  if (error) {
    console.error("booking paid update error:", error);
  }
}

export async function POST(req: Request) {
  const stripe = getStripe();
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();

  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let event;
  try {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) throw new Error("Missing STRIPE_WEBHOOK_SECRET");
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: any) {
    console.error("stripe webhook signature error:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const sb = supabaseServer();
  try {
    const { data: existing, error: existingErr } = await sb
      .from("webhook_events")
      .select("status")
      .eq("provider", "stripe")
      .eq("event_id", event.id)
      .single();

    if (!existingErr && existing?.status === "processed") {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    await sb.from("webhook_events").upsert(
      {
        provider: "stripe",
        event_id: event.id,
        status: "processing",
        received_at: new Date().toISOString(),
      },
      { onConflict: "provider,event_id" }
    );
  } catch (err: any) {
    console.error("webhook idempotency error:", err);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as any;
      const paymentIntentId = session.payment_intent as string | null;
      if (session?.metadata?.event_request_id) {
        await sb
          .from("event_requests")
          .update({ payment_status: "PAID", paid_at: new Date().toISOString() })
          .eq("id", session.metadata.event_request_id);
      }
      if (paymentIntentId) {
        const result = await finalizeBookingFromPaymentIntent(paymentIntentId);
        await markBookingPaid(sb, result.bookingId);
        let waiverUrl = "";
        try {
          const customerId =
            result.customerId || (await ensureCustomerAndLinkBooking(result.bookingInput, result.bookingId));
          const waiverResult = await ensureWaiverForBooking({ bookingId: result.bookingId, customerId, bookingInput: result.bookingInput });
          waiverUrl = waiverResult.waiverUrl || "";
        } catch (waiverErr) {
          console.error("waiver request error:", waiverErr);
        }
        if ((result.intent.metadata as any)?.confirmation_email_sent !== "true") {
          try {
            const emailResult = await sendBookingConfirmationEmail({
              bookingId: result.bookingId,
              activity: result.bookingInput.activity,
              partySize: result.bookingInput.partySize,
              dateKey: result.bookingInput.dateKey,
              startMin: result.bookingInput.startMin,
              durationMinutes: result.bookingInput.durationMinutes,
              customerName: result.bookingInput.customerName,
              customerEmail: result.bookingInput.customerEmail,
              customerPhone: result.bookingInput.customerPhone,
              comboOrder: result.bookingInput.comboOrder,
              waiverUrl,
              totalCents: result.bookingInput.totalCentsOverride,
              paid: true,
            });
            if (emailResult.sent) {
              await stripe.paymentIntents.update(paymentIntentId, {
                metadata: {
                  ...result.intent.metadata,
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
        const customerId =
          result.customerId || (await ensureCustomerAndLinkBooking(result.bookingInput, result.bookingId));
        try {
          await ensureWaiverForBooking({ bookingId: result.bookingId, customerId, bookingInput: result.bookingInput });
        } catch (waiverErr) {
          console.error("waiver request error:", waiverErr);
        }
      }
    }

    if (event.type === "payment_intent.succeeded") {
      const intent = event.data.object as any;
      if (intent?.metadata?.event_request_id) {
        await sb
          .from("event_requests")
          .update({ payment_status: "PAID", paid_at: new Date().toISOString() })
          .eq("id", intent.metadata.event_request_id);
      }
      if (intent?.metadata?.booking_finalized === "true") {
        return NextResponse.json({ received: true }, { status: 200 });
      }
      const paymentIntentId = intent.id as string;
      const result = await finalizeBookingFromPaymentIntent(paymentIntentId);
      await markBookingPaid(sb, result.bookingId);
      let waiverUrl = "";
      try {
        const customerId =
          result.customerId || (await ensureCustomerAndLinkBooking(result.bookingInput, result.bookingId));
        const waiverResult = await ensureWaiverForBooking({ bookingId: result.bookingId, customerId, bookingInput: result.bookingInput });
        waiverUrl = waiverResult.waiverUrl || "";
      } catch (waiverErr) {
        console.error("waiver request error:", waiverErr);
      }
      if ((result.intent.metadata as any)?.confirmation_email_sent !== "true") {
        try {
          const emailResult = await sendBookingConfirmationEmail({
            bookingId: result.bookingId,
            activity: result.bookingInput.activity,
            partySize: result.bookingInput.partySize,
            dateKey: result.bookingInput.dateKey,
            startMin: result.bookingInput.startMin,
            durationMinutes: result.bookingInput.durationMinutes,
            customerName: result.bookingInput.customerName,
            customerEmail: result.bookingInput.customerEmail,
            customerPhone: result.bookingInput.customerPhone,
            comboOrder: result.bookingInput.comboOrder,
            waiverUrl,
            totalCents: result.bookingInput.totalCentsOverride,
            paid: true,
          });
          if (emailResult.sent) {
            await stripe.paymentIntents.update(paymentIntentId, {
              metadata: {
                ...result.intent.metadata,
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
    }

    try {
      await sb
        .from("webhook_events")
        .update({ status: "processed", processed_at: new Date().toISOString(), error_message: null })
        .eq("provider", "stripe")
        .eq("event_id", event.id);
    } catch (err: any) {
      console.error("webhook status update error:", err);
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err: any) {
    console.error("stripe webhook processing error:", err);
    try {
      await sb
        .from("webhook_events")
        .update({ status: "error", error_message: String(err?.message || err) })
        .eq("provider", "stripe")
        .eq("event_id", event.id);
      await sb.from("webhook_failures").insert({
        provider: "stripe",
        event_id: event.id,
        payload_json: event,
        error_message: String(err?.message || err),
      });
    } catch (queueErr: any) {
      console.error("webhook failure queue error:", queueErr);
    }
    return NextResponse.json({ error: err?.message || "Webhook processing failed" }, { status: 500 });
  }
}
