import { createClient } from "@supabase/supabase-js";
import { neededResources, nyLocalDateKeyPlusMinutesToUTCISOString, totalCents } from "@/lib/bookingLogic";

export type ActivityUI = "Axe Throwing" | "Duckpin Bowling" | "Combo Package";
export type ComboOrder = "DUCKPIN_FIRST" | "AXE_FIRST";
type ActivityDB = "AXE" | "DUCKPIN" | "COMBO";

export type BookingInput = {
  activity: ActivityUI;
  partySize: number;
  dateKey: string;
  startMin: number;
  durationMinutes: number;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  comboOrder?: ComboOrder;
  totalCentsOverride?: number;
};

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function mapActivityToDB(activity: ActivityUI): ActivityDB {
  if (activity === "Axe Throwing") return "AXE";
  if (activity === "Duckpin Bowling") return "DUCKPIN";
  return "COMBO";
}

async function upsertCustomer(input: BookingInput) {
  const sb = supabaseAdmin();
  const email = input.customerEmail.trim().toLowerCase();
  const fullName = input.customerName.trim();
  const phone = input.customerPhone?.trim() || null;

  const { data, error } = await sb
    .from("customers")
    .upsert(
      {
        email,
        full_name: fullName || null,
        phone,
      },
      { onConflict: "email" }
    )
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message || "Failed to upsert customer");
  }

  return data?.id as string;
}

async function attachCustomerToBooking(bookingId: string, customerId: string) {
  const sb = supabaseAdmin();
  const { error } = await sb.from("bookings").update({ customer_id: customerId }).eq("id", bookingId);
  if (error) {
    throw new Error(error.message || "Failed to link customer to booking");
  }
}

export async function ensureCustomerAndLinkBooking(input: BookingInput, bookingId: string) {
  const customerId = await upsertCustomer(input);
  await attachCustomerToBooking(bookingId, customerId);
  return customerId;
}

function computeNeeds(activity: ActivityUI, partySize: number) {
  const needs = neededResources(activity, partySize);
  return { axeBays: needs.AXE, lanes: needs.DUCKPIN };
}

export async function createBookingWithResources(input: BookingInput) {
  const sb = supabaseAdmin();
  const activityDB = mapActivityToDB(input.activity);
  const needs = computeNeeds(input.activity, input.partySize);

  const effectiveDuration = input.activity === "Combo Package" ? 120 : input.durationMinutes;
  const endMin = input.startMin + effectiveDuration;

  const startTsUtc = nyLocalDateKeyPlusMinutesToUTCISOString(input.dateKey, input.startMin);
  const endTsUtc = nyLocalDateKeyPlusMinutesToUTCISOString(input.dateKey, endMin);

  const totalCentsValue =
    Number.isFinite(input.totalCentsOverride) && (input.totalCentsOverride as number) > 0
      ? (input.totalCentsOverride as number)
      : totalCents(input.activity, input.partySize, input.durationMinutes);

  if (input.activity === "Combo Package") {
    const comboDuration = 120;
    const comboEndMin = input.startMin + comboDuration;

    const comboStartTsUtc = nyLocalDateKeyPlusMinutesToUTCISOString(input.dateKey, input.startMin);
    const comboEndTsUtc = nyLocalDateKeyPlusMinutesToUTCISOString(input.dateKey, comboEndMin);

    const firstSegStartMin = input.startMin;
    const firstSegEndMin = input.startMin + 60;
    const secondSegStartMin = input.startMin + 60;
    const secondSegEndMin = input.startMin + 120;

    const firstSegStartUtc = nyLocalDateKeyPlusMinutesToUTCISOString(input.dateKey, firstSegStartMin);
    const firstSegEndUtc = nyLocalDateKeyPlusMinutesToUTCISOString(input.dateKey, firstSegEndMin);
    const secondSegStartUtc = nyLocalDateKeyPlusMinutesToUTCISOString(input.dateKey, secondSegStartMin);
    const secondSegEndUtc = nyLocalDateKeyPlusMinutesToUTCISOString(input.dateKey, secondSegEndMin);

    const order = input.comboOrder ?? "DUCKPIN_FIRST";
    const isDuckpinFirst = order === "DUCKPIN_FIRST";

    const duckpinStart = isDuckpinFirst ? firstSegStartUtc : secondSegStartUtc;
    const duckpinEnd = isDuckpinFirst ? firstSegEndUtc : secondSegEndUtc;

    const axeStart = isDuckpinFirst ? secondSegStartUtc : firstSegStartUtc;
    const axeEnd = isDuckpinFirst ? secondSegEndUtc : firstSegEndUtc;

    const { data: bookingId, error } = await sb.rpc("create_combo_booking_with_resources", {
      p_activity: activityDB,
      p_duration_minutes: comboDuration,
      p_party_size: input.partySize,
      p_combo_order: order,
      p_start_ts: comboStartTsUtc,
      p_end_ts: comboEndTsUtc,
      p_duckpin_start_ts: duckpinStart,
      p_duckpin_end_ts: duckpinEnd,
      p_axe_start_ts: axeStart,
      p_axe_end_ts: axeEnd,
      p_total_cents: totalCentsValue,
      p_customer_name: input.customerName,
      p_customer_email: input.customerEmail,
      p_tz: "America/New_York",
    });

    if (error) throw new Error(error.message || "Failed to create combo booking");
    const customerId = await ensureCustomerAndLinkBooking(input, bookingId as string);
    return { bookingId, needs, customerId };
  }

  const { data: bookingId, error } = await sb.rpc("create_booking_with_resources", {
    p_activity: activityDB,
    p_duration_minutes: input.durationMinutes,
    p_party_size: input.partySize,
    p_start_ts: startTsUtc,
    p_end_ts: endTsUtc,
    p_total_cents: totalCentsValue,
    p_customer_name: input.customerName,
    p_customer_email: input.customerEmail,
    p_tz: "America/New_York",
  });

  if (error) throw new Error(error.message || "Failed to create booking");
  const customerId = await ensureCustomerAndLinkBooking(input, bookingId as string);
  return { bookingId, needs, customerId };
}
