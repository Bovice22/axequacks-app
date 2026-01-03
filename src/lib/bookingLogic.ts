// src/lib/bookingLogic.ts

export type Activity = "Axe Throwing" | "Duckpin Bowling" | "Combo Package";

export type NeededResources = {
  AXE: number;
  DUCKPIN: number;
};

export const MAX_PARTY_SIZES: Record<Activity, number> = {
  "Axe Throwing": 16,
  "Duckpin Bowling": 24,
  "Combo Package": 24,
};

export const DURATIONS_MINUTES: Record<Activity, number[]> = {
  "Axe Throwing": [30, 60, 120],
  "Duckpin Bowling": [30, 60, 120],
  // Combo uses per-activity durations (axe + duckpin)
  "Combo Package": [60, 120, 180, 240],
};

// --- RESOURCE THRESHOLDS (SOURCE OF TRUTH) ---

export function duckpinLanesForParty(partySize: number): number {
  // 1 lane: 1-6
  // 2 lanes: 7-12
  // 3 lanes: 13-18
  // 4 lanes: 19-24
  if (partySize >= 19) return 4;
  if (partySize >= 13) return 3;
  if (partySize >= 7) return 2;
  return 1;
}

export function axeBaysForParty(partySize: number): number {
  // Keeping your existing logic style:
  // If you want different thresholds later, change ONLY here.
  // Current: 1 bay up to 8, 2 bays 9-16 (cap 2)
  if (partySize >= 9) return 2;
  return 1;
}

export function neededResources(activity: Activity, partySize: number): NeededResources {
  if (activity === "Axe Throwing") {
    return { AXE: axeBaysForParty(partySize), DUCKPIN: 0 };
  }
  if (activity === "Duckpin Bowling") {
    return { AXE: 0, DUCKPIN: duckpinLanesForParty(partySize) };
  }
  // Combo Package reserves BOTH
  return {
    AXE: axeBaysForParty(partySize),
    DUCKPIN: duckpinLanesForParty(partySize),
  };
}

// --- PRICING (SOURCE OF TRUTH) ---

export const PRICING = {
  AXE_PER_PERSON_CENTS: 2000, // $20
  DUCKPIN_LANE_PER_HOUR_CENTS: 8000, // $80 per lane per hour
};

export type ComboDurations = { axeMinutes: number; duckpinMinutes: number };

export function comboDuckpinLaneCents(minutes: number): number {
  if (minutes === 30) return 30; // $30 per lane
  if (minutes === 60) return 40; // $40 per lane
  if (minutes === 120) return 75; // $75 per lane
  return Math.round(40 * (minutes / 60));
}

export function comboAxePersonCents(minutes: number): number {
  if (minutes === 30) return 15; // $15 per person
  if (minutes === 60) return 20; // $20 per person
  if (minutes === 120) return 35; // $35 per person
  return Math.round(20 * (minutes / 60));
}

export function totalCents(
  activity: Activity,
  partySize: number,
  durationMinutes: number,
  comboDurations?: ComboDurations
): number {
  // Adjust here if your model changes.
  // From your UI examples:
  // Axe: $25 per person per hour
  // Duckpin: $40 per lane (for the duckpin portion)
  // Combo: Duckpin portion + Axe portion

  const hours = durationMinutes / 60;

  if (activity === "Axe Throwing") {
    return Math.round(partySize * 25 * hours * 100);
  }

  if (activity === "Duckpin Bowling") {
    const lanes = duckpinLanesForParty(partySize);
    return Math.round(lanes * 40 * hours * 100);
  }

  // Combo Package: Duckpin @ $40/lane/hour + Axe @ $20/person/hour
  const lanes = duckpinLanesForParty(partySize);
  const duckpinMinutes = comboDurations?.duckpinMinutes ?? 60;
  const axeMinutes = comboDurations?.axeMinutes ?? 60;
  const duckpinPortion = lanes * comboDuckpinLaneCents(duckpinMinutes);
  const axePortion = partySize * comboAxePersonCents(axeMinutes);
  return Math.round((duckpinPortion + axePortion) * 100);
}

// --- TIME HELPERS ---

export function toUtcRange(dateISO: string, startTimeHHmm: string, durationMinutes: number, tz: string) {
  // You already have a working time approach in your routes.
  // Keep using it; this helper is just a placeholder if you want to consolidate later.
  // If you’re currently building UTC timestamps in route.ts, leave that there for now.
  return { tz, dateISO, startTimeHHmm, durationMinutes };
}

// --- TIMEZONE HELPERS ---

export function getTimeZoneOffsetMinutes(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }

  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );

  return Math.round((asUTC - date.getTime()) / 60000);
}

export function nyLocalDateKeyPlusMinutesToUTCISOString(dateKey: string, minsFromMidnight: number) {
  const [y, mo, d] = dateKey.split("-").map(Number);
  const hh = Math.floor(minsFromMidnight / 60);
  const mm = minsFromMidnight % 60;

  const utcGuessMs = Date.UTC(y, (mo ?? 1) - 1, d ?? 1, hh, mm, 0);
  const guessDate = new Date(utcGuessMs);

  const tz = "America/New_York";
  const offsetMin = getTimeZoneOffsetMinutes(guessDate, tz);

  const actualUtcMs = utcGuessMs - offsetMin * 60_000;
  return new Date(actualUtcMs).toISOString();
}

export type ComboFirst = "DUCKPIN" | "AXE";

export function comboSegments(startTs: string, comboFirst: ComboFirst) {
  // startTs is ISO timestamp in UTC (timestamptz string)
  const start = new Date(startTs);
  const mid = new Date(start.getTime() + 60 * 60 * 1000); // +1 hour
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000); // +2 hours

  if (comboFirst === "DUCKPIN") {
    return {
      duckpin: { start: start.toISOString(), end: mid.toISOString() },
      axe: { start: mid.toISOString(), end: end.toISOString() },
      overall: { start: start.toISOString(), end: end.toISOString() },
    };
  }

  return {
    axe: { start: start.toISOString(), end: mid.toISOString() },
    duckpin: { start: mid.toISOString(), end: end.toISOString() },
    overall: { start: start.toISOString(), end: end.toISOString() },
  };
}
