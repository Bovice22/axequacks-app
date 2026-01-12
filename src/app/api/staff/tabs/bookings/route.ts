import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getStaffUserFromCookies } from "@/lib/staffAuth";
import { nyLocalDateKeyPlusMinutesToUTCISOString } from "@/lib/bookingLogic";

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

    const sb = getSupabaseAdmin();
    const { searchParams } = new URL(req.url);
    const dateKey = String(searchParams.get("date_key") || "").trim();

    let query = sb
      .from("bookings")
      .select("id,customer_name,customer_email,start_ts,end_ts,status,activity")
      .neq("status", "CANCELLED")
      .order("start_ts", { ascending: true })
      .limit(200);

    if (dateKey) {
      const startIso = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, 0);
      const endIso = nyLocalDateKeyPlusMinutesToUTCISOString(dateKey, 24 * 60);
      query = query.gte("start_ts", startIso).lt("start_ts", endIso);
    } else {
      query = query.gte("start_ts", new Date().toISOString());
    }

    const { data, error } = await query;

    if (error) {
      console.error("tabs bookings error:", error);
      return NextResponse.json({ error: "Failed to load bookings" }, { status: 500 });
    }

    return NextResponse.json({ bookings: data ?? [] }, { status: 200 });
  } catch (err: any) {
    console.error("tabs bookings fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
