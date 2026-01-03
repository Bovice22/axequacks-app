import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

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

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = await getRouteId(req, context);
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const updates: Record<string, any> = {};
    if (body?.date_key != null) updates.date_key = String(body.date_key);
    if (body?.start_min != null) updates.start_min = Number(body.start_min);
    if (body?.end_min != null) updates.end_min = Number(body.end_min);
    if (body?.activity != null) updates.activity = String(body.activity);
    if (body?.reason != null) updates.reason = String(body.reason).trim() || null;

    const sb = supabaseServer();
    const { error: updErr } = await sb.from("blackout_rules").update(updates).eq("id", id);
    if (updErr) {
      console.error("blackout update error:", updErr);
      return NextResponse.json({ error: "Failed to update blackout" }, { status: 500 });
    }

    const { data, error } = await sb
      .from("blackout_rules")
      .select("id,date_key,start_min,end_min,activity,reason,created_at")
      .eq("id", id)
      .single();

    if (error) {
      console.error("blackout fetch error:", error);
      return NextResponse.json({ error: "Failed to load blackout" }, { status: 500 });
    }

    return NextResponse.json({ blackout: data }, { status: 200 });
  } catch (err: any) {
    console.error("blackout update fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
