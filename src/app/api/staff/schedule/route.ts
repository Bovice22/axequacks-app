import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

function parseDateParam(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

function todayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function GET(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const startDate = parseDateParam(url.searchParams.get("startDate")) || todayKey();
    const endDate = parseDateParam(url.searchParams.get("endDate")) || startDate;

    const sb = supabaseServer();
    const { data, error } = await sb
      .from("staff_shifts")
      .select("id,staff_user_id,shift_date,start_min,end_min,notes,created_by,created_at,staff_users(full_name,staff_id,role_label)")
      .gte("shift_date", startDate)
      .lte("shift_date", endDate)
      .order("shift_date", { ascending: true })
      .order("start_min", { ascending: true });

    if (error) {
      console.error("schedule list error:", error);
      return NextResponse.json({ error: "Failed to load shifts" }, { status: 500 });
    }

    return NextResponse.json({ shifts: data ?? [] }, { status: 200 });
  } catch (err: any) {
    console.error("schedule list fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const staffUserId = String(body?.staff_user_id || "").trim();
    const shiftDate = String(body?.shift_date || "").trim();
    const startMin = Number(body?.start_min);
    const endMin = Number(body?.end_min);
    const notes = body?.notes != null ? String(body.notes).trim() : null;

    if (!staffUserId || !shiftDate || !Number.isFinite(startMin) || !Number.isFinite(endMin)) {
      return NextResponse.json({ error: "Missing shift fields" }, { status: 400 });
    }
    if (startMin < 0 || endMin > 24 * 60 || endMin <= startMin) {
      return NextResponse.json({ error: "Invalid shift time range" }, { status: 400 });
    }

    const sb = supabaseServer();
    const { data, error } = await sb
      .from("staff_shifts")
      .insert({
        staff_user_id: staffUserId,
        shift_date: shiftDate,
        start_min: startMin,
        end_min: endMin,
        notes,
        created_by: staff.staff_id,
      })
      .select("id,staff_user_id,shift_date,start_min,end_min,notes,created_by,created_at")
      .single();

    if (error) {
      console.error("schedule create error:", error);
      return NextResponse.json({ error: "Failed to create shift" }, { status: 500 });
    }

    return NextResponse.json({ shift: data }, { status: 200 });
  } catch (err: any) {
    console.error("schedule create fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || "").trim();
    if (!id) {
      return NextResponse.json({ error: "Missing shift id" }, { status: 400 });
    }

    const updates: Record<string, any> = {};
    if (body?.staff_user_id) updates.staff_user_id = String(body.staff_user_id).trim();
    if (body?.shift_date) updates.shift_date = String(body.shift_date).trim();
    if (body?.start_min != null) updates.start_min = Number(body.start_min);
    if (body?.end_min != null) updates.end_min = Number(body.end_min);
    if (body?.notes !== undefined) updates.notes = body.notes ? String(body.notes).trim() : null;

    if (updates.start_min != null && updates.end_min != null) {
      if (!Number.isFinite(updates.start_min) || !Number.isFinite(updates.end_min)) {
        return NextResponse.json({ error: "Invalid shift time range" }, { status: 400 });
      }
      if (updates.start_min < 0 || updates.end_min > 24 * 60 || updates.end_min <= updates.start_min) {
        return NextResponse.json({ error: "Invalid shift time range" }, { status: 400 });
      }
    }

    const sb = supabaseServer();
    const { data, error } = await sb
      .from("staff_shifts")
      .update(updates)
      .eq("id", id)
      .select("id,staff_user_id,shift_date,start_min,end_min,notes,created_by,created_at")
      .single();

    if (error) {
      console.error("schedule update error:", error);
      return NextResponse.json({ error: "Failed to update shift" }, { status: 500 });
    }

    return NextResponse.json({ shift: data }, { status: 200 });
  } catch (err: any) {
    console.error("schedule update fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || "").trim();
    if (!id) {
      return NextResponse.json({ error: "Missing shift id" }, { status: 400 });
    }

    const sb = supabaseServer();
    const { error } = await sb.from("staff_shifts").delete().eq("id", id);

    if (error) {
      console.error("schedule delete error:", error);
      return NextResponse.json({ error: "Failed to delete shift" }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    console.error("schedule delete fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
