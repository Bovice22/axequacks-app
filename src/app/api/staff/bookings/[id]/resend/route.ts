import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";
import { sendBookingConfirmationEmail } from "@/lib/server/mailer";
import type { ActivityUI } from "@/lib/server/bookingService";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

async function getRouteId(req: Request, context: RouteContext) {
  const resolvedParams = await Promise.resolve(context.params);
  if (resolvedParams?.id) return String(resolvedParams.id).trim();
  try {
    const path = new URL(req.url).pathname;
    return path.split("/").slice(-2, -1)[0] || "";
  } catch {
    return "";
  }
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

function activityLabel(activity: string | null): ActivityUI {
  const key = String(activity || "").toUpperCase();
  if (key === "AXE") return "Axe Throwing";
  if (key === "DUCKPIN") return "Duckpin Bowling";
  if (key === "COMBO") return "Combo Package";
  return "Axe Throwing";
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = (await getRouteId(req, context)) || new URL(req.url).searchParams.get("id") || "";
    if (!id) return NextResponse.json({ error: "Missing booking id" }, { status: 400 });

    const sb = supabaseServer();
    let { data: booking, error: bookingErr } = await sb
      .from("bookings")
      .select(
        "id,activity,party_size,duration_minutes,start_ts,end_ts,customer_name,customer_email,customer_phone,combo_order,total_cents,paid"
      )
      .eq("id", id)
      .single();

    if ((bookingErr || !booking) && id) {
      const { data: resv } = await sb.from("resource_reservations").select("booking_id").eq("id", id).single();
      if (resv?.booking_id) {
        ({ data: booking, error: bookingErr } = await sb
          .from("bookings")
          .select(
            "id,activity,party_size,duration_minutes,start_ts,end_ts,customer_name,customer_email,customer_phone,combo_order,total_cents,paid"
          )
          .eq("id", resv.booking_id)
          .single());
      }
    }

    if (bookingErr || !booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }
    if (!booking.customer_email || !String(booking.customer_email).includes("@")) {
      return NextResponse.json({ error: "Customer email missing" }, { status: 400 });
    }

    const dateKey = dateKeyFromIsoNY(booking.start_ts);
    const startMin = minutesFromIsoNY(booking.start_ts);
    let durationMinutes = Number(booking.duration_minutes || 0);
    if (!durationMinutes && booking.start_ts && booking.end_ts) {
      const start = new Date(booking.start_ts).getTime();
      const end = new Date(booking.end_ts).getTime();
      const diff = Math.round((end - start) / 60000);
      durationMinutes = diff > 0 ? diff : 0;
    }

    const result = await sendBookingConfirmationEmail({
      bookingId: booking.id,
      activity: activityLabel(booking.activity),
      partySize: Number(booking.party_size || 0),
      dateKey,
      startMin,
      durationMinutes: durationMinutes || 60,
      customerName: String(booking.customer_name || ""),
      customerEmail: String(booking.customer_email || ""),
      customerPhone: String(booking.customer_phone || ""),
      comboOrder: booking.combo_order || null,
      totalCents: Number(booking.total_cents || 0),
      paid: Boolean(booking.paid),
    });

    if (!result.sent) {
      return NextResponse.json({ error: result.skippedReason || "Failed to send email" }, { status: 400 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    console.error("booking resend email error:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
