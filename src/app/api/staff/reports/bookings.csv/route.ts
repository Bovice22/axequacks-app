import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

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
  const startTs = `${MANUAL_REPORT_START}T12:00:00+00:00`;
  return MANUAL_BOOKINGS.map((row, index) => ({
    id: `manual-${index}-${MANUAL_REPORT_START}`,
    activity: row.activity,
    party_size: 0,
    duration_minutes: 0,
    total_cents: row.total_cents,
    customer_name: "Manual Report Override",
    customer_email: null,
    start_ts: startTs,
    end_ts: null,
    status: "CONFIRMED",
    created_at: startTs,
    paid: true,
    payment_intent_id: MANUAL_PAYMENT_INTENT_ID,
  }));
}

function csvEscape(value: string) {
  if (value.includes('"') || value.includes(",") || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const start = normalizeDateInput(url.searchParams.get("start"));
    const end = normalizeDateInput(url.searchParams.get("end"));

    if (isBeforeCutoff(end)) {
      const headers = [
        "id",
        "activity",
        "party_size",
        "duration_minutes",
        "total_cents",
        "customer_name",
        "customer_email",
        "start_ts",
        "end_ts",
        "status",
        "created_at",
      ];
      return new NextResponse(headers.join(","), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": "attachment; filename=\"bookings.csv\"",
        },
      });
    }

    const parsedStart = parseDateInput(start);
    const cutoffDate = new Date(`${REPORTS_CUTOFF_DATE}T00:00:00`);
    const reportStart =
      parsedStart && parsedStart.date.getTime() >= cutoffDate.getTime() ? parsedStart.raw : REPORTS_CUTOFF_DATE;

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
          "customer_name",
          "customer_email",
          "start_ts",
          "end_ts",
          "status",
          "created_at",
        ].join(",")
      )
      .order("start_ts", { ascending: true })
      .limit(1000);

    if (reportStart) query = query.gte("start_ts", reportStart);
    if (end) query = query.lte("start_ts", end);

    let { data, error } = await query;
    if (error) {
      console.error("bookings report error:", error);
      return NextResponse.json({ error: "Failed to load bookings report" }, { status: 500 });
    }

    const headers = [
      "id",
      "activity",
      "party_size",
      "duration_minutes",
      "total_cents",
      "customer_name",
      "customer_email",
      "start_ts",
      "end_ts",
      "status",
      "created_at",
    ];

    if (rangeOverlapsManual(start, end)) {
      data = (data ?? []).filter((row) => !isWithinManualRange(row.start_ts));
      data = [...buildManualBookings(), ...(data ?? [])];
    }

    const lines = [headers.join(",")];
    for (const row of data ?? []) {
      const values = headers.map((h) => {
        const v = (row as any)?.[h];
        return csvEscape(String(v ?? ""));
      });
      lines.push(values.join(","));
    }

    return new NextResponse(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=\"bookings.csv\"",
      },
    });
  } catch (err: any) {
    console.error("bookings report fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
