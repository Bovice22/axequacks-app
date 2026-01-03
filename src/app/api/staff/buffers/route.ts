import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

export async function GET() {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sb = supabaseServer();
    const { data, error } = await sb
      .from("buffer_rules")
      .select("id,activity,before_min,after_min,active,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("buffers list error:", error);
      return NextResponse.json({ error: "Failed to load buffers" }, { status: 500 });
    }

    return NextResponse.json({ buffers: data ?? [] }, { status: 200 });
  } catch (err: any) {
    console.error("buffers list fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const activity = String(body?.activity || "ALL");
    const beforeMin = Number(body?.before_min ?? 0);
    const afterMin = Number(body?.after_min ?? 0);
    const active = body?.active != null ? !!body.active : true;

    const sb = supabaseServer();
    const { data, error } = await sb
      .from("buffer_rules")
      .insert({
        activity,
        before_min: beforeMin,
        after_min: afterMin,
        active,
      })
      .select("id,activity,before_min,after_min,active,created_at")
      .single();

    if (error) {
      console.error("buffer create error:", error);
      return NextResponse.json({ error: "Failed to create buffer" }, { status: 500 });
    }

    return NextResponse.json({ buffer: data }, { status: 200 });
  } catch (err: any) {
    console.error("buffer create fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
