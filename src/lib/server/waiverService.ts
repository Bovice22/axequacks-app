import { createClient } from "@supabase/supabase-js";
import type { ActivityUI, BookingInput } from "@/lib/server/bookingService";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function needsWaiver(activity: ActivityUI | string) {
  const normalized = String(activity || "")
    .trim()
    .toUpperCase();
  if (!normalized) return false;
  if (normalized.includes("AXE")) return true;
  if (normalized.includes("COMBO")) return true;
  return false;
}

function buildWaiverUrl(token: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base}/waiver?token=${encodeURIComponent(token)}`;
}

export async function ensureWaiverForBooking(params: {
  bookingId: string;
  customerId: string;
  bookingInput: BookingInput;
}) {
  const sb = supabaseAdmin();
  let requiresWaiver = needsWaiver(params.bookingInput.activity);

  if (!requiresWaiver && params.bookingId) {
    const { data: resources, error: resourcesErr } = await sb
      .from("resource_reservations")
      .select("resources!inner(type)")
      .eq("booking_id", params.bookingId);

    if (resourcesErr) {
      console.error("waiver resource lookup error:", resourcesErr);
    } else if ((resources ?? []).some((row: any) => String(row?.resources?.type || "").toUpperCase().includes("AXE"))) {
      requiresWaiver = true;
    }
  }

  if (!requiresWaiver) {
    return { waiverUrl: "", required: false, reason: "not_required" };
  }
  let customerId = params.customerId;

  if (!customerId) {
    const email = params.bookingInput.customerEmail.trim().toLowerCase();
    const fullName = params.bookingInput.customerName.trim();
    const phone = params.bookingInput.customerPhone?.trim() || null;
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

    if (error || !data?.id) {
      throw new Error(error?.message || "Failed to resolve customer for waiver");
    }
    customerId = data.id as string;
  }

  const { data: existingWaiver } = await sb
    .from("customer_waivers")
    .select("id")
    .eq("customer_id", customerId)
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingWaiver?.id) {
    return { waiverUrl: "", required: false, reason: "already_signed" };
  }

  const { data: existingRequest } = await sb
    .from("waiver_requests")
    .select("id,token,status,sent_at")
    .eq("booking_id", params.bookingId)
    .maybeSingle();

  if (existingRequest?.status === "SIGNED") {
    return { waiverUrl: "", required: false, reason: "already_signed" };
  }

  let requestId = existingRequest?.id;
  let token = existingRequest?.token;

  if (!requestId || !token) {
    token = crypto.randomUUID();
    const { data, error } = await sb
      .from("waiver_requests")
      .insert({
        customer_id: customerId,
        booking_id: params.bookingId,
        token,
        status: "PENDING",
        sent_at: new Date().toISOString(),
      })
      .select("id,token")
      .single();
    if (error || !data) {
      throw new Error(error?.message || "Failed to create waiver request");
    }
    requestId = data.id as string;
    token = data.token as string;
  }

  const waiverUrl = buildWaiverUrl(token as string);
  if (!existingRequest?.sent_at && requestId) {
    await sb
      .from("waiver_requests")
      .update({ sent_at: new Date().toISOString() })
      .eq("id", requestId);
  }

  return { waiverUrl, required: true };
}
