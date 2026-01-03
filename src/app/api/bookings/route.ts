import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { neededResources, nyLocalDateKeyPlusMinutesToUTCISOString, totalCents } from "@/lib/bookingLogic";
import { ensureCustomerAndLinkBooking, type BookingInput } from "@/lib/server/bookingService";

/**
 * UI labels coming in from your page
 */
type ActivityUI = "Axe Throwing" | "Duckpin Bowling" | "Combo Package";

/**
 * DB constraint uses these values
 */
type ActivityDB = "AXE" | "DUCKPIN" | "COMBO";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function mapActivityToDB(activity: ActivityUI): ActivityDB {
  if (activity === "Axe Throwing") return "AXE";
  if (activity === "Duckpin Bowling") return "DUCKPIN";
  return "COMBO";
}

/**
 * Must match your UI compute rules
 */
function computeNeeds(activity: ActivityUI, partySize: number) {
  const needs = neededResources(activity, partySize);
  return { axeBays: needs.AXE, lanes: needs.DUCKPIN };
}

function parseStartTimeToMinutes(startTime: string) {
  const match = startTime.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!match) return null;
  const hoursRaw = Number(match[1]);
  const minutes = Number(match[2] ?? "0");
  const period = (match[3] ?? "").toUpperCase();

  if (!Number.isFinite(hoursRaw) || !Number.isFinite(minutes) || minutes < 0 || minutes > 59) return null;
  if (hoursRaw < 1 || hoursRaw > 12) return null;

  const hours = period === "PM" ? (hoursRaw % 12) + 12 : hoursRaw % 12;
  return hours * 60 + minutes;
}

function nowNYDateKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function nowNYMinutesFromMidnight(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date());

  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;

  return Number(map.hour) * 60 + Number(map.minute);
}

function isOverlapOrExclusionError(err: any) {
  const code = err?.code || err?.details?.code;
  const msg = String(err?.message || "");
  return code === "23P01" || msg.toLowerCase().includes("exclusion") || msg.toLowerCase().includes("overlap");
}

export async function POST(req: Request) {
  const sb = supabaseAdmin();

  try {
    const body = await req.json();

    const activityUI = body.activity as ActivityUI | undefined;
    const partySize = Number(body.partySize);
    const date = String(body.date || "");
    const startTime = String(body.startTime || "");
    const durationMinutes = Number(body.durationMinutes);
    const order = String(body.comboOrder || body.order || "DUCKPIN_FIRST");

    const customerName = String(body.customerName || "").trim();
    const customerEmail = String(body.customerEmail || "").trim();
    const customerPhone = String(body.customerPhone || "").trim();

    if (!activityUI) return NextResponse.json({ error: "Missing activity" }, { status: 400 });
    if (!Number.isFinite(partySize) || partySize <= 0) {
      return NextResponse.json({ error: "Invalid partySize" }, { status: 400 });
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Missing/invalid date" }, { status: 400 });
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return NextResponse.json({ error: "Invalid durationMinutes" }, { status: 400 });
    }
    if (!startTime) return NextResponse.json({ error: "Missing startTime" }, { status: 400 });
    if (!["DUCKPIN_FIRST", "AXE_FIRST"].includes(order)) {
      return NextResponse.json({ error: "Invalid order" }, { status: 400 });
    }

    if (customerName.length < 2) return NextResponse.json({ error: "Missing customer name" }, { status: 400 });
    if (customerEmail.length < 5) return NextResponse.json({ error: "Missing customer email" }, { status: 400 });

    const startMin = parseStartTimeToMinutes(startTime);
    if (startMin == null) {
      return NextResponse.json({ error: "Invalid startTime" }, { status: 400 });
    }

    const todayNY = nowNYDateKey();
    if (date < todayNY) {
      return NextResponse.json({ error: "Cannot book past dates." }, { status: 400 });
    }
    if (date === todayNY) {
      const nowMin = nowNYMinutesFromMidnight();
      if (startMin < nowMin) {
        return NextResponse.json({ error: "Cannot book a time in the past." }, { status: 400 });
      }
    }

    // If combo, you can accept 120 here, but we enforce it for safety
    const effectiveDuration = activityUI === "Combo Package" ? 120 : durationMinutes;

    const endMin = startMin + effectiveDuration;
    if (!Number.isFinite(endMin) || endMin <= startMin) {
      return NextResponse.json({ error: "Invalid time window" }, { status: 400 });
    }

    const activityDB = mapActivityToDB(activityUI);
    const needs = computeNeeds(activityUI, partySize);

    const startTsUtc = nyLocalDateKeyPlusMinutesToUTCISOString(date, startMin);
    const endTsUtc = nyLocalDateKeyPlusMinutesToUTCISOString(date, endMin);

    const totalCentsValue = totalCents(activityUI, partySize, durationMinutes);

    if (activityUI === "Combo Package") {
      // Force 2 hours total for combo booking window
      const comboDuration = 120;
      const comboEndMin = startMin + comboDuration;

      const comboStartTsUtc = nyLocalDateKeyPlusMinutesToUTCISOString(date, startMin);
      const comboEndTsUtc = nyLocalDateKeyPlusMinutesToUTCISOString(date, comboEndMin);

      // Segment windows: 60 + 60
      const firstSegStartMin = startMin;
      const firstSegEndMin = startMin + 60;
      const secondSegStartMin = startMin + 60;
      const secondSegEndMin = startMin + 120;

      const firstSegStartUtc = nyLocalDateKeyPlusMinutesToUTCISOString(date, firstSegStartMin);
      const firstSegEndUtc = nyLocalDateKeyPlusMinutesToUTCISOString(date, firstSegEndMin);
      const secondSegStartUtc = nyLocalDateKeyPlusMinutesToUTCISOString(date, secondSegStartMin);
      const secondSegEndUtc = nyLocalDateKeyPlusMinutesToUTCISOString(date, secondSegEndMin);

      const isDuckpinFirst = order === "DUCKPIN_FIRST";

      const duckpinStart = isDuckpinFirst ? firstSegStartUtc : secondSegStartUtc;
      const duckpinEnd = isDuckpinFirst ? firstSegEndUtc : secondSegEndUtc;

      const axeStart = isDuckpinFirst ? secondSegStartUtc : firstSegStartUtc;
      const axeEnd = isDuckpinFirst ? secondSegEndUtc : firstSegEndUtc;

      const { data: bookingId, error } = await sb.rpc("create_combo_booking_with_resources", {
        p_activity: "COMBO",
        p_duration_minutes: comboDuration,
        p_party_size: partySize,
        p_combo_order: order,

        // overall booking window (2 hours)
        p_start_ts: comboStartTsUtc,
        p_end_ts: comboEndTsUtc,

        // segment windows (1 hour each)
        p_duckpin_start_ts: duckpinStart,
        p_duckpin_end_ts: duckpinEnd,
        p_axe_start_ts: axeStart,
        p_axe_end_ts: axeEnd,

        p_total_cents: totalCentsValue,
        p_customer_name: customerName,
        p_customer_email: customerEmail,
        p_tz: "America/New_York",
      });

      if (error) {
        console.error("create_combo_booking_with_resources error:", error);
        if (isOverlapOrExclusionError(error)) {
          return NextResponse.json({ error: "That time just got booked. Please pick a different time." }, { status: 409 });
        }
        return NextResponse.json(
          {
            error: "Failed to create booking.",
            detail: process.env.NODE_ENV === "production" ? undefined : error?.message || error?.details || error,
          },
          { status: 500 }
        );
      }

      const customerInput: BookingInput = {
        activity: activityUI,
        partySize,
        dateKey: date,
        startMin,
        durationMinutes: durationMinutes,
        customerName,
        customerEmail,
        customerPhone,
        comboOrder: order === "DUCKPIN_FIRST" || order === "AXE_FIRST" ? (order as any) : undefined,
      };
      if (bookingId) {
        await ensureCustomerAndLinkBooking(customerInput, bookingId as string);
      }

      return NextResponse.json({ ok: true, bookingId, needs }, { status: 200 });
    }

    // Non-combo (AXE / DUCKPIN) stays the same:
    const { data: bookingId, error } = await sb.rpc("create_booking_with_resources", {
      p_activity: activityDB,
      p_duration_minutes: durationMinutes,
      p_party_size: partySize,
      p_start_ts: startTsUtc,
      p_end_ts: endTsUtc,
      p_total_cents: totalCentsValue,
      p_customer_name: customerName,
      p_customer_email: customerEmail,
      p_tz: "America/New_York",
    });

    if (error) {
      console.error("create_booking_with_resources error:", error);
      if (isOverlapOrExclusionError(error)) {
        return NextResponse.json({ error: "That time just got booked. Please pick a different time." }, { status: 409 });
      }
      return NextResponse.json(
        {
          error: "Failed to create booking.",
          detail: process.env.NODE_ENV === "production" ? undefined : error?.message || error?.details || error,
        },
        { status: 500 }
      );
    }

    const customerInput: BookingInput = {
      activity: activityUI,
      partySize,
      dateKey: date,
      startMin,
      durationMinutes,
      customerName,
      customerEmail,
      customerPhone,
      comboOrder: order === "DUCKPIN_FIRST" || order === "AXE_FIRST" ? (order as any) : undefined,
    };
    if (bookingId) {
      await ensureCustomerAndLinkBooking(customerInput, bookingId as string);
    }

    return NextResponse.json({ ok: true, bookingId, needs }, { status: 200 });
  } catch (e: any) {
    console.error("bookings route error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
