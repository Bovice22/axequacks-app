"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { duckpinLanesForParty } from "@/lib/bookingLogic";

type BookingRow = {
  id: string;
  activity: string;
  party_size: number;
  duration_minutes: number;
  total_cents: number;
  start_ts: string;
  status?: string | null;
};

type ViewMode = "day" | "week" | "month" | "year";

const INVESTMENT_CENTS = 160_000 * 100;

function toNYDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
  };
}

function dateKeyNY(date: Date) {
  const { year, month, day } = toNYDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function weekStartKeyNY(date: Date) {
  const { year, month, day } = toNYDateParts(date);
  const utc = new Date(Date.UTC(year, month - 1, day));
  const weekday = utc.getUTCDay();
  const diffToMon = (weekday + 6) % 7;
  const monday = new Date(utc.getTime() - diffToMon * 24 * 60 * 60 * 1000);
  return dateKeyNY(monday);
}

function monthKeyNY(date: Date) {
  const { year, month } = toNYDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}`;
}

function yearKeyNY(date: Date) {
  const { year } = toNYDateParts(date);
  return String(year);
}

function monthLabelNY(date: Date) {
  const { year, month } = toNYDateParts(date);
  const label = new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return label;
}

function formatMoney(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function normalizeActivity(activity: string) {
  const a = activity.toUpperCase();
  if (a.includes("AXE")) return "Axe Throwing";
  if (a.includes("DUCK")) return "Duckpin Bowling";
  if (a.includes("COMBO")) return "Combo Package";
  return activity;
}

export default function ReportsDashboard() {
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [allBookings, setAllBookings] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const startInputRef = useRef<HTMLInputElement | null>(null);
  const endInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (startDate || endDate) return;
    const now = new Date();
    const { year, month } = toNYDateParts(now);
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const endDateObj = new Date(year, month, 0);
    const end = dateKeyNY(endDateObj);
    setStartDate(start);
    setEndDate(end);
  }, [startDate, endDate]);

  async function loadBookings() {
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    const res = await fetch(`/api/staff/reports/bookings?${params.toString()}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json?.error || "Failed to load report data.");
      setLoading(false);
      return;
    }
    setBookings(json.bookings || []);
    setLoading(false);
  }

  async function loadAllBookings() {
    const res = await fetch("/api/staff/reports/bookings", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setAllBookings(json.bookings || []);
    }
  }

  useEffect(() => {
    loadBookings();
    loadAllBookings();
  }, []);

  const filtered = useMemo(() => {
    return bookings.filter((b) => b.status !== "CANCELLED");
  }, [bookings]);

  const revenueByActivity = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of filtered) {
      const key = normalizeActivity(b.activity);
      map.set(key, (map.get(key) || 0) + (b.total_cents || 0));
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const revenueByPeriod = useMemo(() => {
    const map = new Map<string, { label: string; sortKey: number; total: number }>();
    for (const b of filtered) {
      if (!b.start_ts) continue;
      const date = new Date(b.start_ts);
      if (Number.isNaN(date.getTime())) continue;
      let key = "";
      let label = "";
      let sortKey = date.getTime();
      if (viewMode === "day") key = dateKeyNY(date);
      if (viewMode === "week") key = weekStartKeyNY(date);
      if (viewMode === "month") key = monthKeyNY(date);
      if (viewMode === "year") key = yearKeyNY(date);

      if (viewMode === "day") label = key;
      if (viewMode === "week") label = `Week of ${key}`;
      if (viewMode === "month") label = monthLabelNY(date);
      if (viewMode === "year") label = key;

      if (viewMode === "day") sortKey = new Date(dateKeyNY(date)).getTime();
      if (viewMode === "week") sortKey = new Date(weekStartKeyNY(date)).getTime();
      if (viewMode === "month") sortKey = new Date(`${monthKeyNY(date)}-01`).getTime();
      if (viewMode === "year") sortKey = new Date(`${yearKeyNY(date)}-01-01`).getTime();

      const entry = map.get(key);
      if (entry) {
        entry.total += b.total_cents || 0;
      } else {
        map.set(key, { label, sortKey, total: b.total_cents || 0 });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.sortKey - b.sortKey);
  }, [filtered, viewMode]);

  const duckpinRevenueCents = useMemo(() => {
    let total = 0;
    for (const b of filtered) {
      const activity = normalizeActivity(b.activity);
      if (activity === "Duckpin Bowling") {
        total += b.total_cents || 0;
      } else if (activity === "Combo Package") {
        const lanes = duckpinLanesForParty(b.party_size || 0);
        total += lanes * 40 * 100;
      }
    }
    return total;
  }, [filtered]);

  const rickShareCents = Math.round(duckpinRevenueCents * 0.25);
  const jasonShareCents = Math.min(Math.round(duckpinRevenueCents * 0.75), INVESTMENT_CENTS);

  const payoffAmountCents = useMemo(() => {
    let total = 0;
    for (const b of allBookings.filter((row) => row.status !== "CANCELLED")) {
      const activity = normalizeActivity(b.activity);
      if (activity === "Duckpin Bowling") {
        total += b.total_cents || 0;
      } else if (activity === "Combo Package") {
        const lanes = duckpinLanesForParty(b.party_size || 0);
        total += lanes * 40 * 100;
      }
    }
    const totalJasonShare = Math.min(Math.round(total * 0.75), INVESTMENT_CENTS);
    return Math.max(INVESTMENT_CENTS - totalJasonShare, 0);
  }, [allBookings]);

  function downloadSummaryCsv() {
    const lines: string[] = [];
    lines.push("Metric,Value");
    lines.push(`Duckpin Bowling Revenue,${formatMoney(duckpinRevenueCents)}`);
    lines.push(`Rick's Share (25%),${formatMoney(rickShareCents)}`);
    lines.push(`Jason's Share (75%),${formatMoney(jasonShareCents)}`);
    lines.push(`Pay-Off Amount,${formatMoney(payoffAmountCents)}`);
    lines.push("");
    lines.push("Revenue by Activity,Amount");
    for (const [name, cents] of revenueByActivity) {
      lines.push(`${name},${formatMoney(cents)}`);
    }
    lines.push("");
    lines.push(`Revenue by ${viewMode},Amount`);
    for (const [key, cents] of revenueByPeriod) {
      lines.push(`${key},${formatMoney(cents)}`);
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "report-summary.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="text-sm font-extrabold text-zinc-900">Filters</div>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
          <label className="text-xs font-semibold text-zinc-600">
            Start Date
            <div className="mt-1 flex items-center gap-2">
              <input
                ref={startInputRef}
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                onClick={() => {
                  if (!startInputRef.current) return;
                  startInputRef.current.readOnly = false;
                  startInputRef.current.showPicker?.();
                  startInputRef.current.readOnly = true;
                }}
                onKeyDown={(e) => e.preventDefault()}
                readOnly
                inputMode="none"
                className="h-10 w-full cursor-pointer rounded-xl border border-zinc-200 px-3 text-sm"
              />
            </div>
          </label>
          <label className="text-xs font-semibold text-zinc-600">
            End Date
            <div className="mt-1 flex items-center gap-2">
              <input
                ref={endInputRef}
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                onClick={() => {
                  if (!endInputRef.current) return;
                  endInputRef.current.readOnly = false;
                  endInputRef.current.showPicker?.();
                  endInputRef.current.readOnly = true;
                }}
                onKeyDown={(e) => e.preventDefault()}
                readOnly
                inputMode="none"
                className="h-10 w-full cursor-pointer rounded-xl border border-zinc-200 px-3 text-sm"
              />
            </div>
          </label>
          <label className="text-xs font-semibold text-zinc-600">
            View
            <select
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as ViewMode)}
              className="mt-1 h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm"
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="year">Year</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={loadBookings}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold leading-none"
            >
              <span className="block leading-none">Apply</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const params = new URLSearchParams();
                if (startDate) params.set("start", startDate);
                if (endDate) params.set("end", endDate);
                window.location.href = `/api/staff/reports/bookings.csv?${params.toString()}`;
              }}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold leading-none"
            >
              <span className="block leading-none">Download</span>
            </button>
            <button
              type="button"
              onClick={downloadSummaryCsv}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-zinc-900 px-3 text-sm font-semibold text-white leading-none"
            >
              <span className="block leading-none">Summary CSV</span>
            </button>
          </div>
        </div>
        {error ? <div className="mt-2 text-sm text-red-600">{error}</div> : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-sm font-extrabold text-zinc-900">Revenue Share (Duckpin Only)</div>
          {loading ? (
            <div className="mt-3 text-sm text-zinc-600">Loading…</div>
          ) : (
            <div className="mt-3 space-y-2 text-sm">
              <div>Duckpin Bowling Revenue: {formatMoney(duckpinRevenueCents)}</div>
              <div>Rick's Share (25%): {formatMoney(rickShareCents)}</div>
              <div>Jason's Share (75%): {formatMoney(jasonShareCents)}</div>
              <div>Pay-Off Amount: {formatMoney(payoffAmountCents)}</div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-sm font-extrabold text-zinc-900">Revenue by Activity</div>
          {loading ? (
            <div className="mt-3 text-sm text-zinc-600">Loading…</div>
          ) : (
            <div className="mt-3 space-y-2 text-sm">
              {revenueByActivity.map(([name, cents]) => (
                <div key={name} className="flex items-center gap-2">
                  <span>{name}</span>
                  <span>- {formatMoney(cents)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="text-sm font-extrabold text-zinc-900">
          {viewMode === "month" ? "Revenue by Month" : `Revenue by ${viewMode}`}
        </div>
        {loading ? (
          <div className="mt-3 text-sm text-zinc-600">Loading…</div>
        ) : (
          <div className="mt-3 overflow-auto">
            <table className="w-auto text-sm">
              <thead className="text-center text-zinc-600">
                <tr>
                  <th className="px-4 py-2 text-center">{viewMode === "month" ? "Month" : viewMode}</th>
                  <th className="px-4 py-2 text-center" style={{ paddingLeft: "120px" }}>
                    Revenue
                  </th>
                </tr>
              </thead>
              <tbody>
                {revenueByPeriod.map((row) => (
                  <tr key={row.label} className="border-t border-zinc-100">
                    <td className="px-4 py-2 text-center">{row.label}</td>
                    <td className="px-4 py-2 text-center" style={{ paddingLeft: "120px" }}>
                      {formatMoney(row.total)}
                    </td>
                  </tr>
                ))}
                {!revenueByPeriod.length && (
                  <tr>
                    <td className="px-4 py-3 text-center text-sm text-zinc-600" colSpan={2}>
                      No data for the selected range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
