import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";
import { nyLocalDateKeyPlusMinutesToUTCISOString } from "@/lib/bookingLogic";

export async function GET(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");

    const sb = supabaseServer();
    let query = sb
      .from("bookings")
      .select(
        [
          "id",
          "activity",
          "party_size",
          "duration_minutes",
          "total_cents",
          "start_ts",
          "status",
        ].join(",")
      )
      .order("start_ts", { ascending: true })
      .limit(5000);

    if (startDate) {
      const startIso = nyLocalDateKeyPlusMinutesToUTCISOString(startDate, 0);
      query = query.gte("start_ts", startIso);
    }
    if (endDate) {
      const endIso = nyLocalDateKeyPlusMinutesToUTCISOString(endDate, 24 * 60 - 1);
      query = query.lte("start_ts", endIso);
    }

    const { data, error } = await query;
    if (error) {
      console.error("reports bookings error:", error);
      return NextResponse.json({ error: "Failed to load bookings report" }, { status: 500 });
    }

    return NextResponse.json({ bookings: data ?? [] }, { status: 200 });
  } catch (err: any) {
    console.error("reports bookings fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
