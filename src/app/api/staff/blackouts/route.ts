import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

export async function GET() {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sb = supabaseServer();
    const { data, error } = await sb
      .from("blackout_rules")
      .select("id,date_key,start_min,end_min,activity,reason,created_at")
      .order("date_key", { ascending: false })
      .limit(200);

    if (error) {
      console.error("blackouts list error:", error);
      return NextResponse.json({ error: "Failed to load blackouts" }, { status: 500 });
    }

    return NextResponse.json({ blackouts: data ?? [] }, { status: 200 });
  } catch (err: any) {
    console.error("blackouts list fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const dateKey = String(body?.date_key || "");
    const startMin = body?.start_min != null ? Number(body.start_min) : null;
    const endMin = body?.end_min != null ? Number(body.end_min) : null;
    const activity = String(body?.activity || "ALL");
    const reason = String(body?.reason || "").trim();

    if (!dateKey) return NextResponse.json({ error: "Missing date_key" }, { status: 400 });

    const sb = supabaseServer();
    const { data, error } = await sb
      .from("blackout_rules")
      .insert({
        date_key: dateKey,
        start_min: startMin,
        end_min: endMin,
        activity,
        reason: reason || null,
      })
      .select("id,date_key,start_min,end_min,activity,reason,created_at")
      .single();

    if (error) {
      console.error("blackout create error:", error);
      return NextResponse.json({ error: "Failed to create blackout" }, { status: 500 });
    }

    return NextResponse.json({ blackout: data }, { status: 200 });
  } catch (err: any) {
    console.error("blackout create fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
