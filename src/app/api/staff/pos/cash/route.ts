import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

type CashItemInput = {
  id: string;
  quantity: number;
};

const TAX_RATE = 0.0725;

function normalizeActivity(name: string) {
  const label = name.toUpperCase();
  if (label.includes("COMBO")) return "Combo Package";
  if (label.includes("DUCK")) return "Duckpin Bowling";
  if (label.includes("AXE")) return "Axe Throwing";
  return "Other";
}

export async function POST(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const items = Array.isArray(body?.items) ? (body.items as CashItemInput[]) : [];
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const rawTabId = body?.tab_id ? String(body.tab_id) : "";
    const tabId = uuidRegex.test(rawTabId) ? rawTabId : null;

    if (!items.length) {
      return NextResponse.json({ error: "Missing items" }, { status: 400 });
    }

    const itemIds = items.map((item) => item.id).filter((id) => uuidRegex.test(String(id)));
    if (!itemIds.length) {
      return NextResponse.json({ error: "Invalid item ids" }, { status: 400 });
    }
    const sb = supabaseServer();
    const { data: addons, error: addonsErr } = await sb
      .from("add_ons")
      .select("id,name,price_cents,category")
      .in("id", itemIds);

    if (addonsErr) {
      console.error("cash sale items error:", addonsErr);
      return NextResponse.json({ error: addonsErr.message || "Failed to load items" }, { status: 500 });
    }

    const addonMap = new Map((addons ?? []).map((row) => [row.id, row]));
    const rows = items
      .map((item) => {
        const addon = addonMap.get(item.id);
        if (!addon) return null;
        const quantity = Math.max(1, Number(item.quantity || 0));
        const lineTotal = addon.price_cents * quantity;
        return {
          item_id: addon.id,
          name: addon.name,
          price_cents: addon.price_cents,
          quantity,
          line_total_cents: lineTotal,
          activity: addon.category || normalizeActivity(addon.name || ""),
        };
      })
      .filter(Boolean) as Array<{
      item_id: string;
      name: string;
      price_cents: number;
      quantity: number;
      line_total_cents: number;
      activity: string;
    }>;

    if (!rows.length) {
      return NextResponse.json({ error: "No valid items found" }, { status: 400 });
    }

    const subtotalCents = rows.reduce((sum, row) => sum + row.line_total_cents, 0);
    const taxCents = Math.round(subtotalCents * TAX_RATE);
    const totalCents = subtotalCents + taxCents;

    const { data: sale, error: saleErr } = await sb
      .from("pos_cash_sales")
      .insert({
        staff_id: staff.id,
        subtotal_cents: subtotalCents,
        tax_cents: taxCents,
        total_cents: totalCents,
        tab_id: tabId,
        status: "PAID",
      })
      .select("id")
      .single();

    if (saleErr || !sale) {
      console.error("cash sale create error:", saleErr);
      return NextResponse.json({ error: saleErr?.message || "Failed to record cash sale" }, { status: 500 });
    }

    const { error: itemsErr } = await sb.from("pos_cash_sale_items").insert(
      rows.map((row) => ({
        sale_id: sale.id,
        item_id: row.item_id,
        name: row.name,
        price_cents: row.price_cents,
        quantity: row.quantity,
        line_total_cents: row.line_total_cents,
        activity: row.activity,
      }))
    );

    if (itemsErr) {
      console.error("cash sale item error:", itemsErr);
      return NextResponse.json({ error: itemsErr.message || "Failed to record cash sale items" }, { status: 500 });
    }

    if (tabId) {
      const { error: tabErr } = await sb.from("booking_tabs").update({ status: "CLOSED" }).eq("id", tabId);
      if (tabErr) {
        console.error("cash tab close error:", tabErr);
      }
    }

    return NextResponse.json({ ok: true, saleId: sale.id }, { status: 200 });
  } catch (err: any) {
    console.error("cash sale fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
