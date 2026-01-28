import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

const REPORTS_CUTOFF_DATE = "2026-02-01";

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

type SummaryRow = {
  staff_id: string;
  full_name: string | null;
  role_label: string | null;
  hourly_rate_cents: number | null;
  total_minutes: number;
  total_hours: number;
  gross_pay_cents: number;
};

function parseDateParam(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

export async function GET(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const startDate = normalizeDateInput(parseDateParam(url.searchParams.get("startDate")));
    const endDate = normalizeDateInput(parseDateParam(url.searchParams.get("endDate")));

    if (isBeforeCutoff(endDate)) {
      return NextResponse.json({ summary: [] }, { status: 200 });
    }

    const parsedStart = parseDateInput(startDate);
    const cutoffDate = new Date(`${REPORTS_CUTOFF_DATE}T00:00:00`);
    const reportStartDate =
      parsedStart && parsedStart.date.getTime() >= cutoffDate.getTime() ? parsedStart.raw : REPORTS_CUTOFF_DATE;

    const sb = supabaseServer();
    let query = sb
      .from("staff_time_entries")
      .select("id,staff_user_id,clock_in_ts,clock_out_ts,staff_users(staff_id,full_name,role_label,hourly_rate_cents)");

    if (reportStartDate) {
      query = query.gte("clock_in_ts", `${reportStartDate}T00:00:00`);
    }
    if (endDate) {
      query = query.lte("clock_in_ts", `${endDate}T23:59:59`);
    }

    const { data, error } = await query;
    if (error) {
      console.error("time clock report error:", error);
      return NextResponse.json({ error: "Failed to load time clock report" }, { status: 500 });
    }

    const summary = new Map<string, SummaryRow>();
    for (const row of data || []) {
      if (!row.clock_in_ts || !row.clock_out_ts) continue;
      const staffUser = row.staff_users as any;
      const staffId = staffUser?.staff_id || row.staff_user_id;
      const fullName = staffUser?.full_name ?? null;
      const roleLabel = staffUser?.role_label ?? null;
      const hourlyRateCents = Number.isFinite(Number(staffUser?.hourly_rate_cents))
        ? Number(staffUser?.hourly_rate_cents)
        : null;
      const start = new Date(row.clock_in_ts).getTime();
      const end = new Date(row.clock_out_ts).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      const minutes = Math.round((end - start) / 60000);

      const existing = summary.get(staffId) || {
        staff_id: staffId,
        full_name: fullName,
        role_label: roleLabel,
        hourly_rate_cents: hourlyRateCents,
        total_minutes: 0,
        total_hours: 0,
        gross_pay_cents: 0,
      };
      existing.total_minutes += minutes;
      existing.total_hours = Number((existing.total_minutes / 60).toFixed(2));
      existing.gross_pay_cents = hourlyRateCents
        ? Math.round((existing.total_minutes / 60) * hourlyRateCents)
        : 0;
      summary.set(staffId, existing);
    }

    return NextResponse.json({ summary: Array.from(summary.values()) }, { status: 200 });
  } catch (err: any) {
    console.error("time clock report fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
