import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";
import { nyLocalDateKeyPlusMinutesToUTCISOString } from "@/lib/bookingLogic";

const REPORTS_CUTOFF_DATE = "2026-01-01";
const MANUAL_REPORT_START = "2026-01-01";
const MANUAL_REPORT_END = "2026-01-28";
const MANUAL_PAYMENT_INTENT_ID = "manual-report-jan-2026";

const MANUAL_BOOKINGS: Array<{
  activity: string;
  total_cents: number;
}> = [
  { activity: "AXE", total_cents: 10720 * 100 },
  { activity: "DUCKPIN", total_cents: 6244 * 100 },
  { activity: "Alcohol", total_cents: 1718 * 100 },
  { activity: "Beverages", total_cents: 554 * 100 },
  { activity: "Concessions", total_cents: 10975 },
  { activity: "Merchandise", total_cents: 10 * 100 },
];

function normalizeDateInput(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes("/")) {
    const [mm, dd, yyyy] = trimmed.split("/");
    if (!mm || !dd || !yyyy) return null;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return trimmed;
}

function parseDateInput(value: string | null) {
  const normalized = normalizeDateInput(value);
  if (!normalized) return null;
  const parsed = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return { raw: normalized, date: parsed };
}

function isBeforeCutoff(value: string | null) {
  const parsed = parseDateInput(value);
  if (!parsed) return false;
  const cutoff = new Date(`${REPORTS_CUTOFF_DATE}T00:00:00`);
  return parsed.date.getTime() < cutoff.getTime();
}

function getManualRange() {
  const start = new Date(`${MANUAL_REPORT_START}T00:00:00`);
  const end = new Date(`${MANUAL_REPORT_END}T23:59:59`);
  return { start, end };
}

function clampEndDateForManual(startDate: string | null, endDate: string | null) {
  if (endDate) return endDate;
  const manual = getManualRange();
  const start = parseDateInput(startDate)?.date;
  if (start && start.getTime() <= manual.end.getTime()) {
    return MANUAL_REPORT_END;
  }
  return null;
}

function rangeOverlapsManual(startDate: string | null, endDate: string | null) {
  const manual = getManualRange();
  const start = parseDateInput(startDate)?.date ?? manual.start;
  const end = parseDateInput(endDate)?.date ?? manual.end;
  return start.getTime() <= manual.end.getTime() && end.getTime() >= manual.start.getTime();
}

function isWithinManualRange(ts: string) {
  const manual = getManualRange();
  const parsed = new Date(ts);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() >= manual.start.getTime() && parsed.getTime() <= manual.end.getTime();
}

function buildManualBookings() {
  const startTs = nyLocalDateKeyPlusMinutesToUTCISOString(MANUAL_REPORT_START, 12 * 60);
  return MANUAL_BOOKINGS.map((row, index) => ({
    id: `manual-${index}-${MANUAL_REPORT_START}`,
    activity: row.activity,
    party_size: 0,
    duration_minutes: 0,
    total_cents: row.total_cents,
    start_ts: startTs,
    status: "CONFIRMED",
    customer_name: "Manual Report Override",
    customer_email: null,
    paid: true,
    payment_intent_id: MANUAL_PAYMENT_INTENT_ID,
  }));
}

export async function GET(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const startDate = normalizeDateInput(url.searchParams.get("startDate"));
    const rawEndDate = normalizeDateInput(url.searchParams.get("endDate"));
    const endDate = clampEndDateForManual(startDate, rawEndDate) ?? rawEndDate;

    if (isBeforeCutoff(endDate)) {
      return NextResponse.json(
        { bookings: [], cashSales: [], posItems: [], posSales: [], posCashSales: [], tips: [], staffUsers: [] },
        { status: 200 }
      );
    }

    const parsedStart = parseDateInput(startDate);
    const cutoffDate = new Date(`${REPORTS_CUTOFF_DATE}T00:00:00`);
    const reportStartDate =
      parsedStart && parsedStart.date.getTime() >= cutoffDate.getTime() ? parsedStart.raw : REPORTS_CUTOFF_DATE;

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

    if (reportStartDate) {
      const startIso = nyLocalDateKeyPlusMinutesToUTCISOString(reportStartDate, 0);
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

    if (reportStartDate) {
      const startIso = nyLocalDateKeyPlusMinutesToUTCISOString(reportStartDate, 0);
      cashQuery = cashQuery.gte("created_at", startIso);
    }
    if (endDate) {
      const endIso = nyLocalDateKeyPlusMinutesToUTCISOString(endDate, 24 * 60 - 1);
      cashQuery = cashQuery.lte("created_at", endIso);
    }

    let { data: cashSales, error: cashErr } = await cashQuery;
    if (cashErr) {
      console.error("reports cash sales error:", cashErr);
      return NextResponse.json({ error: "Failed to load cash sales report" }, { status: 500 });
    }

    let posItemsQuery = sb
      .from("pos_sale_items")
      .select("name,quantity,line_total_cents,created_at")
      .order("created_at", { ascending: true })
      .limit(5000);

    if (reportStartDate) {
      const startIso = nyLocalDateKeyPlusMinutesToUTCISOString(reportStartDate, 0);
      posItemsQuery = posItemsQuery.gte("created_at", startIso);
    }
    if (endDate) {
      const endIso = nyLocalDateKeyPlusMinutesToUTCISOString(endDate, 24 * 60 - 1);
      posItemsQuery = posItemsQuery.lte("created_at", endIso);
    }

    let { data: posItems, error: posItemsErr } = await posItemsQuery;
    if (posItemsErr) {
      console.error("reports pos items error:", posItemsErr);
      // Allow reports to load even if POS items table isn't available yet.
      return NextResponse.json(
        { bookings: data ?? [], cashSales: cashSales ?? [], posItems: [], posSales: [], posCashSales: [], tips: [], staffUsers: [] },
        { status: 200 }
      );
    }

    let posSalesQuery = sb
      .from("pos_sales")
      .select("id,staff_id,subtotal_cents,tax_cents,total_cents,tip_cents,payment_intent_id,status,created_at")
      .order("created_at", { ascending: true })
      .limit(5000);

    if (reportStartDate) {
      const startIso = nyLocalDateKeyPlusMinutesToUTCISOString(reportStartDate, 0);
      posSalesQuery = posSalesQuery.gte("created_at", startIso);
    }
    if (endDate) {
      const endIso = nyLocalDateKeyPlusMinutesToUTCISOString(endDate, 24 * 60 - 1);
      posSalesQuery = posSalesQuery.lte("created_at", endIso);
    }

    let { data: posSales, error: posSalesErr } = await posSalesQuery;
    if (posSalesErr) {
      console.error("reports pos sales error:", posSalesErr);
      return NextResponse.json(
        { bookings: data ?? [], cashSales: cashSales ?? [], posItems: posItems ?? [], posSales: [], posCashSales: [], tips: [], staffUsers: [] },
        { status: 200 }
      );
    }

    let posCashSalesQuery = sb
      .from("pos_cash_sales")
      .select("id,staff_id,subtotal_cents,tax_cents,total_cents,tab_id,status,created_at")
      .order("created_at", { ascending: true })
      .limit(5000);

    if (reportStartDate) {
      const startIso = nyLocalDateKeyPlusMinutesToUTCISOString(reportStartDate, 0);
      posCashSalesQuery = posCashSalesQuery.gte("created_at", startIso);
    }
    if (endDate) {
      const endIso = nyLocalDateKeyPlusMinutesToUTCISOString(endDate, 24 * 60 - 1);
      posCashSalesQuery = posCashSalesQuery.lte("created_at", endIso);
    }

    let { data: posCashSales, error: posCashSalesErr } = await posCashSalesQuery;
    if (posCashSalesErr) {
      console.error("reports pos cash sales error:", posCashSalesErr);
      return NextResponse.json(
        {
          bookings: data ?? [],
          cashSales: cashSales ?? [],
          posItems: posItems ?? [],
          posSales: posSales ?? [],
          posCashSales: [],
          tips: [],
          staffUsers: [],
        },
        { status: 200 }
      );
    }

    let tipsQuery = sb
      .from("pos_sales")
      .select("staff_id,tip_cents,created_at")
      .order("created_at", { ascending: true })
      .limit(5000);

    if (reportStartDate) {
      const startIso = nyLocalDateKeyPlusMinutesToUTCISOString(reportStartDate, 0);
      tipsQuery = tipsQuery.gte("created_at", startIso);
    }
    if (endDate) {
      const endIso = nyLocalDateKeyPlusMinutesToUTCISOString(endDate, 24 * 60 - 1);
      tipsQuery = tipsQuery.lte("created_at", endIso);
    }

    let { data: tips, error: tipsErr } = await tipsQuery;
    if (tipsErr) {
      console.error("reports tips error:", tipsErr);
      return NextResponse.json(
        {
          bookings: data ?? [],
          cashSales: cashSales ?? [],
          posItems: posItems ?? [],
          posSales: posSales ?? [],
          posCashSales: posCashSales ?? [],
          tips: [],
          staffUsers: [],
        },
        { status: 200 }
      );
    }

    let bookingTipsQuery = sb
      .from("bookings")
      .select("tip_staff_id,tip_cents,start_ts")
      .order("start_ts", { ascending: true })
      .limit(5000);

    if (reportStartDate) {
      const startIso = nyLocalDateKeyPlusMinutesToUTCISOString(reportStartDate, 0);
      bookingTipsQuery = bookingTipsQuery.gte("start_ts", startIso);
    }
    if (endDate) {
      const endIso = nyLocalDateKeyPlusMinutesToUTCISOString(endDate, 24 * 60 - 1);
      bookingTipsQuery = bookingTipsQuery.lte("start_ts", endIso);
    }

    const { data: bookingTips, error: bookingTipsErr } = await bookingTipsQuery;
    if (bookingTipsErr) {
      console.error("reports booking tips error:", bookingTipsErr);
    }

    let mergedTips = [
      ...(tips ?? []),
      ...((bookingTips ?? []).map((row: any) => ({
        staff_id: row.tip_staff_id,
        tip_cents: row.tip_cents,
        created_at: row.start_ts,
      })) as any[]),
    ];

    if (rangeOverlapsManual(startDate, endDate)) {
      data = (data ?? []).filter((row) => !isWithinManualRange(row.start_ts));
      cashSales = (cashSales ?? []).filter((row) => !isWithinManualRange(row.created_at));
      posItems = (posItems ?? []).filter((row) => !isWithinManualRange(row.created_at));
      posSales = (posSales ?? []).filter((row) => !isWithinManualRange(row.created_at));
      posCashSales = (posCashSales ?? []).filter((row) => !isWithinManualRange(row.created_at));
      mergedTips = (mergedTips ?? []).filter((row) => !isWithinManualRange(row.created_at));
      data = [...buildManualBookings(), ...(data ?? [])];
    }

    const { data: staffUsers, error: staffErr } = await sb
      .from("staff_users")
      .select("staff_id,full_name")
      .order("full_name", { ascending: true })
      .limit(5000);
    if (staffErr) {
      console.error("reports staff users error:", staffErr);
      return NextResponse.json(
        {
          bookings: data ?? [],
          cashSales: cashSales ?? [],
          posItems: posItems ?? [],
          posSales: posSales ?? [],
          posCashSales: posCashSales ?? [],
          tips: tips ?? [],
          staffUsers: [],
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        bookings: data ?? [],
        cashSales: cashSales ?? [],
        posItems: posItems ?? [],
        posSales: posSales ?? [],
        posCashSales: posCashSales ?? [],
        tips: mergedTips,
        staffUsers: staffUsers ?? [],
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("reports bookings fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
