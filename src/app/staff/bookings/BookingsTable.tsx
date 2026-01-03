"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type BookingRow = {
  id: string;
  activity: string;
  party_size: number;
  duration_minutes: number;
  start_ts: string; // ISO
  end_ts: string;   // ISO
  customer_name: string | null;
  customer_email: string | null;
  customer_id?: string | null;
  total_cents: number;
  combo_order: string | null;
  status?: string | null;
  paid?: boolean | null;
  notes?: string | null;
};

type ResourceRow = {
  id: string;
  type: "AXE" | "DUCKPIN";
  active?: boolean | null;
  name?: string | null;
  sort_order?: number | null;
};

type ReservationRow = {
  id?: string;
  booking_id: string;
  resource_id: string;
  start_ts: string;
  end_ts: string;
};

type EventRequestRow = {
  id: string;
  party_size: number | null;
};

function fmtNY(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
}

const ACTIVITY_LABELS: Record<string, string> = {
  AXE: "Axe Throwing",
  DUCKPIN: "Duckpin Bowling",
  COMBO: "Combo Package",
};

function activityLabel(activity: string | null | undefined) {
  if (!activity) return "";
  return ACTIVITY_LABELS[activity] ?? activity;
}

function comboOrderLabel(order: string | null | undefined) {
  if (!order) return "—";
  if (order === "DUCKPIN_FIRST") return "1) Duckpin | 2) Axe";
  if (order === "AXE_FIRST") return "1) Axe | 2) Duckpin";
  return order;
}

function paymentLabel(status: string | null | undefined, paid: boolean | null | undefined) {
  if ((status ?? "CONFIRMED") === "CANCELLED") return "CANCELLED";
  return paid ? "PAID" : "UNPAID";
}

function todayDateKeyNY(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function toDateKey(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fromDateKey(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function prettyDate(dateKey: string) {
  const d = fromDateKey(dateKey);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function dateKeyFromIsoNY(iso: string | null) {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function minutesFromLabel(label: string | null) {
  if (!label || label === "—") return null;
  const m = label.match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3].toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

function minutesFromIsoNY(iso: string | null) {
  if (!iso) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function minutesToLabel(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function timeRangeLabel(startMin: number, durationMinutes: number) {
  const endMin = startMin + durationMinutes;
  return `${minutesToLabel(startMin)} – ${minutesToLabel(endMin)}`;
}

function nowMinutesNY() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function weekdayNY(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const utc = Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0);
  const label = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(
    new Date(utc)
  );
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[label] ?? 0;
}

function hourLabel(hour: number) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toLocaleTimeString("en-US", { hour: "numeric" });
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_ROW_PX = 140;
const PX_PER_MIN = HOUR_ROW_PX / 60;
const RESOURCE_COL_WIDTH = 260;
const TIME_GUTTER = 96;
const HEADER_HEIGHT = 64;
const BLOCK_INSET_PX = 0;

function getOpenWindowForDateKey(dateKey: string): { openMin: number; closeMin: number } | null {
  if (!dateKey) return null;
  const day = weekdayNY(dateKey); // Sun=0
  if (day === 4) return { openMin: 16 * 60, closeMin: 22 * 60 }; // Thu 4pm-10pm
  if (day === 5) return { openMin: 16 * 60, closeMin: 23 * 60 }; // Fri 4pm-11pm
  if (day === 6) return { openMin: 12 * 60, closeMin: 23 * 60 }; // Sat 12pm-11pm
  if (day === 0) return { openMin: 12 * 60, closeMin: 21 * 60 }; // Sun 12pm-9pm
  return null; // Mon-Wed closed
}

function MonthCalendar(props: {
  selectedDateKey: string;
  onSelectDateKey: (dateKey: string) => void;
}) {
  const { selectedDateKey, onSelectDateKey } = props;
  const [cursor, setCursor] = useState(() => {
    const base = selectedDateKey ? fromDateKey(selectedDateKey) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const todayKey = todayDateKeyNY();

  const monthLabel = cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const days = useMemo(() => {
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const totalDays = end.getDate();

    const startWeekday = start.getDay();
    const cells: Array<{ date: Date | null }> = [];

    for (let i = 0; i < startWeekday; i++) cells.push({ date: null });
    for (let d = 1; d <= totalDays; d++) {
      cells.push({ date: new Date(cursor.getFullYear(), cursor.getMonth(), d) });
    }

    while (cells.length % 7 !== 0) cells.push({ date: null });

    return cells;
  }, [cursor]);

  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const closedWeekdays = new Set([1, 2, 3]);

  return (
    <div
      className="rounded-2xl border border-zinc-200 bg-white p-4"
      style={{ width: 580, maxWidth: "100%" }}
    >
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          className="rounded-xl border border-zinc-200 px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
          onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
        >
          ←
        </button>

        <div className="text-sm font-extrabold text-zinc-900">{monthLabel}</div>

        <button
          type="button"
          className="rounded-xl border border-zinc-200 px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
          onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
        >
          →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold text-zinc-500">
        {weekDays.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-7 gap-2">
        {days.map((cell, idx) => {
          if (!cell.date) return <div key={idx} className="h-10 rounded-xl bg-transparent" />;

          const dk = toDateKey(cell.date);
          const selected = selectedDateKey === dk;
          const isPast = dk < todayKey;
          const closed = closedWeekdays.has(cell.date.getDay());
          const disabled = isPast || closed;

          return (
            <button
              key={dk}
              type="button"
              disabled={disabled}
              onClick={() => !disabled && onSelectDateKey(dk)}
              className={`h-10 rounded-xl border text-sm font-bold transition ${
                selected
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : disabled
                  ? "cursor-not-allowed border-zinc-100 bg-zinc-100 text-zinc-400 line-through"
                  : "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50"
              }`}
            >
              {cell.date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function BookingsTable() {
  const [rows, setRows] = useState<BookingRow[]>([]);
  const [resources, setResources] = useState<ResourceRow[]>([]);
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [eventRequests, setEventRequests] = useState<EventRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [order, setOrder] = useState<"upcoming" | "newest">("upcoming");
  const [selectedDateKey, setSelectedDateKey] = useState(() => todayDateKeyNY());
  const [isClient, setIsClient] = useState(false);
  const [editingBookingId, setEditingBookingId] = useState<string | null>(null);
  const [hoveredNoteId, setHoveredNoteId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPartySize, setEditPartySize] = useState<number>(1);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editActivity, setEditActivity] = useState("");
  const [editDuration, setEditDuration] = useState(60);
  const [editComboOrder, setEditComboOrder] = useState<string | null>(null);
  const [editDateKey, setEditDateKey] = useState("");
  const [editStartMin, setEditStartMin] = useState<number | null>(null);
  const [editBlockedStartMins, setEditBlockedStartMins] = useState<number[]>([]);
  const [editAvailabilityLoading, setEditAvailabilityLoading] = useState(false);
  const [editNotes, setEditNotes] = useState("");
  const [editSnapshot, setEditSnapshot] = useState<{
    activity: string;
    dateKey: string;
    startMin: number | null;
    duration: number;
    name: string;
    email: string;
    notes: string;
  } | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const todayKey = todayDateKeyNY();

  async function loadBookings(nextOrder: "upcoming" | "newest") {
    setLoading(true);
    const res = await fetch(`/api/staff/bookings?order=${nextOrder}`, { cache: "no-store" });
    const json = await res.json();
    setRows(json.bookings || []);
    setResources(json.resources || []);
    setReservations(json.reservations || []);
    setEventRequests(json.eventRequests || []);
    setLoading(false);
  }

  async function updateStatus(id: string, status: "CANCELLED" | "COMPLETED") {
    setActionLoadingId(id);
    try {
      const res = await fetch(`/api/staff/bookings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, id }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        console.error("status update failed:", json);
        return;
      }

      setRows((prev) =>
        prev.map((row) => (row.id === id ? { ...row, status: json?.booking?.status ?? status } : row))
      );
    } finally {
      setActionLoadingId(null);
    }
  }

  async function deleteBooking(id: string) {
    if (!window.confirm("Delete this booking? This cannot be undone.")) return;
    setActionLoadingId(id);
    try {
      const res = await fetch(`/api/staff/bookings/${id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json?.error || "Failed to delete booking.");
        return;
      }
      await loadBookings(order);
    } finally {
      setActionLoadingId(null);
    }
  }

  useEffect(() => {
    loadBookings(order);
  }, [order]);

  useEffect(() => {
    const interval = setInterval(() => {
      void loadBookings(order);
    }, 60000);
    return () => clearInterval(interval);
  }, [order]);

  useEffect(() => {
    function onFocus() {
      void loadBookings(order);
    }
    function onVisibility() {
      if (document.visibilityState === "visible") {
        void loadBookings(order);
      }
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [order]);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const byDate = rows.filter(
      (r) => dateKeyFromIsoNY(r.start_ts) === selectedDateKey && (r.status ?? "CONFIRMED") !== "CANCELLED"
    );
    if (!s) return byDate;
    return byDate.filter((r) =>
      (r.customer_name || "").toLowerCase().includes(s) ||
      (r.customer_email || "").toLowerCase().includes(s) ||
      activityLabel(r.activity).toLowerCase().includes(s) ||
      r.id.toLowerCase().includes(s)
    );
  }, [rows, q, selectedDateKey]);

  const bookingById = useMemo(() => {
    const m = new Map<string, BookingRow>();
    for (const row of rows) m.set(row.id, row);
    return m;
  }, [rows]);

  async function openEditForBooking(bookingId: string) {
    const booking = bookingById.get(bookingId);
    setEditingBookingId(bookingId);
    setHoveredNoteId(null);
    setEditError("");
    if (booking) {
      setEditLoading(false);
      setEditName(booking.customer_name || "");
      setEditEmail(booking.customer_email || "");
      setEditPartySize(booking.party_size || 1);
      setEditActivity(activityLabel(booking.activity) || "");
      setEditDuration(booking.duration_minutes || 60);
      setEditComboOrder(booking.combo_order || null);
      setEditNotes(booking.notes || "");
      const dk = dateKeyFromIsoNY(booking.start_ts) || todayKey;
      setEditDateKey(dk);
      const startMin = minutesFromIsoNY(booking.start_ts);
      setEditStartMin(startMin);
      setEditBlockedStartMins([]);
      setEditSnapshot({
        activity: activityLabel(booking.activity) || "",
        dateKey: dk,
        startMin,
        duration: booking.duration_minutes || 60,
        name: booking.customer_name || "",
        email: booking.customer_email || "",
        notes: booking.notes || "",
      });
      return;
    }

    setEditLoading(true);
    setEditName("");
    setEditEmail("");
    setEditPartySize(1);
    setEditActivity("");
    setEditDuration(60);
    setEditComboOrder(null);
    setEditDateKey(todayKey);
    setEditStartMin(null);
    setEditBlockedStartMins([]);
    try {
      const res = await fetch(`/api/staff/bookings/${bookingId}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditError(json?.error || "Failed to load booking.");
        return;
      }
      const b = json?.booking || {};
      setEditName(b?.customer_name || "");
      setEditEmail(b?.customer_email || "");
      setEditPartySize(b?.party_size || 1);
      setEditActivity(activityLabel(b?.activity) || "");
      setEditDuration(b?.duration_minutes || 60);
      setEditComboOrder(b?.combo_order || null);
      setEditNotes(b?.notes || "");
      const dk = dateKeyFromIsoNY(b?.start_ts) || todayKey;
      setEditDateKey(dk);
      const startMin = minutesFromIsoNY(b?.start_ts);
      setEditStartMin(startMin);
      setEditSnapshot({
        activity: activityLabel(b?.activity) || "",
        dateKey: dk,
        startMin,
        duration: b?.duration_minutes || 60,
        name: b?.customer_name || "",
        email: b?.customer_email || "",
        notes: b?.notes || "",
      });
    } finally {
      setEditLoading(false);
    }
  }

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (editingBookingId) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const scheduleRoot = target.closest("[data-schedule-root]");
      if (!scheduleRoot) return;
      const path = (e.composedPath ? e.composedPath() : []) as HTMLElement[];
      const hit = path.find((el) => (el as HTMLElement)?.dataset?.bookingId) as HTMLElement | undefined;
      const bookingId = hit?.dataset?.bookingId;
      if (bookingId) {
        e.preventDefault();
        openEditForBooking(bookingId);
      }
    }
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [editingBookingId, openEditForBooking]);


  async function saveBookingEdits() {
    if (!editingBookingId) return;
    if (!editDateKey || editStartMin == null) {
      setEditError("Select a valid date and time.");
      return;
    }
    if (!editActivity) {
      setEditError("Select an activity.");
      return;
    }
    const timeChanged = !!editSnapshot && (
      editSnapshot.dateKey !== editDateKey ||
      editSnapshot.startMin !== editStartMin ||
      editSnapshot.duration !== editDuration ||
      editSnapshot.activity !== editActivity
    );
    if (timeChanged && editStartMin != null && editBlockedStartMins.includes(editStartMin)) {
      setEditError("Selected time is unavailable.");
      return;
    }
    setSavingEdit(true);
    setEditError("");
    try {
      const res = await fetch(`/api/staff/bookings/${editingBookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingBookingId,
          customer_name: editName,
          customer_email: editEmail,
          notes: editNotes,
          activity: editActivity,
          dateKey: editDateKey,
          startMin: editStartMin,
          durationMinutes: editDuration,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditError(json?.error || "Failed to update booking.");
        return;
      }
      await loadBookings(order);
      setEditingBookingId(null);
    } finally {
      setSavingEdit(false);
    }
  }

  async function cancelBooking() {
    if (!editingBookingId) return;
    if (!window.confirm("Delete this booking? This cannot be undone.")) return;
    setCancelLoading(true);
    try {
      const res = await fetch(`/api/staff/bookings/${editingBookingId}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditError(json?.error || "Failed to delete booking.");
        return;
      }
      await loadBookings(order);
      setEditingBookingId(null);
    } finally {
      setCancelLoading(false);
    }
  }

  useEffect(() => {
    if (!editingBookingId || !editActivity || !editDateKey || !editDuration) {
      setEditBlockedStartMins([]);
      setEditAvailabilityLoading(false);
      return;
    }
    const openWindow = getOpenWindowForDateKey(editDateKey);
    if (!openWindow) {
      setEditBlockedStartMins([]);
      setEditAvailabilityLoading(false);
      return;
    }
    const controller = new AbortController();
    setEditAvailabilityLoading(true);
    setEditBlockedStartMins([]);
    fetch("/api/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        activity: editActivity,
        partySize: editPartySize || 1,
        dateKey: editDateKey,
        durationMinutes: editDuration,
        openStartMin: openWindow.openMin,
        openEndMin: openWindow.closeMin,
        slotIntervalMin: 30,
        order: editActivity === "Combo Package" ? (editComboOrder === "AXE_FIRST" ? "AXE_FIRST" : "DUCKPIN_FIRST") : undefined,
      }),
    })
      .then((res) => res.json())
      .then((json) => {
        if (!Array.isArray(json?.blockedStartMins)) return;
        setEditBlockedStartMins(json.blockedStartMins);
      })
      .catch(() => {})
      .finally(() => setEditAvailabilityLoading(false));

    return () => controller.abort();
  }, [editingBookingId, editActivity, editPartySize, editDateKey, editDuration, editComboOrder]);

  const editDurationOptions = useMemo(() => {
    const base = editActivity === "Combo Package" ? [120] : [30, 60, 120];
    const set = new Set(base);
    if (editDuration && !set.has(editDuration)) set.add(editDuration);
    return Array.from(set).sort((a, b) => a - b);
  }, [editActivity, editDuration]);

  useEffect(() => {
    if (editActivity === "Combo Package" && editDuration !== 120) {
      setEditDuration(120);
    }
  }, [editActivity, editDuration]);

  useEffect(() => {
    if (!editDateKey || editStartMin == null) return;
    const openWindow = getOpenWindowForDateKey(editDateKey);
    if (!openWindow) return;
    const lastStart = openWindow.closeMin - editDuration;
    if (editStartMin > lastStart) {
      const nextStart = lastStart >= openWindow.openMin ? lastStart : null;
      if (nextStart !== editStartMin) setEditStartMin(nextStart);
    }
  }, [editDateKey, editDuration, editStartMin]);

  const editDirty =
    !!editSnapshot &&
    (editSnapshot.activity !== editActivity ||
      editSnapshot.dateKey !== editDateKey ||
      editSnapshot.startMin !== editStartMin ||
      editSnapshot.duration !== editDuration ||
      editSnapshot.name !== editName ||
      editSnapshot.email !== editEmail ||
      editSnapshot.notes !== editNotes);

  const resourceColumns = useMemo(() => {
    const active = resources.filter((r) => r.active !== false);
    const sortKey = (r: ResourceRow) =>
      Number.isFinite(r.sort_order) ? Number(r.sort_order) : Number.MAX_SAFE_INTEGER;
    const axes = active.filter((r) => r.type === "AXE").sort((a, b) => sortKey(a) - sortKey(b));
    const lanes = active.filter((r) => r.type === "DUCKPIN").sort((a, b) => sortKey(a) - sortKey(b));

    return [
      ...axes.map((r, i) => ({ ...r, label: r.name || `Axe Bay ${i + 1}` })),
      ...lanes.map((r, i) => ({ ...r, label: r.name || `Lane ${i + 1}` })),
    ];
  }, [resources]);

  const resourceIndexById = useMemo(() => {
    const m = new Map<string, number>();
    resourceColumns.forEach((r, idx) => m.set(r.id, idx));
    return m;
  }, [resourceColumns]);

  const reservationsForDay = useMemo(() => {
    return reservations.filter((r) => {
      if (dateKeyFromIsoNY(r.start_ts) !== selectedDateKey) return false;
      const booking = bookingById.get(r.booking_id);
      return (booking?.status ?? "CONFIRMED") !== "CANCELLED";
    });
  }, [reservations, selectedDateKey, bookingById]);

  const bookingColorById = useMemo(() => {
    const palette = [
      "#0f0f10",
      "#1d4ed8",
      "#0f766e",
      "#6d28d9",
      "#b91c1c",
      "#0f172a",
      "#6b7280",
      "#1f2937",
      "#7c2d12",
      "#0e7490",
      "#4338ca",
      "#15803d",
    ];
    const byGroup = new Map<string, { startTs: string }>();
    const groupByBookingId = new Map<string, string>();

    const eventGroupFromNotes = (notes?: string | null) => {
      if (!notes) return null;
      const match = notes.match(/Event Request:\s*([a-f0-9-]+)/i);
      return match ? match[1] : null;
    };

    for (const resv of reservationsForDay) {
      const booking = bookingById.get(resv.booking_id);
      const startTs = booking?.start_ts || resv.start_ts;
      const groupId = eventGroupFromNotes(booking?.notes) || resv.booking_id;
      groupByBookingId.set(resv.booking_id, groupId);
      if (!byGroup.has(groupId)) {
        byGroup.set(groupId, { startTs });
      }
    }
    const ordered = Array.from(byGroup.entries()).sort((a, b) => {
      return new Date(a[1].startTs).getTime() - new Date(b[1].startTs).getTime();
    });
    const colorByGroup = new Map<string, string>();
    ordered.forEach(([id], idx) => {
      colorByGroup.set(id, palette[idx % palette.length]);
    });
    const colorMap = new Map<string, string>();
    groupByBookingId.forEach((groupId, bookingId) => {
      colorMap.set(bookingId, colorByGroup.get(groupId) || palette[0]);
    });
    return colorMap;
  }, [reservationsForDay, bookingById]);

  const eventRequestSizeById = useMemo(() => {
    const map = new Map<string, number>();
    (eventRequests || []).forEach((row) => {
      if (row?.id && Number.isFinite(row.party_size as number)) {
        map.set(row.id, Number(row.party_size));
      }
    });
    return map;
  }, [eventRequests]);

  const eventRequestIdFromNotes = (notes?: string | null) => {
    if (!notes) return null;
    const match = notes.match(/Event Request:\s*([a-f0-9-]+)/i);
    return match ? match[1] : null;
  };

  const displayPartySize = (booking?: BookingRow | null) => {
    if (!booking) return booking?.party_size ?? "—";
    const eventId = eventRequestIdFromNotes(booking.notes);
    if (eventId && eventRequestSizeById.has(eventId)) {
      return eventRequestSizeById.get(eventId);
    }
    return booking.party_size ?? "—";
  };

  if (loading) return <div className="text-sm text-zinc-600">Loading bookings…</div>;

  const openWindow = getOpenWindowForDateKey(selectedDateKey);
  const openStartMin = openWindow?.openMin ?? 0;
  const openEndMin = openWindow?.closeMin ?? 0;
  const scheduleMinutes = Math.max(0, openEndMin - openStartMin);
  const scheduleHeight = (scheduleMinutes / 60) * HOUR_ROW_PX;

  function offsetFromOpen(minutesFromOpen: number) {
    return minutesFromOpen * PX_PER_MIN;
  }

  const modalContent = editingBookingId ? (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 px-4"
      style={{ pointerEvents: "auto", zIndex: 2147483647 }}
    >
      <div className="pointer-events-auto relative z-[100000] w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-zinc-900">Edit Booking</div>
            <div className="mt-1 text-xs text-zinc-500">Update appointment details and reschedule.</div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditingBookingId(null)}
              className="rounded-lg border border-zinc-200 px-3 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
            >
              Back
            </button>
            <button
              type="button"
              onClick={saveBookingEdits}
              className="rounded-lg bg-zinc-900 px-3 py-1 text-xs font-semibold text-white"
            >
              {savingEdit ? "Saving..." : "Save Booking"}
            </button>
            <button
              type="button"
              onClick={cancelBooking}
              disabled={cancelLoading || savingEdit || editLoading}
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 disabled:opacity-60"
            >
              {cancelLoading ? "Cancelling..." : "Cancel Booking"}
            </button>
          </div>
        </div>
        <div className="mt-4 grid gap-3">
          <select
            value={editActivity}
            onChange={(e) => setEditActivity(e.target.value)}
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
            disabled={editLoading}
          >
            <option value="">Select activity</option>
            <option value="Axe Throwing">Axe Throwing</option>
            <option value="Duckpin Bowling">Duckpin Bowling</option>
            <option value="Combo Package">Combo Package</option>
          </select>
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Customer name"
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
            disabled={editLoading}
          />
          <input
            value={editEmail}
            onChange={(e) => setEditEmail(e.target.value)}
            placeholder="Customer email"
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
            disabled={editLoading}
          />
          <textarea
            value={editNotes}
            onChange={(e) => setEditNotes(e.target.value)}
            placeholder="Internal notes (staff only)"
            className="min-h-[80px] rounded-xl border border-zinc-200 px-3 py-2 text-sm"
            disabled={editLoading}
          />
        </div>
        <div className="mt-5 border-t border-zinc-200 pt-4">
          <div className="text-sm font-semibold text-zinc-900">Reschedule</div>
          <div className="mt-2 text-xs text-zinc-500">Choose a new date and time slot.</div>
          <div className="mt-3">
            <MonthCalendar
              selectedDateKey={editDateKey || todayKey}
              onSelectDateKey={(dk) => {
                setEditDateKey(dk);
                setEditStartMin(null);
              }}
            />
          </div>
          <div className="mt-3">
            {(() => {
              const openWindow = editDateKey ? getOpenWindowForDateKey(editDateKey) : null;
              if (!openWindow) {
                return <div className="text-xs text-zinc-500">Closed on selected day.</div>;
              }
              const blockedSet = new Set(editBlockedStartMins);
              const nowMin = editDateKey === todayKey ? nowMinutesNY() : -1;
              const slots: number[] = [];
              const lastStart = openWindow.closeMin - editDuration;
              for (let m = openWindow.openMin; m <= lastStart; m += 30) slots.push(m);
              if (editStartMin != null && !slots.includes(editStartMin)) {
                slots.unshift(editStartMin);
              }
              const endOptions =
                editStartMin == null
                  ? []
                  : editDurationOptions
                      .map((duration) => ({ duration, endMin: editStartMin + duration }))
                      .filter((opt) => opt.endMin <= openWindow.closeMin);
              const endValue = editStartMin == null ? "" : String(editStartMin + editDuration);

              return (
                <div>
                  <div className="mb-2 text-xs text-zinc-500">
                    {editAvailabilityLoading ? "Checking availability…" : "Select start and end time"}
                  </div>
                  {slots.length === 0 ? (
                    <div className="text-xs text-zinc-500">No start times available for this duration.</div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-semibold text-zinc-600">
                      Start Time
                      <select
                        value={editStartMin == null ? "" : String(editStartMin)}
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          setEditStartMin(Number.isFinite(next) ? next : null);
                        }}
                        className="mt-1 h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm"
                        disabled={editAvailabilityLoading}
                      >
                        <option value="">Select start</option>
                        {slots.map((m) => {
                          const blocked = blockedSet.has(m);
                          const past = nowMin >= 0 && m < nowMin;
                          const disabled = blocked || past || editAvailabilityLoading;
                          return (
                            <option key={m} value={m} disabled={disabled}>
                              {minutesToLabel(m)}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    <label className="text-xs font-semibold text-zinc-600">
                      End Time
                      <select
                        value={endValue}
                        onChange={(e) => {
                          if (editStartMin == null) return;
                          const endMin = Number(e.target.value);
                          if (!Number.isFinite(endMin)) return;
                          const nextDuration = endMin - editStartMin;
                          if (nextDuration > 0) setEditDuration(nextDuration);
                        }}
                        className="mt-1 h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm"
                        disabled={editStartMin == null || editAvailabilityLoading}
                      >
                        <option value="">Select end</option>
                        {endOptions.map((opt) => (
                          <option key={opt.endMin} value={opt.endMin}>
                            {minutesToLabel(opt.endMin)}
                          </option>
                        ))}
                      </select>
                    </label>
                    </div>
                  )}
                  <div className="mt-2 text-xs text-zinc-500">
                    Duration: <span className="font-semibold text-zinc-800">{editDuration} mins</span>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
        {editLoading ? <div className="mt-3 text-sm text-zinc-600">Loading booking…</div> : null}
        {editError ? <div className="mt-3 text-sm text-red-600">{editError}</div> : null}
      </div>
    </div>
  ) : null;
  const modal = modalContent;

  return (
    <>
      {modal}
      <div className={`relative z-0 rounded-2xl border border-zinc-200 bg-white p-4 ${editingBookingId ? "pointer-events-none" : ""}`}>
        <div className="mb-6 grid gap-6 lg:grid-cols-1">
        <div className="mx-auto w-full max-w-[640px]">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold text-zinc-700">Calendar</div>
            <button
              type="button"
              onClick={() => setSelectedDateKey(todayKey)}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-1 text-xs hover:bg-zinc-50"
            >
              Today
            </button>
          </div>
          <div className="mb-2 flex justify-center">
            <a
              href="/book?mode=staff"
              target="_blank"
              rel="noreferrer"
              style={{ width: "auto" }}
              className="inline-flex rounded-xl border border-zinc-900 bg-zinc-900 px-5 py-2 text-[12px] font-semibold text-white shadow-sm hover:bg-zinc-800"
            >
              Add Booking +
            </a>
          </div>
          <div className="flex justify-center">
            <MonthCalendar selectedDateKey={selectedDateKey} onSelectDateKey={setSelectedDateKey} />
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold text-zinc-700">Day Schedule</div>
            <div className="text-xs text-zinc-500">{prettyDate(selectedDateKey)}</div>
          </div>
          {!openWindow ? (
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
              Closed today (Mon–Wed).
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white p-3" style={{ pointerEvents: "auto" }}>
              {resourceColumns.length === 0 ? (
                <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3 text-xs text-zinc-600">
                  No active resources found. Add Axe bays and Duckpin lanes in the resources table.
                </div>
              ) : (
                <>
                  <div
                    className="sticky top-0 z-10 border-b border-zinc-100 bg-white"
                    style={{
                      minWidth: TIME_GUTTER + resourceColumns.length * RESOURCE_COL_WIDTH,
                      height: HEADER_HEIGHT,
                    }}
                  >
                    <div className="flex h-full items-center text-sm font-semibold text-zinc-600">
                      <div style={{ width: TIME_GUTTER }} />
                      {resourceColumns.map((r) => (
                        <div
                          key={r.id}
                          className="text-center"
                          style={{ width: RESOURCE_COL_WIDTH, paddingLeft: 10, paddingRight: 10 }}
                        >
                          {r.label || r.name || r.id}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div
                    className="relative"
                    style={{
                      height: scheduleHeight,
                      minWidth: TIME_GUTTER + resourceColumns.length * RESOURCE_COL_WIDTH,
                      position: "relative",
                      pointerEvents: "auto",
                      backgroundImage:
                        "repeating-linear-gradient(to bottom, rgba(24,24,27,0.08) 0, rgba(24,24,27,0.08) 1px, transparent 1px, transparent " +
                        HOUR_ROW_PX +
                        "px), repeating-linear-gradient(to bottom, transparent 0, transparent " +
                        Math.floor(HOUR_ROW_PX / 2) +
                        "px, rgba(24,24,27,0.04) " +
                        Math.floor(HOUR_ROW_PX / 2) +
                        "px, rgba(24,24,27,0.04) " +
                        (Math.floor(HOUR_ROW_PX / 2) + 1) +
                        "px, transparent " +
                        (Math.floor(HOUR_ROW_PX / 2) + 1) +
                        "px, transparent " +
                        HOUR_ROW_PX +
                        "px)",
                      backgroundPosition: "0 0, 0 0",
                      backgroundSize: `100% ${HOUR_ROW_PX}px, 100% ${HOUR_ROW_PX}px`,
                    }}
                    data-schedule-root
                    onPointerDown={(e) => {
                      const elements = typeof document !== "undefined" ? document.elementsFromPoint(e.clientX, e.clientY) : [];
                      const card = elements.find((el) => (el as HTMLElement).dataset?.bookingId) as HTMLElement | undefined;
                      const bookingId = card?.dataset?.bookingId;
                      if (bookingId) {
                        openEditForBooking(bookingId);
                      }
                    }}
                    onClick={(e) => {
                      const elements = typeof document !== "undefined" ? document.elementsFromPoint(e.clientX, e.clientY) : [];
                      const card = elements.find((el) => (el as HTMLElement).dataset?.bookingId) as HTMLElement | undefined;
                      const bookingId = card?.dataset?.bookingId;
                      if (bookingId) {
                        openEditForBooking(bookingId);
                      }
                    }}
                  >
                    <div
                      className="absolute left-0"
                      style={{
                        top: 0,
                        width: TIME_GUTTER,
                        height: scheduleMinutes * PX_PER_MIN,
                        pointerEvents: "none",
                      }}
                    >
                      {Array.from(
                        { length: Math.max(1, Math.ceil(scheduleMinutes / 60)) },
                        (_, i) => Math.floor(openStartMin / 60) + i
                      ).map((h, idx) => (
                        <div key={`${h}-${idx}`} className="relative" style={{ height: HOUR_ROW_PX }}>
                          <div className="absolute left-0 top-0 text-sm text-zinc-500" style={{ paddingLeft: 8 }}>
                            {hourLabel(h)}
                          </div>
                        </div>
                      ))}
                    </div>

                    {resourceColumns.map((r, idx) => (
                      <div
                        key={r.id}
                        className="absolute top-0 bottom-0 border-l border-zinc-100"
                        style={{ left: TIME_GUTTER + idx * RESOURCE_COL_WIDTH, top: HEADER_HEIGHT, pointerEvents: "none" }}
                      />
                    ))}

                    {(isClient ? reservationsForDay : []).map((resv) => {
                      const colIndex = resourceIndexById.get(resv.resource_id);
                      if (colIndex == null) return null;
                      const startLabel = fmtNY(resv.start_ts);
                      const endLabel = fmtNY(resv.end_ts);
                      const startMin = minutesFromLabel(startLabel);
                      const endMin = minutesFromLabel(endLabel);
                      if (startMin == null || endMin == null) return null;
                      const top = offsetFromOpen(startMin - openStartMin);
                      const height = Math.max(28, (endMin - startMin) * PX_PER_MIN);
                      if (top + height < 0 || top > scheduleMinutes * PX_PER_MIN) return null;

                      const booking = bookingById.get(resv.booking_id);
                      const left = TIME_GUTTER + colIndex * RESOURCE_COL_WIDTH + 6;
                      const width = RESOURCE_COL_WIDTH - 12;
                      const resourceLabel =
                        resourceColumns[colIndex]?.label || resourceColumns[colIndex]?.name || "Resource";
                      const bgColor = bookingColorById.get(resv.booking_id) || "#0f0f10";

                      return (
                        <div
                          key={`${resv.booking_id}-${resv.resource_id}-${resv.start_ts}`}
                          className="absolute z-50 cursor-pointer rounded-xl p-3 text-xs text-white shadow-sm"
                          style={{ top, height, left, width, position: "absolute", backgroundColor: bgColor, pointerEvents: "auto" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditForBooking(resv.booking_id);
                          }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            openEditForBooking(resv.booking_id);
                          }}
                          onMouseEnter={() => {
                            const note = (booking?.notes || "").trim();
                            if (note && !note.startsWith("Event Request:")) {
                              setHoveredNoteId(resv.booking_id);
                            }
                          }}
                          onMouseLeave={() => {
                            if (hoveredNoteId === resv.booking_id) setHoveredNoteId(null);
                          }}
                          onTouchStart={(e) => {
                            e.stopPropagation();
                            openEditForBooking(resv.booking_id);
                          }}
                          data-booking-id={resv.booking_id}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openEditForBooking(resv.booking_id);
                            }
                          }}
                        >
                          <button
                            type="button"
                            aria-label="Edit booking"
                            className="absolute right-2 top-2 z-20 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold text-white underline"
                            data-booking-id={resv.booking_id}
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditForBooking(resv.booking_id);
                            }}
                          >
                            Edit
                          </button>
                          {hoveredNoteId === resv.booking_id &&
                          (booking?.notes || "").trim() &&
                          !(booking?.notes || "").trim().startsWith("Event Request:") ? (
                            <div
                              className="absolute right-2 top-7 z-30 max-w-[220px] whitespace-pre-wrap rounded-lg border border-black/10 bg-white px-2 py-1 text-[11px] shadow-lg"
                              style={{ color: "#000" }}
                            >
                              {booking?.notes?.trim()}
                            </div>
                          ) : null}
                          <div className="font-semibold">
                            {fmtNY(resv.start_ts)} – {fmtNY(resv.end_ts)}
                          </div>
                          <div>{activityLabel(booking?.activity) || "Booking"}</div>
                          <div className="text-[10px] text-zinc-300">{resourceLabel}</div>
                          <div className="text-[10px] text-zinc-200">
                            {booking?.customer_name || "Walk-in"} · {displayPartySize(booking)} ppl
                          </div>
                          <div className="text-[10px] text-zinc-200">
                            {paymentLabel(booking?.status, booking?.paid)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mb-2 text-sm font-semibold text-zinc-700">
        {prettyDate(selectedDateKey)} — {filtered.length} booking{filtered.length === 1 ? "" : "s"}
      </div>

      <div className="mx-auto" style={{ width: "90vw", maxWidth: "1400px" }}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email, activity, id…"
            className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setOrder("upcoming")}
              className={`rounded-xl border px-3 py-2 text-sm ${
                order === "upcoming" ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white"
              }`}
            >
              Upcoming
            </button>
            <button
              onClick={() => setOrder("newest")}
              className={`rounded-xl border px-3 py-2 text-sm ${
                order === "newest" ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white"
              }`}
            >
              Newest
            </button>
            <button
              onClick={() => loadBookings(order)}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-600">
              <tr>
                <th className="py-2">Customer</th>
                <th className="py-2">Start Time</th>
                <th className="py-2">End Time</th>
                <th className="py-2">Activity</th>
                <th className="py-2">Combo Order</th>
                <th className="py-2">Group Size</th>
                <th className="py-2">Status</th>
                <th className="py-2">Total</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-zinc-100">
                  <td className="py-2 text-center">
                    <div className="font-medium">
                      {r.customer_id ? (
                        <Link href={`/staff/customers/${r.customer_id}`} className="hover:underline">
                          {r.customer_name || "—"}
                        </Link>
                      ) : (
                        r.customer_name || "—"
                      )}
                    </div>
                    <div className="text-xs text-zinc-600">{r.customer_email || "—"}</div>
                    {r.notes ? <div className="text-[11px] text-zinc-500">Note: {r.notes}</div> : null}
                  </td>
                  <td className="py-2 text-center">{fmtNY(r.start_ts)}</td>
                  <td className="py-2 text-center">{fmtNY(r.end_ts)}</td>
                  <td className="py-2 text-center">{activityLabel(r.activity)}</td>
                  <td className="py-2 text-center">{comboOrderLabel(r.combo_order)}</td>
                  <td className="py-2 text-center">{displayPartySize(r)}</td>
                  <td className="py-2 text-center">
                    {(r.status ?? "CONFIRMED") === "CANCELLED" ? "CANCELLED" : r.paid ? "PAID" : "UNPAID"}
                  </td>
                  <td className="py-2 text-center">${(r.total_cents / 100).toFixed(2)}</td>
                  <td className="py-2 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => deleteBooking(r.id)}
                        disabled={actionLoadingId === r.id}
                        className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditForBooking(r.id)}
                        disabled={actionLoadingId === r.id}
                        className="inline-flex items-center justify-center rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
                        style={{ backgroundColor: "#2563eb", color: "#ffffff" }}
                      >
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      </div>
    </>
  );
}
