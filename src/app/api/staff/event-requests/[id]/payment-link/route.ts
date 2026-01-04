import { NextResponse } from "next/server";
import { getStaffUserFromCookies } from "@/lib/staffAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStripe } from "@/lib/server/stripe";
import { sendEventPaymentLinkEmail } from "@/lib/server/mailer";
import { totalCents } from "@/lib/bookingLogic";

function normalizeBaseUrl(value?: string | null) {
  const cleaned = String(value || "")
    .replace(/^=+/, "")
    .replace(/["']/g, "")
    .trim()
    .replace(/\/+$/, "");
  return /^https?:\/\//.test(cleaned) ? cleaned : "";
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const pathId = url.pathname.split("/").filter(Boolean).pop() || "";
    const routeParams = await params;
    const id = routeParams?.id || pathId;
    if (!id) return NextResponse.json({ error: "Missing ID" }, { status: 400 });

    const sb = supabaseServer();
    const { data: requestRow, error } = await sb
      .from("event_requests")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !requestRow) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    if (requestRow.status !== "ACCEPTED") {
      return NextResponse.json({ error: "Request must be accepted first" }, { status: 400 });
    }

    const totalCentsValue = Number(requestRow.total_cents || 0);
    if (!Number.isFinite(totalCentsValue) || totalCentsValue <= 0) {
      return NextResponse.json({ error: "Invalid total" }, { status: 400 });
    }

    const activities = Array.isArray(requestRow.activities) ? requestRow.activities : [];
    const lineItems =
      activities.length > 0
        ? activities.map((activityItem: any) => {
            const activityName = String(activityItem?.activity || "Activity");
            const durationMinutes = Number(activityItem?.durationMinutes || 0);
            const amount = totalCents(activityName as any, Number(requestRow.party_size || 1), durationMinutes);
            return {
              price_data: {
                currency: "usd",
                unit_amount: Math.max(0, amount),
                product_data: {
                  name: `${activityName} (${durationMinutes} mins)`,
                  description: `Event on ${requestRow.date_key || "TBD"} at ${requestRow.start_min || 0} mins`,
                },
              },
              quantity: 1,
            };
          })
        : [
            {
              price_data: {
                currency: "usd",
                unit_amount: totalCentsValue,
                product_data: {
                  name: `Axe Quacks Event (${requestRow.date_key || "TBD"})`,
                  description: "Event booking payment",
                },
              },
              quantity: 1,
            },
          ];

    const base =
      normalizeBaseUrl(process.env.NEXT_PUBLIC_EVENTS_URL) ||
      normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL) ||
      "https://events.axequacks.com";
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: requestRow.customer_email || undefined,
      line_items: lineItems,
      metadata: {
        event_request_id: String(requestRow.id || ""),
        date_key: String(requestRow.date_key || ""),
        party_size: String(requestRow.party_size || ""),
        start_min: String(requestRow.start_min || ""),
        duration_minutes: String(requestRow.duration_minutes || ""),
      },
      success_url: `${base}/host-event?payment=success`,
      cancel_url: `${base}/host-event?payment=cancel`,
    });

    const paymentUrl = session.url || "";
    if (!paymentUrl) {
      return NextResponse.json({ error: "Unable to create payment link" }, { status: 500 });
    }

    const paymentSentAt = new Date().toISOString();
    const { error: updateErr } = await sb
      .from("event_requests")
      .update({
        payment_link_url: paymentUrl,
        payment_link_sent_at: paymentSentAt,
        payment_session_id: session.id,
        payment_intent_id: session.payment_intent ?? null,
      })
      .eq("id", id);

    if (updateErr) {
      console.error("event request payment link update error:", updateErr);
      return NextResponse.json({ error: "Failed to save payment link" }, { status: 500 });
    }

    try {
      await sendEventPaymentLinkEmail({
        customerName: String(requestRow.customer_name || ""),
        customerEmail: String(requestRow.customer_email || ""),
        customerPhone: requestRow.customer_phone || undefined,
        dateKey: String(requestRow.date_key || ""),
        startMin: Number(requestRow.start_min || 0),
        durationMinutes: Number(requestRow.duration_minutes || 0),
        partySize: Number(requestRow.party_size || 1),
        activities,
        totalCents: totalCentsValue,
        paymentUrl,
      });
    } catch (emailErr) {
      console.error("event request payment email error:", emailErr);
    }

    return NextResponse.json({ paymentUrl, paymentSentAt }, { status: 200 });
  } catch (err: any) {
    console.error("event request payment link fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
