"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { loadStripeTerminal, type Terminal, type Reader } from "@stripe/terminal-js";
import { neededResources, PRICING, totalCents } from "@/lib/bookingLogic";

type Activity = "Axe Throwing" | "Duckpin Bowling" | "Combo Package";

/**
 * CLOSED: Mon–Wed
 * JS getDay(): Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6
 */
const CLOSED_WEEKDAYS = new Set([1, 2, 3]);

// ---------- helpers ----------
function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatMoney(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function toDateKey(d: Date) {
  // yyyy-mm-dd local
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function todayDateKeyNY(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function nowMinutesNY(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function fromDateKey(dateKey: string) {
  // Interpret as local date (avoid timezone weirdness)
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function prettyDate(dateKey: string) {
  if (!dateKey) return "—";
  const d = fromDateKey(dateKey);
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function isClosedDateKey(dateKey: string) {
  if (!dateKey) return false;
  const d = fromDateKey(dateKey);
  return CLOSED_WEEKDAYS.has(d.getDay());
}

/**
 * Store open hours as minutes-from-midnight for each weekday.
 * Thu: 4pm–10pm
 * Fri: 4pm–11pm
 * Sat: 12pm–11pm
 * Sun: 12pm–9pm
 */
function getOpenWindowForDateKey(dateKey: string): { openMin: number; closeMin: number } | null {
  if (!dateKey) return null;
  const d = fromDateKey(dateKey);
  const wd = d.getDay();

  // Thu
  if (wd === 4) return { openMin: 16 * 60, closeMin: 22 * 60 };
  // Fri
  if (wd === 5) return { openMin: 16 * 60, closeMin: 23 * 60 };
  // Sat
  if (wd === 6) return { openMin: 12 * 60, closeMin: 23 * 60 };
  // Sun
  if (wd === 0) return { openMin: 12 * 60, closeMin: 21 * 60 };

  return null; // Mon–Wed closed
}

function hoursForDateKey(dateKey: string) {
  if (!dateKey) return "Select a date to see hours.";
  const d = fromDateKey(dateKey);
  const wd = d.getDay();
  if (wd === 4) return "Thursday: 4:00 PM – 10:00 PM";
  if (wd === 5) return "Friday: 4:00 PM – 11:00 PM";
  if (wd === 6) return "Saturday: 12:00 PM – 11:00 PM";
  if (wd === 0) return "Sunday: 12:00 PM – 9:00 PM";
  return "Closed (Mon–Wed).";
}

function labelDuration(minutes: number | null) {
  if (!minutes) return "—";
  if (minutes === 30) return "30 Minutes";
  if (minutes === 60) return "1-Hour";
  if (minutes === 120) return "2-Hours";
  return `${minutes} minutes`;
}

function formatTimeFromMinutes(minsFromMidnight: number) {
  const h24 = Math.floor(minsFromMidnight / 60);
  const m = minsFromMidnight % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

/**
 * Converts "4:00 PM" -> minutes-from-midnight
 */
function parseLabelToMinutes(label: string) {
  // ex: "4:00 PM"
  const m = label.match(/^(\d{1,2}):(\d{2})\s(AM|PM)$/i);
  if (!m) return 0;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3].toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

/**
 * Build time slots that fit *within open hours*.
 * - Step: 30 mins for all durations (allows half-hour starts)
 * - Ensure slot start + duration does not pass close time
 */
function buildTimeSlotsForDate(dateKey: string, duration: number) {
  const openWindow = getOpenWindowForDateKey(dateKey);
  if (!openWindow) return [];

  const { openMin, closeMin } = openWindow;

  const step = 30; // allow half-hour starts for 2-hour bookings
  const lastStart = closeMin - duration;

  const slots: string[] = [];
  for (let t = openMin; t <= lastStart; t += step) {
    slots.push(formatTimeFromMinutes(t));
  }
  return slots;
}

/**
 * Make the button label show a range:
 * "4:00 PM – 5:00 PM"
 */
function slotRangeLabel(startLabel: string, durationMin: number) {
  const startMin = parseLabelToMinutes(startLabel);
  const endMin = startMin + durationMin;
  return `${formatTimeFromMinutes(startMin)} – ${formatTimeFromMinutes(endMin)}`;
}

/**
 * IMPORTANT:
 * This returns the timezone offset (in minutes) for the specific *selected date* in the user's locale.
 * That handles EST vs EDT correctly.
 *
 * Example:
 * - EST => 300
 * - EDT => 240
 */
function maxParty(activity: Activity | "") {
  if (activity === "Axe Throwing") return 16;
  return 24;
}

function calculatePrice(activity: Activity, duration: number, partySize: number) {
  const breakdown: string[] = [];
  const hours = duration / 60;
  const durationLabel = duration === 60 ? "1-Hour" : duration === 120 ? "2-Hours" : "30 Minutes";
  const resources = neededResources(activity, partySize);

  if (activity === "Axe Throwing") {
    const perPersonCents = Math.round(25 * hours * 100);
    breakdown.push(`${partySize} × ${formatMoney(perPersonCents)} (${durationLabel})`);
    return { cents: totalCents(activity, partySize, duration), breakdown };
  }

  if (activity === "Duckpin Bowling") {
    const lanes = resources.DUCKPIN;
    const perLaneCents = Math.round(40 * hours * 100);
    breakdown.push(`${lanes} lane(s) × ${formatMoney(perLaneCents)} (${durationLabel})`);
    return { cents: totalCents(activity, partySize, duration), breakdown };
  }

  // Combo Package (forced 2 hours)
  const lanes = resources.DUCKPIN;
  const duckpinPortionCents = Math.round(40 * 1 * 100);
  const axePerPerson = (PRICING.AXE_PER_PERSON_CENTS / 100).toFixed(2);
  const axePortionCents = PRICING.AXE_PER_PERSON_CENTS;
  breakdown.push(`${lanes} lane(s) × ${formatMoney(duckpinPortionCents)} (Duckpin portion)`);
  breakdown.push(`${partySize} × $${axePerPerson} (Axe portion)`);
  return { cents: totalCents(activity, partySize, duration), breakdown };
}

// ---------- Calendar component ----------
function MonthCalendar(props: {
  selectedDateKey: string;
  onSelectDateKey: (dateKey: string) => void;
}) {
  const { selectedDateKey, onSelectDateKey } = props;
  const [cursor, setCursor] = useState(() => {
    const base = selectedDateKey ? fromDateKey(selectedDateKey) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const days = useMemo(() => {
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const totalDays = end.getDate();

    // Align grid to Sunday start
    const startWeekday = start.getDay(); // 0..6
    const cells: Array<{ date: Date | null }> = [];

    for (let i = 0; i < startWeekday; i++) cells.push({ date: null });
    for (let d = 1; d <= totalDays; d++) cells.push({ date: new Date(cursor.getFullYear(), cursor.getMonth(), d) });

    while (cells.length % 7 !== 0) cells.push({ date: null });

    return cells;
  }, [cursor]);

  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const todayNY = todayDateKeyNY();

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
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
          if (!cell.date) {
            return <div key={idx} className="h-10 rounded-xl bg-transparent" />;
          }

          const dk = toDateKey(cell.date);
          const closed = CLOSED_WEEKDAYS.has(cell.date.getDay());
          const isPast = dk < todayNY;
          const selected = selectedDateKey === dk;
          const disabled = closed || isPast;

          return (
            <button
              key={dk}
              type="button"
              disabled={disabled}
              onClick={() => onSelectDateKey(dk)}
              className={cx(
                "h-10 rounded-xl border text-sm font-bold transition",
                selected && !disabled && "border-zinc-900 bg-zinc-900 text-white",
                !selected && !disabled && "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50",
                closed && "cursor-not-allowed border-zinc-100 bg-zinc-100 text-zinc-400 line-through",
                isPast && "cursor-not-allowed border-zinc-100 bg-zinc-100 text-zinc-400"
              )}
              title={closed ? "Closed (Mon–Wed)" : isPast ? "Past date" : "Open"}
            >
              {cell.date.getDate()}
            </button>
          );
        })}
      </div>

      <div className="mt-3 text-xs text-zinc-500">
        <span className="font-semibold text-zinc-700">Closed:</span> Mon–Wed (greyed out)
      </div>
    </div>
  );
}

// ---------- Main page ----------
export default function BookPage() {
  const searchParams = useSearchParams();
  const isStaffMode = searchParams.get("mode") === "staff";
  const checkoutSessionId = searchParams.get("session_id");

  const [activity, setActivity] = useState<Activity | "">("");
  const [duration, setDuration] = useState<number | null>(null);
  const [partySize, setPartySize] = useState(2);
  const [comboSlot1, setComboSlot1] = useState<"Axe Throwing" | "Duckpin Bowling">("Duckpin Bowling");
  const [dateKey, setDateKey] = useState(""); // yyyy-mm-dd
  const [time, setTime] = useState(""); // stores START label (ex: "4:00 PM")
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string>("");
  const [submitSuccess, setSubmitSuccess] = useState<string>("");
  const [promoCode, setPromoCode] = useState("");
  const [promoApplied, setPromoApplied] = useState<{
    code: string;
    discountType: "PERCENT" | "AMOUNT";
    discountValue: number;
    amountOffCents: number;
    totalCents: number;
  } | null>(null);
  const [promoStatus, setPromoStatus] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    activity: Activity;
    duration: number;
    dateKey: string;
    timeLabel: string;
    partySize: number;
    customerName: string;
    customerEmail: string;
    customerPhone?: string;
    totalCents: number;
    comboOrder?: "DUCKPIN_FIRST" | "AXE_FIRST";
    resourceNames?: string[];
  } | null>(null);

  // Availability state
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [blockedStartMins, setBlockedStartMins] = useState<number[]>([]);
  const blockedSet = useMemo(() => new Set(blockedStartMins), [blockedStartMins]);

  const [showPaymentOptions, setShowPaymentOptions] = useState(false);
  const [showTerminalPanel, setShowTerminalPanel] = useState(false);
  const [terminalReaders, setTerminalReaders] = useState<Reader[]>([]);
  const [terminalLoading, setTerminalLoading] = useState(false);
  const [terminalError, setTerminalError] = useState<string>("");
  const [selectedReaderId, setSelectedReaderId] = useState<string>("");

  const terminalRef = useRef<Terminal | null>(null);
  const terminalReadyRef = useRef(false);

  useEffect(() => {
    setShowConfirmation(!!confirmation);
  }, [confirmation]);

  useEffect(() => {
    if (!isStaffMode || terminalReadyRef.current) return;
    terminalReadyRef.current = true;

    loadStripeTerminal().then((StripeTerminal) => {
      terminalRef.current = StripeTerminal.create({
        onFetchConnectionToken: async () => {
          const res = await fetch("/api/stripe/terminal/connection_token", { method: "POST" });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || !json?.secret) {
            throw new Error(json?.error || "Failed to fetch connection token.");
          }
          return json.secret as string;
        },
        onUnexpectedReaderDisconnect: () => {
          setTerminalError("Reader disconnected. Please reconnect.");
        },
      });
    });
  }, [isStaffMode]);

  // Used to prevent stale availability responses from overwriting newer ones
  const availabilityAbortRef = useRef<AbortController | null>(null);
  const availabilityReqIdRef = useRef(0);
  const debounceTimerRef = useRef<number | null>(null);

  const comboFirst = comboSlot1 === "Duckpin Bowling" ? "DUCKPIN" : "AXE";
  const comboSlot2 = comboSlot1 === "Duckpin Bowling" ? "Axe Throwing" : "Duckpin Bowling";

  function chooseActivity(a: Activity) {
    setActivity(a);

    // Combo forces 2 hours
    if (a === "Combo Package") setDuration(120);
    else setDuration(null);

    // Clamp party size
    setPartySize((p) => Math.min(p, maxParty(a)));

    // Reset time so user re-picks for new selection
    setTime("");

    // Reset submit states
    setSubmitError("");
    setSubmitSuccess("");
  }

  const closed = isClosedDateKey(dateKey);

  const slots = useMemo(() => {
    if (!duration || !dateKey) return [];
    return buildTimeSlotsForDate(dateKey, duration);
  }, [duration, dateKey]);

  const pricing = useMemo(() => {
    if (!activity || !duration) return null;
    return calculatePrice(activity, duration, partySize);
  }, [activity, duration, partySize]);

  const totalCents = pricing?.cents ?? 0;
  const discountedTotalCents = promoApplied?.totalCents ?? totalCents;
  const discountCents = promoApplied?.amountOffCents ?? 0;

  async function applyPromo(nextCode?: string) {
    const codeToApply = (nextCode ?? promoCode).trim();
    if (!codeToApply) {
      setPromoApplied(null);
      setPromoStatus("");
      return;
    }
    if (!pricing) {
      setPromoStatus("Select an activity and duration first.");
      return;
    }

    setPromoLoading(true);
    setPromoStatus("");
    try {
      const res = await fetch("/api/promos/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeToApply, amount_cents: pricing.cents }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.promo) {
        setPromoApplied(null);
        setPromoStatus(json?.error || "Invalid promo code.");
        return;
      }
      setPromoApplied({
        code: json.promo.code,
        discountType: json.promo.discount_type,
        discountValue: json.promo.discount_value,
        amountOffCents: json.amount_off_cents ?? 0,
        totalCents: json.total_cents ?? pricing.cents,
      });
      setPromoStatus("Promo applied.");
    } catch (e: any) {
      setPromoApplied(null);
      setPromoStatus(e?.message || "Failed to apply promo.");
    } finally {
      setPromoLoading(false);
    }
  }

  useEffect(() => {
    if (!promoApplied || !pricing) return;
    applyPromo(promoApplied.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricing?.cents]);

  const resources = useMemo(() => {
    if (!activity) return null;
    const needs = neededResources(activity, partySize);
    return { bays: needs.AXE, lanes: needs.DUCKPIN };
  }, [activity, partySize]);

  const selectedTimeRange = useMemo(() => {
    if (!time || !duration) return "—";
    return slotRangeLabel(time, duration);
  }, [time, duration]);

  const startMin = useMemo(() => (time ? parseLabelToMinutes(time) : null), [time]);
  const endMin = useMemo(() => (startMin != null && duration ? startMin + duration : null), [startMin, duration]);
  const selectedTimePast = useMemo(() => {
    if (!dateKey || !time) return false;
    if (dateKey !== todayDateKeyNY()) return false;
    return parseLabelToMinutes(time) < nowMinutesNY();
  }, [dateKey, time]);

  useEffect(() => {
    if (!dateKey || !time) return;
    if (dateKey !== todayDateKeyNY()) return;
    if (parseLabelToMinutes(time) < nowMinutesNY()) {
      setTime("");
    }
  }, [dateKey, time]);

  // -------- availability fetch --------
  async function refreshAvailability(params: {
    activity: Activity;
    partySize: number;
    dateKey: string;
    durationMinutes: number;
    openStartMin: number;
    openEndMin: number;
    slotIntervalMin: number;
    order?: "DUCKPIN_FIRST" | "AXE_FIRST";
  }) {
    // cancel any in-flight request
    availabilityAbortRef.current?.abort();
    const controller = new AbortController();
    availabilityAbortRef.current = controller;

    const reqId = ++availabilityReqIdRef.current;

    setAvailabilityLoading(true);
    // Clear stale blocked data while loading so UI doesn’t show old state
    setBlockedStartMins([]);

    try {
      const res = await fetch("/api/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: controller.signal,
      });

      const json = await res.json().catch(() => ({}));

      // If a newer request was fired after this one, ignore this response
      if (reqId !== availabilityReqIdRef.current) return;

      if (!res.ok) {
        console.error("availability error:", json);
        setBlockedStartMins([]);
        return;
      }

      const blocked = Array.isArray(json.blockedStartMins) ? json.blockedStartMins : [];
      setBlockedStartMins(blocked);

      // If selected time became blocked, clear it
      if (time) {
        const sm = parseLabelToMinutes(time);
        if (blocked.includes(sm)) setTime("");
      }
    } catch (err: any) {
      // ignore abort errors
      if (err?.name !== "AbortError") {
        console.error("availability fetch failed:", err);
      }
    } finally {
      // Only stop loading if this is still the latest request
      if (reqId === availabilityReqIdRef.current) {
        setAvailabilityLoading(false);
      }
    }
  }

  // Auto refresh availability when selections change (debounced)
  useEffect(() => {
    if (!activity || !duration || !dateKey || closed) {
      availabilityAbortRef.current?.abort();
      setAvailabilityLoading(false);
      setBlockedStartMins([]);
      return;
    }

    const openWindow = getOpenWindowForDateKey(dateKey);
    if (!openWindow) {
      availabilityAbortRef.current?.abort();
      setAvailabilityLoading(false);
      setBlockedStartMins([]);
      return;
    }

    const step = 30;

    // debounce to avoid spamming API while changing
    if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);

    debounceTimerRef.current = window.setTimeout(() => {
      refreshAvailability({
        activity,
        partySize,
        dateKey,
        durationMinutes: duration,
        openStartMin: openWindow.openMin,
        openEndMin: openWindow.closeMin,
        slotIntervalMin: step,
        order: activity === "Combo Package" ? (comboFirst === "DUCKPIN" ? "DUCKPIN_FIRST" : "AXE_FIRST") : undefined,
      });
    }, 200);

    return () => {
      if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity, duration, partySize, dateKey, closed, comboFirst]);

  // Disable confirm if selected time is blocked
  const selectedTimeBlocked = useMemo(() => {
    if (!time) return false;
    const sm = parseLabelToMinutes(time);
    return blockedSet.has(sm);
  }, [time, blockedSet]);

  const canConfirm =
    !!activity &&
    !!duration &&
    !!dateKey &&
    !!time &&
    !closed &&
    !selectedTimeBlocked &&
    !selectedTimePast &&
    name.trim().length > 1 &&
    email.trim().length > 3 &&
    phone.trim().length > 6 &&
    !submitting;

  async function createCheckoutSession(opts: { successPath: string; cancelPath: string; uiMode: "customer" | "staff" }) {
    if (!activity || !duration || !dateKey || !time || closed) return;
    if (startMin == null || endMin == null) return;
    if (!pricing) return;

    setSubmitting(true);
    setSubmitError("");
    setSubmitSuccess("");

    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activity,
          durationMinutes: duration,
          partySize,
          dateKey,
          startMin,
          customerName: name.trim(),
          customerEmail: email.trim(),
          customerPhone: phone.trim(),
          comboOrder: activity === "Combo Package" ? (comboFirst === "DUCKPIN" ? "DUCKPIN_FIRST" : "AXE_FIRST") : undefined,
          successPath: opts.successPath,
          cancelPath: opts.cancelPath,
          uiMode: opts.uiMode,
          promoCode: promoApplied?.code || "",
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitError(json?.error || "Failed to start checkout.");
        return;
      }

      if (json?.url) {
        window.location.href = json.url;
      } else {
        setSubmitError("Checkout session did not return a URL.");
      }
    } catch (e: any) {
      setSubmitError(e?.message || "Checkout failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirm() {
    setSubmitError("");
    setSubmitSuccess("");

    if (!activity || !duration || !dateKey || !time || closed) return;
    if (startMin == null || endMin == null) return;
    if (!pricing) return;

    if (isStaffMode) {
      setShowPaymentOptions(true);
      return;
    }

    await createCheckoutSession({ successPath: "/book/confirmation", cancelPath: "/book", uiMode: "customer" });
  }

  function resetBookingState() {
    setActivity("");
    setDuration(null);
    setPartySize(2);
    setComboSlot1("Duckpin Bowling");
    setDateKey("");
    setTime("");
    setName("");
    setEmail("");
    setPhone("");
    setPromoCode("");
    setPromoApplied(null);
    setPromoStatus("");
    setSubmitError("");
    setSubmitSuccess("");
    setBlockedStartMins([]);
    setAvailabilityLoading(false);
  }

  async function loadTerminalReaders() {
    try {
      setTerminalError("");
      const res = await fetch("/api/stripe/terminal/readers");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTerminalError(json?.error || "Failed to load card readers.");
        return;
      }
      setTerminalReaders(json.readers || []);
      if (!selectedReaderId && json.readers?.length) {
        setSelectedReaderId(json.readers[0].id);
      }
    } catch (e: any) {
      setTerminalError(e?.message || "Failed to load card readers.");
    }
  }

  async function handleTerminalPayment() {
    if (!terminalRef.current) {
      setTerminalError("Stripe Terminal not initialized.");
      return;
    }
    if (!activity || !duration || !dateKey || !time || closed) return;
    if (startMin == null || endMin == null) return;
    if (!pricing) return;
    if (!selectedReaderId) {
      setTerminalError("Select a reader to continue.");
      return;
    }

    setTerminalLoading(true);
    setTerminalError("");

    try {
      const reader = terminalReaders.find((r) => r.id === selectedReaderId);
      if (!reader) {
        setTerminalError("Reader not found.");
        return;
      }

      const connectResult = await terminalRef.current.connectReader(reader);
      if (connectResult.error) {
        setTerminalError(connectResult.error.message || "Failed to connect reader.");
        return;
      }

      const intentRes = await fetch("/api/stripe/terminal/payment_intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activity,
          durationMinutes: duration,
          partySize,
          dateKey,
          startMin,
          customerName: name.trim(),
          customerEmail: email.trim(),
          customerPhone: phone.trim(),
          comboOrder: activity === "Combo Package" ? (comboFirst === "DUCKPIN" ? "DUCKPIN_FIRST" : "AXE_FIRST") : undefined,
          promoCode: promoApplied?.code || "",
        }),
      });

      const intentJson = await intentRes.json().catch(() => ({}));
      if (!intentRes.ok || !intentJson?.client_secret) {
        setTerminalError(intentJson?.error || "Failed to create payment intent.");
        return;
      }

      const collectResult = await terminalRef.current.collectPaymentMethod(intentJson.client_secret);
      if (collectResult.error) {
        setTerminalError(collectResult.error.message || "Payment collection failed.");
        return;
      }

      const processResult = await terminalRef.current.processPayment(collectResult.paymentIntent);
      if (processResult.error) {
        setTerminalError(processResult.error.message || "Payment failed.");
        return;
      }

      const paymentIntentId = processResult.paymentIntent?.id;
      if (!paymentIntentId) {
        setTerminalError("Payment completed, but no payment intent returned.");
        return;
      }

      const finalizeRes = await fetch("/api/stripe/terminal/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_intent_id: paymentIntentId }),
      });
      const finalizeJson = await finalizeRes.json().catch(() => ({}));
      if (!finalizeRes.ok) {
        setTerminalError(finalizeJson?.error || "Payment succeeded but booking failed.");
        return;
      }

      const comboOrder = activity === "Combo Package" ? (comboFirst === "DUCKPIN" ? "DUCKPIN_FIRST" : "AXE_FIRST") : undefined;
      setConfirmation({
        activity,
        duration,
        dateKey,
        timeLabel: selectedTimeRange,
        partySize,
        customerName: name.trim(),
        customerEmail: email.trim(),
        customerPhone: phone.trim(),
        totalCents: pricing.cents,
        comboOrder,
        resourceNames: [],
      });
      setShowConfirmation(true);
      setShowTerminalPanel(false);
      setShowPaymentOptions(false);
    } catch (e: any) {
      setTerminalError(e?.message || "Terminal payment failed.");
    } finally {
      setTerminalLoading(false);
    }
  }

  async function handleManualCheckout() {
    await createCheckoutSession({
      successPath: "/book/confirmation?mode=staff",
      cancelPath: "/book?mode=staff",
      uiMode: "staff",
    });
  }

  useEffect(() => {
    if (!checkoutSessionId) return;

    (async () => {
      try {
        // Best-effort finalize to cover local dev without webhooks.
        const finalizeRes = await fetch(`/api/stripe/checkout/finalize?session_id=${checkoutSessionId}`, {
          method: "POST",
        });
        const finalizeJson = await finalizeRes.json().catch(() => ({}));

        const res = await fetch(`/api/stripe/checkout/session?session_id=${checkoutSessionId}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const meta = json?.metadata || {};

        const activityFromMeta = meta.activity as Activity;
        const durationFromMeta = Number(meta.duration_minutes);
        const partyFromMeta = Number(meta.party_size);
        const dateFromMeta = String(meta.date_key || "");
        const startMinFromMeta = Number(meta.start_min);
        const timeLabel = `${formatTimeFromMinutes(startMinFromMeta)} – ${formatTimeFromMinutes(
          startMinFromMeta + durationFromMeta
        )}`;

        setConfirmation({
          activity: activityFromMeta,
          duration: durationFromMeta,
          dateKey: dateFromMeta,
          timeLabel,
          partySize: partyFromMeta,
          customerName: String(meta.customer_name || ""),
          customerEmail: String(meta.customer_email || ""),
          customerPhone: String(meta.customer_phone || ""),
          totalCents: Number(json?.session?.amount_total || 0),
          comboOrder: (meta.combo_order as "DUCKPIN_FIRST" | "AXE_FIRST") ?? undefined,
          resourceNames: Array.isArray(finalizeJson?.resources) ? finalizeJson.resources : [],
        });
        setShowConfirmation(true);
        resetBookingState();
      } catch (e) {
        // ignore; checkout success handled by UI
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutSessionId]);

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-900 text-white shadow-sm">
            <span className="text-sm font-extrabold">AQ</span>
          </div>

          <div>
            <div className="text-2xl font-extrabold text-zinc-900">Axe Quacks Booking</div>
            <div className="text-sm text-zinc-600">
              Choose an activity, duration, date, and time — pricing updates in real time.
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.7fr_1fr]">
          {/* Left column */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            {/* Step 1 */}
            <div className="mb-6">
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-xs font-extrabold text-white">
                  1
                </div>
                <div className="text-base font-extrabold text-zinc-900">Activity</div>
              </div>

              <div className="flex flex-wrap gap-2">
                {(["Axe Throwing", "Duckpin Bowling", "Combo Package"] as Activity[]).map((a) => {
                  const selected = activity === a;
                  return (
                    <button
                      key={a}
                      type="button"
                      onClick={() => chooseActivity(a)}
                      className={cx(
                        "rounded-2xl border px-4 py-2 text-sm font-extrabold transition",
                        selected
                          ? "border-zinc-900 bg-zinc-900 text-white"
                          : "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50"
                      )}
                    >
                      {a}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 2 */}
            <div className="mb-6">
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-xs font-extrabold text-white">
                  2
                </div>
                <div className="text-base font-extrabold text-zinc-900">Duration</div>
              </div>

              {activity === "Combo Package" ? (
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
                  Combo Package is automatically <span className="font-extrabold">2-Hours</span>.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {[30, 60, 120].map((d) => {
                    const selected = duration === d;
                    return (
                      <button
                        key={d}
                        type="button"
                        disabled={!activity}
                        onClick={() => {
                          setDuration(d);
                          setTime("");
                          setSubmitError("");
                          setSubmitSuccess("");
                        }}
                        className={cx(
                          "rounded-2xl border px-4 py-2 text-sm font-extrabold transition",
                          !activity && "cursor-not-allowed opacity-40",
                          activity &&
                            (selected
                              ? "border-zinc-900 bg-zinc-900 text-white"
                              : "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50")
                        )}
                      >
                        {labelDuration(d)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Step 3 */}
            <div className="mb-6">
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-xs font-extrabold text-white">
                  3
                </div>
                <div className="text-base font-extrabold text-zinc-900">Party Size</div>
                <div className="text-xs font-semibold text-zinc-500">
                  (max {activity ? maxParty(activity) : "—"})
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPartySize((p) => Math.max(1, p - 1));
                    setSubmitError("");
                    setSubmitSuccess("");
                  }}
                  disabled={!activity}
                  className={cx(
                    "h-10 w-10 rounded-2xl border border-zinc-200 bg-white text-lg font-extrabold hover:bg-zinc-50",
                    !activity && "cursor-not-allowed opacity-40"
                  )}
                >
                  −
                </button>

                <input
                  type="number"
                  min={1}
                  max={activity ? maxParty(activity) : 24}
                  value={partySize}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    const clamped = Math.max(1, Math.min(next, activity ? maxParty(activity) : 24));
                    setPartySize(clamped);
                    setSubmitError("");
                    setSubmitSuccess("");
                  }}
                  disabled={!activity}
                  className={cx(
                    "h-10 w-24 rounded-2xl border border-zinc-200 bg-white px-3 text-center text-sm font-extrabold text-zinc-900",
                    !activity && "cursor-not-allowed opacity-40"
                  )}
                />

                <button
                  type="button"
                  onClick={() => {
                    setPartySize((p) => Math.min(activity ? maxParty(activity) : 24, p + 1));
                    setSubmitError("");
                    setSubmitSuccess("");
                  }}
                  disabled={!activity}
                  className={cx(
                    "h-10 w-10 rounded-2xl border border-zinc-200 bg-white text-lg font-extrabold hover:bg-zinc-50",
                    !activity && "cursor-not-allowed opacity-40"
                  )}
                >
                  +
                </button>

                {activity === "Combo Package" && (
                  <div className="ml-2 rounded-2xl bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-700">
                    Combo max is <span className="font-extrabold">24</span> (6 per lane).
                  </div>
                )}
              </div>
            </div>

            {activity === "Combo Package" && (
              <div className="mb-6">
                <div className="text-sm font-medium mb-2">Order</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-zinc-200 bg-white p-3">
                    <div className="text-xs font-semibold text-zinc-500">1)</div>
                    <select
                      value={comboSlot1}
                      onChange={(e) => {
                        setComboSlot1(e.target.value as "Axe Throwing" | "Duckpin Bowling");
                        setSubmitError("");
                        setSubmitSuccess("");
                      }}
                      className="mt-2 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-900"
                    >
                      <option value="Axe Throwing">Axe Throwing</option>
                      <option value="Duckpin Bowling">Duckpin Bowling</option>
                    </select>
                  </div>
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                    <div className="text-xs font-semibold text-zinc-500">2)</div>
                    <select
                      value={comboSlot2}
                      disabled
                      className="mt-2 h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm font-semibold text-zinc-900"
                    >
                      <option value={comboSlot2}>{comboSlot2}</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Step 4 */}
            <div className="mb-6">
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-xs font-extrabold text-white">
                  4
                </div>
                <div className="text-base font-extrabold text-zinc-900">Date</div>
              </div>

              <MonthCalendar
                selectedDateKey={dateKey}
                onSelectDateKey={(dk) => {
                  if (isClosedDateKey(dk)) return;
                  setDateKey(dk);
                  setTime("");
                  setSubmitError("");
                  setSubmitSuccess("");
                }}
              />

              <div className="mt-3 rounded-2xl border border-zinc-200 bg-white p-4 text-sm">
                <div className="font-extrabold text-zinc-900">{prettyDate(dateKey)}</div>
                <div className={cx("mt-1", closed ? "text-red-600" : "text-zinc-700")}>
                  {hoursForDateKey(dateKey)}
                </div>
              </div>
            </div>

            {/* Step 5 */}
            <div>
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-xs font-extrabold text-white">
                  5
                </div>
                <div className="text-base font-extrabold text-zinc-900">Time</div>

                {availabilityLoading && (
                  <div className="ml-2 text-xs font-semibold text-zinc-500">Checking availability…</div>
                )}
              </div>

              {!duration ? (
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
                  Select an activity and duration to see time slots.
                </div>
              ) : !dateKey ? (
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
                  Select a date to see time slots.
                </div>
              ) : closed ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
                  Axe Quacks is closed on this date. Choose Thu–Sun.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {slots.map((startLabel) => {
                    const sm = parseLabelToMinutes(startLabel);
                    const isBlocked = blockedSet.has(sm);
                    const selected = time === startLabel;
                    const isPastTime = dateKey === todayDateKeyNY() && sm < nowMinutesNY();

                    return (
                      <button
                        key={startLabel}
                        type="button"
                        disabled={isBlocked || isPastTime || availabilityLoading}
                        onClick={() => {
                          if (isBlocked || isPastTime) return;
                          setTime(startLabel);
                          setSubmitError("");
                          setSubmitSuccess("");
                        }}
                        className={cx(
                          "rounded-2xl border px-3 py-2 text-sm font-extrabold transition",
                          selected && !isBlocked && "border-zinc-900 bg-zinc-900 text-white",
                          !selected && !isBlocked && "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50",
                          isPastTime && "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400 line-through opacity-70",
                          isBlocked && "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400 line-through opacity-70"
                        )}
                        title={
                          isPastTime
                            ? "That time has already passed."
                            : isBlocked
                            ? "Not enough resources available for this time."
                            : "Available"
                        }
                      >
                        {slotRangeLabel(startLabel, duration)}
                      </button>
                    );
                  })}
                </div>
              )}

              {!closed && duration && dateKey && (
                <div className="mt-2 text-xs text-zinc-500">
                  Times that are unavailable will be greyed out automatically.
                </div>
              )}
            </div>
          </div>

          {/* Right column - Summary */}
          <div className="lg:sticky lg:top-6">
            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="mb-3 text-base font-extrabold text-zinc-900">Summary</div>

              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-600">Activity</span>
                  <span className="font-extrabold text-zinc-900">{activity || "—"}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-600">Duration</span>
                  <span className="font-extrabold text-zinc-900">{labelDuration(duration)}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-600">Date</span>
                  <span className="font-extrabold text-zinc-900">{dateKey ? prettyDate(dateKey) : "—"}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-600">Time</span>
                  <span className="font-extrabold text-zinc-900">{time && duration ? selectedTimeRange : "—"}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-600">Party Size</span>
                  <span className="font-extrabold text-zinc-900">{partySize}</span>
                </div>

                {resources && (
                  <div className="mt-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700">
                    <div className="font-extrabold text-zinc-900">Resources (calculated)</div>
                    <div className="mt-1">
                      {resources.lanes > 0 ? (
                        <div>
                          Duckpin lanes: <span className="font-extrabold">{resources.lanes}</span>
                        </div>
                      ) : (
                        <div>Duckpin lanes: —</div>
                      )}
                      {resources.bays > 0 ? (
                        <div>
                          Axe bays: <span className="font-extrabold">{resources.bays}</span>
                        </div>
                      ) : (
                        <div>Axe bays: —</div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="my-4 border-t border-zinc-200" />

              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-zinc-600">Total</div>
                <div className="text-lg font-extrabold text-zinc-900">
                  {pricing ? formatMoney(discountedTotalCents) : "—"}
                </div>
              </div>

              {promoApplied && discountCents > 0 ? (
                <div className="mt-2 space-y-1 text-xs text-zinc-600">
                  <div className="flex items-center justify-between">
                    <span>Subtotal</span>
                    <span className="font-semibold text-zinc-800">{formatMoney(totalCents)}</span>
                  </div>
                  <div className="flex items-center justify-between text-emerald-700">
                    <span>Promo {promoApplied.code}</span>
                    <span className="font-semibold">-{formatMoney(discountCents)}</span>
                  </div>
                </div>
              ) : null}

              {pricing?.breakdown?.length ? (
                <div className="mt-2 rounded-2xl border border-zinc-200 bg-white p-3 text-xs text-zinc-700">
                  <div className="mb-1 font-extrabold text-zinc-900">Price breakdown</div>
                  <ul className="list-disc pl-4">
                    {pricing.breakdown.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="mt-4">
                <div className="text-sm font-extrabold text-zinc-900">Promo Code</div>
                <div className="mt-2 flex gap-2">
                  <input
                    value={promoCode}
                    onChange={(e) => {
                      setPromoCode(e.target.value);
                      setPromoStatus("");
                    }}
                    placeholder="Enter code"
                    className="h-11 flex-1 rounded-2xl border border-zinc-200 px-4 text-sm font-semibold outline-none focus:border-zinc-900"
                    autoCapitalize="characters"
                  />
                  {promoApplied ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPromoApplied(null);
                        setPromoStatus("");
                        setPromoCode("");
                      }}
                      className="h-11 rounded-2xl border border-zinc-200 px-4 text-sm font-extrabold text-zinc-700 hover:bg-zinc-50"
                    >
                      Remove
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => applyPromo()}
                      disabled={promoLoading || !promoCode.trim()}
                      className={cx(
                        "h-11 rounded-2xl px-4 text-sm font-extrabold transition",
                        promoLoading || !promoCode.trim()
                          ? "bg-zinc-200 text-zinc-500"
                          : "bg-zinc-900 text-white hover:bg-zinc-800"
                      )}
                    >
                      {promoLoading ? "Checking..." : "Apply"}
                    </button>
                  )}
                </div>
                {promoStatus ? (
                  <div className="mt-2 text-xs font-semibold text-zinc-600">{promoStatus}</div>
                ) : null}
              </div>

              <div className="my-4 border-t border-zinc-200" />

              <div className="text-sm font-extrabold text-zinc-900">Customer Info</div>

              <div className="mt-2 grid grid-cols-1 gap-2">
                <input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setSubmitError("");
                    setSubmitSuccess("");
                  }}
                  placeholder="Full Name"
                  className="h-11 rounded-2xl border border-zinc-200 px-4 text-sm font-semibold outline-none focus:border-zinc-900"
                  name="full_name"
                  id="full_name"
                />
                <input
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setSubmitError("");
                    setSubmitSuccess("");
                  }}
                  placeholder="Email"
                  className="h-11 rounded-2xl border border-zinc-200 px-4 text-sm font-semibold outline-none focus:border-zinc-900"
                  name="email"
                  id="email"
                />
                <input
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setSubmitError("");
                    setSubmitSuccess("");
                  }}
                  placeholder="Phone Number"
                  className="h-11 rounded-2xl border border-zinc-200 px-4 text-sm font-semibold outline-none focus:border-zinc-900"
                  name="phone"
                  id="phone"
                  inputMode="tel"
                />
              </div>

              {selectedTimeBlocked && (
                <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                  That time just became unavailable. Please select a different time.
                </div>
              )}

              {submitError && (
                <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                  {submitError}
                </div>
              )}

              {submitSuccess && (
                <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                  {submitSuccess}
                </div>
              )}

              <button
                disabled={!canConfirm}
                onClick={handleConfirm}
                className={cx(
                  "mt-4 h-12 w-full rounded-2xl text-sm font-extrabold transition",
                  canConfirm ? "bg-zinc-900 text-white hover:bg-zinc-800" : "bg-zinc-200 text-zinc-500"
                )}
              >
                {submitting ? "Starting checkout..." : isStaffMode ? "Confirm Booking (Payment)" : "Confirm Booking"}
              </button>

              {!canConfirm && !submitting && (
                <div className="mt-2 text-xs text-zinc-500">
                  Complete activity, duration, date (Thu–Sun), time, and customer info to enable confirmation.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 text-xs text-zinc-500">Note: This saves bookings + resource reservations in Supabase now.</div>
      </div>

      {showConfirmation && confirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="text-lg font-extrabold text-zinc-900">Thanks For Booking At Axe Quacks</div>
            <div className="mt-2 text-sm text-zinc-600">Here are your booking details:</div>
            <div className="mt-4 space-y-2 text-sm">
              <div>
                <span className="font-semibold text-zinc-700">Name:</span> {confirmation.customerName}
              </div>
              {confirmation.comboOrder && (
                <div>
                  <span className="font-semibold text-zinc-700">Combo Order:</span>{" "}
                  {confirmation.comboOrder === "DUCKPIN_FIRST"
                    ? "First: Duckpin Bowling, Second: Axe Throwing"
                    : "First: Axe Throwing, Second: Duckpin Bowling"}
                </div>
              )}
              <div>
                <span className="font-semibold text-zinc-700">Activity:</span> {confirmation.activity}
              </div>
              <div>
                <span className="font-semibold text-zinc-700">Date:</span> {prettyDate(confirmation.dateKey)}
              </div>
              <div>
                <span className="font-semibold text-zinc-700">Start/End Time:</span> {confirmation.timeLabel}
              </div>
              <div>
                <span className="font-semibold text-zinc-700">Resource Assigned:</span>{" "}
                {confirmation.resourceNames?.length ? confirmation.resourceNames.join(", ") : "TBD"}
              </div>
              <div>
                <span className="font-semibold text-zinc-700">Group Size:</span> {confirmation.partySize}
              </div>
              <div>
                <span className="font-semibold text-zinc-700">Phone:</span> {confirmation.customerPhone || "—"}
              </div>
              <div>
                <span className="font-semibold text-zinc-700">Email:</span> {confirmation.customerEmail}
              </div>
              <div>
                <span className="font-semibold text-zinc-700">Total:</span> $
                {(confirmation.totalCents / 100).toFixed(2)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowConfirmation(false);
                setConfirmation(null);
                resetBookingState();
              }}
              className="mt-5 h-11 w-full rounded-2xl bg-zinc-900 text-sm font-extrabold text-white hover:bg-zinc-800"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {showPaymentOptions ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-lg">
            <div className="text-lg font-extrabold text-zinc-900">Collect Payment</div>
            <div className="mt-2 text-sm text-zinc-600">Choose how you want to take payment for this booking.</div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setShowTerminalPanel(true);
                  loadTerminalReaders();
                }}
                className="rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-3 text-sm font-extrabold text-white hover:bg-zinc-800"
              >
                Card Reader
              </button>
              <button
                type="button"
                onClick={handleManualCheckout}
                className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-extrabold text-zinc-900 hover:bg-zinc-50"
              >
                Manual Card Checkout
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowPaymentOptions(false)}
              className="mt-4 text-xs font-semibold text-zinc-500 hover:text-zinc-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {showTerminalPanel ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-lg">
            <div className="text-lg font-extrabold text-zinc-900">Stripe Terminal</div>
            <div className="mt-2 text-sm text-zinc-600">Select a reader, then collect payment.</div>

            <div className="mt-4 grid gap-2">
              <label className="text-xs font-semibold text-zinc-500">Reader</label>
              <select
                value={selectedReaderId}
                onChange={(e) => setSelectedReaderId(e.target.value)}
                className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-900"
              >
                <option value="">Select a reader</option>
                {terminalReaders.map((reader) => (
                  <option key={reader.id} value={reader.id}>
                    {reader.label || reader.id}
                  </option>
                ))}
              </select>
            </div>

            {terminalError ? <div className="mt-3 text-xs font-semibold text-red-600">{terminalError}</div> : null}

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleTerminalPayment}
                disabled={terminalLoading}
                className={cx(
                  "rounded-2xl border border-zinc-900 bg-zinc-900 px-5 py-3 text-sm font-extrabold text-white hover:bg-zinc-800",
                  terminalLoading && "cursor-not-allowed opacity-60"
                )}
              >
                {terminalLoading ? "Processing…" : "Collect Payment"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowTerminalPanel(false);
                  setTerminalError("");
                }}
                className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-extrabold text-zinc-900 hover:bg-zinc-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
