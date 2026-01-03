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
    if (body?.activity != null) updates.activity = String(body.activity);
    if (body?.before_min != null) updates.before_min = Number(body.before_min);
    if (body?.after_min != null) updates.after_min = Number(body.after_min);
    if (body?.active != null) updates.active = !!body.active;

    const sb = supabaseServer();
    const { error: updErr } = await sb.from("buffer_rules").update(updates).eq("id", id);
    if (updErr) {
      console.error("buffer update error:", updErr);
      return NextResponse.json({ error: "Failed to update buffer" }, { status: 500 });
    }

    const { data, error } = await sb
      .from("buffer_rules")
      .select("id,activity,before_min,after_min,active,created_at")
      .eq("id", id)
      .single();

    if (error) {
      console.error("buffer fetch error:", error);
      return NextResponse.json({ error: "Failed to load buffer" }, { status: 500 });
    }

    return NextResponse.json({ buffer: data }, { status: 200 });
  } catch (err: any) {
    console.error("buffer update fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
