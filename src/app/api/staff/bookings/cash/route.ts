import { NextResponse } from "next/server";
import { createBookingWithResources, type ActivityUI, type ComboOrder } from "@/lib/server/bookingService";
import { ensureWaiverForBooking } from "@/lib/server/waiverService";
import { sendBookingConfirmationEmail, sendOwnerBookingConfirmationEmail } from "@/lib/server/mailer";
import { supabaseServer } from "@/lib/supabaseServer";
import { hasPromoRedemption, normalizeEmail, normalizePromoCode, recordPromoRedemption } from "@/lib/server/promoRedemptions";
import { validatePromoUsage } from "@/lib/server/promoRules";
import { validateGiftCertificate, redeemGiftCertificate } from "@/lib/server/giftCertificates";
import { partyAreaCostCents, totalCents } from "@/lib/bookingLogic";

function formatTimeFromMinutes(minsFromMidnight: number) {
  const h24 = Math.floor(minsFromMidnight / 60);
  const m = minsFromMidnight % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

export async function POST(req: Request) {
  try {
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
    const totalCentsOverride = Number(body?.totalCentsOverride);
    const promoCode = String(body?.promoCode || "");
    const partyAreas = Array.isArray(body?.partyAreas) ? body.partyAreas : [];
    const partyAreaMinutes = Number(body?.partyAreaMinutes);
    const partyAreaTiming = (String(body?.partyAreaTiming || "DURING").toUpperCase() as "BEFORE" | "DURING" | "AFTER");
    const normalizedPartyAreaMinutes =
      partyAreas.length && Number.isFinite(partyAreaMinutes)
        ? Math.min(480, Math.max(60, Math.round(partyAreaMinutes / 60) * 60))
        : 0;

    if (!activity || !dateKey || !Number.isFinite(partySize) || !Number.isFinite(startMin) || !Number.isFinite(durationMinutes)) {
      return NextResponse.json({ error: "Missing booking fields" }, { status: 400 });
    }

    const bookingInput = {
      activity,
      partySize,
      dateKey,
      startMin,
      durationMinutes,
      comboAxeMinutes: Number.isFinite(comboAxeMinutes) ? comboAxeMinutes : undefined,
      comboDuckpinMinutes: Number.isFinite(comboDuckpinMinutes) ? comboDuckpinMinutes : undefined,
      partyAreaMinutes: normalizedPartyAreaMinutes || undefined,
      partyAreaTiming,
      customerName,
      customerEmail,
      customerPhone,
      comboOrder,
      totalCentsOverride: Number.isFinite(totalCentsOverride) ? totalCentsOverride : undefined,
      partyAreas,
    };

    const comboDurations =
      Number.isFinite(comboAxeMinutes) && Number.isFinite(comboDuckpinMinutes)
        ? { axeMinutes: comboAxeMinutes, duckpinMinutes: comboDuckpinMinutes }
        : undefined;
    const baseAmount =
      totalCents(activity, partySize, durationMinutes, comboDurations) +
      partyAreaCostCents(normalizedPartyAreaMinutes, partyAreas.length);
    let giftMeta: { code: string; amountOff: number } | null = null;

    if (promoCode) {
      const normalizedCode = normalizePromoCode(promoCode);
      const sb = supabaseServer();
      const { data, error } = await sb
        .from("promo_codes")
        .select("code,active,starts_at,ends_at,max_redemptions,redemptions_count")
        .eq("code", normalizedCode)
        .maybeSingle();

      if (error) {
        console.error("promo lookup error:", error);
        return NextResponse.json({ error: "Failed to validate promo code" }, { status: 500 });
      }
      if (data) {
        const promoRuleError = validatePromoUsage({
          code: normalizedCode,
          activity,
          durationMinutes,
        });
        if (promoRuleError) {
          return NextResponse.json({ error: promoRuleError }, { status: 400 });
        }
        const normalizedEmail = normalizeEmail(customerEmail || "");
        if (normalizedEmail) {
          const alreadyUsed = await hasPromoRedemption(normalizedCode, normalizedEmail);
          if (alreadyUsed) {
            return NextResponse.json({ error: "Promo code already used." }, { status: 400 });
          }
        }
        if (!data.active) {
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
      } else {
        try {
          const giftResult = await validateGiftCertificate({
            code: normalizedCode,
            customerEmail,
            amountCents: baseAmount,
          });
          giftMeta = { code: giftResult.gift.code, amountOff: giftResult.amountOffCents };
          bookingInput.totalCentsOverride = giftResult.remainingCents;
        } catch (giftErr: any) {
          return NextResponse.json({ error: giftErr?.message || "Invalid promo code." }, { status: 400 });
        }
      }
    }

    const result = await createBookingWithResources(bookingInput);
    const sb = supabaseServer();
    const { error } = await sb.from("bookings").update({ paid: true }).eq("id", result.bookingId);
    if (error) {
      console.error("cash booking paid update error:", error);
    }
    if (promoCode && !giftMeta) {
      await recordPromoRedemption({
        promoCode,
        customerEmail,
        customerId: result.customerId,
        bookingId: result.bookingId,
      });
    }
    if (giftMeta) {
      await redeemGiftCertificate({
        code: giftMeta.code,
        customerEmail,
        amountCents: giftMeta.amountOff,
        bookingId: result.bookingId,
      });
    }

    try {
      const waiverResult = await ensureWaiverForBooking({
        bookingId: result.bookingId,
        customerId: result.customerId,
        bookingInput,
      });
      await sendBookingConfirmationEmail({
        bookingId: result.bookingId,
        activity: bookingInput.activity,
        partySize: bookingInput.partySize,
        dateKey: bookingInput.dateKey,
        startMin: bookingInput.startMin,
        durationMinutes: bookingInput.durationMinutes,
        customerName: bookingInput.customerName,
        customerEmail: bookingInput.customerEmail,
        customerPhone: bookingInput.customerPhone,
        comboOrder: bookingInput.comboOrder,
        waiverUrl: waiverResult.waiverUrl || "",
        totalCents: bookingInput.totalCentsOverride,
        paid: true,
      });
    } catch (emailErr) {
      console.error("cash booking confirmation error:", emailErr);
    }

    try {
      await sendOwnerBookingConfirmationEmail({
        bookingId: result.bookingId,
        activity,
        partySize,
        dateKey,
        startMin,
        durationMinutes,
        customerName,
        customerEmail,
        customerPhone,
        totalCents: totalCentsOverride,
        paid: true,
      });
    } catch (err) {
      console.error("cash owner booking email error:", err);
    }

    return NextResponse.json({ bookingId: result.bookingId }, { status: 200 });
  } catch (err: any) {
    console.error("cash booking fatal:", err);
    return NextResponse.json({ error: err?.message || "Failed to record cash booking" }, { status: 500 });
  }
}
