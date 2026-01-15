import { normalizePromoCode } from "@/lib/server/promoRedemptions";

const BOWL10_CODE = "BOWL10";
export const BOWL10_ERROR =
  "Promo code can only be applied to 1-hour duckpin bowling bookings.";

type PromoActivity = {
  activity?: string;
  durationMinutes?: number;
};

function isDuckpinHour(activity?: string, durationMinutes?: number) {
  const normalizedActivity = String(activity || "").trim().toLowerCase();
  const isDuckpin =
    normalizedActivity === "duckpin bowling" || normalizedActivity === "duckpin";
  return isDuckpin && Number(durationMinutes) === 60;
}

export function validatePromoUsage(input: {
  code: string;
  activity?: string;
  durationMinutes?: number;
  activities?: PromoActivity[];
}) {
  const normalized = normalizePromoCode(input.code || "");
  if (normalized !== BOWL10_CODE) return null;

  if (Array.isArray(input.activities) && input.activities.length) {
    if (input.activities.length !== 1) return BOWL10_ERROR;
    const [entry] = input.activities;
    return isDuckpinHour(entry?.activity, entry?.durationMinutes) ? null : BOWL10_ERROR;
  }

  return isDuckpinHour(input.activity, input.durationMinutes) ? null : BOWL10_ERROR;
}
