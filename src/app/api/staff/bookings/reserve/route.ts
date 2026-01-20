import { NextResponse } from "next/server";
import { createBookingWithResources, type ActivityUI, type ComboOrder } from "@/lib/server/bookingService";
import { ensureWaiverForBooking } from "@/lib/server/waiverService";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";
import { normalizePromoCode } from "@/lib/server/promoRedemptions";
import { validatePromoUsage } from "@/lib/server/promoRules";
import { sendOwnerBookingConfirmationEmail } from "@/lib/server/mailer";

function formatTimeFromMinutes(minsFromMidnight: number) {
  const h24 = Math.floor(minsFromMidnight / 60);
  const m = minsFromMidnight % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

export async function POST(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
    const partyAreas = Array.isArray(body?.partyAreas) ? body.partyAreas : [];
    const partyAreaMinutes = Number(body?.partyAreaMinutes);
    const partyAreaTiming = (String(body?.partyAreaTiming || "DURING").toUpperCase() as "BEFORE" | "DURING" | "AFTER");
    const promoCode = String(body?.promoCode || "");

    if (!activity || !dateKey || !Number.isFinite(partySize) || !Number.isFinite(startMin) || !Number.isFinite(durationMinutes)) {
      return NextResponse.json({ error: "Missing booking fields" }, { status: 400 });
    }

    if (promoCode) {
      const promoRuleError = validatePromoUsage({
        code: normalizePromoCode(promoCode),
        activity,
        durationMinutes,
      });
      if (promoRuleError) {
        return NextResponse.json({ error: promoRuleError }, { status: 400 });
      }
    }

    const bookingInput = {
      activity,
      partySize,
      dateKey,
      startMin,
      durationMinutes,
      comboAxeMinutes: Number.isFinite(comboAxeMinutes) ? comboAxeMinutes : undefined,
      comboDuckpinMinutes: Number.isFinite(comboDuckpinMinutes) ? comboDuckpinMinutes : undefined,
      partyAreaMinutes: Number.isFinite(partyAreaMinutes) ? partyAreaMinutes : undefined,
      partyAreaTiming,
      customerName,
      customerEmail,
      customerPhone,
      comboOrder,
      totalCentsOverride: Number.isFinite(totalCentsOverride) ? totalCentsOverride : undefined,
      partyAreas,
    };

    const result = await createBookingWithResources(bookingInput);

    const sb = supabaseServer();
    await sb.from("bookings").update({ paid: false }).eq("id", result.bookingId);

    try {
      await ensureWaiverForBooking({
        bookingId: result.bookingId,
        customerId: result.customerId,
        bookingInput,
      });
    } catch (err) {
      console.error("reserve waiver error:", err);
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
        paid: false,
      });
    } catch (err) {
      console.error("reserve owner booking email error:", err);
    }

    return NextResponse.json({ bookingId: result.bookingId }, { status: 200 });
  } catch (err: any) {
    console.error("reserve booking error:", err);
    return NextResponse.json({ error: err?.message || "Failed to reserve booking" }, { status: 500 });
  }
}
