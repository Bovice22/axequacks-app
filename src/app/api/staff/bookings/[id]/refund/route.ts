import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getStaffUserFromCookies } from "@/lib/staffAuth";
import { pinToPassword } from "@/lib/pinAuth";
import { getStripe } from "@/lib/server/stripe";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

async function getRouteId(req: Request, context: RouteContext) {
  const resolvedParams = await Promise.resolve(context.params);
  if (resolvedParams?.id) return String(resolvedParams.id).trim();
  try {
    const path = new URL(req.url).pathname;
    const parts = path.split("/").filter(Boolean);
    if (!parts.length) return "";
    const last = parts[parts.length - 1];
    if (last === "refund" && parts.length >= 2) {
      return parts[parts.length - 2] || "";
    }
    return last || "";
  } catch {
    return "";
  }
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

function getSupabaseAnon() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function verifyAdmin(staffIdRaw: string, pin: string) {
  const staffId = staffIdRaw.trim().toLowerCase();
  if (!staffId || pin.length !== 4) {
    return { ok: false, error: "Missing manager credentials" };
  }

  const admin = getSupabaseAdmin();
  const { data: staff, error: staffErr } = await admin
    .from("staff_users")
    .select("auth_email,role,active")
    .eq("staff_id", staffId)
    .single();

  if (staffErr || !staff || !staff.active || staff.role !== "admin") {
    return { ok: false, error: "Invalid manager credentials" };
  }

  const sb = getSupabaseAnon();
  const { error: authErr } = await sb.auth.signInWithPassword({
    email: staff.auth_email,
    password: pinToPassword(pin, staffId),
  });

  if (authErr) {
    return { ok: false, error: "Invalid manager credentials" };
  }

  return { ok: true };
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = (await getRouteId(req, context)) || new URL(req.url).searchParams.get("id") || "";
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const reason = String(body?.reason || "").trim();
    const amountCents = Number(body?.amount_cents || 0);

    if (!reason) {
      return NextResponse.json({ error: "Refund reason required" }, { status: 400 });
    }

    if (staff.role !== "admin") {
      const managerId = String(body?.manager_staff_id || "");
      const managerPin = String(body?.manager_pin || "");
      const verified = await verifyAdmin(managerId, managerPin);
      if (!verified.ok) {
        return NextResponse.json({ error: verified.error || "Manager approval required" }, { status: 403 });
      }
    }

    const sb = getSupabaseAdmin();
    let booking: any = null;
    let bookingErr: any = null;

    ({ data: booking, error: bookingErr } = await sb
      .from("bookings")
      .select("id,paid,status,total_cents,payment_intent_id")
      .eq("id", id)
      .single());

    let bookingErrMessage = String(bookingErr?.message || "").toLowerCase();
    if (bookingErr && bookingErrMessage.includes("payment_intent")) {
      ({ data: booking, error: bookingErr } = await sb
        .from("bookings")
        .select("id,paid,status,total_cents")
        .eq("id", id)
        .single());
      bookingErrMessage = String(bookingErr?.message || "").toLowerCase();
    }
    if (bookingErr && bookingErrMessage.includes("paid")) {
      ({ data: booking, error: bookingErr } = await sb
        .from("bookings")
        .select("id,status,total_cents")
        .eq("id", id)
        .single());
      bookingErrMessage = String(bookingErr?.message || "").toLowerCase();
    }

    if (bookingErr || !booking) {
      const errorMessage = bookingErr?.message ? String(bookingErr.message) : "Booking not found";
      return NextResponse.json({ error: errorMessage }, { status: 404 });
    }

    if (booking.paid === false) {
      return NextResponse.json({ error: "Booking is not marked paid" }, { status: 400 });
    }

    const totalCents = Number(booking.total_cents || 0);
    const refundCents = amountCents > 0 ? amountCents : totalCents;
    if (!Number.isFinite(refundCents) || refundCents <= 0) {
      return NextResponse.json({ error: "Refund amount must be greater than 0" }, { status: 400 });
    }
    if (refundCents > totalCents) {
      return NextResponse.json({ error: "Refund amount exceeds total" }, { status: 400 });
    }

    const stripe = getStripe();
    let paymentIntentId = String(booking.payment_intent_id || "");

    if (!paymentIntentId) {
      try {
        const search = await stripe.paymentIntents.search({
          query: `metadata['booking_id']:'${id}'`,
          limit: 1,
        });
        paymentIntentId = search.data?.[0]?.id || "";
      } catch (searchErr) {
        console.error("payment intent search error:", searchErr);
      }
    }

    if (!paymentIntentId) {
      return NextResponse.json({ error: "Missing payment intent for refund" }, { status: 400 });
    }

    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: refundCents,
      metadata: {
        booking_id: id,
        reason,
        requested_by: staff.staff_id,
      },
    });

    if (refundCents === totalCents) {
      await sb.from("bookings").update({ paid: false, status: "CANCELLED" }).eq("id", id);
    }

    await sb.from("booking_audit_logs").insert({
      booking_id: id,
      staff_id: staff.staff_id,
      action: "refund",
      details: {
        refund_id: refund.id,
        amount_cents: refundCents,
        reason,
      },
    });

    return NextResponse.json({ ok: true, refund }, { status: 200 });
  } catch (err: any) {
    console.error("refund booking error:", err);
    return NextResponse.json({ error: err?.message || "Failed to issue refund" }, { status: 500 });
  }
}
