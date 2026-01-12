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

export async function GET(req: Request, context: RouteContext) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = (await getRouteId(req, context)) || new URL(req.url).searchParams.get("id") || "";
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const sb = getSupabaseAdmin();
    const { data: tab, error: tabErr } = await sb
      .from("booking_tabs")
      .select("id,booking_id,customer_name,customer_email,status,created_at")
      .eq("id", id)
      .single();

    if (tabErr || !tab) {
      return NextResponse.json({ error: "Tab not found" }, { status: 404 });
    }

    const { data: items, error: itemsErr } = await sb
      .from("booking_tab_items")
      .select("id,tab_id,item_id,quantity")
      .eq("tab_id", id);

    if (itemsErr) {
      console.error("tab items error:", itemsErr);
      return NextResponse.json({ error: "Failed to load tab items" }, { status: 500 });
    }

    const itemIds = (items ?? []).map((row) => row.item_id).filter(Boolean);
    let addons: any[] = [];
    if (itemIds.length > 0) {
      const { data: addRows } = await sb
        .from("add_ons")
        .select("id,name,price_cents,image_url")
        .in("id", itemIds);
      addons = addRows ?? [];
    }

    const addonById = new Map(addons.map((row) => [row.id, row]));
    const detailed = (items ?? []).map((row) => {
      const addon = addonById.get(row.item_id);
      return {
        id: row.id,
        item_id: row.item_id,
        quantity: row.quantity,
        name: addon?.name || "Item",
        price_cents: addon?.price_cents || 0,
        image_url: addon?.image_url || null,
        line_total_cents: (addon?.price_cents || 0) * (row.quantity || 0),
      };
    });

    return NextResponse.json({ tab, items: detailed }, { status: 200 });
  } catch (err: any) {
    console.error("tab fetch fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
