import { NextResponse } from "next/server";
import {
  PARTY_AREA_OPTIONS,
  canonicalPartyAreaName,
  normalizePartyAreaName,
  partyAreaCostCents,
  totalCents,
  type PartyAreaName,
} from "@/lib/bookingLogic";
import { getStripeTerminal } from "@/lib/server/stripe";
import { supabaseServer } from "@/lib/supabaseServer";
import { hasPromoRedemption, normalizeEmail, normalizePromoCode } from "@/lib/server/promoRedemptions";
import { validatePromoUsage } from "@/lib/server/promoRules";
import type { ActivityUI, ComboOrder } from "@/lib/server/bookingService";

type TerminalIntentRequest = {
  activity: ActivityUI;
  partySize: number;
  dateKey: string;
  startMin: number;
  durationMinutes: number;
  comboAxeMinutes?: number;
  comboDuckpinMinutes?: number;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  comboOrder?: ComboOrder;
  promoCode?: string;
  partyAreas?: string[];
  partyAreaMinutes?: number;
};

function validate(body: TerminalIntentRequest) {
  if (!body.activity) return "Missing activity";
  if (!Number.isFinite(body.partySize) || body.partySize < 1) return "Invalid party size";
  if (!body.dateKey) return "Missing date";
  if (!Number.isFinite(body.startMin)) return "Missing start time";
  if (!Number.isFinite(body.durationMinutes) || body.durationMinutes <= 0) return "Missing duration";
  if (!body.customerName || body.customerName.trim().length < 2) return "Missing customer name";
  if (!body.customerEmail || body.customerEmail.trim().length < 5) return "Missing customer email";
  if (body.activity === "Combo Package") {
    const valid = [30, 60, 120];
    if (!valid.includes(Number(body.comboAxeMinutes)) || !valid.includes(Number(body.comboDuckpinMinutes))) {
      return "Missing combo durations";
    }
  }
  return null;
}

const PARTY_AREA_BOOKABLE_SET: Set<string> = new Set(
  PARTY_AREA_OPTIONS.filter((option) => option.visible).map((option) => normalizePartyAreaName(option.name))
);

function normalizePartyAreas(input?: string[]) {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .map((item) => canonicalPartyAreaName(String(item || "")))
        .filter((name): name is PartyAreaName => !!name)
        .filter((name) => PARTY_AREA_BOOKABLE_SET.has(normalizePartyAreaName(name)))
    )
  );
}

function serializePartyAreas(partyAreas: string[]) {
  return partyAreas.length ? JSON.stringify(partyAreas) : "";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as TerminalIntentRequest;
    const err = validate(body);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    const partyAreas = normalizePartyAreas(body.partyAreas);

    const stripe = getStripeTerminal();
    const partyAreaMinutes =
      partyAreas.length && Number.isFinite(Number(body.partyAreaMinutes))
        ? Math.min(480, Math.max(60, Math.round(Number(body.partyAreaMinutes) / 60) * 60))
        : 0;
    if (partyAreas.length && !partyAreaMinutes) {
      return NextResponse.json({ error: "Invalid party area duration" }, { status: 400 });
    }
    const baseAmount = totalCents(body.activity, body.partySize, body.durationMinutes, {
      axeMinutes: Number(body.comboAxeMinutes),
      duckpinMinutes: Number(body.comboDuckpinMinutes),
    }) + partyAreaCostCents(partyAreaMinutes, partyAreas.length);
    let amount = baseAmount;
    let promoMeta: { code: string; amountOff: number; discountType: string; discountValue: number } | null = null;
    const comboOrder = body.comboOrder ?? "DUCKPIN_FIRST";
    const comboTotalMinutes =
      body.activity === "Combo Package"
        ? Number(body.comboAxeMinutes || 0) + Number(body.comboDuckpinMinutes || 0)
        : body.durationMinutes;

    const promoCode = body.promoCode ? normalizePromoCode(body.promoCode) : "";
    if (promoCode) {
      const promoRuleError = validatePromoUsage({
        code: promoCode,
        activity: body.activity,
        durationMinutes: body.durationMinutes,
      });
      if (promoRuleError) {
        return NextResponse.json({ error: promoRuleError }, { status: 400 });
      }
      const sb = supabaseServer();
      const customerEmail = normalizeEmail(body.customerEmail || "");
      if (customerEmail) {
        const alreadyUsed = await hasPromoRedemption(promoCode, customerEmail);
        if (alreadyUsed) {
          return NextResponse.json({ error: "Promo code already used." }, { status: 400 });
        }
      }
      const { data, error } = await sb
        .from("promo_codes")
        .select("code,discount_type,discount_value,active,starts_at,ends_at,max_redemptions,redemptions_count")
        .eq("code", promoCode)
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

    const intent = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      capture_method: "automatic",
      payment_method_types: ["card_present"],
      metadata: {
        activity: body.activity,
        party_size: String(body.partySize),
        date_key: body.dateKey,
        start_min: String(body.startMin),
        duration_minutes: String(comboTotalMinutes),
        combo_axe_minutes: body.comboAxeMinutes != null ? String(body.comboAxeMinutes) : "",
        combo_duckpin_minutes: body.comboDuckpinMinutes != null ? String(body.comboDuckpinMinutes) : "",
        party_areas: serializePartyAreas(partyAreas),
        party_area_minutes: partyAreaMinutes ? String(partyAreaMinutes) : "",
        customer_name: body.customerName.trim(),
        customer_email: body.customerEmail.trim(),
        customer_phone: body.customerPhone?.trim() || "",
        combo_order: comboOrder,
        ui_mode: "staff",
        promo_code: promoMeta?.code || "",
        discount_amount: promoMeta ? String(promoMeta.amountOff) : "",
        discount_type: promoMeta?.discountType || "",
        discount_value: promoMeta ? String(promoMeta.discountValue) : "",
        total_before_discount: String(baseAmount),
      },
    });

    return NextResponse.json({ client_secret: intent.client_secret }, { status: 200 });
  } catch (e: any) {
    console.error("terminal payment intent error:", e);
    return NextResponse.json({ error: e?.message || "Failed to create payment intent" }, { status: 500 });
  }
}
