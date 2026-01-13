import { NextResponse } from "next/server";
import { PARTY_AREA_OPTIONS, canonicalPartyAreaName, normalizePartyAreaName, type PartyAreaName } from "@/lib/bookingLogic";
import { hasPromoRedemption, normalizeEmail, normalizePromoCode } from "@/lib/server/promoRedemptions";
import { supabaseServer } from "@/lib/supabaseServer";

type Activity = "Axe Throwing" | "Duckpin Bowling";
const PARTY_AREA_BOOKABLE_SET: Set<string> = new Set(
  PARTY_AREA_OPTIONS.filter((option) => option.visible).map((option) => normalizePartyAreaName(option.name))
);

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const customerName = String(body?.customerName || "").trim();
    const customerEmail = String(body?.customerEmail || "").trim().toLowerCase();
    const customerPhone = String(body?.customerPhone || "").trim();
    const partySize = Number(body?.partySize);
    const dateKey = String(body?.dateKey || "");
    const startMin = Number(body?.startMin);
    const durationMinutes = Number(body?.durationMinutes);
    const totalCents = Number(body?.totalCents);
    const promoCodeRaw = String(body?.promoCode || "");
    const activities = Array.isArray(body?.activities) ? body.activities : [];
    const payInPerson = Boolean(body?.payInPerson);
    const partyAreas = Array.isArray(body?.partyAreas)
      ? Array.from(
          new Set(
            body.partyAreas
              .map((item: any) => canonicalPartyAreaName(String(item || "")))
              .filter((name: PartyAreaName | null): name is PartyAreaName => !!name)
              .filter((name: string) => PARTY_AREA_BOOKABLE_SET.has(normalizePartyAreaName(name)))
          )
        )
      : [];
    const partyAreaMinutes = Number(body?.partyAreaMinutes);

    if (!customerName || !customerEmail) {
      return NextResponse.json({ error: "Missing contact info" }, { status: 400 });
    }
    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }
    if (!Number.isFinite(partySize) || partySize < 1 || partySize > 100) {
      return NextResponse.json({ error: "Invalid party size" }, { status: 400 });
    }
    if (!Number.isFinite(startMin) || startMin < 0) {
      return NextResponse.json({ error: "Invalid start time" }, { status: 400 });
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return NextResponse.json({ error: "Invalid duration" }, { status: 400 });
    }
    if (!Number.isFinite(totalCents) || totalCents < 0) {
      return NextResponse.json({ error: "Invalid total" }, { status: 400 });
    }
    if (!activities.length) {
      return NextResponse.json({ error: "Select at least one activity" }, { status: 400 });
    }

    const cleanActivities = activities
      .map((a: any) => ({
        activity: a?.activity as Activity,
        durationMinutes: Number(a?.durationMinutes),
      }))
      .filter(
        (a: any) =>
          (a.activity === "Axe Throwing" || a.activity === "Duckpin Bowling") &&
          [30, 60, 120].includes(a.durationMinutes)
      );

    if (!cleanActivities.length) {
      return NextResponse.json({ error: "Invalid activities" }, { status: 400 });
    }

    const normalizedPartyAreaMinutes =
      partyAreas.length && Number.isFinite(partyAreaMinutes)
        ? Math.min(480, Math.max(60, Math.round(partyAreaMinutes / 60) * 60))
        : null;
    if (partyAreas.length && !normalizedPartyAreaMinutes) {
      return NextResponse.json({ error: "Invalid party area duration" }, { status: 400 });
    }

    const sb = supabaseServer();
    let finalTotalCents = totalCents;
    const promoCode = promoCodeRaw ? normalizePromoCode(promoCodeRaw) : "";
    if (promoCode) {
      const customerEmailNorm = normalizeEmail(customerEmail || "");
      if (customerEmailNorm) {
        const alreadyUsed = await hasPromoRedemption(promoCode, customerEmailNorm);
        if (alreadyUsed) {
          return NextResponse.json({ error: "Promo code already used." }, { status: 400 });
        }
      }

      const { data: promo, error: promoErr } = await sb
        .from("promo_codes")
        .select("code,discount_type,discount_value,active,starts_at,ends_at,max_redemptions,redemptions_count")
        .eq("code", promoCode)
        .maybeSingle();

      if (promoErr) {
        console.error("promo lookup error:", promoErr);
        return NextResponse.json({ error: "Failed to validate promo code" }, { status: 500 });
      }
      if (!promo || !promo.active) {
        return NextResponse.json({ error: "Invalid promo code" }, { status: 400 });
      }
      const now = new Date();
      if (promo.starts_at && new Date(promo.starts_at) > now) {
        return NextResponse.json({ error: "Promo not active yet" }, { status: 400 });
      }
      if (promo.ends_at && new Date(promo.ends_at) < now) {
        return NextResponse.json({ error: "Promo has expired" }, { status: 400 });
      }
      if (promo.max_redemptions != null && promo.redemptions_count >= promo.max_redemptions) {
        return NextResponse.json({ error: "Promo has reached its limit" }, { status: 400 });
      }

      let amountOff = 0;
      if (promo.discount_type === "PERCENT") {
        amountOff = Math.round((totalCents * Number(promo.discount_value || 0)) / 100);
      } else {
        amountOff = Number(promo.discount_value || 0);
      }
      amountOff = Math.max(0, Math.min(amountOff, totalCents));
      const discounted = totalCents - amountOff;
      if (discounted < 50) {
        return NextResponse.json({ error: "Promo discount exceeds total" }, { status: 400 });
      }
      finalTotalCents = discounted;
    }
    const { data, error } = await sb
      .from("event_requests")
      .insert({
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone || null,
        party_size: partySize,
        party_areas: partyAreas,
        party_area_minutes: normalizedPartyAreaMinutes,
        date_key: dateKey,
        start_min: startMin,
        duration_minutes: durationMinutes,
        total_cents: finalTotalCents,
        activities: cleanActivities,
        pay_in_person: payInPerson,
        status: "PENDING",
      })
      .select("id")
      .single();

    if (error) {
      console.error("event request insert error:", error);
      return NextResponse.json(
        { error: "Unable to submit request", detail: error?.message || "Insert failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({ id: data?.id }, { status: 200 });
  } catch (err: any) {
    console.error("event request route fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
