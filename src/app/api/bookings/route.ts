import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  PARTY_AREA_OPTIONS,
  canonicalPartyAreaName,
  normalizePartyAreaName,
  neededResources,
  nyLocalDateKeyPlusMinutesToUTCISOString,
  partyAreaCostCents,
  totalCents,
} from "@/lib/bookingLogic";
import { ensureCustomerAndLinkBooking, type BookingInput } from "@/lib/server/bookingService";

/**
 * UI labels coming in from your page
 */
type ActivityUI = "Axe Throwing" | "Duckpin Bowling" | "Combo Package";

/**
 * DB constraint uses these values
 */
type ActivityDB = "AXE" | "DUCKPIN" | "COMBO";
const PARTY_AREA_BOOKABLE_SET: Set<string> = new Set(
  PARTY_AREA_OPTIONS.filter((option) => option.visible).map((option) => normalizePartyAreaName(option.name))
);

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

function normalizePartyAreas(input: unknown) {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of input) {
    const canonical = canonicalPartyAreaName(String(item || ""));
    if (!canonical) continue;
    const normalized = normalizePartyAreaName(canonical);
    if (!normalized || seen.has(normalized) || !PARTY_AREA_BOOKABLE_SET.has(normalized)) continue;
    seen.add(normalized);
    names.push(canonical);
  }
  return names;
}

async function reservePartyAreas(
  sb: ReturnType<typeof supabaseAdmin>,
  bookingId: string,
  partyAreas: string[],
  startTsUtc: string,
  endTsUtc: string
) {
  if (!partyAreas.length) return;

  const { data: resources, error: resErr } = await sb
    .from("resources")
    .select("id,name,type,active")
    .eq("type", "PARTY")
    .or("active.eq.true,active.is.null");

  if (resErr) {
    throw new Error(resErr.message || "Failed to load party areas");
  }

  const normalizedPartyNames = new Set(partyAreas.map((name) => normalizePartyAreaName(name)));
  const resourceIds = (resources || [])
    .filter((r: any) => normalizedPartyNames.has(normalizePartyAreaName(String(r?.name || ""))))
    .map((r: any) => r.id)
    .filter(Boolean);
  if (resourceIds.length !== partyAreas.length) {
    throw new Error("Selected party area is unavailable");
  }

  const { data: reservations, error: resvErr } = await sb
    .from("resource_reservations")
    .select("resource_id, bookings(status)")
    .in("resource_id", resourceIds)
    .gt("end_ts", startTsUtc)
    .lt("start_ts", endTsUtc);

  if (resvErr) {
    throw new Error(resvErr.message || "Failed to check party area availability");
  }

  const conflicts = (reservations || []).some((row: any) => row?.bookings?.status !== "CANCELLED");
  if (conflicts) {
    throw new Error("Selected party area is already booked");
  }

  const inserts = resourceIds.map((resourceId: string) => ({
    booking_id: bookingId,
    resource_id: resourceId,
    start_ts: startTsUtc,
    end_ts: endTsUtc,
  }));

  const { error: insertErr } = await sb.from("resource_reservations").insert(inserts);
  if (insertErr) {
    throw new Error(insertErr.message || "Failed to reserve party area");
  }
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
    const comboAxeMinutes = Number(body.comboAxeMinutes);
    const comboDuckpinMinutes = Number(body.comboDuckpinMinutes);
    const order = String(body.comboOrder || body.order || "DUCKPIN_FIRST");
    const partyAreas = normalizePartyAreas(body.partyAreas);
    const partyAreaMinutes = Number(body.partyAreaMinutes);

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

    const isCombo = activityUI === "Combo Package";
    const validDurations = [15, 30, 60, 120];
    const validComboDurations = [30, 60, 120];
    if (isCombo) {
      if (!validComboDurations.includes(comboAxeMinutes) || !validComboDurations.includes(comboDuckpinMinutes)) {
        return NextResponse.json({ error: "Invalid combo durations" }, { status: 400 });
      }
    } else if (!validDurations.includes(durationMinutes)) {
      return NextResponse.json({ error: "Invalid durationMinutes" }, { status: 400 });
    }

    const comboTotalMinutes = isCombo ? comboAxeMinutes + comboDuckpinMinutes : 0;
    const effectiveDuration = isCombo ? comboTotalMinutes : durationMinutes;

    const endMin = startMin + effectiveDuration;
    if (!Number.isFinite(endMin) || endMin <= startMin) {
      return NextResponse.json({ error: "Invalid time window" }, { status: 400 });
    }

    const activityDB = mapActivityToDB(activityUI);
    const needs = computeNeeds(activityUI, partySize);

    const normalizedPartyAreaMinutes =
      partyAreas.length && Number.isFinite(partyAreaMinutes)
        ? Math.min(480, Math.max(60, Math.round(partyAreaMinutes / 60) * 60))
        : 0;
    if (partyAreas.length && !normalizedPartyAreaMinutes) {
      return NextResponse.json({ error: "Invalid party area duration" }, { status: 400 });
    }

    const startTsUtc = nyLocalDateKeyPlusMinutesToUTCISOString(date, startMin);
    const endTsUtc = nyLocalDateKeyPlusMinutesToUTCISOString(date, endMin);
    const partyAreaEndMin = normalizedPartyAreaMinutes ? startMin + normalizedPartyAreaMinutes : endMin;
    const partyAreaEndTsUtc = nyLocalDateKeyPlusMinutesToUTCISOString(date, partyAreaEndMin);
    const totalCentsValue =
      totalCents(activityUI, partySize, durationMinutes, {
        axeMinutes: comboAxeMinutes,
        duckpinMinutes: comboDuckpinMinutes,
      }) + partyAreaCostCents(normalizedPartyAreaMinutes, partyAreas.length);

    if (activityUI === "Combo Package") {
      const comboDuration = comboTotalMinutes;
      const comboEndMin = startMin + comboDuration;

      const comboStartTsUtc = nyLocalDateKeyPlusMinutesToUTCISOString(date, startMin);
      const comboEndTsUtc = nyLocalDateKeyPlusMinutesToUTCISOString(date, comboEndMin);

      const isDuckpinFirst = order === "DUCKPIN_FIRST";

      const firstSegDuration = isDuckpinFirst ? comboDuckpinMinutes : comboAxeMinutes;
      const secondSegDuration = isDuckpinFirst ? comboAxeMinutes : comboDuckpinMinutes;

      const firstSegStartMin = startMin;
      const firstSegEndMin = firstSegStartMin + firstSegDuration;
      const secondSegStartMin = firstSegEndMin;
      const secondSegEndMin = secondSegStartMin + secondSegDuration;

      const firstSegStartUtc = nyLocalDateKeyPlusMinutesToUTCISOString(date, firstSegStartMin);
      const firstSegEndUtc = nyLocalDateKeyPlusMinutesToUTCISOString(date, firstSegEndMin);
      const secondSegStartUtc = nyLocalDateKeyPlusMinutesToUTCISOString(date, secondSegStartMin);
      const secondSegEndUtc = nyLocalDateKeyPlusMinutesToUTCISOString(date, secondSegEndMin);

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
        durationMinutes: comboDuration,
        comboAxeMinutes,
        comboDuckpinMinutes,
        customerName,
        customerEmail,
        customerPhone,
        comboOrder: order === "DUCKPIN_FIRST" || order === "AXE_FIRST" ? (order as any) : undefined,
      };
    if (bookingId) {
      await ensureCustomerAndLinkBooking(customerInput, bookingId as string);
      await reservePartyAreas(sb, bookingId as string, partyAreas, comboStartTsUtc, partyAreaEndTsUtc);
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
      await reservePartyAreas(sb, bookingId as string, partyAreas, startTsUtc, partyAreaEndTsUtc);
    }

    return NextResponse.json({ ok: true, bookingId, needs }, { status: 200 });
  } catch (e: any) {
    console.error("bookings route error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
