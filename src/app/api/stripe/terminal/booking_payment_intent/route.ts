import { NextResponse } from "next/server";
import { getStripeTerminal } from "@/lib/server/stripe";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";
import { cardFeeCents } from "@/lib/bookingLogic";

const ACTIVITY_LABELS: Record<string, string> = {
  AXE: "Axe Throwing",
  DUCKPIN: "Duckpin Bowling",
  COMBO: "Combo Package",
};

function activityLabel(activity: string | null | undefined) {
  if (!activity) return "";
  return ACTIVITY_LABELS[activity] ?? activity;
}

function dateKeyFromIsoNY(iso: string | null) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function minutesFromIsoNY(iso: string | null) {
  if (!iso) return 0;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

export async function POST(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const bookingId = String(body?.booking_id || "").trim();
    if (!bookingId) return NextResponse.json({ error: "Missing booking_id" }, { status: 400 });

    const sb = supabaseServer();
    const { data: booking, error } = await sb
      .from("bookings")
      .select("id,activity,party_size,duration_minutes,start_ts,customer_name,customer_email,customer_phone,total_cents,combo_order")
      .eq("id", bookingId)
      .single();

    if (error || !booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const amount = Number(booking.total_cents || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Invalid booking total" }, { status: 400 });
    }

    const cardFee = cardFeeCents(amount);
    const totalWithFee = amount + cardFee;

    const stripe = getStripeTerminal();
    const intent = await stripe.paymentIntents.create({
      amount: totalWithFee,
      currency: "usd",
      capture_method: "automatic",
      payment_method_types: ["card_present"],
      metadata: {
        booking_id: bookingId,
        activity: activityLabel(booking.activity),
        party_size: String(booking.party_size || ""),
        date_key: dateKeyFromIsoNY(booking.start_ts),
        start_min: String(minutesFromIsoNY(booking.start_ts)),
        duration_minutes: String(booking.duration_minutes || ""),
        customer_name: String(booking.customer_name || ""),
        customer_email: String(booking.customer_email || ""),
        customer_phone: String(booking.customer_phone || ""),
        combo_order: String(booking.combo_order || "DUCKPIN_FIRST"),
        ui_mode: "staff",
        staff_id: staff.staff_id,
        total_before_discount: String(amount),
        discount_amount: "0",
        card_fee_cents: String(cardFee),
        total_with_fee: String(totalWithFee),
      },
    });

    return NextResponse.json({ client_secret: intent.client_secret }, { status: 200 });
  } catch (e: any) {
    console.error("booking terminal payment intent error:", e);
    return NextResponse.json({ error: e?.message || "Failed to create payment intent" }, { status: 500 });
  }
}
