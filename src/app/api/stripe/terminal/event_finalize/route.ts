import { NextResponse } from "next/server";
import { getStaffUserFromCookies } from "@/lib/staffAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStripeTerminal } from "@/lib/server/stripe";

export async function POST(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const paymentIntentId = String(body?.payment_intent_id || "");
    if (!paymentIntentId) {
      return NextResponse.json({ error: "Missing payment_intent_id" }, { status: 400 });
    }

    const stripe = getStripeTerminal();
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const eventRequestId = String(intent.metadata?.event_request_id || "");
    if (!eventRequestId) {
      return NextResponse.json({ error: "Missing event_request_id" }, { status: 400 });
    }

    const sb = supabaseServer();
    const { data: requestRow, error } = await sb
      .from("event_requests")
      .select("id,booking_ids,payment_status,pay_in_person")
      .eq("id", eventRequestId)
      .single();

    if (error || !requestRow) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    const paidAt = new Date().toISOString();
    const { error: updateErr } = await sb
      .from("event_requests")
      .update({
        payment_status: "PAID",
        paid_at: paidAt,
        payment_intent_id: paymentIntentId,
      })
      .eq("id", eventRequestId);

    if (updateErr) {
      console.error("event request pay-in-person update error:", updateErr);
      return NextResponse.json({ error: "Failed to update request" }, { status: 500 });
    }

    if (Array.isArray(requestRow.booking_ids) && requestRow.booking_ids.length) {
      await sb.from("bookings").update({ paid: true }).in("id", requestRow.booking_ids);
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    console.error("event pay-in-person finalize error:", e);
    return NextResponse.json({ error: e?.message || "Failed to finalize payment" }, { status: 500 });
  }
}
