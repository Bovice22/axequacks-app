"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { comboAxePersonCents, comboDuckpinLaneCents, duckpinLanesForParty } from "@/lib/bookingLogic";

type BookingRow = {
  id: string;
  activity: string;
  party_size: number;
  duration_minutes: number;
  total_cents: number;
  start_ts: string;
  status?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  paid?: boolean | null;
  payment_intent_id?: string | null;
  tip_cents?: number | null;
};
type CashSaleRow = {
  activity: string | null;
  line_total_cents: number;
  created_at: string;
  name?: string | null;
  quantity?: number | null;
};
type PosItemRow = {
  name: string | null;
  quantity: number | null;
  line_total_cents: number | null;
  created_at: string;
};
type PosSaleRow = {
  id: string;
  staff_id: string | null;
  subtotal_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
  tip_cents: number | null;
  payment_intent_id: string | null;
  status: string | null;
  created_at: string;
};
type PosCashSaleRow = {
  id: string;
  staff_id: string | null;
  subtotal_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
  tab_id: string | null;
  status: string | null;
  created_at: string;
};
type TipRow = {
  staff_id: string | null;
  tip_cents: number | null;
  created_at: string;
};
type StaffUserRow = {
  staff_id: string;
  full_name: string | null;
};
type TimeClockSummaryRow = {
  staff_id: string;
  full_name: string | null;
  role_label: string | null;
  hourly_rate_cents: number | null;
  total_minutes: number;
  total_hours: number;
  gross_pay_cents: number;
};

type ViewMode = "day" | "week" | "month" | "year";

const INVESTMENT_CENTS = 160_000 * 100;
const PAYMENT_LOG_STORAGE_KEY = "axequacks:payment-log";
const REPORTS_CUTOFF_DATE = "2026-01-01";

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

function normalizeDateInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes("/")) {
    const [mm, dd, yyyy] = trimmed.split("/");
    if (!mm || !dd || !yyyy) return null;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return trimmed;
}

function parseDateInput(value: string) {
  const normalized = normalizeDateInput(value);
  if (!normalized) return null;
  const parsed = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function isBeforeCutoff(value: string) {
  const parsed = parseDateInput(value);
  if (!parsed) return false;
  const cutoff = new Date(`${REPORTS_CUTOFF_DATE}T00:00:00`);
  return parsed.getTime() < cutoff.getTime();
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

function parsePaymentAmountCents(entry: string) {
  const dollarMatches = entry.match(/\$[0-9][0-9,]*\.?[0-9]{0,2}/g);
  if (dollarMatches && dollarMatches.length) {
    return dollarMatches.reduce((sum, match) => {
      const raw = match.replace(/[^0-9.]/g, "");
      const amount = Number(raw);
      if (!Number.isFinite(amount)) return sum;
      return sum + Math.round(amount * 100);
    }, 0);
  }

  const paidMatch = entry.match(/paid\s+\$?\s*([0-9][0-9,]*\.?[0-9]{0,2})/i);
  if (paidMatch) {
    const raw = paidMatch[1].replace(/,/g, "");
    const amount = Number(raw);
    if (!Number.isFinite(amount)) return 0;
    return Math.round(amount * 100);
  }

  return 0;
}

export default function ReportsDashboard() {
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [allBookings, setAllBookings] = useState<BookingRow[]>([]);
  const [cashSales, setCashSales] = useState<CashSaleRow[]>([]);
  const [allCashSales, setAllCashSales] = useState<CashSaleRow[]>([]);
  const [posItems, setPosItems] = useState<PosItemRow[]>([]);
  const [posSales, setPosSales] = useState<PosSaleRow[]>([]);
  const [posCashSales, setPosCashSales] = useState<PosCashSaleRow[]>([]);
  const [tips, setTips] = useState<TipRow[]>([]);
  const [staffUsers, setStaffUsers] = useState<StaffUserRow[]>([]);
  const [timeClockSummary, setTimeClockSummary] = useState<TimeClockSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
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
    if (endDate && isBeforeCutoff(endDate)) {
      setBookings([]);
      setCashSales([]);
      setPosItems([]);
      setTips([]);
      setStaffUsers([]);
      setTimeClockSummary([]);
      setLoading(false);
      return;
    }
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
    setCashSales(json.cashSales || []);
    setPosItems(json.posItems || []);
    setPosSales(json.posSales || []);
    setPosCashSales(json.posCashSales || []);
    setTips(json.tips || []);
    setStaffUsers(json.staffUsers || []);
    if (json.timeClockSummary) {
      setTimeClockSummary(json.timeClockSummary || []);
    }
    setLoading(false);
  }

  async function loadAllBookings() {
    if (endDate && isBeforeCutoff(endDate)) {
      setAllBookings([]);
      setAllCashSales([]);
      return;
    }
    const res = await fetch("/api/staff/reports/bookings", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setAllBookings(json.bookings || []);
      setAllCashSales(json.cashSales || []);
    }
  }

  useEffect(() => {
    if (!startDate && !endDate) return;
    loadBookings();
    loadAllBookings();
  }, [startDate, endDate]);

  async function loadTimeClockSummary() {
    if (endDate && isBeforeCutoff(endDate)) {
      setTimeClockSummary([]);
      return;
    }
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    const res = await fetch(`/api/staff/reports/time-clock?${params.toString()}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setTimeClockSummary(json.summary || []);
    }
  }

  useEffect(() => {
    if (!startDate && !endDate) return;
    loadTimeClockSummary();
  }, [startDate, endDate]);

  const cashAsBookings = useMemo<BookingRow[]>(() => {
    return cashSales.map((row, idx) => ({
      id: `cash-${idx}-${row.created_at}`,
      activity: row.activity || "Other",
      party_size: 0,
      duration_minutes: 0,
      total_cents: row.line_total_cents || 0,
      start_ts: row.created_at,
      status: "PAID",
      customer_name: "Walk-in Cash",
    }));
  }, [cashSales]);

  const filtered = useMemo(() => {
    return [...bookings, ...cashAsBookings].filter((b) => {
      if (b.status === "CANCELLED") return false;
      const notes = (b as any)?.notes || "";
      if (String(notes).includes("IMPORTED_FROM_SQUARE")) return false;
      return true;
    });
  }, [bookings, cashAsBookings]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of filtered) {
      set.add(normalizeActivity(row.activity));
    }
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
  }, [filtered]);

  const filteredByCategory = useMemo(() => {
    if (!selectedCategories.length) return filtered;
    return filtered.filter((row) => selectedCategories.includes(normalizeActivity(row.activity)));
  }, [filtered, selectedCategories]);

  const { revenueByActivity, comboBreakdown } = useMemo(() => {
    const map = new Map<string, number>();
    let comboAxeCents = 0;
    let comboDuckpinCents = 0;

    for (const b of filteredByCategory) {
      const activity = normalizeActivity(b.activity);
      if (activity === "Combo Package") {
        const totalMinutes = b.duration_minutes || 0;
        const axeMinutes = totalMinutes > 0 ? Math.max(Math.floor(totalMinutes / 2), 15) : 60;
        const duckpinMinutes = totalMinutes > 0 ? Math.max(totalMinutes - axeMinutes, 15) : 60;
        const lanes = duckpinLanesForParty(b.party_size || 0);
        const duckpinPortion = lanes * comboDuckpinLaneCents(duckpinMinutes) * 100;
        const axePortion = (b.party_size || 0) * comboAxePersonCents(axeMinutes) * 100;
        comboAxeCents += axePortion;
        comboDuckpinCents += duckpinPortion;
        map.set("Axe Throwing", (map.get("Axe Throwing") || 0) + axePortion);
        map.set("Duckpin Bowling", (map.get("Duckpin Bowling") || 0) + duckpinPortion);
        continue;
      }
      map.set(activity, (map.get(activity) || 0) + (b.total_cents || 0));
    }

    const entries = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    return {
      revenueByActivity: entries,
      comboBreakdown: { axe: comboAxeCents, duckpin: comboDuckpinCents },
    };
  }, [filteredByCategory]);

  const revenueByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of filteredByCategory) {
      const key = normalizeActivity(b.activity);
      map.set(key, (map.get(key) || 0) + (b.total_cents || 0));
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [filteredByCategory]);

  const paymentBreakdown = useMemo(() => {
    const manualStart = new Date("2026-01-01T00:00:00");
    const manualEnd = new Date("2026-01-28T23:59:59");
    const filterManualRange = (ts: string | null | undefined) => {
      if (!ts) return false;
      const parsed = new Date(ts);
      if (Number.isNaN(parsed.getTime())) return false;
      return parsed.getTime() >= manualStart.getTime() && parsed.getTime() <= manualEnd.getTime();
    };

    const paidBookings = bookings.filter((row) => (row.status ?? "CONFIRMED") !== "CANCELLED" && row.paid === true);
    let cardBookingCents = 0;
    let cashBookingCents = 0;
    for (const row of paidBookings) {
      const cents = Number(row.total_cents || 0);
      if (filterManualRange(row.start_ts)) {
        cardBookingCents += cents;
        continue;
      }
      if (row.payment_intent_id) {
        cardBookingCents += cents;
      } else {
        cashBookingCents += cents;
      }
    }

    let posCardCents = 0;
    for (const row of posItems) {
      posCardCents += Number(row.line_total_cents || 0);
    }

    let posCashCents = 0;
    for (const row of cashSales) {
      posCashCents += Number(row.line_total_cents || 0);
    }

    const cardTotal = cardBookingCents + posCardCents;
    const cashTotal = cashBookingCents + posCashCents;
    const grandTotal = cardTotal + cashTotal;
    const cardPct = grandTotal ? Math.round((cardTotal / grandTotal) * 1000) / 10 : 0;
    const cashPct = grandTotal ? Math.round((cashTotal / grandTotal) * 1000) / 10 : 0;

    return {
      cardBookingCents,
      cashBookingCents,
      posCardCents,
      posCashCents,
      cardTotal,
      cashTotal,
      grandTotal,
      cardPct,
      cashPct,
    };
  }, [bookings, posItems, cashSales]);

  const tipsByStaff = useMemo(() => {
    const nameById = new Map<string, string>();
    for (const staff of staffUsers) {
      if (staff.staff_id) {
        nameById.set(staff.staff_id, staff.full_name || staff.staff_id);
      }
    }
    const totals = new Map<string, number>();
    for (const row of tips) {
      const staffId = row.staff_id || "unknown";
      const cents = Number(row.tip_cents || 0);
      if (cents <= 0) continue;
      totals.set(staffId, (totals.get(staffId) || 0) + cents);
    }
    const entries = Array.from(totals.entries()).map(([staffId, cents]) => ({
      staffId,
      name: nameById.get(staffId) || (staffId === "unknown" ? "Unknown" : staffId),
      cents,
    }));
    entries.sort((a, b) => b.cents - a.cents);
    return entries;
  }, [staffUsers, tips]);

  const totalTipsCents = useMemo(() => {
    return tipsByStaff.reduce((sum, row) => sum + row.cents, 0);
  }, [tipsByStaff]);

  const totalRevenueCents = useMemo(() => {
    return filteredByCategory.reduce((sum, row) => sum + (row.total_cents || 0), 0);
  }, [filteredByCategory]);

  const itemsSold = useMemo(() => {
    const map = new Map<string, { quantity: number; revenue: number }>();
    for (const row of posItems) {
      const name = (row.name || "").trim();
      if (!name) continue;
      const qty = Number(row.quantity || 0);
      const revenue = Number(row.line_total_cents || 0);
      if (!qty && !revenue) continue;
      const existing = map.get(name) || { quantity: 0, revenue: 0 };
      existing.quantity += qty;
      existing.revenue += revenue;
      map.set(name, existing);
    }
    for (const row of cashSales) {
      const name = (row.name || "").trim();
      if (!name) continue;
      const qty = Number(row.quantity || 0);
      const revenue = Number(row.line_total_cents || 0);
      if (!qty && !revenue) continue;
      const existing = map.get(name) || { quantity: 0, revenue: 0 };
      existing.quantity += qty;
      existing.revenue += revenue;
      map.set(name, existing);
    }
    return Array.from(map.entries())
      .map(([name, values]) => ({ name, ...values }))
      .filter((row) => row.quantity > 0)
      .sort((a, b) => b.revenue - a.revenue);
  }, [posItems, cashSales]);

  const transactions = useMemo(() => {
    const staffNameById = new Map<string, string>();
    for (const staff of staffUsers) {
      if (staff.staff_id) {
        staffNameById.set(staff.staff_id, staff.full_name || staff.staff_id);
      }
    }

    const bookingIntentIds = new Set<string>();
    const bookingRows = bookings
      .filter((row) => (row.status ?? "CONFIRMED") !== "CANCELLED" && row.paid === true)
      .map((row) => {
        if (row.payment_intent_id) bookingIntentIds.add(row.payment_intent_id);
        return {
          id: row.id,
          date: row.start_ts,
          source: "Booking",
          method: row.payment_intent_id ? "Card" : "Cash",
          activity: normalizeActivity(row.activity),
          amount: Number(row.total_cents || 0),
          tip: Number(row.tip_cents || 0),
          customer: row.customer_name?.trim() || row.customer_email?.trim() || "Walk-in",
          staff: "—",
        };
      });

    const posRows = posSales
      .filter((row) => (row.status || "PAID").toUpperCase() === "PAID")
      .filter((row) => !row.payment_intent_id || !bookingIntentIds.has(row.payment_intent_id))
      .map((row) => ({
        id: `pos-${row.id}`,
        date: row.created_at,
        source: "POS Sale",
        method: "Card",
        activity: "POS",
        amount: Number(row.total_cents || 0),
        tip: Number(row.tip_cents || 0),
        customer: "Walk-in",
        staff: row.staff_id ? staffNameById.get(row.staff_id) || row.staff_id : "—",
      }));

    const posCashRows = posCashSales
      .filter((row) => (row.status || "PAID").toUpperCase() === "PAID")
      .map((row) => ({
        id: `pos-cash-${row.id}`,
        date: row.created_at,
        source: row.tab_id ? "Tab Sale" : "POS Sale",
        method: "Cash",
        activity: "POS",
        amount: Number(row.total_cents || 0),
        tip: 0,
        customer: "Walk-in",
        staff: row.staff_id ? staffNameById.get(row.staff_id) || row.staff_id : "—",
      }));

    const all = [...bookingRows, ...posRows, ...posCashRows];
    all.sort((a, b) => {
      const aTime = a.date ? new Date(a.date).getTime() : 0;
      const bTime = b.date ? new Date(b.date).getTime() : 0;
      return bTime - aTime;
    });
    return all;
  }, [bookings, posSales, posCashSales, staffUsers]);

  const revenueByPeriod = useMemo(() => {
    const map = new Map<string, { label: string; sortKey: number; total: number }>();
    for (const b of filteredByCategory) {
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
  }, [filteredByCategory, viewMode]);

  const duckpinRevenueCents = useMemo(() => {
    let total = 0;
    for (const b of filteredByCategory) {
      const activity = normalizeActivity(b.activity);
      if (activity === "Duckpin Bowling") {
        total += b.total_cents || 0;
      } else if (activity === "Combo Package") {
        const lanes = duckpinLanesForParty(b.party_size || 0);
        total += lanes * 40 * 100;
      }
    }
    return total;
  }, [filteredByCategory]);

  const rickShareCents = Math.round(duckpinRevenueCents * 0.5);
  const jasonShareCents = Math.min(Math.round(duckpinRevenueCents * 0.5), INVESTMENT_CENTS);

  const [paymentLogNote, setPaymentLogNote] = useState("");
  const [paymentLogEntries, setPaymentLogEntries] = useState<string[]>([]);
  const paymentLogTotalCents = useMemo(
    () => paymentLogEntries.reduce((sum, entry) => sum + parsePaymentAmountCents(entry), 0),
    [paymentLogEntries]
  );
  const payoffAmountCents = Math.max(INVESTMENT_CENTS - paymentLogTotalCents, 0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(PAYMENT_LOG_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setPaymentLogEntries(parsed.filter((item) => typeof item === "string"));
      }
    } catch {
      // Ignore bad storage data.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PAYMENT_LOG_STORAGE_KEY, JSON.stringify(paymentLogEntries));
  }, [paymentLogEntries]);

  function downloadSummaryCsv() {
    const lines: string[] = [];
    lines.push("Metric,Value");
    lines.push(`Duckpin Bowling Revenue,${formatMoney(duckpinRevenueCents)}`);
    lines.push(`Rick's Share (50%),${formatMoney(rickShareCents)}`);
    lines.push(`Jason's Share (50%),${formatMoney(jasonShareCents)}`);
    lines.push(`Total Pay-Off Amount,${formatMoney(payoffAmountCents)}`);
    lines.push("");
    lines.push("Revenue by Category,Amount");
    for (const [name, cents] of revenueByActivity) {
      lines.push(`${name},${formatMoney(cents)}`);
    }
    lines.push("");
    lines.push(`Revenue by ${viewMode},Amount`);
    for (const row of revenueByPeriod) {
      lines.push(`${row.label},${formatMoney(row.total)}`);
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
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-5">
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
          <div className="md:col-span-2">
            <div className="text-xs font-semibold text-zinc-600">Categories</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {categoryOptions.map((option) => {
                const selected = selectedCategories.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() =>
                      setSelectedCategories((prev) =>
                        prev.includes(option) ? prev.filter((item) => item !== option) : [...prev, option]
                      )
                    }
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                      selected
                        ? "border-black bg-black text-white"
                        : "border-zinc-200 bg-white text-zinc-700"
                    }`}
                  >
                    {option}
                  </button>
                );
              })}
              {!categoryOptions.length ? (
                <div className="text-xs text-zinc-400">No categories yet.</div>
              ) : null}
            </div>
            {selectedCategories.length ? (
              <button
                type="button"
                onClick={() => setSelectedCategories([])}
                className="mt-2 text-xs font-semibold text-zinc-500 underline"
              >
                Clear category filters
              </button>
            ) : null}
          </div>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => {
                const params = new URLSearchParams();
                if (startDate) params.set("start", startDate);
                if (endDate) params.set("end", endDate);
                window.location.href = `/api/staff/reports/bookings.csv?${params.toString()}`;
              }}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-black bg-black px-3 text-sm font-semibold leading-none text-white"
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
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 md:col-span-2">
          <div className="text-sm font-extrabold text-zinc-900">Payments Breakdown</div>
          {loading ? (
            <div className="mt-3 text-sm text-zinc-600">Loading…</div>
          ) : (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
                <div className="text-xs font-semibold text-zinc-500">Card Payments</div>
                <div className="mt-1 text-lg font-extrabold text-zinc-900">
                  {formatMoney(paymentBreakdown.cardTotal)}
                </div>
                <div className="text-xs text-zinc-500">{paymentBreakdown.cardPct}% of total</div>
                <div className="mt-2 text-xs text-zinc-600">
                  Bookings: {formatMoney(paymentBreakdown.cardBookingCents)}
                </div>
                <div className="text-xs text-zinc-600">
                  POS: {formatMoney(paymentBreakdown.posCardCents)}
                </div>
              </div>
              <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
                <div className="text-xs font-semibold text-zinc-500">Cash Payments</div>
                <div className="mt-1 text-lg font-extrabold text-zinc-900">
                  {formatMoney(paymentBreakdown.cashTotal)}
                </div>
                <div className="text-xs text-zinc-500">{paymentBreakdown.cashPct}% of total</div>
                <div className="mt-2 text-xs text-zinc-600">
                  Bookings: {formatMoney(paymentBreakdown.cashBookingCents)}
                </div>
                <div className="text-xs text-zinc-600">
                  POS: {formatMoney(paymentBreakdown.posCashCents)}
                </div>
              </div>
              <div className="text-xs font-semibold text-zinc-600 md:col-span-2">
                Total processed: {formatMoney(paymentBreakdown.grandTotal)}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-sm font-extrabold text-zinc-900">Tips by Employee</div>
          {loading ? (
            <div className="mt-3 text-sm text-zinc-900">Loading…</div>
          ) : (
            <div className="mt-3 space-y-2 text-sm text-zinc-900">
              <div className="text-xs text-zinc-600">Total tips: {formatMoney(totalTipsCents)}</div>
              {tipsByStaff.length ? (
                <div className="space-y-1">
                  {tipsByStaff.map((row) => (
                    <div key={row.staffId} className="flex items-center justify-between gap-2">
                      <span>{row.name}</span>
                      <span className="font-semibold">{formatMoney(row.cents)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-zinc-600">No tips in this range.</div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-sm font-extrabold text-zinc-900">Time Clock Summary</div>
          {loading ? (
            <div className="mt-3 text-sm text-zinc-900">Loading…</div>
          ) : (
            <div className="mt-3 overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-center text-zinc-900">
                  <tr>
                    <th className="px-3 py-2">Staff</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Hours</th>
                    <th className="px-3 py-2">Gross Pay</th>
                  </tr>
                </thead>
                <tbody>
                  {timeClockSummary.map((row) => (
                    <tr key={row.staff_id} className="border-t border-zinc-100 text-zinc-900">
                      <td className="px-3 py-2 text-center">{row.full_name || row.staff_id}</td>
                      <td className="px-3 py-2 text-center">{row.role_label || "—"}</td>
                      <td className="px-3 py-2 text-center">{row.total_hours.toFixed(2)}</td>
                      <td className="px-3 py-2 text-center">{formatMoney(row.gross_pay_cents)}</td>
                    </tr>
                  ))}
                  {!timeClockSummary.length ? (
                    <tr>
                      <td className="px-3 py-3 text-center text-sm text-zinc-900" colSpan={4}>
                        No time clock entries in this range.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-sm font-extrabold text-zinc-900">Revenue Share (Duckpin Only)</div>
          {loading ? (
            <div className="mt-3 text-sm text-zinc-900">Loading…</div>
          ) : (
            <div className="mt-3 space-y-2 text-sm text-zinc-900">
              <div>Duckpin Bowling Revenue: {formatMoney(duckpinRevenueCents)}</div>
              <div>Rick's Share (50%): {formatMoney(rickShareCents)}</div>
              <div>Jason's Share (50%): {formatMoney(jasonShareCents)}</div>
              <div className="pt-2">
                <div className="text-xs font-semibold text-zinc-900">Payment Log</div>
                <div className="mt-1 flex gap-2">
                  <input
                    value={paymentLogNote}
                    onChange={(e) => setPaymentLogNote(e.target.value)}
                    placeholder="Paid $2,000 1/12/26"
                    className="h-9 flex-1 rounded-lg border border-zinc-200 px-3 text-xs font-semibold text-zinc-900 placeholder:text-zinc-900 outline-none focus:border-zinc-900"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const note = paymentLogNote.trim();
                      if (!note) return;
                      setPaymentLogEntries((prev) => [note, ...prev]);
                      setPaymentLogNote("");
                    }}
                    className="h-9 rounded-lg border border-zinc-900 px-3 text-xs font-semibold text-zinc-900 hover:bg-zinc-50"
                  >
                    Save
                  </button>
                </div>
                {paymentLogEntries.length ? (
                  <div className="mt-2 space-y-1 text-xs text-zinc-900">
                    {paymentLogEntries.map((entry, idx) => (
                      <div key={`${entry}-${idx}`} className="flex items-center justify-between gap-2">
                        <span>• {entry}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setPaymentLogEntries((prev) => prev.filter((_, index) => index !== idx))
                          }
                          className="rounded-full border border-zinc-200 px-2 py-0.5 text-[10px] font-semibold text-zinc-900 hover:bg-zinc-50"
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div>Total Pay-Off Amount: {formatMoney(payoffAmountCents)}</div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-sm font-extrabold text-zinc-900">Revenue by Category</div>
          {loading ? (
            <div className="mt-3 text-sm text-zinc-900">Loading…</div>
          ) : (
            <div className="mt-3 overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-center text-zinc-900">
                  <tr>
                    <th className="px-3 py-2">Activity</th>
                    <th className="px-3 py-2">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-zinc-100 font-semibold text-zinc-900">
                    <td className="px-3 py-2 text-center">Total Revenue</td>
                    <td className="px-3 py-2 text-center">{formatMoney(totalRevenueCents)}</td>
                  </tr>
                  {revenueByActivity.map(([name, cents]) => (
                    <tr key={name} className="border-t border-zinc-100 text-zinc-900">
                      <td className="px-3 py-2 text-center">{name}</td>
                      <td className="px-3 py-2 text-center">{formatMoney(cents)}</td>
                    </tr>
                  ))}
                  {!revenueByActivity.length ? (
                    <tr>
                      <td className="px-3 py-3 text-center text-sm text-zinc-900" colSpan={2}>
                        No activity revenue in this range.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-sm font-extrabold text-zinc-900">Combo Package Breakdown</div>
          {loading ? (
            <div className="mt-3 text-sm text-zinc-900">Loading…</div>
          ) : (
            <div className="mt-3 space-y-2 text-sm text-zinc-900">
              <div>Combo Axe Throwing Revenue: {formatMoney(comboBreakdown.axe)}</div>
              <div>Combo Duckpin Bowling Revenue: {formatMoney(comboBreakdown.duckpin)}</div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-sm font-extrabold text-zinc-900">Category Summary</div>
          {loading ? (
            <div className="mt-3 text-sm text-zinc-900">Loading…</div>
          ) : (
            <div className="mt-3 overflow-auto">
              <table className="w-full text-sm">
              <thead className="text-center text-zinc-900">
                <tr>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Revenue</th>
                </tr>
              </thead>
                <tbody>
                  <tr className="border-t border-zinc-100 font-semibold text-zinc-900">
                    <td className="px-3 py-2 text-center">Total Revenue</td>
                    <td className="px-3 py-2 text-center">{formatMoney(totalRevenueCents)}</td>
                  </tr>
                  {revenueByCategory.map(([name, cents]) => (
                    <tr key={name} className="border-t border-zinc-100 text-zinc-900">
                      <td className="px-3 py-2 text-center">{name}</td>
                      <td className="px-3 py-2 text-center">{formatMoney(cents)}</td>
                  </tr>
                ))}
                {!revenueByCategory.length ? (
                  <tr>
                    <td className="px-3 py-3 text-center text-sm text-zinc-900" colSpan={2}>
                      No category revenue in this range.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-sm font-extrabold text-zinc-900">POS Items Sold</div>
          {loading ? (
            <div className="mt-3 text-sm text-zinc-900">Loading…</div>
          ) : (
            <div className="mt-3 overflow-auto">
              <table className="w-full text-sm">
              <thead className="text-center text-zinc-900">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Quantity Sold</th>
                  <th className="px-3 py-2">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {itemsSold.map((row) => (
                  <tr key={row.name} className="border-t border-zinc-100 text-zinc-900">
                    <td className="px-3 py-2 text-center">{row.name}</td>
                    <td className="px-3 py-2 text-center">{row.quantity}</td>
                    <td className="px-3 py-2 text-center">{formatMoney(row.revenue)}</td>
                  </tr>
                ))}
                {!itemsSold.length ? (
                  <tr>
                    <td className="px-3 py-3 text-center text-sm text-zinc-900" colSpan={3}>
                      No POS items sold in this range.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="text-sm font-extrabold text-zinc-900">Transactions</div>
        {loading ? (
          <div className="mt-3 text-sm text-zinc-600">Loading…</div>
        ) : (
          <div className="mt-3 overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-center text-zinc-600">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Method</th>
                  <th className="px-3 py-2">Activity</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Staff</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Tip</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((row) => {
                  const dateLabel = row.date
                    ? new Date(row.date).toLocaleString("en-US")
                    : "—";
                  return (
                    <tr key={row.id} className="border-t border-zinc-100 text-zinc-900">
                      <td className="px-3 py-2 text-center">{dateLabel}</td>
                      <td className="px-3 py-2 text-center">{row.source}</td>
                      <td className="px-3 py-2 text-center">{row.method}</td>
                      <td className="px-3 py-2 text-center">{row.activity}</td>
                      <td className="px-3 py-2 text-center">{row.customer}</td>
                      <td className="px-3 py-2 text-center">{row.staff}</td>
                      <td className="px-3 py-2 text-center">{formatMoney(row.amount)}</td>
                      <td className="px-3 py-2 text-center">{formatMoney(row.tip || 0)}</td>
                    </tr>
                  );
                })}
                {!transactions.length ? (
                  <tr>
                    <td className="px-3 py-3 text-center text-sm text-zinc-600" colSpan={8}>
                      No transactions in this range.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedCategories.length ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-sm font-extrabold text-zinc-900">Transactions (Selected Categories)</div>
          {loading ? (
            <div className="mt-3 text-sm text-zinc-600">Loading…</div>
          ) : (
            <div className="mt-3 overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-center text-zinc-600">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Activity</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredByCategory.map((row) => {
                    const date = row.start_ts ? new Date(row.start_ts) : null;
                    const dateLabel = date && !Number.isNaN(date.getTime())
                      ? date.toLocaleDateString("en-US")
                      : "—";
                    const customerLabel =
                      row.customer_name?.trim() || row.customer_email?.trim() || (row.id.startsWith("cash-") ? "Walk-in" : "—");
                    return (
                      <tr key={row.id} className="border-t border-zinc-100">
                        <td className="px-3 py-2 text-center">{dateLabel}</td>
                        <td className="px-3 py-2 text-center">{normalizeActivity(row.activity)}</td>
                        <td className="px-3 py-2 text-center">{customerLabel}</td>
                        <td className="px-3 py-2 text-center">{formatMoney(row.total_cents || 0)}</td>
                      </tr>
                    );
                  })}
                  {!filteredByCategory.length ? (
                    <tr>
                      <td className="px-3 py-3 text-center text-sm text-zinc-600" colSpan={4}>
                        No transactions for the selected categories.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-sm font-extrabold text-zinc-900">
            {viewMode === "month" ? "Revenue by Month" : `Revenue by ${viewMode}`}
          </div>
          {loading ? (
            <div className="mt-3 text-sm text-zinc-900">Loading…</div>
          ) : (
            <div className="mt-3 overflow-auto">
              <table className="w-auto text-sm">
              <thead className="text-center text-zinc-900">
                <tr>
                  <th className="px-4 py-2 text-center">{viewMode === "month" ? "Month" : viewMode}</th>
                  <th className="px-4 py-2 text-center" style={{ paddingLeft: "120px" }}>
                    Revenue
                  </th>
                </tr>
              </thead>
              <tbody>
                {revenueByPeriod.map((row) => (
                  <tr key={row.label} className="border-t border-zinc-100 text-zinc-900">
                    <td className="px-4 py-2 text-center">{row.label}</td>
                    <td className="px-4 py-2 text-center" style={{ paddingLeft: "120px" }}>
                      {formatMoney(row.total)}
                    </td>
                  </tr>
                ))}
                {!revenueByPeriod.length && (
                  <tr>
                    <td className="px-4 py-3 text-center text-sm text-zinc-900" colSpan={2}>
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
