import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const status = String(searchParams.get("status") || "OPEN").toUpperCase();

    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("booking_tabs")
      .select("id,booking_id,customer_name,customer_email,status,created_at")
      .eq("status", status)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("tabs list error:", error);
      return NextResponse.json({ error: "Failed to load tabs" }, { status: 500 });
    }

    return NextResponse.json({ tabs: data ?? [] }, { status: 200 });
  } catch (err: any) {
    console.error("tabs list fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const bookingId = String(body?.booking_id || "").trim();
    if (!bookingId) return NextResponse.json({ error: "Missing booking_id" }, { status: 400 });

    const sb = getSupabaseAdmin();
    const { data: booking, error: bookingErr } = await sb
      .from("bookings")
      .select("id,customer_id,customer_name,customer_email")
      .eq("id", bookingId)
      .single();

    if (bookingErr || !booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const customerId = booking.customer_id ?? null;
    const customerEmail = booking.customer_email ?? null;

    let existingQuery = sb.from("booking_tabs").select("id,booking_id,status").eq("status", "OPEN");
    if (customerId) {
      existingQuery = existingQuery.eq("customer_id", customerId);
    } else if (customerEmail) {
      existingQuery = existingQuery.eq("customer_email", customerEmail);
    }
    const { data: existing } = await existingQuery.maybeSingle();
    if (existing?.id) {
      return NextResponse.json({ tab: existing }, { status: 200 });
    }

    const { data: tab, error: tabErr } = await sb
      .from("booking_tabs")
      .insert({
        booking_id: bookingId,
        customer_id: customerId,
        customer_name: booking.customer_name,
        customer_email: customerEmail,
        status: "OPEN",
      })
      .select("id,booking_id,status")
      .single();

    if (tabErr || !tab) {
      console.error("tab create error:", tabErr);
      return NextResponse.json({ error: "Failed to open tab" }, { status: 500 });
    }

    return NextResponse.json({ tab }, { status: 200 });
  } catch (err: any) {
    console.error("tab create fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
