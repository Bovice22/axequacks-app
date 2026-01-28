import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

const REPORTS_CUTOFF_DATE = "2026-02-01";

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
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");

    if (end && end < REPORTS_CUTOFF_DATE) {
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

    const reportStart = start && start >= REPORTS_CUTOFF_DATE ? start : REPORTS_CUTOFF_DATE;

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
