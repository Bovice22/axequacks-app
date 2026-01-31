import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";
import { validateGiftCertificate, redeemGiftCertificate } from "@/lib/server/giftCertificates";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

async function getRouteId(req: Request, context: RouteContext) {
  const resolvedParams = await Promise.resolve(context.params);
  if (resolvedParams?.id) return String(resolvedParams.id).trim();
  try {
    const path = new URL(req.url).pathname;
    return path.split("/").slice(-2, -1)[0] || "";
  } catch {
    return "";
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = (await getRouteId(req, context)) || new URL(req.url).searchParams.get("id") || "";
    if (!id) return NextResponse.json({ error: "Missing booking id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const giftCode = String(body?.gift_code || "").trim();
    const amountOverrideCents = Number(body?.amount_override_cents);
    const bookingTotalNew = Number(body?.booking_total_cents_new);

    if (!giftCode) return NextResponse.json({ error: "Missing gift certificate code." }, { status: 400 });

    const sb = supabaseServer();
    let { data: booking, error: bookingErr } = await sb
      .from("bookings")
      .select("id,customer_email,total_cents,paid")
      .eq("id", id)
      .single();
    if ((bookingErr || !booking) && id) {
      const { data: resv } = await sb.from("resource_reservations").select("booking_id").eq("id", id).single();
      if (resv?.booking_id) {
        ({ data: booking, error: bookingErr } = await sb
          .from("bookings")
          .select("id,customer_email,total_cents,paid")
          .eq("id", resv.booking_id)
          .single());
      }
    }
    if (bookingErr || !booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    if (booking.paid && !(Number.isFinite(amountOverrideCents) && amountOverrideCents > 0)) {
      return NextResponse.json({ error: "Booking already paid" }, { status: 400 });
    }

    let bookingTotalCents = Number(booking.total_cents || 0);
    if (Number.isFinite(bookingTotalNew)) {
      bookingTotalCents = bookingTotalNew;
    }
    const amountDueCents =
      Number.isFinite(amountOverrideCents) && amountOverrideCents > 0 ? amountOverrideCents : bookingTotalCents;

    let giftResult = null;
    try {
      giftResult = await validateGiftCertificate({
        code: giftCode,
        customerEmail: String(booking.customer_email || ""),
        amountCents: amountDueCents,
      });
    } catch (giftErr: any) {
      return NextResponse.json({ error: giftErr?.message || "Invalid gift certificate." }, { status: 400 });
    }

    if (giftResult.remainingCents > 0) {
      return NextResponse.json({ error: "Gift certificate does not cover the full balance." }, { status: 400 });
    }

    const { data: tab } = await sb
      .from("booking_tabs")
      .select("id,status")
      .eq("booking_id", booking.id)
      .eq("status", "OPEN")
      .maybeSingle();

    if (tab?.id) {
      const { data: tabItems } = await sb
        .from("booking_tab_items")
        .select("id,tab_id,item_id,quantity")
        .eq("tab_id", tab.id);
      if ((tabItems ?? []).length > 0) {
        return NextResponse.json({ error: "Tab balance must be paid separately." }, { status: 400 });
      }
      await sb.from("booking_tabs").update({ status: "CLOSED" }).eq("id", tab.id);
    }

    await redeemGiftCertificate({
      code: giftResult.gift.code,
      customerEmail: String(booking.customer_email || ""),
      amountCents: giftResult.amountOffCents,
      bookingId: booking.id,
      createdBy: staff.staff_id,
    });

    const nextTotalCents = Number.isFinite(bookingTotalNew) ? bookingTotalNew : giftResult.remainingCents;
    const { error: updErr } = await sb
      .from("bookings")
      .update({ paid: true, total_cents: nextTotalCents })
      .eq("id", booking.id);
    if (updErr) {
      console.error("booking gift pay update error:", updErr);
      return NextResponse.json({ error: "Failed to mark booking paid" }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    console.error("booking gift pay fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
