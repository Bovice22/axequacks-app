import { NextResponse } from "next/server";
import { getStaffUserFromCookies } from "@/lib/staffAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import { createBookingWithResources } from "@/lib/server/bookingService";
import {
  PARTY_AREA_OPTIONS,
  canonicalPartyAreaName,
  neededResources,
  normalizePartyAreaName,
  nyLocalDateKeyPlusMinutesToUTCISOString,
  totalCents,
} from "@/lib/bookingLogic";
import { sendEventRequestAcceptedEmail, sendOwnerNotification } from "@/lib/server/mailer";

type Activity = "Axe Throwing" | "Duckpin Bowling";
type PartyAreaTiming = "BEFORE" | "DURING" | "AFTER";
const PARTY_AREA_BOOKABLE_SET: Set<string> = new Set(
  PARTY_AREA_OPTIONS.filter((option) => option.visible).map((option) => normalizePartyAreaName(option.name))
);

function formatTimeFromMinutes(minsFromMidnight: number) {
  const h24 = Math.floor(minsFromMidnight / 60);
  const m = minsFromMidnight % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
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

function overlaps(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && startB < endA;
}

function computePartyAreaWindow(input: {
  startMin: number;
  totalDuration: number;
  partyAreaMinutes: number;
  timing: PartyAreaTiming;
}) {
  const partyWindowMinutes = input.partyAreaMinutes || input.totalDuration;
  const startMin =
    input.timing === "BEFORE"
      ? input.startMin - partyWindowMinutes
      : input.timing === "AFTER"
      ? input.startMin + input.totalDuration
      : input.startMin;
  const endMin = startMin + partyWindowMinutes;
  return { startMin, endMin };
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
    .gt("end_ts", startIso)
    .lt("start_ts", endIso);

  if (resvErr) {
    console.error("party reservations query error:", resvErr);
    throw new Error("Failed to check party area availability");
  }

  const conflicts = (reservations || []).some((row: any) => {
    if (row?.bookings == null) return false;
    return row?.bookings?.status !== "CANCELLED";
  });
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
    const partyAreaTiming = (String(requestRow.party_area_timing || "DURING").toUpperCase() as PartyAreaTiming);

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
      const totalDuration = activities.reduce((sum: number, a: any) => sum + (Number(a?.durationMinutes) || 0), 0);
      const partyWindow = computePartyAreaWindow({
        startMin,
        totalDuration,
        partyAreaMinutes: normalizedPartyAreaMinutes || totalDuration,
        timing: partyAreaTiming,
      });
      if (partyAreaTiming === "BEFORE" && partyWindow.startMin < 0) {
        return NextResponse.json({ error: "Party area must start after opening." }, { status: 400 });
      }
      const partyAreaStartIso = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, partyWindow.startMin);
      const partyAreaEndIso = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, partyWindow.endMin);
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

        offsetMinutes += durationMinutes;
      }

      if (partyAreas.length && bookingIds.length) {
        try {
          await reservePartyAreasForBooking(sb, bookingIds[0], partyAreas, partyAreaStartIso, partyAreaEndIso);
        } catch (err: any) {
          return NextResponse.json({ error: err?.message || "Selected party area is unavailable" }, { status: 400 });
        }
      }

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

    if (action === "accept") {
      const existingBookingIds = Array.isArray(requestRow.booking_ids)
        ? requestRow.booking_ids.map((value: any) => String(value || "")).filter(Boolean)
        : [];
      if (existingBookingIds.length) {
        const acceptedAt = new Date().toISOString();
        const payInPerson = Boolean(requestRow.pay_in_person);
        const { error: updateErr } = await sb
          .from("event_requests")
          .update({
            status: "ACCEPTED",
            accepted_at: acceptedAt,
            accepted_by: staff.id,
            booking_ids: existingBookingIds,
            payment_status: payInPerson ? "PAY_IN_PERSON" : "UNPAID",
          })
          .eq("id", id);

        if (updateErr) {
          console.error("event request accept update error:", updateErr);
          return NextResponse.json({ error: "Failed to update request" }, { status: 500 });
        }

        return NextResponse.json({ bookingIds: existingBookingIds, acceptedAt }, { status: 200 });
      }

      const { data: existingBookings, error: existingBookingsErr } = await sb
        .from("bookings")
        .select("id")
        .eq("notes", `Event Request: ${id}`);

      if (existingBookingsErr) {
        console.error("event request booking lookup error:", existingBookingsErr);
      }

      const recoveredBookingIds = (existingBookings || []).map((row: any) => String(row?.id || "")).filter(Boolean);
      if (recoveredBookingIds.length) {
        const acceptedAt = new Date().toISOString();
        const payInPerson = Boolean(requestRow.pay_in_person);
        const { error: updateErr } = await sb
          .from("event_requests")
          .update({
            status: "ACCEPTED",
            accepted_at: acceptedAt,
            accepted_by: staff.id,
            booking_ids: recoveredBookingIds,
            payment_status: payInPerson ? "PAY_IN_PERSON" : "UNPAID",
          })
          .eq("id", id);

        if (updateErr) {
          console.error("event request accept update error:", updateErr);
          return NextResponse.json({ error: "Failed to update request" }, { status: 500 });
        }

        return NextResponse.json({ bookingIds: recoveredBookingIds, acceptedAt }, { status: 200 });
      }
    }

    const bookingIds: string[] = [];
    const requestedPartySize = Number(requestRow.party_size || 1);
    const bookingPartySize = Math.min(24, Math.max(1, requestedPartySize));
    const dateKey = String(requestRow.date_key || "");
    const startMin = Number(requestRow.start_min || 0);
    const totalDuration = activities.reduce((sum: number, a: any) => sum + (Number(a?.durationMinutes) || 0), 0);
    const partyWindow = computePartyAreaWindow({
      startMin,
      totalDuration,
      partyAreaMinutes: normalizedPartyAreaMinutes || totalDuration,
      timing: partyAreaTiming,
    });
    if (partyAreaTiming === "BEFORE" && partyWindow.startMin < 0) {
      return NextResponse.json({ error: "Party area must start after opening." }, { status: 400 });
    }
    const partyAreaStartIso = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, partyWindow.startMin);
    const partyAreaEndIso = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, partyWindow.endMin);
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
      const needs = neededResources(activity, bookingPartySize);
      const neededCount = needs[resourceType];
      const { data: resources } = await sb
        .from("resources")
        .select("id,type,active")
        .eq("type", resourceType)
        .or("active.eq.true,active.is.null");

      const resourceIds = Array.from(new Set((resources || []).map((r: any) => r.id).filter(Boolean)));
      if (neededCount > 0 && resourceIds.length < neededCount) {
        return NextResponse.json({ error: "Selected time is unavailable" }, { status: 400 });
      }
      if (neededCount > 0 && resourceIds.length) {
        await sb.from("resource_reservations").delete().eq("booking_id", bookingId);
        const { data: reservations, error: resvLookupErr } = await sb
          .from("resource_reservations")
          .select("resource_id,start_ts,end_ts, bookings(status)")
          .in("resource_id", resourceIds)
          .gt("end_ts", startIso)
          .lt("start_ts", endIso);

        if (resvLookupErr) {
          return NextResponse.json({ error: "Failed to check resource availability" }, { status: 500 });
        }

        const occupied = new Set<string>();
        for (const row of reservations || []) {
          if ((row as any)?.bookings == null) continue;
          const status = (row as any)?.bookings?.status as string | null | undefined;
          if (status === "CANCELLED") continue;
          const resourceId = String((row as any)?.resource_id || "");
          const start = new Date((row as any)?.start_ts as string).getTime();
          const end = new Date((row as any)?.end_ts as string).getTime();
          if (!resourceId || !Number.isFinite(start) || !Number.isFinite(end)) continue;
          if (overlaps(start, end, new Date(startIso).getTime(), new Date(endIso).getTime())) {
            occupied.add(resourceId);
          }
        }

        const available = resourceIds.filter((resourceId) => !occupied.has(resourceId));
        if (available.length < neededCount) {
          return NextResponse.json({ error: "Selected time is unavailable" }, { status: 400 });
        }

        const inserts = available.slice(0, neededCount).map((resourceId) => ({
          booking_id: bookingId,
          resource_id: resourceId,
          start_ts: startIso,
          end_ts: endIso,
        }));
        const { error: insertErr } = await sb.from("resource_reservations").insert(inserts);
        if (insertErr) {
          console.error("event request reservations insert error:", insertErr);
          return NextResponse.json(
            { error: "Failed to reserve resources", detail: insertErr?.message || "Insert failed" },
            { status: 500 }
          );
        }
      }

      offsetMinutes += durationMinutes;
    }

    if (partyAreas.length && bookingIds.length) {
      try {
        await reservePartyAreasForBooking(sb, bookingIds[0], partyAreas, partyAreaStartIso, partyAreaEndIso);
      } catch (err: any) {
        return NextResponse.json(
          { error: err?.message || "Selected party area is unavailable", detail: err?.message || "" },
          { status: 400 }
        );
      }
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

    try {
      const startLabel = formatTimeFromMinutes(Number(requestRow.start_min || 0));
      const endLabel = formatTimeFromMinutes(
        Number(requestRow.start_min || 0) + Number(requestRow.duration_minutes || 0)
      );
      await sendOwnerNotification({
        subject: "Axe Quacks: Event Request Accepted",
        lines: [
          `Request ID: ${requestRow.id}`,
          `Customer: ${requestRow.customer_name || "—"}`,
          `Email: ${requestRow.customer_email || "—"}`,
          requestRow.customer_phone ? `Phone: ${requestRow.customer_phone}` : null,
          `Date: ${requestRow.date_key}`,
          `Time: ${startLabel} – ${endLabel}`,
          `Party Size: ${requestRow.party_size || "—"}`,
          `Activities: ${activities.map((a) => `${a.activity} (${a.durationMinutes} min)`).join(", ")}`,
          requestRow.party_areas?.length ? `Party Area: ${requestRow.party_areas.join(", ")}` : null,
          requestRow.party_area_minutes ? `Party Area Duration: ${requestRow.party_area_minutes / 60} hr` : null,
          payInPerson ? "Payment: Pay in Person" : "Payment: Unpaid (payment link available)",
        ].filter(Boolean) as string[],
      });
    } catch (err) {
      console.error("event request accepted owner notify error:", err);
    }

    return NextResponse.json({ bookingIds, acceptedAt }, { status: 200 });
  } catch (err: any) {
    console.error("event request accept fatal:", err);
    return NextResponse.json(
      { error: err?.message || "Server error", detail: err?.message || "" },
      { status: 500 }
    );
  }
}
