import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const params = await context.params;
    const certificateId = String(params?.id || "").trim();
    if (!certificateId) return NextResponse.json({ error: "Missing certificate id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const deltaCents = Math.round(Number(body?.delta_cents ?? 0));

    if (!Number.isFinite(deltaCents) || deltaCents === 0) {
      return NextResponse.json({ error: "Invalid adjustment amount" }, { status: 400 });
    }

    const sb = supabaseServer();
    const { data: existing, error: findErr } = await sb
      .from("gift_certificates")
      .select("id,balance_cents,status")
      .eq("id", certificateId)
      .maybeSingle();

    if (findErr) {
      console.error("gift certificate adjust lookup error:", findErr);
      return NextResponse.json({ error: "Failed to load gift certificate" }, { status: 500 });
    }
    if (!existing?.id) return NextResponse.json({ error: "Gift certificate not found" }, { status: 404 });

    const nextBalance = Math.max(0, Number(existing.balance_cents || 0) + deltaCents);
    const nextStatus = nextBalance <= 0 ? "REDEEMED" : "ACTIVE";

    const { data: updated, error: updateErr } = await sb
      .from("gift_certificates")
      .update({ balance_cents: nextBalance, status: nextStatus })
      .eq("id", certificateId)
      .select("id,code,original_amount_cents,balance_cents,status,expires_at,created_at,customers(full_name,email)")
      .maybeSingle();

    if (updateErr || !updated?.id) {
      console.error("gift certificate adjust update error:", updateErr);
      return NextResponse.json({ error: "Failed to update gift certificate" }, { status: 500 });
    }

    return NextResponse.json({ certificate: updated }, { status: 200 });
  } catch (err: any) {
    console.error("gift certificate adjust fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
