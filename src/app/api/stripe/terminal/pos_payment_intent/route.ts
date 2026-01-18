import { NextResponse } from "next/server";
import { getStripeTerminal } from "@/lib/server/stripe";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";
import { cardFeeCents } from "@/lib/bookingLogic";

const TAX_RATE = 0.0725;

type PosItemInput = {
  id: string;
  quantity: number;
};

function normalizeItems(items: PosItemInput[]) {
  return items
    .map((item) => ({
      id: String(item?.id || "").trim(),
      quantity: Number(item?.quantity || 0),
    }))
    .filter((item) => item.id && Number.isFinite(item.quantity) && item.quantity > 0);
}

export async function POST(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const items = normalizeItems(Array.isArray(body?.items) ? body.items : []);
    const tabId = String(body?.tab_id || "").trim();
    if (!items.length) return NextResponse.json({ error: "Add at least one item" }, { status: 400 });

    const ids = items.map((item) => item.id);
    const sb = supabaseServer();
    const { data, error } = await sb
      .from("add_ons")
      .select("id,name,price_cents,active")
      .in("id", ids);

    if (error) {
      console.error("pos inventory load error:", error);
      return NextResponse.json({ error: "Failed to load inventory" }, { status: 500 });
    }

    if (!data || data.length !== ids.length) {
      return NextResponse.json({ error: "One or more items not found" }, { status: 400 });
    }

    const itemsById = new Map(data.map((row) => [row.id, row]));
    const lineItems = items.map((item) => {
      const row = itemsById.get(item.id);
      if (!row) throw new Error("Item not found");
      const priceCents = Number(row.price_cents || 0);
      const qty = item.quantity;
      return {
        item_id: row.id,
        name: row.name,
        price_cents: priceCents,
        quantity: qty,
        line_total_cents: priceCents * qty,
      };
    });

    const subtotalCents = lineItems.reduce((sum, item) => sum + item.line_total_cents, 0);
    const taxCents = Math.round(subtotalCents * TAX_RATE);
    const totalCents = subtotalCents + taxCents;
    const cardFee = cardFeeCents(totalCents);
    const totalWithFee = totalCents + cardFee;

    const stripe = getStripeTerminal();
    const metadata: Record<string, string> = {
      ui_mode: "staff_pos",
      pos_items: JSON.stringify(lineItems),
      pos_subtotal: String(subtotalCents),
      pos_tax: String(taxCents),
      pos_total: String(totalCents),
      pos_card_fee: String(cardFee),
      pos_total_with_fee: String(totalWithFee),
      pos_staff_id: staff.staff_id,
    };
    if (tabId) metadata.tab_id = tabId;

    const intent = await stripe.paymentIntents.create({
      amount: totalWithFee,
      currency: "usd",
      capture_method: "automatic",
      payment_method_types: ["card_present"],
      metadata,
    });

    return NextResponse.json(
      {
        client_secret: intent.client_secret,
        totals: {
          subtotal_cents: subtotalCents,
          tax_cents: taxCents,
          total_cents: totalCents,
          card_fee_cents: cardFee,
          total_with_fee_cents: totalWithFee,
        },
      },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("pos payment intent error:", e);
    return NextResponse.json({ error: e?.message || "Failed to create payment intent" }, { status: 500 });
  }
}
