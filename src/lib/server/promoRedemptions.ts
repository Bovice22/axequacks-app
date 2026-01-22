import { supabaseServer } from "@/lib/supabaseServer";

export function normalizePromoCode(code: string) {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function hasPromoRedemption(promoCode: string, customerEmail: string) {
  const code = normalizePromoCode(promoCode);
  const email = normalizeEmail(customerEmail);
  if (!code || !email) return false;
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("promo_redemptions")
    .select("id")
    .eq("promo_code", code)
    .eq("customer_email", email)
    .maybeSingle();
  if (error) {
    console.error("promo redemption lookup error:", error);
    throw new Error("Failed to validate promo code");
  }
  return !!data;
}

export async function recordPromoRedemption(input: {
  promoCode: string;
  customerEmail: string;
  customerId?: string | null;
  bookingId?: string | null;
}) {
  const code = normalizePromoCode(input.promoCode);
  const email = normalizeEmail(input.customerEmail);
  if (!code || !email) return;
  const sb = supabaseServer();
  const { data: existing, error: lookupErr } = await sb
    .from("promo_redemptions")
    .select("id")
    .eq("promo_code", code)
    .eq("customer_email", email)
    .maybeSingle();
  if (lookupErr) {
    console.error("promo redemption lookup error:", lookupErr);
    return;
  }
  if (existing?.id) return;

  const { error: insertErr } = await sb.from("promo_redemptions").insert({
    promo_code: code,
    customer_email: email,
    customer_id: input.customerId || null,
    booking_id: input.bookingId || null,
  });
  if (insertErr) {
    console.error("promo redemption insert error:", insertErr);
    return;
  }

  const { data: promoRow, error: promoErr } = await sb
    .from("promo_codes")
    .select("redemptions_count")
    .eq("code", code)
    .maybeSingle();
  if (promoErr) {
    console.error("promo redemption count lookup error:", promoErr);
    return;
  }
  if (!promoRow) return;
  const nextCount = Number(promoRow.redemptions_count || 0) + 1;
  const { error: countErr } = await sb
    .from("promo_codes")
    .update({ redemptions_count: nextCount })
    .eq("code", code);
  if (countErr) {
    console.error("promo redemption count update error:", countErr);
  }
}
