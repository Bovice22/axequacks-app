import { NextResponse } from "next/server";
import { getStripeTerminal } from "@/lib/server/stripe";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";
import { cardFeeCents } from "@/lib/bookingLogic";
import { validateGiftCertificate } from "@/lib/server/giftCertificates";

const ACTIVITY_LABELS: Record<string, string> = {
  AXE: "Axe Throwing",
  DUCKPIN: "Duckpin Bowling",
  COMBO: "Combo Package",
};

function activityLabel(activity: string | null | undefined) {
  if (!activity) return "";
  return ACTIVITY_LABELS[activity] ?? activity;
}

function dateKeyFromIsoNY(iso: string | null) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function minutesFromIsoNY(iso: string | null) {
  if (!iso) return 0;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

export async function POST(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const TAX_RATE = 0.0725;

    const body = await req.json().catch(() => ({}));
    const bookingId = String(body?.booking_id || "").trim();
    const bookingSnapshot = body?.booking_snapshot || null;
    if (!bookingId) return NextResponse.json({ error: "Missing booking_id" }, { status: 400 });

    const sb = supabaseServer();
    let { data: booking, error } = await sb
      .from("bookings")
      .select("id,activity,party_size,duration_minutes,start_ts,customer_name,customer_email,customer_phone,total_cents,combo_order,paid")
      .eq("id", bookingId)
      .single();

    if ((error || !booking) && bookingId) {
      const { data: resv } = await sb.from("resource_reservations").select("booking_id").eq("id", bookingId).single();
      if (resv?.booking_id) {
        ({ data: booking, error } = await sb
          .from("bookings")
          .select(
            "id,activity,party_size,duration_minutes,start_ts,customer_name,customer_email,customer_phone,total_cents,combo_order,paid"
          )
          .eq("id", resv.booking_id)
          .single());
      }
    }

    if ((error || !booking) && bookingSnapshot && bookingSnapshot.start_ts) {
      const startTs = new Date(bookingSnapshot.start_ts);
      if (!Number.isNaN(startTs.getTime())) {
        const windowStart = new Date(startTs.getTime() - 10 * 60 * 1000).toISOString();
        const windowEnd = new Date(startTs.getTime() + 10 * 60 * 1000).toISOString();
        let lookup = sb
          .from("bookings")
          .select(
            "id,activity,party_size,duration_minutes,start_ts,customer_name,customer_email,customer_phone,total_cents,combo_order,paid"
          )
          .gte("start_ts", windowStart)
          .lte("start_ts", windowEnd)
          .limit(1);
        if (bookingSnapshot.customer_email) {
          lookup = lookup.ilike("customer_email", String(bookingSnapshot.customer_email).trim());
        } else if (bookingSnapshot.customer_name) {
          lookup = lookup.ilike("customer_name", String(bookingSnapshot.customer_name).trim());
        }
        ({ data: booking, error } = await lookup.single());
      }
    }

    if ((error || !booking) && bookingSnapshot?.total_cents) {
      booking = {
        id: bookingId,
        activity: bookingSnapshot.activity || "AXE",
        party_size: bookingSnapshot.party_size || 0,
        duration_minutes: bookingSnapshot.duration_minutes || 0,
        start_ts: bookingSnapshot.start_ts,
        customer_name: bookingSnapshot.customer_name || "",
        customer_email: bookingSnapshot.customer_email || "",
        customer_phone: "",
        total_cents: Number(bookingSnapshot.total_cents || 0),
        combo_order: "DUCKPIN_FIRST",
        paid: false,
      } as any;
      error = null;
    }

    if (error || !booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const baseAmount = Number(booking.total_cents || 0);
    const giftCode = String(body?.gift_code || "").trim();
    const amountOverrideCents = Number(body?.amount_override_cents);
    const bookingTotalNew = Number(body?.booking_total_cents_new);
    let giftMeta: { code: string; amountOff: number } | null = null;
    let bookingAmount = baseAmount;
    if (Number.isFinite(amountOverrideCents) && amountOverrideCents > 0) {
      bookingAmount = amountOverrideCents;
    }
    if (giftCode) {
      try {
        const giftResult = await validateGiftCertificate({
          code: giftCode,
          customerEmail: String(booking.customer_email || ""),
          amountCents: baseAmount,
        });
        bookingAmount = giftResult.remainingCents;
        giftMeta = { code: giftResult.gift.code, amountOff: giftResult.amountOffCents };
      } catch (giftErr: any) {
        return NextResponse.json({ error: giftErr?.message || "Invalid gift certificate." }, { status: 400 });
      }
    }

    let tabTotalCents = 0;
    let tabSubtotalCents = 0;
    let tabTaxCents = 0;
    let tabItemsMeta: Array<{ item_id: string; name: string; price_cents: number; quantity: number; line_total_cents: number }> = [];
    let tabId = "";
    if (booking.paid !== true) {
      const { data: tab } = await sb
        .from("booking_tabs")
        .select("id,status")
        .eq("booking_id", bookingId)
        .eq("status", "OPEN")
        .maybeSingle();
      if (tab?.id) {
        tabId = tab.id;
        const { data: tabItems } = await sb
          .from("booking_tab_items")
          .select("id,tab_id,item_id,quantity")
          .eq("tab_id", tabId);
        const itemIds = Array.from(new Set((tabItems ?? []).map((row) => row.item_id).filter(Boolean)));
        if (itemIds.length) {
          const { data: addons } = await sb
            .from("add_ons")
            .select("id,name,price_cents")
            .in("id", itemIds);
          const addonById = new Map((addons ?? []).map((row) => [row.id, row]));
          for (const item of tabItems ?? []) {
            const addon = addonById.get(item.item_id);
            if (!addon) continue;
            const priceCents = Number(addon.price_cents || 0);
            const qty = Number(item.quantity || 0);
            const lineTotal = priceCents * qty;
            tabItemsMeta.push({
              item_id: addon.id,
              name: addon.name,
              price_cents: priceCents,
              quantity: qty,
              line_total_cents: lineTotal,
            });
            tabSubtotalCents += lineTotal;
          }
          tabTaxCents = Math.round(tabSubtotalCents * TAX_RATE);
          tabTotalCents = tabSubtotalCents + tabTaxCents;
        }
      }
    }

    const combinedAmount = bookingAmount + tabTotalCents;

    if (giftMeta && combinedAmount <= 0) {
      return NextResponse.json({ error: "Gift certificate covers total. Use Apply Gift Certificate to mark paid." }, { status: 400 });
    }
    if (giftMeta && combinedAmount > 0 && combinedAmount < 50) {
      return NextResponse.json({ error: "Remaining balance must be at least $0.50 to pay by card." }, { status: 400 });
    }
    if (!Number.isFinite(combinedAmount) || combinedAmount <= 0) {
      return NextResponse.json({ error: "Invalid booking total" }, { status: 400 });
    }

    const cardFee = cardFeeCents(combinedAmount);
    const totalWithFee = combinedAmount + cardFee;

    const stripe = getStripeTerminal();
    const intent = await stripe.paymentIntents.create({
      amount: totalWithFee,
      currency: "usd",
      capture_method: "automatic",
      payment_method_types: ["card_present"],
      metadata: {
        booking_id: bookingId,
        activity: activityLabel(booking.activity),
        party_size: String(booking.party_size || ""),
        date_key: dateKeyFromIsoNY(booking.start_ts),
        start_min: String(minutesFromIsoNY(booking.start_ts)),
        duration_minutes: String(booking.duration_minutes || ""),
        customer_name: String(booking.customer_name || ""),
        customer_email: String(booking.customer_email || ""),
        customer_phone: String(booking.customer_phone || ""),
        lookup_start_ts: String(booking.start_ts || ""),
        lookup_customer_name: String(booking.customer_name || ""),
        lookup_customer_email: String(booking.customer_email || ""),
        combo_order: String(booking.combo_order || "DUCKPIN_FIRST"),
        ui_mode: "staff",
        staff_id: staff.staff_id,
        total_before_discount: String(baseAmount),
        booking_total_new: Number.isFinite(bookingTotalNew) ? String(bookingTotalNew) : "",
        amount_override_cents: Number.isFinite(amountOverrideCents) ? String(amountOverrideCents) : "",
        discount_amount: giftMeta ? String(giftMeta.amountOff) : "0",
        discount_type: giftMeta ? "GIFT" : "",
        gift_code: giftMeta?.code || "",
        gift_amount: giftMeta ? String(giftMeta.amountOff) : "",
        booking_total_after_discount: String(bookingAmount),
        tab_id: tabId || "",
        tab_items: tabItemsMeta.length ? JSON.stringify(tabItemsMeta) : "",
        tab_subtotal_cents: String(tabSubtotalCents || 0),
        tab_tax_cents: String(tabTaxCents || 0),
        tab_total_cents: String(tabTotalCents || 0),
        card_fee_cents: String(cardFee),
        total_with_fee: String(totalWithFee),
      },
    });

    return NextResponse.json({ client_secret: intent.client_secret }, { status: 200 });
  } catch (e: any) {
    console.error("booking terminal payment intent error:", e);
    return NextResponse.json({ error: e?.message || "Failed to create payment intent" }, { status: 500 });
  }
}
