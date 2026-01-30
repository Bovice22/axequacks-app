import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const bookingId = String(body?.booking_id || "").trim();
    const updates = Array.isArray(body?.updates) ? body.updates : [];
    if (!bookingId || !updates.length) {
      return NextResponse.json({ error: "Missing booking_id or updates" }, { status: 400 });
    }

    const updateRows: Array<{ reservationId: string; resourceId: string }> = updates
      .map((row: any) => ({
        reservationId: String(row?.reservation_id || "").trim(),
        resourceId: String(row?.resource_id || "").trim(),
      }))
      .filter((row: { reservationId: string; resourceId: string }) => row.reservationId && row.resourceId);

    if (!updateRows.length) {
      return NextResponse.json({ error: "No valid updates provided" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();
    const reservationIds = updateRows.map((row) => row.reservationId);

    const { data: reservations, error: resErr } = await sb
      .from("resource_reservations")
      .select("id,booking_id,resource_id,start_ts,end_ts")
      .in("id", reservationIds);
    if (resErr) {
      console.error("resource reassignment lookup error:", resErr);
      return NextResponse.json({ error: "Failed to load reservations" }, { status: 500 });
    }

    const reservationMap = new Map((reservations || []).map((row) => [row.id, row]));
    for (const row of updateRows) {
      const reservation = reservationMap.get(row.reservationId);
      if (!reservation || reservation.booking_id !== bookingId) {
        return NextResponse.json({ error: "Reservation not found for booking" }, { status: 400 });
      }
    }

    const resourceIds = Array.from(
      new Set([
        ...updateRows.map((row) => row.resourceId),
        ...(reservations || []).map((row) => row.resource_id),
      ])
    );
    const { data: resources, error: resourceErr } = await sb
      .from("resources")
      .select("id,type,active")
      .in("id", resourceIds);
    if (resourceErr) {
      console.error("resource reassignment resources error:", resourceErr);
      return NextResponse.json({ error: "Failed to load resources" }, { status: 500 });
    }

    const resourceById = new Map((resources || []).map((row) => [row.id, row]));
    for (const row of updateRows) {
      const reservation = reservationMap.get(row.reservationId);
      if (!reservation) continue;
      const currentResource = resourceById.get(reservation.resource_id);
      const nextResource = resourceById.get(row.resourceId);
      if (!currentResource || !nextResource) {
        return NextResponse.json({ error: "Resource not found" }, { status: 400 });
      }
      if (nextResource.active === false) {
        return NextResponse.json({ error: "Selected resource is inactive" }, { status: 400 });
      }
      if (currentResource.type !== nextResource.type) {
        return NextResponse.json({ error: "Resource type mismatch" }, { status: 400 });
      }
    }

    for (const row of updateRows) {
      const reservation = reservationMap.get(row.reservationId);
      if (!reservation) continue;
      if (reservation.resource_id === row.resourceId) continue;
      const { data: conflicts, error: conflictErr } = await sb
        .from("resource_reservations")
        .select("id")
        .eq("resource_id", row.resourceId)
        .neq("id", reservation.id)
        .lt("start_ts", reservation.end_ts)
        .gt("end_ts", reservation.start_ts)
        .limit(1);
      if (conflictErr) {
        console.error("resource reassignment conflict error:", conflictErr);
        return NextResponse.json({ error: "Failed to check resource availability" }, { status: 500 });
      }
      if (conflicts && conflicts.length) {
        return NextResponse.json({ error: "Selected resource is already booked" }, { status: 409 });
      }
    }

    for (const row of updateRows) {
      const reservation = reservationMap.get(row.reservationId);
      if (!reservation) continue;
      if (reservation.resource_id === row.resourceId) continue;
      const { error: updateErr } = await sb
        .from("resource_reservations")
        .update({ resource_id: row.resourceId })
        .eq("id", reservation.id);
      if (updateErr) {
        console.error("resource reassignment update error:", updateErr);
        return NextResponse.json({ error: "Failed to update resources" }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    console.error("resource reassignment fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
