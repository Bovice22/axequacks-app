import { NextResponse } from "next/server";
import { getStaffUserFromCookies } from "@/lib/staffAuth";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET() {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sb = supabaseServer();
    const { count, error } = await sb
      .from("event_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "PENDING");

    if (error) {
      console.error("event request count error:", error);
      return NextResponse.json({ error: "Failed to load count" }, { status: 500 });
    }

    return NextResponse.json({ pending: count ?? 0 }, { status: 200 });
  } catch (err: any) {
    console.error("event request count fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
