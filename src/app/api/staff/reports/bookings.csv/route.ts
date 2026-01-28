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

    const { data, error } = await query;
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
