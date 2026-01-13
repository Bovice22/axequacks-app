import { NextResponse } from "next/server";
import { getStaffUserFromCookies } from "@/lib/staffAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import { createBookingWithResources } from "@/lib/server/bookingService";
import {
  PARTY_AREA_OPTIONS,
  canonicalPartyAreaName,
  normalizePartyAreaName,
  nyLocalDateKeyPlusMinutesToUTCISOString,
  totalCents,
} from "@/lib/bookingLogic";
import { sendEventRequestAcceptedEmail } from "@/lib/server/mailer";

type Activity = "Axe Throwing" | "Duckpin Bowling";
const PARTY_AREA_BOOKABLE_SET: Set<string> = new Set(
  PARTY_AREA_OPTIONS.filter((option) => option.visible).map((option) => normalizePartyAreaName(option.name))
);

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

async function reservePartyAreasForBooking(
  sb: ReturnType<typeof supabaseServer>,
  bookingId: string,
  partyAreas: string[],
  startIso: string,
  endIso: string
) {
  if (!partyAreas.length) return;
  const { data: resources, error: resErr } = await sb
    .from("resources")
    .select("id,name,type,active")
    .eq("type", "PARTY")
    .or("active.eq.true,active.is.null");

  if (resErr) {
    console.error("party resources query error:", resErr);
    throw new Error("Failed to load party areas");
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
    .gt("end_ts", startIso)
    .lt("start_ts", endIso);

  if (resvErr) {
    console.error("party reservations query error:", resvErr);
    throw new Error("Failed to check party area availability");
  }

  const conflicts = (reservations || []).some((row: any) => row?.bookings?.status !== "CANCELLED");
  if (conflicts) {
    throw new Error("Selected party area is already booked");
  }

  const inserts = resourceIds.map((resourceId) => ({
    booking_id: bookingId,
    resource_id: resourceId,
    start_ts: startIso,
    end_ts: endIso,
  }));
  const { error: insertErr } = await sb.from("resource_reservations").insert(inserts);
  if (insertErr) {
    console.error("party reservations insert error:", insertErr);
    throw new Error("Failed to reserve party area");
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const pathId = url.pathname.split("/").filter(Boolean).pop() || "";
    const routeParams = await params;
    const id = routeParams?.id || pathId;
    if (!id) {
      return NextResponse.json({ error: "Missing ID" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    if (!["accept", "decline", "reschedule"].includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const sb = supabaseServer();
    const { data: requestRow, error } = await sb
      .from("event_requests")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !requestRow) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    const partyAreas = normalizePartyAreas(requestRow.party_areas);
    const partyAreaMinutes = Number(requestRow.party_area_minutes);
    const normalizedPartyAreaMinutes =
      partyAreas.length && Number.isFinite(partyAreaMinutes)
        ? Math.min(480, Math.max(60, Math.round(partyAreaMinutes / 60) * 60))
        : 0;

    if (action !== "reschedule" && requestRow.status && requestRow.status !== "PENDING") {
      return NextResponse.json({ error: "Request already processed" }, { status: 400 });
    }
    if (action === "reschedule" && String(requestRow.status || "").toUpperCase() !== "ACCEPTED") {
      return NextResponse.json({ error: "Only accepted requests can be rescheduled" }, { status: 400 });
    }

    if (action === "decline") {
      const { error: updateErr } = await sb
        .from("event_requests")
        .update({
          status: "DECLINED",
          declined_at: new Date().toISOString(),
          declined_by: staff.id,
        })
        .eq("id", id);

      if (updateErr) {
        console.error("event request decline update error:", updateErr);
        return NextResponse.json({ error: "Failed to update request" }, { status: 500 });
      }

      return NextResponse.json({ status: "DECLINED" }, { status: 200 });
    }

    const activities = Array.isArray(requestRow.activities) ? requestRow.activities : [];
    if (!activities.length) {
      return NextResponse.json({ error: "Request has no activities" }, { status: 400 });
    }

    if (action === "reschedule") {
      const dateKey = String(body?.dateKey || "");
      const startMin = Number(body?.startMin);
      const partySizeOverride = Number(body?.partySize);
      if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        return NextResponse.json({ error: "Invalid date" }, { status: 400 });
      }
      if (!Number.isFinite(startMin) || startMin < 0) {
        return NextResponse.json({ error: "Invalid start time" }, { status: 400 });
      }
      const requestedPartySize = Number.isFinite(partySizeOverride)
        ? partySizeOverride
        : Number(requestRow.party_size || 1);
      if (!Number.isFinite(requestedPartySize) || requestedPartySize < 1 || requestedPartySize > 100) {
        return NextResponse.json({ error: "Invalid party size" }, { status: 400 });
      }

      const bookingIds = Array.isArray(requestRow.booking_ids) ? requestRow.booking_ids : [];
      if (!bookingIds.length) {
        return NextResponse.json({ error: "No bookings to reschedule" }, { status: 400 });
      }

      const bookingPartySize = Math.min(24, Math.max(1, requestedPartySize));
      let offsetMinutes = 0;

      for (let i = 0; i < activities.length; i += 1) {
        const item = activities[i];
        const bookingId = bookingIds[i];
        if (!bookingId) continue;
        const activity = item?.activity as Activity | undefined;
        const durationMinutes = Number(item?.durationMinutes);
        if (!activity || ![30, 60, 120].includes(durationMinutes)) continue;

        const segmentStartMin = startMin + offsetMinutes;
        const segmentEndMin = segmentStartMin + durationMinutes;
        const startIso = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, segmentStartMin);
        const endIso = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, segmentEndMin);
        const partyAreaEndMin = segmentStartMin + (normalizedPartyAreaMinutes || durationMinutes);
        const partyAreaEndIso = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, partyAreaEndMin);
        const activityTotalCents = totalCents(activity as any, requestedPartySize, durationMinutes);

        const startHour = Math.floor(segmentStartMin / 60);
        const startMinute = String(segmentStartMin % 60).padStart(2, "0");
        const endHour = Math.floor(segmentEndMin / 60);
        const endMinute = String(segmentEndMin % 60).padStart(2, "0");
        const startTime = `${String(startHour).padStart(2, "0")}:${startMinute}:00`;
        const endTime = `${String(endHour).padStart(2, "0")}:${endMinute}:00`;

        await sb
          .from("bookings")
          .update({
            date: dateKey,
            start_time: startTime,
            end_time: endTime,
            start_ts: startIso,
            end_ts: endIso,
            duration_minutes: durationMinutes,
            party_size: bookingPartySize,
            total_cents: activityTotalCents,
          })
          .eq("id", bookingId);

        const resourceType = activity === "Axe Throwing" ? "AXE" : "DUCKPIN";
        const { data: resources } = await sb
          .from("resources")
          .select("id,type,active")
          .eq("type", resourceType)
          .or("active.eq.true,active.is.null");

        const resourceIds = (resources || []).map((r: any) => r.id).filter(Boolean);
        if (resourceIds.length) {
          await sb.from("resource_reservations").delete().eq("booking_id", bookingId);
          const inserts = resourceIds.map((resourceId) => ({
            booking_id: bookingId,
            resource_id: resourceId,
            start_ts: startIso,
            end_ts: endIso,
          }));
          await sb.from("resource_reservations").insert(inserts);
        }

        if (partyAreas.length) {
          try {
            await reservePartyAreasForBooking(sb, bookingId, partyAreas, startIso, partyAreaEndIso);
          } catch (err: any) {
            return NextResponse.json({ error: err?.message || "Selected party area is unavailable" }, { status: 400 });
          }
        }

        offsetMinutes += durationMinutes;
      }

      const totalDuration = activities.reduce((sum: number, a: any) => sum + (Number(a?.durationMinutes) || 0), 0);
      const totalCentsValue = activities.reduce((sum: number, a: any) => {
        const activity = a?.activity as Activity | undefined;
        const durationMinutes = Number(a?.durationMinutes);
        if (!activity || ![30, 60, 120].includes(durationMinutes)) return sum;
        return sum + totalCents(activity as any, requestedPartySize, durationMinutes);
      }, 0);
      const { error: updateErr } = await sb
        .from("event_requests")
        .update({
          date_key: dateKey,
          start_min: startMin,
          duration_minutes: totalDuration,
          party_size: requestedPartySize,
          total_cents: totalCentsValue,
        })
        .eq("id", id);

      if (updateErr) {
        console.error("event request reschedule update error:", updateErr);
        return NextResponse.json({ error: "Failed to reschedule request" }, { status: 500 });
      }

      return NextResponse.json({ status: "RESCHEDULED" }, { status: 200 });
    }

    const bookingIds: string[] = [];
    const requestedPartySize = Number(requestRow.party_size || 1);
    const bookingPartySize = Math.min(24, Math.max(1, requestedPartySize));
    const dateKey = String(requestRow.date_key || "");
    const startMin = Number(requestRow.start_min || 0);
    let offsetMinutes = 0;
    for (const item of activities) {
      const activity = item?.activity as Activity | undefined;
      const durationMinutes = Number(item?.durationMinutes);
      if (!activity || ![30, 60, 120].includes(durationMinutes)) continue;

      const segmentStartMin = startMin + offsetMinutes;
      const segmentEndMin = segmentStartMin + durationMinutes;
      const customerName = String(requestRow.customer_name || "");
      const customerEmail = String(requestRow.customer_email || "");
      const customerPhone = requestRow.customer_phone || undefined;
      const activityDb = activity === "Axe Throwing" ? "AXE" : "DUCKPIN";
      const startIso = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, segmentStartMin);
      const endIso = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, segmentEndMin);
      const partyAreaEndMin = segmentStartMin + (normalizedPartyAreaMinutes || durationMinutes);
      const partyAreaEndIso = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, partyAreaEndMin);
      const activityTotalCents = totalCents(activity as any, requestedPartySize, durationMinutes);
      const startHour = Math.floor(segmentStartMin / 60);
      const startMinute = String(segmentStartMin % 60).padStart(2, "0");
      const endHour = Math.floor(segmentEndMin / 60);
      const endMinute = String(segmentEndMin % 60).padStart(2, "0");
      const startTime = `${String(startHour).padStart(2, "0")}:${startMinute}:00`;
      const endTime = `${String(endHour).padStart(2, "0")}:${endMinute}:00`;

      const { data: bookingRow, error: bookingErr } = await sb
        .from("bookings")
        .insert({
          activity: activityDb,
          duration_minutes: durationMinutes,
          party_size: bookingPartySize,
          date: dateKey,
          start_time: startTime,
          end_time: endTime,
          start_ts: startIso,
          end_ts: endIso,
          total_cents: activityTotalCents,
          customer_name: customerName,
          customer_email: customerEmail,
          notes: `Event Request: ${id}`,
          status: "CONFIRMED",
        })
        .select("id")
        .single();

      if (bookingErr || !bookingRow?.id) {
        console.error("event request booking insert error:", bookingErr);
        return NextResponse.json({ error: bookingErr?.message || "Failed to create booking" }, { status: 500 });
      }

      const bookingId = String(bookingRow.id);
      bookingIds.push(bookingId);

      const resourceType = activity === "Axe Throwing" ? "AXE" : "DUCKPIN";
      const { data: resources } = await sb
        .from("resources")
        .select("id,type,active")
        .eq("type", resourceType)
        .or("active.eq.true,active.is.null");

      const resourceIds = (resources || []).map((r: any) => r.id).filter(Boolean);
      if (resourceIds.length) {
        await sb.from("resource_reservations").delete().eq("booking_id", bookingId);
        const inserts = resourceIds.map((resourceId) => ({
          booking_id: bookingId,
          resource_id: resourceId,
          start_ts: startIso,
          end_ts: endIso,
        }));
        await sb.from("resource_reservations").insert(inserts);
      }

      if (partyAreas.length) {
        try {
          await reservePartyAreasForBooking(sb, bookingId, partyAreas, startIso, partyAreaEndIso);
        } catch (err: any) {
          return NextResponse.json({ error: err?.message || "Selected party area is unavailable" }, { status: 400 });
        }
      }

      offsetMinutes += durationMinutes;
    }

    if (!bookingIds.length) {
      return NextResponse.json({ error: "No bookings created" }, { status: 500 });
    }

    const acceptedAt = new Date().toISOString();
    const payInPerson = Boolean(requestRow.pay_in_person);
    const { error: updateErr } = await sb
      .from("event_requests")
      .update({
        status: "ACCEPTED",
        accepted_at: acceptedAt,
        accepted_by: staff.id,
        booking_ids: bookingIds,
        payment_status: payInPerson ? "PAY_IN_PERSON" : "UNPAID",
      })
      .eq("id", id);

    if (updateErr) {
      console.error("event request accept update error:", updateErr);
      return NextResponse.json({ error: "Failed to update request" }, { status: 500 });
    }

    try {
      const totalCents = typeof requestRow.total_cents === "number" ? requestRow.total_cents : undefined;
      await sendEventRequestAcceptedEmail({
        customerName: String(requestRow.customer_name || ""),
        customerEmail: String(requestRow.customer_email || ""),
        customerPhone: requestRow.customer_phone || undefined,
        dateKey: String(requestRow.date_key || ""),
        startMin: Number(requestRow.start_min || 0),
        durationMinutes: Number(requestRow.duration_minutes || 0),
        partySize: Number(requestRow.party_size || 1),
        activities,
        totalCents,
      });
    } catch (emailErr) {
      console.error("event request accepted email error:", emailErr);
    }

    return NextResponse.json({ bookingIds, acceptedAt }, { status: 200 });
  } catch (err: any) {
    console.error("event request accept fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
