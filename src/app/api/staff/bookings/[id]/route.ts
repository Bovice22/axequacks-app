import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getStaffUserFromCookies } from "@/lib/staffAuth";
import { PARTY_AREA_OPTIONS, neededResources, nyLocalDateKeyPlusMinutesToUTCISOString } from "@/lib/bookingLogic";
import { sendOwnerNotification } from "@/lib/server/mailer";
import { validateGiftCertificate, redeemGiftCertificate } from "@/lib/server/giftCertificates";

const ALLOWED_STATUSES = new Set(["CONFIRMED", "CANCELLED", "NO-SHOW", "COMPLETED"]);
const ACTIVITY_DB = {
  "Axe Throwing": "AXE",
  "Duckpin Bowling": "DUCKPIN",
  "Combo Package": "COMBO",
} as const;
const PARTY_AREA_NAME_SET: Set<string> = new Set(PARTY_AREA_OPTIONS.map((option) => option.name));

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

function timeLabelFromIsoNY(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
}

function weekdayNY(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const utc = Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0);
  const label = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(
    new Date(utc)
  );
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[label] ?? 0;
}

function getOpenWindowForDateKey(dateKey: string): { openMin: number; closeMin: number } | null {
  if (!dateKey) return null;
  const day = weekdayNY(dateKey);
  if (day === 4) return { openMin: 16 * 60, closeMin: 22 * 60 };
  if (day === 5) return { openMin: 16 * 60, closeMin: 23 * 60 };
  if (day === 6) return { openMin: 12 * 60, closeMin: 23 * 60 };
  if (day === 0) return { openMin: 12 * 60, closeMin: 21 * 60 };
  return null;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && aEnd > bStart;
}

async function logBookingEvent(sb: ReturnType<typeof getSupabaseAdmin>, payload: {
  bookingId: string;
  staffId: string;
  action: string;
  details?: Record<string, any>;
}) {
  const { bookingId, staffId, action, details } = payload;
  const { error } = await sb.from("booking_audit_logs").insert({
    booking_id: bookingId,
    staff_id: staffId,
    action,
    details: details ?? {},
  });
  if (error) {
    console.error("booking audit log error:", error);
  }
}

export async function GET(req: Request, context: RouteContext) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const id = (await getRouteId(req, context)) || new URL(req.url).searchParams.get("id") || "";
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const sb = getSupabaseAdmin();
    let { data, error } = await sb
      .from("bookings")
      .select(
        "id,customer_name,customer_email,party_size,status,activity,combo_order,duration_minutes,start_ts,end_ts,paid,notes,assigned_staff_id,tip_cents,tip_staff_id"
      )
      .eq("id", id)
      .single();

    const errMessage = String(error?.message || "").toLowerCase();
    if (
      error &&
      (errMessage.includes("assigned_staff_id") ||
        errMessage.includes("tip_staff_id") ||
        errMessage.includes("tip_cents"))
    ) {
      ({ data, error } = await sb
        .from("bookings")
        .select("id,customer_name,customer_email,party_size,status,activity,combo_order,duration_minutes,start_ts,end_ts,paid,notes")
        .eq("id", id)
        .single());
    }

    if (error || !data) {
      console.error("staff booking fetch error:", error);
      return NextResponse.json({ error: "Failed to load booking" }, { status: 500 });
    }

    return NextResponse.json({ booking: data }, { status: 200 });
  } catch (err: any) {
    console.error("staff booking fetch fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const id =
      (await getRouteId(req, context)) ||
      String(body?.id || "") ||
      new URL(req.url).searchParams.get("id") ||
      "";
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const updates: Record<string, any> = {};
    const giftCode = String(body?.gift_code || "").trim();
    const statusRaw = body?.status;
    const status = statusRaw ? String(statusRaw).toUpperCase() : "";
    if (status) {
      if (!ALLOWED_STATUSES.has(status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      updates.status = status;
    }
    if (body?.customer_name != null) {
      updates.customer_name = String(body.customer_name || "").trim() || null;
    }
    if (body?.customer_email != null) {
      updates.customer_email = String(body.customer_email || "").trim().toLowerCase() || null;
    }
    if (body?.party_size != null) {
      const size = Number(body.party_size);
      if (!Number.isFinite(size) || size <= 0) {
        return NextResponse.json({ error: "Invalid party size" }, { status: 400 });
      }
      updates.party_size = Math.round(size);
    }
    if (body?.notes != null) {
      const note = String(body.notes || "").trim();
      updates.notes = note || null;
    }
    if (body?.paid != null) {
      updates.paid = Boolean(body.paid);
    }
    if (body?.assigned_staff_id != null) {
      if (staff.role !== "admin") {
        return NextResponse.json({ error: "Admin only" }, { status: 401 });
      }
      const staffId = String(body.assigned_staff_id || "").trim().toLowerCase();
      if (!staffId) {
        updates.assigned_staff_id = null;
      } else {
        const sb = getSupabaseAdmin();
        const { data: staffRow, error: staffErr } = await sb
          .from("staff_users")
          .select("staff_id,active")
          .eq("staff_id", staffId)
          .single();
        if (staffErr || !staffRow || staffRow.active === false) {
          return NextResponse.json({ error: "Assigned staff not found" }, { status: 400 });
        }
        updates.assigned_staff_id = staffRow.staff_id;
      }
    }
    let activityOverride: keyof typeof ACTIVITY_DB | null = null;
    if (body?.activity != null) {
      const activity = String(body.activity || "");
      const activityDb = ACTIVITY_DB[activity as keyof typeof ACTIVITY_DB];
      if (!activityDb) {
        return NextResponse.json({ error: "Invalid activity" }, { status: 400 });
      }
      activityOverride = activity as keyof typeof ACTIVITY_DB;
      updates.activity = activityDb;
    }
    const durationRaw = Number(body?.durationMinutes);
    let durationOverride: number | null = null;
    if (Number.isFinite(durationRaw)) {
      if (durationRaw <= 0) {
        return NextResponse.json({ error: "Invalid duration" }, { status: 400 });
      }
      durationOverride = Math.round(durationRaw);
    }
    if (activityOverride === "Combo Package" && durationOverride !== 120) {
      durationOverride = 120;
    }
    if (durationOverride != null) {
      updates.duration_minutes = durationOverride;
    }

    const sb = getSupabaseAdmin();

    const dateKey = String(body?.dateKey || "").trim();
    const startMin = Number(body?.startMin);
    const reschedule = !!dateKey || Number.isFinite(startMin);

    if (reschedule) {
      if (!dateKey || !Number.isFinite(startMin)) {
        return NextResponse.json({ error: "Missing reschedule date/time" }, { status: 400 });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        return NextResponse.json({ error: "Invalid date" }, { status: 400 });
      }

      const { data: booking, error: bookingErr } = await sb
        .from("bookings")
        .select("id,activity,party_size,duration_minutes,combo_order,status")
        .eq("id", id)
        .single();

      if (bookingErr || !booking) {
        return NextResponse.json({ error: "Booking not found" }, { status: 404 });
      }

      const activity = activityOverride ?? (String(booking.activity || "") as keyof typeof ACTIVITY_DB);
      const activityDb = ACTIVITY_DB[activity];
      if (!activityDb) {
        return NextResponse.json({ error: "Unsupported activity" }, { status: 400 });
      }

      const durationMinutes = durationOverride ?? Number(booking.duration_minutes || 0);
      if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
        return NextResponse.json({ error: "Invalid duration" }, { status: 400 });
      }

      const openWindow = getOpenWindowForDateKey(dateKey);
      if (!openWindow) {
        return NextResponse.json({ error: "Closed on selected day" }, { status: 400 });
      }
      const openStartMin = openWindow.openMin;
      const openEndMin = openWindow.closeMin;
      if (startMin < openStartMin || startMin + durationMinutes > openEndMin) {
        return NextResponse.json({ error: "Selected time outside business hours" }, { status: 400 });
      }

      const { data: blackouts } = await sb
        .from("blackout_rules")
        .select("start_min,end_min,activity")
        .eq("date_key", dateKey)
        .in("activity", [activityDb, "ALL"]);

      const { data: buffers } = await sb
        .from("buffer_rules")
        .select("activity,before_min,after_min,active")
        .eq("active", true)
        .in("activity", [activityDb, "ALL"]);

      const bufferBefore = Math.max(0, ...(buffers || []).map((b: any) => Number(b.before_min) || 0));
      const bufferAfter = Math.max(0, ...(buffers || []).map((b: any) => Number(b.after_min) || 0));

      const slotStartMin = Math.max(openStartMin, startMin - bufferBefore);
      const slotEndMin = Math.min(openEndMin, startMin + durationMinutes + bufferAfter);
      if ((blackouts || []).some((b: any) => overlaps(slotStartMin, slotEndMin, Number(b.start_min), Number(b.end_min)))) {
        return NextResponse.json({ error: "Selected time is blocked" }, { status: 400 });
      }

      const partySizeOverride = updates.party_size ?? booking.party_size ?? 1;
      const needs = neededResources(activity as any, Number(partySizeOverride || 1));
      const types: Array<"AXE" | "DUCKPIN"> = [];
      if (needs.AXE > 0) types.push("AXE");
      if (needs.DUCKPIN > 0) types.push("DUCKPIN");

      const { data: resources, error: resErr } = await sb
        .from("resources")
        .select("id,type,active")
        .in("type", types)
        .or("active.eq.true,active.is.null");

      if (resErr) {
        return NextResponse.json({ error: "Failed to load resources" }, { status: 500 });
      }

      const activeByType: Record<"AXE" | "DUCKPIN", string[]> = { AXE: [], DUCKPIN: [] };
      for (const r of resources || []) {
        const t = r.type as "AXE" | "DUCKPIN";
        if (t === "AXE" || t === "DUCKPIN") activeByType[t].push(r.id);
      }

      if ((needs.AXE > 0 && activeByType.AXE.length < needs.AXE) || (needs.DUCKPIN > 0 && activeByType.DUCKPIN.length < needs.DUCKPIN)) {
        return NextResponse.json({ error: "Not enough resources available" }, { status: 400 });
      }

      const startIso = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, startMin);
      const endIso = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, startMin + durationMinutes);

      const { data: reservations } = await sb
        .from("resource_reservations")
        .select("resource_id,start_ts,end_ts, resources!inner(type)")
        .in("resource_id", [...activeByType.AXE, ...activeByType.DUCKPIN])
        .neq("booking_id", id)
        .gt("end_ts", startIso)
        .lt("start_ts", endIso);

      const intervalsByType: Record<"AXE" | "DUCKPIN", Map<string, Array<[number, number]>>> = {
        AXE: new Map(),
        DUCKPIN: new Map(),
      };
      for (const row of reservations || []) {
        const type = (row as any)?.resources?.type as "AXE" | "DUCKPIN" | undefined;
        const resourceId = row.resource_id as string;
        if (!type || !resourceId) continue;
        const s = new Date(row.start_ts as string).getTime();
        const e = new Date(row.end_ts as string).getTime();
        const list = intervalsByType[type].get(resourceId) || [];
        list.push([s, e]);
        intervalsByType[type].set(resourceId, list);
      }

      const findFree = (type: "AXE" | "DUCKPIN", segStart: string, segEnd: string, count: number) => {
        const segS = new Date(segStart).getTime();
        const segE = new Date(segEnd).getTime();
        const chosen: string[] = [];
        for (const resourceId of activeByType[type]) {
          const intervals = intervalsByType[type].get(resourceId) || [];
          let isUsed = false;
          for (const [s, e] of intervals) {
            if (overlaps(segS, segE, s, e)) {
              isUsed = true;
              break;
            }
          }
          if (!isUsed) {
            chosen.push(resourceId);
            if (chosen.length >= count) break;
          }
        }
        return chosen.length >= count ? chosen : null;
      };

      const comboOrder = String(booking.combo_order || "DUCKPIN_FIRST");
      const isCombo = activity === "Combo Package";

      let axeStartIso = startIso;
      let axeEndIso = endIso;
      let duckStartIso = startIso;
      let duckEndIso = endIso;

      if (isCombo) {
        const firstStart = startMin;
        const firstEnd = startMin + 60;
        const secondStart = startMin + 60;
        const secondEnd = startMin + 120;
        const duckpinFirst = comboOrder !== "AXE_FIRST";
        const duckpinStartMin = duckpinFirst ? firstStart : secondStart;
        const duckpinEndMin = duckpinFirst ? firstEnd : secondEnd;
        const axeStartMin = duckpinFirst ? secondStart : firstStart;
        const axeEndMin = duckpinFirst ? secondEnd : firstEnd;
        duckStartIso = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, duckpinStartMin);
        duckEndIso = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, duckpinEndMin);
        axeStartIso = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, axeStartMin);
        axeEndIso = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, axeEndMin);
      }

      const axeResources = needs.AXE > 0 ? findFree("AXE", axeStartIso, axeEndIso, needs.AXE) : [];
      const duckResources = needs.DUCKPIN > 0 ? findFree("DUCKPIN", duckStartIso, duckEndIso, needs.DUCKPIN) : [];

      if ((needs.AXE > 0 && !axeResources) || (needs.DUCKPIN > 0 && !duckResources)) {
        return NextResponse.json({ error: "Selected time is unavailable" }, { status: 400 });
      }

      const { data: existingPartyReservations } = await sb
        .from("resource_reservations")
        .select("resource_id,start_ts,end_ts, resources!inner(type,name)")
        .eq("booking_id", id);
      const partyResourceIds = (existingPartyReservations || [])
        .filter((row: any) => {
          const type = String(row?.resources?.type || "").toUpperCase();
          const name = String(row?.resources?.name || "");
          return type === "PARTY" || PARTY_AREA_NAME_SET.has(name);
        })
        .map((row: any) => row.resource_id)
        .filter(Boolean);
      const partyDurationMs = (existingPartyReservations || [])
        .filter((row: any) => {
          const type = String(row?.resources?.type || "").toUpperCase();
          const name = String(row?.resources?.name || "");
          return type === "PARTY" || PARTY_AREA_NAME_SET.has(name);
        })
        .map((row: any) => {
          const start = new Date(row.start_ts as string).getTime();
          const end = new Date(row.end_ts as string).getTime();
          return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
        })
        .reduce((max: number, val: number) => Math.max(max, val), 0);
      const partyEndIso =
        partyDurationMs > 0 ? new Date(new Date(startIso).getTime() + partyDurationMs).toISOString() : endIso;

      if (partyResourceIds.length) {
        const { data: partyConflicts, error: partyErr } = await sb
          .from("resource_reservations")
          .select("resource_id, bookings(status)")
          .in("resource_id", partyResourceIds)
          .neq("booking_id", id)
          .gt("end_ts", startIso)
          .lt("start_ts", endIso);

        if (partyErr) {
          return NextResponse.json({ error: "Failed to check party area availability" }, { status: 500 });
        }

        const hasConflict = (partyConflicts || []).some((row: any) => {
          if (row?.bookings == null) return false;
          return row?.bookings?.status !== "CANCELLED";
        });
        if (hasConflict) {
          return NextResponse.json({ error: "Selected party area is unavailable" }, { status: 400 });
        }
      }

      await sb.from("resource_reservations").delete().eq("booking_id", id);
      const inserts: Array<{ booking_id: string; resource_id: string; start_ts: string; end_ts: string }> = [];
      for (const rid of axeResources || []) {
        inserts.push({ booking_id: id, resource_id: rid, start_ts: axeStartIso, end_ts: axeEndIso });
      }
      for (const rid of duckResources || []) {
        inserts.push({ booking_id: id, resource_id: rid, start_ts: duckStartIso, end_ts: duckEndIso });
      }
      for (const rid of partyResourceIds) {
        inserts.push({ booking_id: id, resource_id: rid, start_ts: startIso, end_ts: partyEndIso });
      }
      if (inserts.length) {
        const { error: insertErr } = await sb.from("resource_reservations").insert(inserts);
        if (insertErr) {
          return NextResponse.json({ error: "Failed to update reservations" }, { status: 500 });
        }
      }

      updates.start_ts = startIso;
      updates.end_ts = endIso;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No updates provided" }, { status: 400 });
    }

    const statusChanged = Object.prototype.hasOwnProperty.call(updates, "status");
    const { data, error } = await sb
      .from("bookings")
      .update(updates)
      .eq("id", id)
      .select("id,status,customer_name,customer_email,party_size,activity,duration_minutes,start_ts,end_ts,paid,notes,total_cents")
      .single();

    if (error) {
      console.error("staff booking status update error:", error);
      return NextResponse.json(
        {
          error: "Failed to update booking",
          detail: process.env.NODE_ENV === "production" ? undefined : error?.message || error?.details || error,
        },
        { status: 500 }
      );
    }

    if (giftCode && updates.paid === true) {
      try {
        const giftResult = await validateGiftCertificate({
          code: giftCode,
          customerEmail: String(data.customer_email || ""),
          amountCents: Number(data.total_cents || 0),
        });
        await redeemGiftCertificate({
          code: giftCode,
          customerEmail: String(data.customer_email || ""),
          amountCents: giftResult.amountOffCents,
          bookingId: data.id,
          createdBy: staff.staff_id,
        });
      } catch (giftErr: any) {
        return NextResponse.json({ error: giftErr?.message || "Failed to redeem gift certificate." }, { status: 400 });
      }
    }

    if (updates.status === "CANCELLED") {
      const { error: rrErr } = await sb.from("resource_reservations").delete().eq("booking_id", id);
      if (rrErr) {
        console.error("staff booking reservations delete error:", rrErr);
        return NextResponse.json(
          {
            error: "Failed to cancel booking reservations",
            detail: process.env.NODE_ENV === "production" ? undefined : rrErr?.message || rrErr?.details || rrErr,
          },
          { status: 500 }
        );
      }
    }

    await logBookingEvent(sb, {
      bookingId: id,
      staffId: staff.staff_id,
      action: "UPDATE",
      details: updates,
    });

    if (statusChanged) {
      try {
        const statusValue = String(data?.status || "").toUpperCase();
        const subject =
          statusValue === "CANCELLED"
            ? "Axe Quacks: Booking Cancelled"
            : statusValue === "COMPLETED"
            ? "Axe Quacks: Booking Completed"
            : "Axe Quacks: Booking Status Updated";
        const startLabel = timeLabelFromIsoNY(data?.start_ts || null);
        const endLabel = timeLabelFromIsoNY(data?.end_ts || null);
        await sendOwnerNotification({
          subject,
          lines: [
            `Booking ID: ${data?.id || id}`,
            `Customer: ${data?.customer_name || "—"}`,
            data?.customer_email ? `Email: ${data.customer_email}` : null,
            `Activity: ${data?.activity || "—"}`,
            `Date: ${dateKeyFromIsoNY(data?.start_ts || null)}`,
            `Time: ${startLabel} – ${endLabel}`,
            `Status: ${statusValue}`,
          ].filter(Boolean) as string[],
        });
      } catch (err) {
        console.error("booking status owner notify error:", err);
      }
    }

    return NextResponse.json({ booking: data }, { status: 200 });
  } catch (err: any) {
    console.error("staff booking status route fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, context: RouteContext) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const url = new URL(req.url);
    const id =
      (await getRouteId(req, context)) ||
      String(body?.id || "") ||
      url.searchParams.get("id") ||
      "";
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const sb = getSupabaseAdmin();

    const { error: rrErr } = await sb.from("resource_reservations").delete().eq("booking_id", id);
    if (rrErr) {
      console.error("staff booking reservations delete error:", rrErr);
      return NextResponse.json({ error: "Failed to delete booking reservations" }, { status: 500 });
    }

    const { error: bookingErr } = await sb.from("bookings").delete().eq("id", id);
    if (bookingErr) {
      console.error("staff booking delete error:", bookingErr);
      return NextResponse.json({ error: "Failed to delete booking" }, { status: 500 });
    }

    await logBookingEvent(sb, {
      bookingId: id,
      staffId: staff.staff_id,
      action: "DELETE",
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    console.error("staff booking delete fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
