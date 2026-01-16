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
    const baseFields = [
      "id",
      "activity",
      "party_size",
      "duration_minutes",
      "total_cents",
      "start_ts",
      "status",
      "customer_name",
      "customer_email",
    ];
    const selectWithPayment = [...baseFields, "paid", "payment_intent_id"].join(",");
    const selectWithPaid = [...baseFields, "paid"].join(",");

    let query = sb.from("bookings").select(selectWithPayment).order("start_ts", { ascending: true }).limit(5000);

    if (startDate) {
      const startIso = nyLocalDateKeyPlusMinutesToUTCISOString(startDate, 0);
      query = query.gte("start_ts", startIso);
    }
    if (endDate) {
      const endIso = nyLocalDateKeyPlusMinutesToUTCISOString(endDate, 24 * 60 - 1);
      query = query.lte("start_ts", endIso);
    }

    let data: any[] | null = null;
    let error: any = null;
    ({ data, error } = await query);
    const errorMessage = String(error?.message || "").toLowerCase();
    if (error && errorMessage.includes("payment_intent")) {
      ({ data, error } = await sb
        .from("bookings")
        .select(selectWithPaid)
        .order("start_ts", { ascending: true })
        .limit(5000));
    }
    if (error && String(error?.message || "").toLowerCase().includes("paid")) {
      ({ data, error } = await sb
        .from("bookings")
        .select(baseFields.join(","))
        .order("start_ts", { ascending: true })
        .limit(5000));
    }

    if (error) {
      console.error("reports bookings error:", error);
      return NextResponse.json({ error: "Failed to load bookings report" }, { status: 500 });
    }

    let cashQuery = sb
      .from("pos_cash_sale_items")
      .select("activity,line_total_cents,created_at,name,quantity")
      .order("created_at", { ascending: true })
      .limit(5000);

    if (startDate) {
      const startIso = nyLocalDateKeyPlusMinutesToUTCISOString(startDate, 0);
      cashQuery = cashQuery.gte("created_at", startIso);
    }
    if (endDate) {
      const endIso = nyLocalDateKeyPlusMinutesToUTCISOString(endDate, 24 * 60 - 1);
      cashQuery = cashQuery.lte("created_at", endIso);
    }

    const { data: cashSales, error: cashErr } = await cashQuery;
    if (cashErr) {
      console.error("reports cash sales error:", cashErr);
      return NextResponse.json({ error: "Failed to load cash sales report" }, { status: 500 });
    }

    let posItemsQuery = sb
      .from("pos_sale_items")
      .select("name,quantity,line_total_cents,created_at")
      .order("created_at", { ascending: true })
      .limit(5000);

    if (startDate) {
      const startIso = nyLocalDateKeyPlusMinutesToUTCISOString(startDate, 0);
      posItemsQuery = posItemsQuery.gte("created_at", startIso);
    }
    if (endDate) {
      const endIso = nyLocalDateKeyPlusMinutesToUTCISOString(endDate, 24 * 60 - 1);
      posItemsQuery = posItemsQuery.lte("created_at", endIso);
    }

    const { data: posItems, error: posItemsErr } = await posItemsQuery;
    if (posItemsErr) {
      console.error("reports pos items error:", posItemsErr);
      // Allow reports to load even if POS items table isn't available yet.
      return NextResponse.json(
        { bookings: data ?? [], cashSales: cashSales ?? [], posItems: [], tips: [], staffUsers: [] },
        { status: 200 }
      );
    }

    let tipsQuery = sb
      .from("pos_sales")
      .select("staff_id,tip_cents,created_at")
      .order("created_at", { ascending: true })
      .limit(5000);

    if (startDate) {
      const startIso = nyLocalDateKeyPlusMinutesToUTCISOString(startDate, 0);
      tipsQuery = tipsQuery.gte("created_at", startIso);
    }
    if (endDate) {
      const endIso = nyLocalDateKeyPlusMinutesToUTCISOString(endDate, 24 * 60 - 1);
      tipsQuery = tipsQuery.lte("created_at", endIso);
    }

    const { data: tips, error: tipsErr } = await tipsQuery;
    if (tipsErr) {
      console.error("reports tips error:", tipsErr);
      return NextResponse.json(
        { bookings: data ?? [], cashSales: cashSales ?? [], posItems: posItems ?? [], tips: [], staffUsers: [] },
        { status: 200 }
      );
    }

    const { data: staffUsers, error: staffErr } = await sb
      .from("staff_users")
      .select("staff_id,full_name")
      .order("full_name", { ascending: true })
      .limit(5000);
    if (staffErr) {
      console.error("reports staff users error:", staffErr);
      return NextResponse.json(
        { bookings: data ?? [], cashSales: cashSales ?? [], posItems: posItems ?? [], tips: tips ?? [], staffUsers: [] },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        bookings: data ?? [],
        cashSales: cashSales ?? [],
        posItems: posItems ?? [],
        tips: tips ?? [],
        staffUsers: staffUsers ?? [],
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("reports bookings fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
