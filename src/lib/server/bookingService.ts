import { createClient } from "@supabase/supabase-js";
import {
  PARTY_AREA_OPTIONS,
  type PartyAreaName,
  canonicalPartyAreaName,
  normalizePartyAreaName,
  neededResources,
  nyLocalDateKeyPlusMinutesToUTCISOString,
  totalCents,
} from "@/lib/bookingLogic";

function minutesToTimeString(totalMinutes: number) {
  const mins = Math.max(0, Math.floor(totalMinutes));
  const hours = Math.floor(mins / 60) % 24;
  const rem = mins % 60;
  return `${String(hours).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

export type ActivityUI = "Axe Throwing" | "Duckpin Bowling" | "Combo Package";
export type ComboOrder = "DUCKPIN_FIRST" | "AXE_FIRST";
export type PartyAreaTiming = "BEFORE" | "DURING" | "AFTER";
type ActivityDB = "AXE" | "DUCKPIN" | "COMBO";

export type BookingInput = {
  activity: ActivityUI;
  partySize: number;
  partySizeForResources?: number;
  dateKey: string;
  startMin: number;
  durationMinutes: number;
  comboAxeMinutes?: number;
  comboDuckpinMinutes?: number;
  partyAreaMinutes?: number;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  comboOrder?: ComboOrder;
  totalCentsOverride?: number;
  partyAreas?: PartyAreaName[];
  partyAreaTiming?: PartyAreaTiming;
};

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

function mapActivityToUI(activity: ActivityDB | string | null): ActivityUI {
  if (activity === "AXE") return "Axe Throwing";
  if (activity === "DUCKPIN") return "Duckpin Bowling";
  return "Combo Package";
}

async function upsertCustomer(input: BookingInput) {
  const sb = supabaseAdmin();
  const email = input.customerEmail.trim().toLowerCase();
  const fullName = input.customerName.trim();
  const phone = input.customerPhone?.trim() || null;

  if (!email) {
    const { data, error } = await sb
      .from("customers")
      .insert({
        email: null,
        full_name: fullName || null,
        phone,
      })
      .select("id")
      .single();
    if (!error && data?.id) return data.id as string;
    if (error) {
      console.error("customer insert without email error:", error);
    }
    const fallbackEmail = `no-email+${Date.now()}@axequacks.local`;
    const fallback = await sb
      .from("customers")
      .insert({
        email: fallbackEmail,
        full_name: fullName || null,
        phone,
      })
      .select("id")
      .single();
    if (fallback.error) {
      throw new Error(fallback.error.message || "Failed to insert customer");
    }
    return fallback.data?.id as string;
  }

  const { data, error } = await sb
    .from("customers")
    .upsert(
      {
        email,
        full_name: fullName || null,
        phone,
      },
      { onConflict: "email" }
    )
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message || "Failed to upsert customer");
  }

  return data?.id as string;
}

async function attachCustomerToBooking(bookingId: string, customerId: string) {
  const sb = supabaseAdmin();
  const { error } = await sb.from("bookings").update({ customer_id: customerId }).eq("id", bookingId);
  if (error) {
    throw new Error(error.message || "Failed to link customer to booking");
  }
}

export async function ensureCustomerAndLinkBooking(input: BookingInput, bookingId: string) {
  const customerId = await upsertCustomer(input);
  await attachCustomerToBooking(bookingId, customerId);
  return customerId;
}

function computeNeeds(activity: ActivityUI, partySize: number) {
  const needs = neededResources(activity, partySize);
  return { axeBays: needs.AXE, lanes: needs.DUCKPIN };
}

const PARTY_AREA_BOOKABLE_SET: Set<string> = new Set(
  PARTY_AREA_OPTIONS.filter((option) => option.visible).map((option) => normalizePartyAreaName(option.name))
);

function normalizePartyAreas(input?: PartyAreaName[]) {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const normalized: PartyAreaName[] = [];
  for (const item of input) {
    const canonical = canonicalPartyAreaName(String(item || ""));
    if (!canonical) continue;
    const normalizedName = normalizePartyAreaName(canonical);
    if (seen.has(normalizedName) || !PARTY_AREA_BOOKABLE_SET.has(normalizedName)) continue;
    seen.add(normalizedName);
    normalized.push(canonical);
  }
  return normalized;
}

async function reservePartyAreas(
  sb: ReturnType<typeof supabaseAdmin>,
  bookingId: string,
  partyAreas: PartyAreaName[],
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
  let resourceIds = (resources || [])
    .filter((r: any) => normalizedPartyNames.has(normalizePartyAreaName(String(r?.name || ""))))
    .map((r: any) => r.id)
    .filter(Boolean);
  if (!resourceIds.length && partyAreas.length === 1 && (resources || []).length === 1) {
    const fallbackId = (resources || [])[0]?.id;
    if (fallbackId) resourceIds = [fallbackId];
  }
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

  const conflicts = (reservations || []).some((row: any) => {
    if (row?.bookings == null) return false;
    return row?.bookings?.status !== "CANCELLED";
  });
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

async function enforceDuckpinPairing(
  sb: ReturnType<typeof supabaseAdmin>,
  bookingId: string,
  startTsUtc: string,
  endTsUtc: string,
  lanesNeeded: number
) {
  if (lanesNeeded !== 2) return;

  const { data: resources, error: resErr } = await sb
    .from("resources")
    .select("id,type,name,sort_order,active")
    .eq("type", "DUCKPIN")
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });

  if (resErr || !resources?.length) {
    return;
  }

  const activeLanes = resources.filter((r: any) => r.active !== false);
  if (activeLanes.length < 2) return;

  const pairs = [
    activeLanes.slice(0, 2),
    activeLanes.slice(2, 4),
  ].filter((pair) => pair.length === 2);

  if (!pairs.length) return;

  const { data: currentReservations } = await sb
    .from("resource_reservations")
    .select("id,resource_id,resources(type,name,sort_order)")
    .eq("booking_id", bookingId);

  const currentDuckpinIds = (currentReservations || [])
    .filter((row: any) => row.resources?.type === "DUCKPIN")
    .map((row: any) => row.resource_id);

  if (currentDuckpinIds.length !== 2) return;

  const currentPairKey = currentDuckpinIds.slice().sort().join("|");
  const desiredPair = pairs.find((pair) => {
    const ids = pair.map((r: any) => r.id);
    return ids.slice().sort().join("|") === currentPairKey;
  });
  if (desiredPair) return;

  for (const pair of pairs) {
    const pairIds = pair.map((r: any) => r.id);
    const { data: conflicts } = await sb
      .from("resource_reservations")
      .select("id,resource_id")
      .in("resource_id", pairIds)
      .neq("booking_id", bookingId)
      .lt("start_ts", endTsUtc)
      .gt("end_ts", startTsUtc);

    if (conflicts && conflicts.length > 0) {
      continue;
    }

    await sb
      .from("resource_reservations")
      .delete()
      .eq("booking_id", bookingId)
      .in("resource_id", currentDuckpinIds);

    const inserts = pairIds.map((resourceId: string) => ({
      booking_id: bookingId,
      resource_id: resourceId,
      start_ts: startTsUtc,
      end_ts: endTsUtc,
    }));
    await sb.from("resource_reservations").insert(inserts);
    return;
  }
}

async function reserveResourcesBypass(
  sb: ReturnType<typeof supabaseAdmin>,
  bookingId: string,
  type: "AXE" | "DUCKPIN",
  count: number,
  startTsUtc: string,
  endTsUtc: string
) {
  if (count <= 0) return;
  const { data: resources, error } = await sb
    .from("resources")
    .select("id,type,sort_order,active")
    .eq("type", type)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error || !resources?.length) return;

  const active = resources.filter((r: any) => r.active !== false);
  if (!active.length) return;

  let selected = active.slice(0, count);
  if (type === "DUCKPIN" && count === 2) {
    const pairA = active.slice(0, 2);
    const pairB = active.slice(2, 4);
    if (pairA.length === 2) selected = pairA;
    else if (pairB.length === 2) selected = pairB;
  }

  const inserts = selected.map((r: any) => ({
    booking_id: bookingId,
    resource_id: r.id,
    start_ts: startTsUtc,
    end_ts: endTsUtc,
  }));

  if (inserts.length) {
    await sb.from("resource_reservations").insert(inserts);
  }
}

export async function repairBookingReservations(bookingId: string) {
  const sb = supabaseAdmin();
  const { data: booking, error } = await sb
    .from("bookings")
    .select("id,activity,party_size,start_ts,end_ts")
    .eq("id", bookingId)
    .single();

  if (error || !booking) {
    throw new Error("Booking not found");
  }

  await sb.from("resource_reservations").delete().eq("booking_id", bookingId);

  const activityUi = mapActivityToUI(booking.activity);
  const needs = computeNeeds(activityUi, Number(booking.party_size) || 1);
  const startTsUtc = booking.start_ts;
  const endTsUtc = booking.end_ts;

  await reserveResourcesBypass(sb, bookingId, "AXE", needs.axeBays, startTsUtc, endTsUtc);
  await reserveResourcesBypass(sb, bookingId, "DUCKPIN", needs.lanes, startTsUtc, endTsUtc);

  return { bookingId };
}

export async function createBookingBypassResources(input: BookingInput) {
  const sb = supabaseAdmin();
  const activityDB = mapActivityToDB(input.activity);
  const resourcePartySize = input.partySizeForResources ?? input.partySize;
  const needs = computeNeeds(input.activity, resourcePartySize);
  const partyAreas = normalizePartyAreas(input.partyAreas);
  const partyAreaMinutes =
    partyAreas.length && Number.isFinite(input.partyAreaMinutes)
      ? Math.min(480, Math.max(60, Math.round(Number(input.partyAreaMinutes) / 60) * 60))
      : 0;

  const comboAxeMinutes = input.comboAxeMinutes ?? 60;
  const comboDuckpinMinutes = input.comboDuckpinMinutes ?? 60;
  const comboTotalMinutes = comboAxeMinutes + comboDuckpinMinutes;
  const effectiveDuration = input.activity === "Combo Package" ? comboTotalMinutes : input.durationMinutes;
  const endMin = input.startMin + effectiveDuration;
  const partyAreaTiming: PartyAreaTiming = input.partyAreaTiming ?? "DURING";
  const partyWindowMinutes = partyAreaMinutes || effectiveDuration;
  const partyAreaStartMin =
    partyAreaTiming === "BEFORE"
      ? input.startMin - partyWindowMinutes
      : partyAreaTiming === "AFTER"
      ? input.startMin + effectiveDuration
      : input.startMin;
  const partyAreaEndMin = partyAreaStartMin + partyWindowMinutes;

  const startTsUtc = nyLocalDateKeyPlusMinutesToUTCISOString(input.dateKey, input.startMin);
  const endTsUtc = nyLocalDateKeyPlusMinutesToUTCISOString(input.dateKey, endMin);
  const partyAreaStartTsUtc = nyLocalDateKeyPlusMinutesToUTCISOString(input.dateKey, partyAreaStartMin);
  const partyAreaEndTsUtc = nyLocalDateKeyPlusMinutesToUTCISOString(input.dateKey, partyAreaEndMin);

  const hasOverride = Number.isFinite(input.totalCentsOverride);
  const totalCentsValue = hasOverride
    ? Math.max(0, Number(input.totalCentsOverride))
    : totalCents(input.activity, input.partySize, input.durationMinutes, {
        axeMinutes: comboAxeMinutes,
        duckpinMinutes: comboDuckpinMinutes,
      });

  const insertPayload: Record<string, any> = {
    activity: activityDB,
    duration_minutes: effectiveDuration,
    party_size: input.partySize,
    date: input.dateKey,
    start_ts: startTsUtc,
    end_ts: endTsUtc,
    start_time: minutesToTimeString(input.startMin),
    end_time: minutesToTimeString(endMin),
    total_cents: totalCentsValue,
    customer_name: input.customerName,
    customer_email: input.customerEmail,
    combo_order: input.comboOrder ?? null,
  };

  const { data: bookingRow, error } = await sb.from("bookings").insert(insertPayload).select("id").single();
  if (error) throw new Error(error.message || "Failed to create booking");

  const bookingId = bookingRow?.id as string;
  const customerId = await ensureCustomerAndLinkBooking(input, bookingId);

  await reserveResourcesBypass(sb, bookingId, "AXE", needs.axeBays, startTsUtc, endTsUtc);
  await reserveResourcesBypass(sb, bookingId, "DUCKPIN", needs.lanes, startTsUtc, endTsUtc);
  await reservePartyAreas(sb, bookingId, partyAreas, partyAreaStartTsUtc, partyAreaEndTsUtc);

  return { bookingId, needs, customerId };
}

export async function createBookingWithResources(input: BookingInput) {
  const sb = supabaseAdmin();
  const activityDB = mapActivityToDB(input.activity);
  const resourcePartySize = input.partySizeForResources ?? input.partySize;
  const needs = computeNeeds(input.activity, resourcePartySize);
  const partyAreas = normalizePartyAreas(input.partyAreas);
  const partyAreaMinutes =
    partyAreas.length && Number.isFinite(input.partyAreaMinutes)
      ? Math.min(480, Math.max(60, Math.round(Number(input.partyAreaMinutes) / 60) * 60))
      : 0;

  const comboAxeMinutes = input.comboAxeMinutes ?? 60;
  const comboDuckpinMinutes = input.comboDuckpinMinutes ?? 60;
  const comboTotalMinutes = comboAxeMinutes + comboDuckpinMinutes;
  const effectiveDuration = input.activity === "Combo Package" ? comboTotalMinutes : input.durationMinutes;
  const endMin = input.startMin + effectiveDuration;
  const partyAreaTiming: PartyAreaTiming = input.partyAreaTiming ?? "DURING";
  const partyWindowMinutes = partyAreaMinutes || effectiveDuration;
  const partyAreaStartMin =
    partyAreaTiming === "BEFORE"
      ? input.startMin - partyWindowMinutes
      : partyAreaTiming === "AFTER"
      ? input.startMin + effectiveDuration
      : input.startMin;
  if (partyAreaTiming === "BEFORE" && partyAreaStartMin < 0) {
    throw new Error("Party area cannot start before opening hours.");
  }
  const partyAreaEndMin = partyAreaStartMin + partyWindowMinutes;

  const startTsUtc = nyLocalDateKeyPlusMinutesToUTCISOString(input.dateKey, input.startMin);
  const endTsUtc = nyLocalDateKeyPlusMinutesToUTCISOString(input.dateKey, endMin);
  const partyAreaStartTsUtc = nyLocalDateKeyPlusMinutesToUTCISOString(input.dateKey, partyAreaStartMin);
  const partyAreaEndTsUtc = nyLocalDateKeyPlusMinutesToUTCISOString(input.dateKey, partyAreaEndMin);

  const hasOverride = Number.isFinite(input.totalCentsOverride);
  const totalCentsValue = hasOverride
    ? Math.max(0, Number(input.totalCentsOverride))
    : totalCents(input.activity, input.partySize, input.durationMinutes, {
        axeMinutes: comboAxeMinutes,
        duckpinMinutes: comboDuckpinMinutes,
      });

  if (input.activity === "Combo Package") {
    const comboDuration = comboTotalMinutes;
    const comboEndMin = input.startMin + comboDuration;

    const comboStartTsUtc = nyLocalDateKeyPlusMinutesToUTCISOString(input.dateKey, input.startMin);
    const comboEndTsUtc = nyLocalDateKeyPlusMinutesToUTCISOString(input.dateKey, comboEndMin);

    const order = input.comboOrder ?? "DUCKPIN_FIRST";
    const isDuckpinFirst = order === "DUCKPIN_FIRST";

    const firstSegDuration = isDuckpinFirst ? comboDuckpinMinutes : comboAxeMinutes;
    const secondSegDuration = isDuckpinFirst ? comboAxeMinutes : comboDuckpinMinutes;

    const firstSegStartMin = input.startMin;
    const firstSegEndMin = firstSegStartMin + firstSegDuration;
    const secondSegStartMin = firstSegEndMin;
    const secondSegEndMin = secondSegStartMin + secondSegDuration;

    const firstSegStartUtc = nyLocalDateKeyPlusMinutesToUTCISOString(input.dateKey, firstSegStartMin);
    const firstSegEndUtc = nyLocalDateKeyPlusMinutesToUTCISOString(input.dateKey, firstSegEndMin);
    const secondSegStartUtc = nyLocalDateKeyPlusMinutesToUTCISOString(input.dateKey, secondSegStartMin);
    const secondSegEndUtc = nyLocalDateKeyPlusMinutesToUTCISOString(input.dateKey, secondSegEndMin);

    const duckpinStart = isDuckpinFirst ? firstSegStartUtc : secondSegStartUtc;
    const duckpinEnd = isDuckpinFirst ? firstSegEndUtc : secondSegEndUtc;

    const axeStart = isDuckpinFirst ? secondSegStartUtc : firstSegStartUtc;
    const axeEnd = isDuckpinFirst ? secondSegEndUtc : firstSegEndUtc;

    const { data: bookingId, error } = await sb.rpc("create_combo_booking_with_resources", {
      p_activity: activityDB,
      p_duration_minutes: comboDuration,
      p_party_size: input.partySize,
      p_combo_order: order,
      p_start_ts: comboStartTsUtc,
      p_end_ts: comboEndTsUtc,
      p_duckpin_start_ts: duckpinStart,
      p_duckpin_end_ts: duckpinEnd,
      p_axe_start_ts: axeStart,
      p_axe_end_ts: axeEnd,
      p_total_cents: totalCentsValue,
      p_customer_name: input.customerName,
      p_customer_email: input.customerEmail,
      p_tz: "America/New_York",
    });

    if (error) throw new Error(error.message || "Failed to create combo booking");
    const customerId = await ensureCustomerAndLinkBooking(input, bookingId as string);
    await reservePartyAreas(sb, bookingId as string, partyAreas, partyAreaStartTsUtc, partyAreaEndTsUtc);
    await enforceDuckpinPairing(sb, bookingId as string, duckpinStart, duckpinEnd, needs.lanes);
    return { bookingId, needs, customerId };
  }

  const { data: bookingId, error } = await sb.rpc("create_booking_with_resources", {
    p_activity: activityDB,
    p_duration_minutes: input.durationMinutes,
    p_party_size: input.partySize,
    p_start_ts: startTsUtc,
    p_end_ts: endTsUtc,
    p_total_cents: totalCentsValue,
    p_customer_name: input.customerName,
    p_customer_email: input.customerEmail,
    p_tz: "America/New_York",
  });

  if (error) throw new Error(error.message || "Failed to create booking");
  const customerId = await ensureCustomerAndLinkBooking(input, bookingId as string);
  await reservePartyAreas(sb, bookingId as string, partyAreas, partyAreaStartTsUtc, partyAreaEndTsUtc);
  await enforceDuckpinPairing(sb, bookingId as string, startTsUtc, endTsUtc, needs.lanes);
  return { bookingId, needs, customerId };
}
