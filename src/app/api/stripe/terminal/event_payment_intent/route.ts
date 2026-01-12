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
    const eventRequestId = String(body?.event_request_id || "");
    if (!eventRequestId) {
      return NextResponse.json({ error: "Missing event_request_id" }, { status: 400 });
    }

    const sb = supabaseServer();
    const { data: requestRow, error } = await sb
      .from("event_requests")
      .select("*")
      .eq("id", eventRequestId)
      .single();

    if (error || !requestRow) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }
    if (String(requestRow.status || "").toUpperCase() !== "ACCEPTED") {
      return NextResponse.json({ error: "Request must be accepted first" }, { status: 400 });
    }
    if (!requestRow.pay_in_person) {
      return NextResponse.json({ error: "Request is not marked pay-in-person" }, { status: 400 });
    }

    const totalCents = Number(requestRow.total_cents || 0);
    if (!Number.isFinite(totalCents) || totalCents <= 0) {
      return NextResponse.json({ error: "Invalid total" }, { status: 400 });
    }

    const stripe = getStripeTerminal();
    const intent = await stripe.paymentIntents.create({
      amount: totalCents,
      currency: "usd",
      capture_method: "automatic",
      payment_method_types: ["card_present"],
      metadata: {
        event_request_id: String(requestRow.id || ""),
        party_size: String(requestRow.party_size || ""),
        date_key: String(requestRow.date_key || ""),
        start_min: String(requestRow.start_min || ""),
        duration_minutes: String(requestRow.duration_minutes || ""),
        customer_name: String(requestRow.customer_name || ""),
        customer_email: String(requestRow.customer_email || ""),
        customer_phone: String(requestRow.customer_phone || ""),
        ui_mode: "staff",
        pay_in_person: "true",
      },
    });

    return NextResponse.json({ client_secret: intent.client_secret }, { status: 200 });
  } catch (e: any) {
    console.error("event payment intent error:", e);
    return NextResponse.json({ error: e?.message || "Failed to create payment intent" }, { status: 500 });
  }
}
