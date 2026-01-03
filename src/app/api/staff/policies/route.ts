import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

function requireAdmin(staff: any) {
  return staff && staff.role === "admin";
}

export async function GET() {
  try {
    const staff = await getStaffUserFromCookies();
    if (!requireAdmin(staff)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sb = supabaseServer();
    const { data, error } = await sb
      .from("booking_policies")
      .select("id,cancel_window_hours,reschedule_window_hours,refund_policy,notes,updated_at")
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error("policies fetch error:", error);
      return NextResponse.json({ error: "Failed to load policies" }, { status: 500 });
    }

    return NextResponse.json({ policy: data?.[0] ?? null }, { status: 200 });
  } catch (err: any) {
    console.error("policies fetch fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const cancelWindowHours = Number(body?.cancel_window_hours ?? 24);
    const rescheduleWindowHours = Number(body?.reschedule_window_hours ?? 12);
    const refundPolicy = String(body?.refund_policy ?? "FULL_BEFORE_WINDOW");
    const notes = String(body?.notes ?? "").trim();

    const sb = supabaseServer();
    const { data, error } = await sb
      .from("booking_policies")
      .insert({
        cancel_window_hours: cancelWindowHours,
        reschedule_window_hours: rescheduleWindowHours,
        refund_policy: refundPolicy,
        notes: notes || null,
      })
      .select("id,cancel_window_hours,reschedule_window_hours,refund_policy,notes,updated_at")
      .single();

    if (error) {
      console.error("policies create error:", error);
      return NextResponse.json({ error: "Failed to save policies" }, { status: 500 });
    }

    return NextResponse.json({ policy: data }, { status: 200 });
  } catch (err: any) {
    console.error("policies create fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
