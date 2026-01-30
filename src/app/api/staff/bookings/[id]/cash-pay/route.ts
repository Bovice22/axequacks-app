import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getStaffUserFromCookies } from "@/lib/staffAuth";
import { validateGiftCertificate, redeemGiftCertificate } from "@/lib/server/giftCertificates";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

const TAX_RATE = 0.0725;

async function getRouteId(req: Request, context: RouteContext) {
  const resolvedParams = await Promise.resolve(context.params);
  if (resolvedParams?.id) return String(resolvedParams.id).trim();
  try {
    const path = new URL(req.url).pathname;
    return path.split("/").slice(-2, -1)[0] || "";
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

function normalizeActivity(name: string) {
  const label = name.toUpperCase();
  if (label.includes("COMBO")) return "Combo Package";
  if (label.includes("DUCK")) return "Duckpin Bowling";
  if (label.includes("AXE")) return "Axe Throwing";
  return "Other";
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = (await getRouteId(req, context)) || new URL(req.url).searchParams.get("id") || "";
    if (!id) return NextResponse.json({ error: "Missing booking id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const giftCode = String(body?.gift_code || "").trim();

    const sb = getSupabaseAdmin();
    const { data: booking, error: bookingErr } = await sb
      .from("bookings")
      .select("id,customer_email,total_cents,paid")
      .eq("id", id)
      .single();
    if (bookingErr || !booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }
    if (booking.paid) {
      return NextResponse.json({ error: "Booking already paid" }, { status: 400 });
    }

    let bookingTotalCents = Number(booking.total_cents || 0);
    if (giftCode) {
      try {
        const giftResult = await validateGiftCertificate({
          code: giftCode,
          customerEmail: String(booking.customer_email || ""),
          amountCents: bookingTotalCents,
        });
        bookingTotalCents = giftResult.remainingCents;
        await redeemGiftCertificate({
          code: giftResult.gift.code,
          customerEmail: String(booking.customer_email || ""),
          amountCents: giftResult.amountOffCents,
          bookingId: booking.id,
          createdBy: staff.staff_id,
        });
      } catch (giftErr: any) {
        return NextResponse.json({ error: giftErr?.message || "Invalid gift certificate." }, { status: 400 });
      }
    }

    let tabTotalCents = 0;
    const { data: tab } = await sb
      .from("booking_tabs")
      .select("id,status")
      .eq("booking_id", id)
      .eq("status", "OPEN")
      .maybeSingle();
    if (tab?.id) {
      const { data: tabItems } = await sb
        .from("booking_tab_items")
        .select("id,tab_id,item_id,quantity")
        .eq("tab_id", tab.id);
      const itemIds = Array.from(new Set((tabItems ?? []).map((row) => row.item_id).filter(Boolean)));
      if (itemIds.length) {
        const { data: addons } = await sb
          .from("add_ons")
          .select("id,name,price_cents,category")
          .in("id", itemIds);
        const addonById = new Map((addons ?? []).map((row) => [row.id, row]));
        const rows = (tabItems ?? [])
          .map((item) => {
            const addon = addonById.get(item.item_id);
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

        if (rows.length) {
          const subtotalCents = rows.reduce((sum, row) => sum + row.line_total_cents, 0);
          const taxCents = Math.round(subtotalCents * TAX_RATE);
          tabTotalCents = subtotalCents + taxCents;

          const { data: sale, error: saleErr } = await sb
            .from("pos_cash_sales")
            .insert({
              staff_id: staff.id,
              subtotal_cents: subtotalCents,
              tax_cents: taxCents,
              total_cents: tabTotalCents,
              tab_id: tab.id,
              status: "PAID",
            })
            .select("id")
            .single();

          if (saleErr || !sale) {
            console.error("tab cash sale create error:", saleErr);
            return NextResponse.json({ error: saleErr?.message || "Failed to record tab sale" }, { status: 500 });
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
            console.error("tab cash sale item error:", itemsErr);
            return NextResponse.json({ error: itemsErr.message || "Failed to record tab sale items" }, { status: 500 });
          }
        }
      }

      const { error: tabErr } = await sb.from("booking_tabs").update({ status: "CLOSED" }).eq("id", tab.id);
      if (tabErr) {
        console.error("tab close error:", tabErr);
      }
    }

    const totalCents = bookingTotalCents + tabTotalCents;
    const { error: updErr } = await sb
      .from("bookings")
      .update({ paid: true, total_cents: totalCents })
      .eq("id", id);
    if (updErr) {
      console.error("booking cash update error:", updErr);
      return NextResponse.json({ error: "Failed to mark booking paid" }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    console.error("booking cash pay fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
