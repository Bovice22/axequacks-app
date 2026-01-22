import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

export async function GET(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const requestedStaffId = String(url.searchParams.get("staff_user_id") || "").trim();
    const targetStaffId =
      requestedStaffId && staff.role === "admin" ? requestedStaffId : staff.id;

    const sb = supabaseServer();
    const { data: openEntry } = await sb
      .from("staff_time_entries")
      .select("id,clock_in_ts,clock_out_ts,staff_users(full_name,staff_id)")
      .eq("staff_user_id", targetStaffId)
      .is("clock_out_ts", null)
      .order("clock_in_ts", { ascending: false })
      .limit(1)
      .single();

    const { data: recent } = await sb
      .from("staff_time_entries")
      .select("id,clock_in_ts,clock_out_ts,created_at,staff_users(full_name,staff_id)")
      .eq("staff_user_id", targetStaffId)
      .order("clock_in_ts", { ascending: false })
      .limit(20);

    return NextResponse.json(
      { openEntry: openEntry || null, recent: recent || [], staff_user_id: targetStaffId },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("time clock status fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "").trim();
    if (!["clock_in", "clock_out"].includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const requestedStaffId = body?.staff_user_id ? String(body.staff_user_id).trim() : "";
    const targetStaffId =
      requestedStaffId && staff.role === "admin" ? requestedStaffId : staff.id;

    const sb = supabaseServer();
    const { data: openEntry } = await sb
      .from("staff_time_entries")
      .select("id,clock_in_ts")
      .eq("staff_user_id", targetStaffId)
      .is("clock_out_ts", null)
      .order("clock_in_ts", { ascending: false })
      .limit(1)
      .single();

    if (action === "clock_in") {
      if (openEntry?.id) {
        return NextResponse.json({ error: "Already clocked in" }, { status: 400 });
      }
      const { data, error } = await sb
        .from("staff_time_entries")
        .insert({
          staff_user_id: targetStaffId,
          clock_in_ts: new Date().toISOString(),
          source: "staff",
        })
        .select("id,clock_in_ts,clock_out_ts")
        .single();
      if (error) {
        console.error("clock in error:", error);
        return NextResponse.json({ error: "Failed to clock in" }, { status: 500 });
      }
      return NextResponse.json({ entry: data }, { status: 200 });
    }

    if (!openEntry?.id) {
      return NextResponse.json({ error: "Not clocked in" }, { status: 400 });
    }

    const { data, error } = await sb
      .from("staff_time_entries")
      .update({ clock_out_ts: new Date().toISOString() })
      .eq("id", openEntry.id)
      .select("id,clock_in_ts,clock_out_ts")
      .single();

    if (error) {
      console.error("clock out error:", error);
      return NextResponse.json({ error: "Failed to clock out" }, { status: 500 });
    }

    return NextResponse.json({ entry: data }, { status: 200 });
  } catch (err: any) {
    console.error("time clock action fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
