import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { comboSegments, neededResources as neededResourcesStandard, nyLocalDateKeyPlusMinutesToUTCISOString } from "@/lib/bookingLogic";

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
  return aStart < bEnd && aEnd > bStart;
}

function mapActivityToDB(activity: Activity) {
  if (activity === "Axe Throwing") return "AXE";
  if (activity === "Duckpin Bowling") return "DUCKPIN";
  return "COMBO";
}

function axeBaysForParty(partySize: number) {
  return Math.max(1, Math.ceil(partySize / 8));
}

function duckpinLanesForParty(partySize: number) {
  return Math.max(1, Math.ceil(partySize / 6));
}

function neededResources(activity: Activity, partySize: number) {
  if (activity === "Axe Throwing") {
    return { AXE: axeBaysForParty(partySize), DUCKPIN: 0 };
  }
  if (activity === "Duckpin Bowling") {
    return { AXE: 0, DUCKPIN: duckpinLanesForParty(partySize) };
  }
  return { AXE: axeBaysForParty(partySize), DUCKPIN: duckpinLanesForParty(partySize) };
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

    const buyout = partySize >= 25;
    const needs = neededResources(activity, partySize);
    let needsAxe = buyout ? 0 : needs.AXE;
    let needsDuck = buyout ? 0 : needs.DUCKPIN;

    if (!buyout && needsAxe <= 0 && needsDuck <= 0) {
      return NextResponse.json({ blockedStartMins: [] }, { status: 200 });
    }

    const supabase = getSupabaseAdmin();
    const activityDB = mapActivityToDB(activity);

    const typesToCheck: ResourceType[] = buyout ? ["AXE", "DUCKPIN"] : [];
    if (!buyout) {
      if (needsAxe > 0) typesToCheck.push("AXE");
      if (needsDuck > 0) typesToCheck.push("DUCKPIN");
    }
    const resolvedTypes = typesToCheck.length ? typesToCheck : (["AXE", "DUCKPIN"] as ResourceType[]);

    const { data: resources, error: resErr } = await supabase
      .from("resources")
      .select("id,type,active")
      .in("type", resolvedTypes)
      .or("active.eq.true,active.is.null");

    if (resErr) {
      console.error("resources query error:", resErr);
      return NextResponse.json(
        { error: resErr.message || "Database error (resources)", code: (resErr as any).code },
        { status: 500 }
      );
    }

    const activeByType: Record<ResourceType, string[]> = { AXE: [], DUCKPIN: [] };
    for (const r of resources || []) {
      const t = r.type as ResourceType;
      if (t === "AXE" || t === "DUCKPIN") activeByType[t].push(r.id);
    }

    if (!buyout) {
      if ((needsAxe > 0 && activeByType.AXE.length === 0) || (needsDuck > 0 && activeByType.DUCKPIN.length === 0)) {
        const blockedAll: number[] = [];
        const lastStart = openEndMin - durationMinutes;
        for (let t = openStartMin; t <= lastStart; t += slotIntervalMin) blockedAll.push(t);
        return NextResponse.json({ blockedStartMins: blockedAll }, { status: 200 });
      }

      if (needsAxe > activeByType.AXE.length) {
        needsAxe = activeByType.AXE.length;
      }
      if (needsDuck > activeByType.DUCKPIN.length) {
        needsDuck = activeByType.DUCKPIN.length;
      }
    }

    const { data: blackouts, error: blackoutErr } = await supabase
      .from("blackout_rules")
      .select("start_min,end_min,activity")
      .eq("date_key", dateKey)
      .in("activity", [activityDB, "ALL"]);

    if (blackoutErr) {
      console.error("blackout rules query error:", blackoutErr);
    }

    const { data: buffers, error: bufferErr } = await supabase
      .from("buffer_rules")
      .select("activity,before_min,after_min,active")
      .eq("active", true)
      .in("activity", [activityDB, "ALL"]);

    if (bufferErr) {
      console.error("buffer rules query error:", bufferErr);
    }

    const bufferBefore = Math.max(0, ...(buffers || []).map((b: any) => Number(b.before_min) || 0));
    const bufferAfter = Math.max(0, ...(buffers || []).map((b: any) => Number(b.after_min) || 0));

    const openStartISO = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, openStartMin);
    const openEndISO = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, openEndMin);

    const resourceIds = [...activeByType.AXE, ...activeByType.DUCKPIN];
    let reservations: any[] = [];
    if (resourceIds.length) {
      const { data, error: rrErr } = await supabase
        .from("resource_reservations")
        .select("resource_id,start_ts,end_ts, resources!inner(type), bookings(status)")
        .gt("end_ts", openStartISO)
        .lt("start_ts", openEndISO)
        .in("resource_id", resourceIds);

      if (rrErr) {
        console.error("reservations query error:", rrErr);
        return NextResponse.json({ error: "Database error (reservations)" }, { status: 500 });
      }
      reservations = data || [];
    }

    const { data: bookings, error: bookingsErr } = await supabase
      .from("bookings")
      .select("activity,party_size,start_ts,end_ts,combo_order,status")
      .gt("end_ts", openStartISO)
      .lt("start_ts", openEndISO);

    if (bookingsErr) {
      console.error("bookings overlap query error:", bookingsErr);
    }

    const intervalsByType: Record<ResourceType, Map<string, Array<[number, number]>>> = {
      AXE: new Map(),
      DUCKPIN: new Map(),
    };
    const allIntervals: Array<[number, number]> = [];

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
      allIntervals.push([s, e]);
    }

    const bookingList = (bookings || []).filter((b: any) => b?.status !== "CANCELLED");
    for (const row of bookingList) {
      const s = new Date(row.start_ts as string).getTime();
      const e = new Date(row.end_ts as string).getTime();
      if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
      allIntervals.push([s, e]);
    }

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

    const bookingUsage = (type: ResourceType, slotStartISO: string, slotEndISO: string) => {
      if (!bookingList.length) return 0;
      const slotS = new Date(slotStartISO).getTime();
      const slotE = new Date(slotEndISO).getTime();
      let used = 0;

      for (const row of bookingList) {
        const activity = row.activity as Activity | undefined;
        const party = Number(row.party_size) || 1;
        if (!activity || !row.start_ts || !row.end_ts) continue;

        const needs = neededResourcesStandard(activity, party);

        if (activity === "Combo Package") {
          const comboFirst = row.combo_order === "AXE_FIRST" ? "AXE" : "DUCKPIN";
          const segments = comboSegments(row.start_ts as string, comboFirst);
          if (type === "AXE") {
            const segS = new Date(segments.axe.start).getTime();
            const segE = new Date(segments.axe.end).getTime();
            if (overlaps(slotS, slotE, segS, segE)) used += needs.AXE;
          } else if (type === "DUCKPIN") {
            const segS = new Date(segments.duckpin.start).getTime();
            const segE = new Date(segments.duckpin.end).getTime();
            if (overlaps(slotS, slotE, segS, segE)) used += needs.DUCKPIN;
          }
          continue;
        }

        const segS = new Date(row.start_ts as string).getTime();
        const segE = new Date(row.end_ts as string).getTime();
        if (!overlaps(slotS, slotE, segS, segE)) continue;

        if (type === "AXE" && activity === "Axe Throwing") {
          used += needs.AXE;
        }
        if (type === "DUCKPIN" && activity === "Duckpin Bowling") {
          used += needs.DUCKPIN;
        }
      }

      return used;
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

      if (!blocked) {
        const slotStartISO = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, slotStartMin);
        const slotEndISO = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, slotEndMin);

        if (buyout) {
          const slotS = new Date(slotStartISO).getTime();
          const slotE = new Date(slotEndISO).getTime();
          for (const [s, e] of allIntervals) {
            if (overlaps(slotS, slotE, s, e)) {
              blocked = true;
              break;
            }
          }
        } else {
          if (needsAxe > 0) {
            let freeAxe = countFree("AXE", slotStartISO, slotEndISO);
            if (intervalsByType.AXE.size === 0) {
              const usedAxe = bookingUsage("AXE", slotStartISO, slotEndISO);
              freeAxe = Math.max(0, activeByType.AXE.length - usedAxe);
            }
            if (freeAxe < needsAxe) blocked = true;
          }
          if (!blocked && needsDuck > 0) {
            let freeDuck = countFree("DUCKPIN", slotStartISO, slotEndISO);
            if (intervalsByType.DUCKPIN.size === 0) {
              const usedDuck = bookingUsage("DUCKPIN", slotStartISO, slotEndISO);
              freeDuck = Math.max(0, activeByType.DUCKPIN.length - usedDuck);
            }
            if (freeDuck < needsDuck) blocked = true;
          }
        }
      }

      if (blocked) blockedStartMins.push(startMin);
    }

    return NextResponse.json({ blockedStartMins }, { status: 200 });
  } catch (err: any) {
    console.error("availability event fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
