import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { neededResources, nyLocalDateKeyPlusMinutesToUTCISOString } from "@/lib/bookingLogic";

type Activity = "Axe Throwing" | "Duckpin Bowling" | "Combo Package";
type ResourceType = "AXE" | "DUCKPIN";
type ComboOrder = "DUCKPIN_FIRST" | "AXE_FIRST";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  // overlap if start < otherEnd and end > otherStart
  return aStart < bEnd && aEnd > bStart;
}

function mapActivityToDB(activity: Activity) {
  if (activity === "Axe Throwing") return "AXE";
  if (activity === "Duckpin Bowling") return "DUCKPIN";
  return "COMBO";
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    const activity = body?.activity as Activity | undefined;
    const partySize = Number(body?.partySize);
    const dateKey = String(body?.dateKey || "");
    const durationMinutes = Number(body?.durationMinutes);
    const openStartMin = Number(body?.openStartMin);
    const openEndMin = Number(body?.openEndMin);
    const slotIntervalMin = Number(body?.slotIntervalMin);
    const order = (body?.order as ComboOrder | undefined) ?? "DUCKPIN_FIRST";

    // Basic validation
    if (!activity || !["Axe Throwing", "Duckpin Bowling", "Combo Package"].includes(activity)) {
      return NextResponse.json({ error: "Invalid activity" }, { status: 400 });
    }
    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      return NextResponse.json({ error: "Invalid dateKey" }, { status: 400 });
    }
    if (!Number.isFinite(partySize) || partySize < 1) {
      return NextResponse.json({ error: "Invalid partySize" }, { status: 400 });
    }
    if (![30, 60, 120].includes(durationMinutes)) {
      return NextResponse.json({ error: "Invalid durationMinutes" }, { status: 400 });
    }
    if (!Number.isFinite(openStartMin) || !Number.isFinite(openEndMin) || openEndMin <= openStartMin) {
      return NextResponse.json({ error: "Invalid time window" }, { status: 400 });
    }
    if (![30, 60].includes(slotIntervalMin)) {
      return NextResponse.json({ error: "Invalid slotIntervalMin" }, { status: 400 });
    }
    if (!["DUCKPIN_FIRST", "AXE_FIRST"].includes(order)) {
      return NextResponse.json({ error: "Invalid order" }, { status: 400 });
    }

    const needs = neededResources(activity, partySize);
    const needsAxe = needs.AXE;
    const needsDuck = needs.DUCKPIN;

    // If somehow nothing needed, nothing blocked.
    if (needsAxe <= 0 && needsDuck <= 0) {
      return NextResponse.json({ blockedStartMins: [] }, { status: 200 });
    }

    const supabase = getSupabaseAdmin();
    const activityDB = mapActivityToDB(activity);

    // 1) Load active resource counts for relevant types
    const typesToCheck: ResourceType[] = [];
    if (needsAxe > 0) typesToCheck.push("AXE");
    if (needsDuck > 0) typesToCheck.push("DUCKPIN");

    const { data: resources, error: resErr } = await supabase
      .from("resources")
      .select("id,type,active")
      .in("type", typesToCheck)
      // Treat NULL as active to match staff UI behavior.
      .or("active.eq.true,active.is.null");

    if (resErr) {
      console.error("resources query error:", resErr);
      return NextResponse.json({ error: "Database error (resources)" }, { status: 500 });
    }

    const activeByType: Record<ResourceType, string[]> = { AXE: [], DUCKPIN: [] };
    for (const r of resources || []) {
      const t = r.type as ResourceType;
      if (t === "AXE" || t === "DUCKPIN") activeByType[t].push(r.id);
    }

    // If there aren’t even enough total resources, every slot is blocked
    if ((needsAxe > 0 && activeByType.AXE.length < needsAxe) || (needsDuck > 0 && activeByType.DUCKPIN.length < needsDuck)) {
      const blockedAll: number[] = [];
      const lastStart = openEndMin - durationMinutes;
      for (let t = openStartMin; t <= lastStart; t += slotIntervalMin) blockedAll.push(t);
      return NextResponse.json({ blockedStartMins: blockedAll }, { status: 200 });
    }

    // 2a) Load blackout rules for the date/activity
    const { data: blackouts, error: blackoutErr } = await supabase
      .from("blackout_rules")
      .select("start_min,end_min,activity")
      .eq("date_key", dateKey)
      .in("activity", [activityDB, "ALL"]);

    if (blackoutErr) {
      console.error("blackout rules query error:", blackoutErr);
    }

    // 2b) Load buffer rules for activity (default 0)
    const { data: buffers, error: bufferErr } = await supabase
      .from("buffer_rules")
      .select("activity,before_min,after_min,active")
      .eq("active", true)
      .in("activity", [activityDB, "ALL"]);

    if (bufferErr) {
      console.error("buffer rules query error:", bufferErr);
    }

    const bufferBefore = Math.max(
      0,
      ...(buffers || []).map((b: any) => Number(b.before_min) || 0)
    );
    const bufferAfter = Math.max(
      0,
      ...(buffers || []).map((b: any) => Number(b.after_min) || 0)
    );

    // 3) Fetch all reservations overlapping the OPEN window for relevant resource types
    const openStartISO = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, openStartMin);
    const openEndISO = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, openEndMin);

    // We join resources to get resource type
    const { data: reservations, error: rrErr } = await supabase
      .from("resource_reservations")
      .select("resource_id,start_ts,end_ts, resources!inner(type), bookings(status)")
      .gt("end_ts", openStartISO) // ends after openStart
      .lt("start_ts", openEndISO) // starts before openEnd
      .in("resource_id", [...activeByType.AXE, ...activeByType.DUCKPIN]); // only active resources we care about

    if (rrErr) {
      console.error("reservations query error:", rrErr);
      return NextResponse.json({ error: "Database error (reservations)" }, { status: 500 });
    }

    // Build map: type -> resource_id -> list of [startMs,endMs] (UTC ms)
    const intervalsByType: Record<ResourceType, Map<string, Array<[number, number]>>> = {
      AXE: new Map(),
      DUCKPIN: new Map(),
    };

    for (const row of reservations || []) {
      const status = (row as any)?.bookings?.status as string | null | undefined;
      if (status === "CANCELLED") continue;
      const resourceId = row.resource_id as string;
      const type = (row as any)?.resources?.type as ResourceType | undefined;
      if (!type || (type !== "AXE" && type !== "DUCKPIN")) continue;

      const s = new Date(row.start_ts as string).getTime();
      const e = new Date(row.end_ts as string).getTime();
      if (!Number.isFinite(s) || !Number.isFinite(e)) continue;

      const m = intervalsByType[type];
      const list = m.get(resourceId) || [];
      list.push([s, e]);
      m.set(resourceId, list);
    }

    // Helper: count how many resources of a type are fully free for the slot window
    const countFree = (type: ResourceType, slotStartISO: string, slotEndISO: string) => {
      const slotS = new Date(slotStartISO).getTime();
      const slotE = new Date(slotEndISO).getTime();
      let free = 0;

      for (const resourceId of activeByType[type]) {
        const intervals = intervalsByType[type].get(resourceId) || [];
        let isUsed = false;
        for (const [s, e] of intervals) {
          if (overlaps(slotS, slotE, s, e)) {
            isUsed = true;
            break;
          }
        }
        if (!isUsed) free += 1;
      }

      return free;
    };

    const blockedStartMins: number[] = [];
    const lastStart = openEndMin - durationMinutes;

    for (let startMin = openStartMin; startMin <= lastStart; startMin += slotIntervalMin) {
      let blocked = false;
      const slotStartMin = Math.max(openStartMin, startMin - bufferBefore);
      const slotEndMin = Math.min(openEndMin, startMin + durationMinutes + bufferAfter);

      if ((blackouts || []).length) {
        for (const b of blackouts || []) {
          const bStart = Number(b.start_min ?? openStartMin);
          const bEnd = Number(b.end_min ?? openEndMin);
          if (overlaps(slotStartMin, slotEndMin, bStart, bEnd)) {
            blocked = true;
            break;
          }
        }
      }
      if (blocked) {
        blockedStartMins.push(startMin);
        continue;
      }

      if (activity === "Combo Package") {
        // Combo is always 120 in your UI, but each segment is 60
        const seg1Start = startMin;
        const seg1End = startMin + 60;
        const seg2Start = startMin + 60;
        const seg2End = startMin + 120;

        // Ensure segments fit (defensive)
        if (seg2End > openEndMin) {
          blockedStartMins.push(startMin);
          continue;
        }

        const duckpinSegStart = order === "DUCKPIN_FIRST" ? seg1Start : seg2Start;
        const duckpinSegEnd = order === "DUCKPIN_FIRST" ? seg1End : seg2End;

        const axeSegStart = order === "DUCKPIN_FIRST" ? seg2Start : seg1Start;
        const axeSegEnd = order === "DUCKPIN_FIRST" ? seg2End : seg1End;

        const duckpinStartISO = nyLocalDateKeyPlusMinutesToUTCISOString(
          dateKey,
          Math.max(openStartMin, duckpinSegStart - bufferBefore)
        );
        const duckpinEndISO = nyLocalDateKeyPlusMinutesToUTCISOString(
          dateKey,
          Math.min(openEndMin, duckpinSegEnd + bufferAfter)
        );

        const axeStartISO = nyLocalDateKeyPlusMinutesToUTCISOString(
          dateKey,
          Math.max(openStartMin, axeSegStart - bufferBefore)
        );
        const axeEndISO = nyLocalDateKeyPlusMinutesToUTCISOString(
          dateKey,
          Math.min(openEndMin, axeSegEnd + bufferAfter)
        );

        // duckpin check only during duckpin segment
        if (needsDuck > 0) {
          const freeDuck = countFree("DUCKPIN", duckpinStartISO, duckpinEndISO);
          if (freeDuck < needsDuck) blocked = true;
        }

        // axe check only during axe segment
        if (!blocked && needsAxe > 0) {
          const freeAxe = countFree("AXE", axeStartISO, axeEndISO);
          if (freeAxe < needsAxe) blocked = true;
        }
      } else {
        // Non-combo: single window
        const endMin = startMin + durationMinutes;
        const slotStartISO = nyLocalDateKeyPlusMinutesToUTCISOString(
          dateKey,
          Math.max(openStartMin, startMin - bufferBefore)
        );
        const slotEndISO = nyLocalDateKeyPlusMinutesToUTCISOString(
          dateKey,
          Math.min(openEndMin, endMin + bufferAfter)
        );

        if (needsAxe > 0) {
          const freeAxe = countFree("AXE", slotStartISO, slotEndISO);
          if (freeAxe < needsAxe) blocked = true;
        }

        if (!blocked && needsDuck > 0) {
          const freeDuck = countFree("DUCKPIN", slotStartISO, slotEndISO);
          if (freeDuck < needsDuck) blocked = true;
        }
      }

      if (blocked) blockedStartMins.push(startMin);
    }

    return NextResponse.json({ blockedStartMins }, { status: 200 });
  } catch (e: any) {
    console.error("availability route fatal:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
