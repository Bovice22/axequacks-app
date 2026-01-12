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
  const { error } = await sb.from("promo_redemptions").upsert(
    {
      promo_code: code,
      customer_email: email,
      customer_id: input.customerId || null,
      booking_id: input.bookingId || null,
    },
    { onConflict: "promo_code,customer_email" }
  );
  if (error) {
    console.error("promo redemption insert error:", error);
  }
}
