import { supabaseServer } from "@/lib/supabaseServer";
import { normalizeEmail, normalizePromoCode } from "@/lib/server/promoRedemptions";

export type GiftCertificateRow = {
  id: string;
  code: string;
  customer_id: string;
  original_amount_cents: number;
  balance_cents: number;
  status: string;
  expires_at: string;
};

type GiftValidationResult = {
  gift: GiftCertificateRow;
  amountOffCents: number;
  remainingCents: number;
};

function isExpired(expiresAt?: string | null) {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() < Date.now();
}

export async function findGiftCertificateByCode(codeInput: string) {
  const code = normalizePromoCode(codeInput);
  if (!code) return null;
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("gift_certificates")
    .select("id,code,customer_id,original_amount_cents,balance_cents,status,expires_at")
    .eq("code", code)
    .maybeSingle();
  if (error) {
    console.error("gift certificate lookup error:", error);
    throw new Error("Failed to validate gift certificate");
  }
  return (data as GiftCertificateRow) || null;
}

export async function validateGiftCertificate(input: {
  code: string;
  customerEmail?: string;
  amountCents: number;
}) {
  const code = normalizePromoCode(input.code);
  if (!code) throw new Error("Missing gift certificate code.");
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    throw new Error("Missing amount.");
  }
  const gift = await findGiftCertificateByCode(code);
  if (!gift) throw new Error("Gift certificate not found.");
  if (gift.status !== "ACTIVE") throw new Error("Gift certificate is inactive.");
  if (isExpired(gift.expires_at)) throw new Error("Gift certificate has expired.");
  if (gift.balance_cents <= 0) throw new Error("Gift certificate has no remaining balance.");

  const email = normalizeEmail(input.customerEmail || "");
  if (!email) throw new Error("Gift certificate requires a matching customer email.");
  const sb = supabaseServer();
  const { data: customer, error: customerErr } = await sb
    .from("customers")
    .select("id,email")
    .eq("email", email)
    .maybeSingle();
  if (customerErr) {
    console.error("gift certificate customer lookup error:", customerErr);
    throw new Error("Failed to validate gift certificate");
  }
  if (!customer?.id || customer.id !== gift.customer_id) {
    throw new Error("Gift certificate does not match this customer.");
  }

  const amountOffCents = Math.max(0, Math.min(gift.balance_cents, input.amountCents));
  const remainingCents = input.amountCents - amountOffCents;

  return {
    gift,
    amountOffCents,
    remainingCents,
  } satisfies GiftValidationResult;
}

export async function redeemGiftCertificate(input: {
  code: string;
  customerEmail: string;
  amountCents: number;
  bookingId?: string | null;
  createdBy?: string | null;
}) {
  const code = normalizePromoCode(input.code);
  const email = normalizeEmail(input.customerEmail);
  if (!code || !email) return null;
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) return null;

  const sb = supabaseServer();
  const gift = await findGiftCertificateByCode(code);
  if (!gift) throw new Error("Gift certificate not found.");
  if (gift.status !== "ACTIVE") throw new Error("Gift certificate is inactive.");
  if (isExpired(gift.expires_at)) throw new Error("Gift certificate has expired.");
  if (gift.balance_cents < input.amountCents) throw new Error("Gift certificate balance is too low.");

  const { data: customer, error: customerErr } = await sb
    .from("customers")
    .select("id,email")
    .eq("email", email)
    .maybeSingle();
  if (customerErr) {
    console.error("gift redemption customer lookup error:", customerErr);
    throw new Error("Failed to redeem gift certificate.");
  }
  if (!customer?.id || customer.id !== gift.customer_id) {
    throw new Error("Gift certificate does not match this customer.");
  }

  if (input.bookingId) {
    const { data: existing } = await sb
      .from("gift_certificate_redemptions")
      .select("id")
      .eq("certificate_id", gift.id)
      .eq("booking_id", input.bookingId)
      .maybeSingle();
    if (existing?.id) return existing.id as string;
  }

  const newBalance = gift.balance_cents - input.amountCents;
  const nextStatus = newBalance <= 0 ? "REDEEMED" : "ACTIVE";
  const { data: updated, error: updateErr } = await sb
    .from("gift_certificates")
    .update({ balance_cents: newBalance, status: nextStatus })
    .eq("id", gift.id)
    .eq("balance_cents", gift.balance_cents)
    .select("id")
    .maybeSingle();
  if (updateErr || !updated?.id) {
    console.error("gift certificate balance update error:", updateErr);
    throw new Error("Failed to redeem gift certificate.");
  }

  const { data: redemption, error: redemptionErr } = await sb
    .from("gift_certificate_redemptions")
    .insert({
      certificate_id: gift.id,
      booking_id: input.bookingId || null,
      amount_cents: input.amountCents,
      created_by: input.createdBy || null,
    })
    .select("id")
    .single();
  if (redemptionErr) {
    console.error("gift redemption insert error:", redemptionErr);
    throw new Error("Failed to redeem gift certificate.");
  }

  return redemption.id as string;
}

export function generateGiftCode() {
  const rand = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `GC-${rand()}-${rand()}`;
}
