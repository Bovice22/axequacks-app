import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tabId = (await getRouteId(req, context)) || new URL(req.url).searchParams.get("id") || "";
    if (!tabId) return NextResponse.json({ error: "Missing tab id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const itemId = String(body?.item_id || "").trim();
    const delta = Number(body?.delta ?? 1);
    if (!itemId || !Number.isFinite(delta) || delta === 0) {
      return NextResponse.json({ error: "Invalid item update" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();
    const { data: existing } = await sb
      .from("booking_tab_items")
      .select("id,quantity")
      .eq("tab_id", tabId)
      .eq("item_id", itemId)
      .maybeSingle();

    if (!existing?.id) {
      if (delta < 0) {
        return NextResponse.json({ error: "Quantity cannot be negative" }, { status: 400 });
      }
      const { error: insErr } = await sb.from("booking_tab_items").insert({
        tab_id: tabId,
        item_id: itemId,
        quantity: delta,
      });
      if (insErr) {
        console.error("tab item insert error:", insErr);
        return NextResponse.json({ error: "Failed to add item" }, { status: 500 });
      }
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const nextQty = Number(existing.quantity || 0) + delta;
    if (nextQty <= 0) {
      const { error: delErr } = await sb.from("booking_tab_items").delete().eq("id", existing.id);
      if (delErr) {
        console.error("tab item delete error:", delErr);
        return NextResponse.json({ error: "Failed to update item" }, { status: 500 });
      }
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const { error: updErr } = await sb.from("booking_tab_items").update({ quantity: nextQty }).eq("id", existing.id);
    if (updErr) {
      console.error("tab item update error:", updErr);
      return NextResponse.json({ error: "Failed to update item" }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    console.error("tab item update fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
