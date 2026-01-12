import { NextResponse } from "next/server";
import { getStaffUserFromCookies } from "@/lib/staffAuth";
import { getStripe } from "@/lib/server/stripe";
import { PARTY_AREA_OPTIONS, partyAreaCostCents, totalCents } from "@/lib/bookingLogic";
import { supabaseServer } from "@/lib/supabaseServer";
import { hasPromoRedemption, normalizeEmail, normalizePromoCode } from "@/lib/server/promoRedemptions";
import { sendBookingPaymentLinkEmail } from "@/lib/server/mailer";
import type { ActivityUI, ComboOrder } from "@/lib/server/bookingService";

const PARTY_AREA_BOOKABLE_SET: Set<string> = new Set(
  PARTY_AREA_OPTIONS.filter((option) => option.visible).map((option) => option.name)
);

function normalizeBaseUrl(value?: string | null) {
  const cleaned = String(value || "")
    .replace(/^=+/, "")
    .replace(/["']/g, "")
    .trim()
    .replace(/\/+$/, "");
  return /^https?:\/\//.test(cleaned) ? cleaned : "";
}

export async function POST(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff && process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const activity = body?.activity as ActivityUI | undefined;
    const partySize = Number(body?.partySize);
    const dateKey = String(body?.dateKey || "");
    const startMin = Number(body?.startMin);
    const durationMinutes = Number(body?.durationMinutes);
    const comboAxeMinutes = Number(body?.comboAxeMinutes);
    const comboDuckpinMinutes = Number(body?.comboDuckpinMinutes);
    const customerName = String(body?.customerName || "");
    const customerEmail = String(body?.customerEmail || "");
    const customerPhone = String(body?.customerPhone || "");
    const comboOrder = (body?.comboOrder as ComboOrder | undefined) ?? "DUCKPIN_FIRST";
    const promoCode = String(body?.promoCode || "");
    const partyAreas = Array.isArray(body?.partyAreas) ? body.partyAreas : [];
    const partyAreaMinutes = Number(body?.partyAreaMinutes);

    if (!activity || !dateKey || !Number.isFinite(partySize) || !Number.isFinite(startMin) || !Number.isFinite(durationMinutes)) {
      return NextResponse.json({ error: "Missing booking fields" }, { status: 400 });
    }

    const validDurations = [15, 30, 60, 120];
    const validComboDurations = [30, 60, 120];
    if (activity === "Combo Package") {
      if (!validComboDurations.includes(comboAxeMinutes) || !validComboDurations.includes(comboDuckpinMinutes)) {
        return NextResponse.json({ error: "Invalid combo durations" }, { status: 400 });
      }
    } else if (!validDurations.includes(durationMinutes)) {
      return NextResponse.json({ error: "Invalid durationMinutes" }, { status: 400 });
    }

    const normalizedPartyAreas = Array.from(
      new Set(
        partyAreas
          .map((item: any) => String(item || "").trim())
          .filter((name: string) => PARTY_AREA_BOOKABLE_SET.has(name))
      )
    );
    const normalizedPartyAreaMinutes =
      normalizedPartyAreas.length && Number.isFinite(partyAreaMinutes)
        ? Math.min(480, Math.max(60, Math.round(partyAreaMinutes / 60) * 60))
        : 0;
    if (normalizedPartyAreas.length && !normalizedPartyAreaMinutes) {
      return NextResponse.json({ error: "Invalid party area duration" }, { status: 400 });
    }

    const baseAmount = totalCents(activity, partySize, durationMinutes, {
      axeMinutes: Number.isFinite(comboAxeMinutes) ? comboAxeMinutes : undefined,
      duckpinMinutes: Number.isFinite(comboDuckpinMinutes) ? comboDuckpinMinutes : undefined,
    }) + partyAreaCostCents(normalizedPartyAreaMinutes, normalizedPartyAreas.length);

    let amount = baseAmount;
    let promoMeta: { code: string; amountOff: number; discountType: string; discountValue: number } | null = null;

    if (promoCode) {
      const sb = supabaseServer();
      const normalized = normalizePromoCode(promoCode);
      const customerEmailNormalized = normalizeEmail(customerEmail || "");
      if (customerEmailNormalized) {
        const alreadyUsed = await hasPromoRedemption(normalized, customerEmailNormalized);
        if (alreadyUsed) {
          return NextResponse.json({ error: "Promo code already used." }, { status: 400 });
        }
      }
      const { data, error } = await sb
        .from("promo_codes")
        .select("code,discount_type,discount_value,active,starts_at,ends_at,max_redemptions,redemptions_count")
        .eq("code", normalized)
        .maybeSingle();

      if (error) {
        console.error("promo lookup error:", error);
        return NextResponse.json({ error: "Failed to validate promo code" }, { status: 500 });
      }

      if (!data || !data.active) {
        return NextResponse.json({ error: "Invalid promo code" }, { status: 400 });
      }

      const now = new Date();
      if (data.starts_at && new Date(data.starts_at) > now) {
        return NextResponse.json({ error: "Promo not active yet" }, { status: 400 });
      }
      if (data.ends_at && new Date(data.ends_at) < now) {
        return NextResponse.json({ error: "Promo has expired" }, { status: 400 });
      }
      if (data.max_redemptions != null && data.redemptions_count >= data.max_redemptions) {
        return NextResponse.json({ error: "Promo has reached its limit" }, { status: 400 });
      }

      let amountOff = 0;
      if (data.discount_type === "PERCENT") {
        amountOff = Math.round((baseAmount * Number(data.discount_value || 0)) / 100);
      } else {
        amountOff = Number(data.discount_value || 0);
      }
      amountOff = Math.max(0, Math.min(amountOff, baseAmount));
      const discounted = baseAmount - amountOff;
      if (discounted < 50) {
        return NextResponse.json({ error: "Promo discount exceeds total" }, { status: 400 });
      }
      amount = discounted;
      promoMeta = {
        code: data.code,
        amountOff,
        discountType: data.discount_type,
        discountValue: Number(data.discount_value || 0),
      };
    }

    const comboTotalMinutes =
      activity === "Combo Package"
        ? Number(comboAxeMinutes || 0) + Number(comboDuckpinMinutes || 0)
        : durationMinutes;

    const partyAreasMeta = normalizedPartyAreas.length ? JSON.stringify(normalizedPartyAreas) : "";

    const base =
      normalizeBaseUrl(process.env.NEXT_PUBLIC_BOOK_URL) ||
      normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL) ||
      "http://localhost:3000";
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: customerEmail || undefined,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: amount,
            product_data: {
              name: activity,
              description: `${partySize} guests • ${comboTotalMinutes} mins`,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${base}/book/confirmation?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/book`,
      payment_intent_data: {
          metadata: {
            activity,
            party_size: String(partySize),
            date_key: dateKey,
            start_min: String(startMin),
            duration_minutes: String(comboTotalMinutes),
            combo_axe_minutes: Number.isFinite(comboAxeMinutes) ? String(comboAxeMinutes) : "",
            combo_duckpin_minutes: Number.isFinite(comboDuckpinMinutes) ? String(comboDuckpinMinutes) : "",
            party_areas: partyAreasMeta,
            party_area_minutes: normalizedPartyAreaMinutes ? String(normalizedPartyAreaMinutes) : "",
            customer_name: customerName.trim(),
          customer_email: customerEmail.trim(),
          customer_phone: customerPhone.trim(),
          combo_order: comboOrder,
          ui_mode: "staff",
          promo_code: promoMeta?.code || "",
          discount_amount: promoMeta ? String(promoMeta.amountOff) : "",
          discount_type: promoMeta?.discountType || "",
          discount_value: promoMeta ? String(promoMeta.discountValue) : "",
          total_before_discount: String(baseAmount),
        },
      },
    });

    const paymentUrl = session.url || "";
    if (!paymentUrl) {
      return NextResponse.json({ error: "Unable to create payment link" }, { status: 500 });
    }

    try {
      await sendBookingPaymentLinkEmail({
        customerName,
        customerEmail,
        customerPhone: customerPhone || undefined,
        dateKey,
        startMin,
        durationMinutes: comboTotalMinutes,
        partySize,
        activity,
        totalCents: amount,
        paymentUrl,
      });
    } catch (emailErr) {
      console.error("booking payment link email error:", emailErr);
    }

    return NextResponse.json({ paymentUrl }, { status: 200 });
  } catch (err: any) {
    console.error("booking payment link fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
