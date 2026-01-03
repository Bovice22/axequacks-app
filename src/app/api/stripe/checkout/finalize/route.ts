import { NextResponse } from "next/server";
import { getStripe } from "@/lib/server/stripe";
import { createBookingWithResources, ensureCustomerAndLinkBooking, type ActivityUI, type ComboOrder } from "@/lib/server/bookingService";
import { sendBookingConfirmationEmail } from "@/lib/server/mailer";
import { ensureWaiverForBooking } from "@/lib/server/waiverService";
import { createClient } from "@supabase/supabase-js";

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

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

async function markBookingPaid(bookingId: string) {
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("bookings").update({ paid: true }).eq("id", bookingId);
  if (error) {
    console.error("booking paid update error:", error);
  }
}

function buildWaiverUrl(token: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base}/waiver?token=${encodeURIComponent(token)}`;
}

async function fetchBookingResources(bookingId: string) {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("resource_reservations")
    .select("resource_id, resources!inner(name,type)")
    .eq("booking_id", bookingId);

  if (error) {
    console.error("checkout finalize resource lookup error:", error);
    return [];
  }

  return (data ?? [])
    .map((row: any) => row?.resources?.name as string | undefined)
    .filter((name: string | undefined) => !!name);
}

async function fetchWaiverUrlForBooking(bookingId: string) {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("waiver_requests")
    .select("token,status")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (error || !data?.token || data?.status === "SIGNED") {
    return "";
  }
  return buildWaiverUrl(data.token as string);
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("session_id");
    if (!sessionId) return NextResponse.json({ error: "Missing session_id" }, { status: 400 });

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") {
      return NextResponse.json({ error: "Checkout not paid yet" }, { status: 400 });
    }

    const paymentIntentId = session.payment_intent as string | null;
    if (!paymentIntentId) return NextResponse.json({ error: "Missing payment intent" }, { status: 400 });

    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const bookingInput = parseBookingMetadata(intent.metadata || {});

    if ((intent.metadata as any)?.booking_id) {
      const bookingId = intent.metadata.booking_id as string;
      const customerId = bookingInput ? await ensureCustomerAndLinkBooking(bookingInput, bookingId) : "";
      await markBookingPaid(bookingId);
      const resources = await fetchBookingResources(bookingId);
      let waiverUrl = "";
      if (bookingInput) {
        try {
          const waiverResult = await ensureWaiverForBooking({ bookingId, customerId, bookingInput });
          waiverUrl = waiverResult.waiverUrl || "";
        } catch (waiverErr) {
          console.error("waiver request error:", waiverErr);
        }
        if (!waiverUrl) {
          waiverUrl = await fetchWaiverUrlForBooking(bookingId);
        }
      }

      let emailStatus: { sent: boolean; skippedReason?: string } | null = null;
      if ((intent.metadata as any)?.confirmation_email_sent !== "true") {
        if (bookingInput) {
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
              resourceNames: resources,
              waiverUrl,
              totalCents: bookingInput.totalCentsOverride,
              paid: true,
            });
            emailStatus = { sent: emailResult.sent, skippedReason: emailResult.skippedReason };
            if (emailResult.sent) {
              await stripe.paymentIntents.update(paymentIntentId, {
                metadata: { ...intent.metadata, confirmation_email_sent: "true" },
              });
            } else if (emailResult.skippedReason) {
              console.warn("confirmation email skipped:", emailResult.skippedReason);
            }
          } catch (emailErr) {
            console.error("confirmation email error:", emailErr);
          }
        }
      }
      return NextResponse.json({ bookingId, resources, waiverUrl, emailStatus }, { status: 200 });
    }

    if (!bookingInput) {
      return NextResponse.json({ error: "Missing booking metadata on payment intent" }, { status: 400 });
    }

    const result = await createBookingWithResources(bookingInput);
    await markBookingPaid(result.bookingId);
    await stripe.paymentIntents.update(paymentIntentId, {
      metadata: {
        ...intent.metadata,
        booking_id: result.bookingId,
        booking_finalized: "true",
      },
    });

    const resources = await fetchBookingResources(result.bookingId);
    let emailStatus: { sent: boolean; skippedReason?: string } | null = null;
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
      if (!waiverUrl) {
        waiverUrl = await fetchWaiverUrlForBooking(result.bookingId);
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
          resourceNames: resources,
          waiverUrl,
          totalCents: bookingInput.totalCentsOverride,
          paid: true,
        });
        emailStatus = { sent: emailResult.sent, skippedReason: emailResult.skippedReason };
        if (emailResult.sent) {
          await stripe.paymentIntents.update(paymentIntentId, {
            metadata: { ...intent.metadata, booking_id: result.bookingId, booking_finalized: "true", confirmation_email_sent: "true" },
          });
        } else if (emailResult.skippedReason) {
          console.warn("confirmation email skipped:", emailResult.skippedReason);
        }
      } catch (emailErr) {
        console.error("confirmation email error:", emailErr);
      }
    }
    const waiverUrl = await fetchWaiverUrlForBooking(result.bookingId);
    return NextResponse.json({ bookingId: result.bookingId, resources, waiverUrl, emailStatus }, { status: 200 });
  } catch (err: any) {
    console.error("checkout finalize error:", err);
    return NextResponse.json({ error: err?.message || "Failed to finalize booking" }, { status: 500 });
  }
}
