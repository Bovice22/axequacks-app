import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getStaffUserFromCookies } from "@/lib/staffAuth";
import { getStripe } from "@/lib/server/stripe";
import { cardFeeCents } from "@/lib/bookingLogic";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

async function getRouteId(req: Request, context: RouteContext) {
  const resolvedParams = await Promise.resolve(context.params);
  if (resolvedParams?.id) return String(resolvedParams.id).trim();
  try {
    const path = new URL(req.url).pathname;
    return path.split("/").pop() || "";
  } catch {
    return "";
  }
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, { auth: { persistSession: false } });
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

const ACTIVITY_LABELS: Record<string, string> = {
  AXE: "Axe Throwing",
  DUCKPIN: "Duckpin Bowling",
  COMBO: "Combo Package",
};

function activityLabel(activity: string | null | undefined) {
  if (!activity) return "";
  return ACTIVITY_LABELS[activity] ?? activity;
}

function normalizeBaseUrl(value?: string | null) {
  const cleaned = String(value || "")
    .replace(/^=+/, "")
    .replace(/["']/g, "")
    .trim()
    .replace(/\/+$/, "");
  return /^https?:\/\//.test(cleaned) ? cleaned : "";
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const id = (await getRouteId(req, context)) || new URL(req.url).searchParams.get("id") || "";
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const sb = getSupabaseAdmin();
    const { data: booking, error } = await sb
      .from("bookings")
      .select("id,activity,party_size,duration_minutes,start_ts,customer_name,customer_email,combo_order,total_cents")
      .eq("id", id)
      .single();

    if (error || !booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const amount = Number(booking.total_cents || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Invalid booking total" }, { status: 400 });
    }

    const activity = activityLabel(booking.activity);
    const dateKey = dateKeyFromIsoNY(booking.start_ts);
    const startMin = minutesFromIsoNY(booking.start_ts);
    const durationMinutes = Number(booking.duration_minutes || 0);
    const partySize = Number(booking.party_size || 0);
    const customerName = String(booking.customer_name || "");
    const customerEmail = String(booking.customer_email || "");
    const comboOrder = String(booking.combo_order || "DUCKPIN_FIRST");

    const base =
      normalizeBaseUrl(process.env.NEXT_PUBLIC_STAFF_URL) ||
      normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL) ||
      "http://localhost:3000";
    const cardFee = cardFeeCents(amount);
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: customerEmail || undefined,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: amount,
            product_data: {
              name: `${activity} Booking`,
              description: `${partySize} guests`,
            },
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: "usd",
            unit_amount: cardFee,
            product_data: {
              name: "Card Processing Fee (3%)",
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${base}/staff/bookings`,
      cancel_url: `${base}/staff/bookings`,
      payment_intent_data: {
        metadata: {
          booking_id: booking.id,
          activity,
          party_size: String(partySize),
          date_key: dateKey,
          start_min: String(startMin),
          duration_minutes: String(durationMinutes),
          customer_name: customerName,
          customer_email: customerEmail,
          combo_order: comboOrder,
          ui_mode: "staff",
          staff_id: staff.staff_id,
          total_before_discount: String(amount),
          discount_amount: "0",
          card_fee_cents: String(cardFee),
        },
      },
    });

    const paymentUrl = session.url || "";
    if (!paymentUrl) {
      return NextResponse.json({ error: "Unable to create payment link" }, { status: 500 });
    }

    return NextResponse.json({ paymentUrl }, { status: 200 });
  } catch (err: any) {
    console.error("booking payment link fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
