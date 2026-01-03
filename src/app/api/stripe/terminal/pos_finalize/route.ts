import { NextResponse } from "next/server";
import { getStripe } from "@/lib/server/stripe";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

type LineItem = {
  item_id: string;
  name: string;
  price_cents: number;
  quantity: number;
  line_total_cents: number;
};

function parseLineItems(raw?: string | null) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as LineItem[];
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const paymentIntentId = String(body?.payment_intent_id || "");
    if (!paymentIntentId) return NextResponse.json({ error: "Missing payment_intent_id" }, { status: 400 });

    const stripe = getStripe();
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (intent.metadata?.pos_sale_id) {
      return NextResponse.json({ ok: true, saleId: intent.metadata.pos_sale_id }, { status: 200 });
    }

    const items = parseLineItems(intent.metadata?.pos_items);
    if (!items || !items.length) {
      return NextResponse.json({ error: "Missing POS metadata" }, { status: 400 });
    }

    const subtotalCents = Number(intent.metadata?.pos_subtotal || 0);
    const taxCents = Number(intent.metadata?.pos_tax || 0);
    const totalCents = Number(intent.metadata?.pos_total || 0);

    const sb = supabaseServer();
    const { data: existing } = await sb
      .from("pos_sales")
      .select("id")
      .eq("payment_intent_id", paymentIntentId)
      .maybeSingle();

    if (existing?.id) {
      return NextResponse.json({ ok: true, saleId: existing.id }, { status: 200 });
    }

    const { data: sale, error: saleErr } = await sb
      .from("pos_sales")
      .insert({
        staff_id: staff.staff_id,
        subtotal_cents: subtotalCents,
        tax_cents: taxCents,
        total_cents: totalCents,
        payment_intent_id: paymentIntentId,
        status: "PAID",
      })
      .select("id")
      .single();

    if (saleErr || !sale) {
      console.error("pos sale create error:", saleErr);
      return NextResponse.json({ error: "Failed to record sale" }, { status: 500 });
    }

    const rows = items.map((item) => ({
      sale_id: sale.id,
      item_id: item.item_id,
      name: item.name,
      price_cents: item.price_cents,
      quantity: item.quantity,
      line_total_cents: item.line_total_cents,
    }));

    const { error: itemsErr } = await sb.from("pos_sale_items").insert(rows);
    if (itemsErr) {
      console.error("pos sale items error:", itemsErr);
      return NextResponse.json({ error: "Failed to record sale items" }, { status: 500 });
    }

    await stripe.paymentIntents.update(paymentIntentId, {
      metadata: { ...intent.metadata, pos_sale_id: sale.id },
    });

    return NextResponse.json({ ok: true, saleId: sale.id }, { status: 200 });
  } catch (e: any) {
    console.error("pos finalize error:", e);
    return NextResponse.json({ error: e?.message || "Failed to finalize POS sale" }, { status: 500 });
  }
}
