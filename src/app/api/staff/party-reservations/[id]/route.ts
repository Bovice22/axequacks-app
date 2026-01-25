import { NextResponse } from "next/server";
import { getStaffUserFromCookies } from "@/lib/staffAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import { nyLocalDateKeyPlusMinutesToUTCISOString } from "@/lib/bookingLogic";

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return new Date(aStart).getTime() < new Date(bEnd).getTime() && new Date(aEnd).getTime() > new Date(bStart).getTime();
}

export async function PATCH(req: Request, context: { params: { id: string } }) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const reservationId = context?.params?.id || "";
    if (!reservationId) return NextResponse.json({ error: "Missing reservation id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const dateKey = String(body?.dateKey || "").trim();
    const startMin = Number(body?.startMin);
    const endMin = Number(body?.endMin);

    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dateKey)) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }
    if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) {
      return NextResponse.json({ error: "Invalid time" }, { status: 400 });
    }

    const sb = supabaseServer();
    const { data: reservation, error: resErr } = await sb
      .from("resource_reservations")
      .select("id,resource_id,booking_id")
      .eq("id", reservationId)
      .single();

    if (resErr || !reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }

    const startTs = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, startMin);
    const endTs = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, endMin);

    const { data: conflicts, error: conflictErr } = await sb
      .from("resource_reservations")
      .select("id,start_ts,end_ts")
      .eq("resource_id", reservation.resource_id)
      .neq("id", reservationId)
      .lt("start_ts", endTs)
      .gt("end_ts", startTs);

    if (conflictErr) {
      return NextResponse.json({ error: "Failed to check conflicts" }, { status: 500 });
    }

    if ((conflicts || []).some((c: any) => overlaps(c.start_ts, c.end_ts, startTs, endTs))) {
      return NextResponse.json({ error: "Selected time overlaps another reservation" }, { status: 400 });
    }

    const { error: updateErr } = await sb
      .from("resource_reservations")
      .update({ start_ts: startTs, end_ts: endTs })
      .eq("id", reservationId);

    if (updateErr) {
      return NextResponse.json({ error: "Failed to update reservation" }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
