"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { loadStripeTerminal, type Terminal, type Reader } from "@stripe/terminal-js";
import { createPortal } from "react-dom";
import {
  PARTY_AREA_OPTIONS,
  type PartyAreaName,
  partyAreaCostCents,
  comboAxePersonCents,
  comboDuckpinLaneCents,
  neededResources,
  PRICING,
  totalCents,
} from "@/lib/bookingLogic";

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

  // Mon–Wed (admin override window)
  if (wd === 1 || wd === 2 || wd === 3) return { openMin: 12 * 60, closeMin: 20 * 60 };
  // Thu
  if (wd === 4) return { openMin: 16 * 60, closeMin: 22 * 60 };
  // Fri
  if (wd === 5) return { openMin: 16 * 60, closeMin: 23 * 60 };
  // Sat
  if (wd === 6) return { openMin: 12 * 60, closeMin: 23 * 60 };
  // Sun
  if (wd === 0) return { openMin: 12 * 60, closeMin: 21 * 60 };

  return null;
}

function hoursForDateKey(dateKey: string) {
  if (!dateKey) return "Select a date to see hours.";
  const d = fromDateKey(dateKey);
  const wd = d.getDay();
  if (wd === 1 || wd === 2 || wd === 3) return "Monday–Wednesday: 12:00 PM – 8:00 PM (admin override)";
  if (wd === 4) return "Thursday: 4:00 PM – 10:00 PM";
  if (wd === 5) return "Friday: 4:00 PM – 11:00 PM";
  if (wd === 6) return "Saturday: 12:00 PM – 11:00 PM";
  if (wd === 0) return "Sunday: 12:00 PM – 9:00 PM";
  return "Closed.";
}

function labelDuration(minutes: number | null) {
  if (!minutes) return "—";
  if (minutes === 15) return "10 Axes";
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
function buildTimeSlotsForWindow(openWindow: { openMin: number; closeMin: number } | null, duration: number) {
  if (!openWindow) return [];
  const { openMin, closeMin } = openWindow;
  const step = duration === 15 ? 15 : 30; // allow quarter-hour starts for 10-axe bookings
  const lastStart = closeMin - duration;

  const slots: string[] = [];
  for (let t = openMin; t <= lastStart; t += step) {
    slots.push(formatTimeFromMinutes(t));
  }
  return slots;
}

function buildTimeSlotsForDate(dateKey: string, duration: number) {
  return buildTimeSlotsForWindow(getOpenWindowForDateKey(dateKey), duration);
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

function calculatePrice(
  activity: Activity,
  duration: number,
  partySize: number,
  comboDurations?: { axeMinutes: number; duckpinMinutes: number },
  partyAreaMinutes?: number,
  partyAreaCount?: number
) {
  const breakdown: string[] = [];
  const hours = duration / 60;
  const durationLabel = labelDuration(duration);
  const resources = neededResources(activity, partySize);

  if (activity === "Axe Throwing") {
    const perPersonCents =
      duration === 15 ? Math.round(10 * 100) :
      duration === 30 ? Math.round(20 * 100) :
      duration === 60 ? Math.round(25 * 100) :
      duration === 120 ? Math.round(45 * 100) :
      Math.round(25 * hours * 100);
    breakdown.push(`${partySize} × ${formatMoney(perPersonCents)} (${durationLabel})`);
    const base = totalCents(activity, partySize, duration);
    const partyAreaCents = partyAreaCostCents(partyAreaMinutes || 0, partyAreaCount || 0);
    if (partyAreaCents) {
      const hours = (partyAreaMinutes || 0) / 60;
      breakdown.push(`${partyAreaCount} party area(s) × ${hours} hr × ${formatMoney(5000)} = ${formatMoney(partyAreaCents)}`);
    }
    return { cents: base + partyAreaCents, breakdown };
  }

  if (activity === "Duckpin Bowling") {
    const lanes = resources.DUCKPIN;
    const perLaneCents =
      duration === 30 ? Math.round(30 * 100) :
      duration === 60 ? Math.round(40 * 100) :
      duration === 120 ? Math.round(75 * 100) :
      Math.round(40 * hours * 100);
    breakdown.push(`${lanes} lane(s) × ${formatMoney(perLaneCents)} (${durationLabel})`);
    const base = totalCents(activity, partySize, duration);
    const partyAreaCents = partyAreaCostCents(partyAreaMinutes || 0, partyAreaCount || 0);
    if (partyAreaCents) {
      const hours = (partyAreaMinutes || 0) / 60;
      breakdown.push(`${partyAreaCount} party area(s) × ${hours} hr × ${formatMoney(5000)} = ${formatMoney(partyAreaCents)}`);
    }
    return { cents: base + partyAreaCents, breakdown };
  }

  // Combo Package (per-activity durations)
  const comboAxeMinutes = comboDurations?.axeMinutes ?? 60;
  const comboDuckpinMinutes = comboDurations?.duckpinMinutes ?? 60;
  const lanes = resources.DUCKPIN;
  const duckpinPortionCents = Math.round(comboDuckpinLaneCents(comboDuckpinMinutes) * 100);
  const axePerPersonCents = Math.round(comboAxePersonCents(comboAxeMinutes) * 100);
  breakdown.push(`${lanes} lane(s) × ${formatMoney(duckpinPortionCents)} (${labelDuration(comboDuckpinMinutes)})`);
  breakdown.push(`${partySize} × ${formatMoney(axePerPersonCents)} (${labelDuration(comboAxeMinutes)})`);
  const base = totalCents(activity, partySize, duration, comboDurations);
  const partyAreaCents = partyAreaCostCents(partyAreaMinutes || 0, partyAreaCount || 0);
  if (partyAreaCents) {
    const hours = (partyAreaMinutes || 0) / 60;
    breakdown.push(`${partyAreaCount} party area(s) × ${hours} hr × ${formatMoney(5000)} = ${formatMoney(partyAreaCents)}`);
  }
  return { cents: base + partyAreaCents, breakdown };
}

// ---------- Calendar component ----------
function MonthCalendar(props: {
  selectedDateKey: string;
  onSelectDateKey: (dateKey: string) => void;
  allowClosed?: boolean;
  closedOverrideDates?: Set<string>;
}) {
  const { selectedDateKey, onSelectDateKey, allowClosed, closedOverrideDates } = props;
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
          className="rounded-xl border border-zinc-200 px-3 py-2 text-sm font-semibold text-black hover:bg-zinc-50"
          onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
        >
          ←
        </button>

        <div className="text-sm font-extrabold text-zinc-900">{monthLabel}</div>

        <button
          type="button"
          className="rounded-xl border border-zinc-200 px-3 py-2 text-sm font-semibold text-black hover:bg-zinc-50"
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
          const overridden = closedOverrideDates?.has(dk);
          const disabled = isPast;
          const closedDisabled = !allowClosed && closed;
          const blocked = disabled || closedDisabled;

          return (
            <button
              key={dk}
              type="button"
              aria-disabled={blocked}
              onClick={() => {
                if (blocked) return;
                onSelectDateKey(dk);
              }}
              className={cx(
                "h-10 rounded-xl border text-sm font-bold transition",
                selected && !blocked && "border-zinc-900 bg-zinc-900 text-white",
                !selected && !blocked && "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50",
                closed && !allowClosed && "cursor-not-allowed border-zinc-100 bg-zinc-100 text-zinc-400 line-through",
                closed && allowClosed && !overridden && "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
                isPast && "cursor-not-allowed border-zinc-100 bg-zinc-100 text-zinc-400"
              )}
              title={
                closed
                  ? overridden
                    ? "Closed-day override applied"
                    : "Closed (admin override required)"
                  : isPast
                  ? "Past date"
                  : "Open"
              }
            >
              {cell.date.getDate()}
            </button>
          );
        })}
      </div>

      <div className="mt-3 text-xs text-zinc-500">
        <span className="font-semibold text-zinc-700">Closed:</span>{" "}
        {allowClosed ? "Mon–Wed (admin override required to book)" : "Mon–Wed (not bookable)"}
      </div>
    </div>
  );
}

// ---------- Main page ----------
function BookPageContent() {
  const searchParams = useSearchParams();
  const isStaffMode = searchParams.get("mode") === "staff";
  const checkoutSessionId = searchParams.get("session_id");

  const [activity, setActivity] = useState<Activity | "">("");
  const [duration, setDuration] = useState<number | null>(null);
  const [comboAxeDuration, setComboAxeDuration] = useState<number | null>(null);
  const [comboDuckpinDuration, setComboDuckpinDuration] = useState<number | null>(null);
  const [partySize, setPartySize] = useState(2);
  const [partyAreas, setPartyAreas] = useState<PartyAreaName[]>([]);
  const [partyAreaMinutes, setPartyAreaMinutes] = useState<number | null>(null);
  const [comboSlot1, setComboSlot1] = useState<"Axe Throwing" | "Duckpin Bowling">("Duckpin Bowling");
  const [dateKey, setDateKey] = useState(""); // yyyy-mm-dd
  const [time, setTime] = useState(""); // stores START label (ex: "4:00 PM")
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);

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
  const [closedOverrideDates, setClosedOverrideDates] = useState<Set<string>>(() => new Set());
  const [blackoutOverrideDates, setBlackoutOverrideDates] = useState<Set<string>>(() => new Set());
  const [overrideTarget, setOverrideTarget] = useState<{ dateKey: string; type: "closed" | "blackout" } | null>(null);
  const [overrideStaffId, setOverrideStaffId] = useState("");
  const [overridePin, setOverridePin] = useState("");
  const [overrideError, setOverrideError] = useState("");
  const [overrideLoading, setOverrideLoading] = useState(false);

  const [showPaymentOptions, setShowPaymentOptions] = useState(false);
  const [showTerminalPanel, setShowTerminalPanel] = useState(false);
  const [autoStartTerminal, setAutoStartTerminal] = useState(false);
  const [terminalReaders, setTerminalReaders] = useState<Reader[]>([]);
  const [terminalLoading, setTerminalLoading] = useState(false);
  const [terminalError, setTerminalError] = useState<string>("");
  const [selectedReaderId, setSelectedReaderId] = useState<string>("");
  const [cashModalOpen, setCashModalOpen] = useState(false);
  const [cashInput, setCashInput] = useState("0.00");
  const cashInputRef = useRef<HTMLInputElement | null>(null);
  const [cashError, setCashError] = useState("");

  useEffect(() => {
    if (!partyAreas.length) {
      if (partyAreaMinutes != null) setPartyAreaMinutes(null);
      return;
    }
    if (partyAreaMinutes == null || !Number.isFinite(partyAreaMinutes)) {
      setPartyAreaMinutes(60);
      return;
    }
    const clamped = Math.min(480, Math.max(60, Math.round(partyAreaMinutes / 60) * 60));
    if (clamped !== partyAreaMinutes) setPartyAreaMinutes(clamped);
  }, [partyAreas, partyAreaMinutes]);
  const [cashLoading, setCashLoading] = useState(false);

  const terminalRef = useRef<Terminal | null>(null);
  const terminalReadyRef = useRef(false);

  useEffect(() => {
    setShowConfirmation(!!confirmation);
  }, [confirmation]);

  useEffect(() => {
    if (isStaffMode) return;
    setCashModalOpen(false);
    setShowTerminalPanel(false);
    setShowPaymentOptions(false);
    setOverrideTarget(null);
    setShowConfirmation(false);
  }, [isStaffMode]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setCashModalOpen(false);
      setShowTerminalPanel(false);
      setShowPaymentOptions(false);
      setOverrideTarget(null);
      setShowConfirmation(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!cashModalOpen) return;
    const timer = window.setTimeout(() => {
      cashInputRef.current?.focus();
      cashInputRef.current?.select();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [cashModalOpen]);

  useEffect(() => {
    if (!isStaffMode || terminalReadyRef.current) return;
    terminalReadyRef.current = true;

    loadStripeTerminal().then((StripeTerminal) => {
      if (!StripeTerminal) {
        setTerminalError("Stripe Terminal failed to load. Please refresh.");
        return;
      }
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
  const comboTotalDuration = useMemo(() => {
    if (!comboAxeDuration || !comboDuckpinDuration) return null;
    return comboAxeDuration + comboDuckpinDuration;
  }, [comboAxeDuration, comboDuckpinDuration]);
  const effectiveDuration = activity === "Combo Package" ? comboTotalDuration : duration;
  const maxPartyAreaMinutes = Math.max(60, Math.floor((effectiveDuration || 0) / 60) * 60);

  function chooseActivity(a: Activity) {
    setActivity(a);

    if (a === "Combo Package") {
      setDuration(null);
      setComboAxeDuration(null);
      setComboDuckpinDuration(null);
    } else {
      setDuration(null);
    }

    // Clamp party size
    setPartySize((p) => Math.min(p, maxParty(a)));

    // Reset time so user re-picks for new selection
    setTime("");

    // Reset submit states
    setSubmitError("");
    setSubmitSuccess("");
  }

  function requestClosedOverride(nextDateKey: string) {
    setOverrideTarget({ dateKey: nextDateKey, type: "closed" });
  }

  function requestBlackoutOverride(nextDateKey: string) {
    setOverrideTarget({ dateKey: nextDateKey, type: "blackout" });
    setOverrideStaffId("");
    setOverridePin("");
    setOverrideError("");
  }

  async function submitClosedOverride(targetOverride?: { dateKey: string; type: "closed" | "blackout" }) {
    const target = targetOverride ?? overrideTarget;
    if (!target) return;
    if (!overrideStaffId.trim() || overridePin.trim().length !== 4) {
      setOverrideError("Enter a valid admin staff ID and 4-digit PIN.");
      return;
    }
    setOverrideLoading(true);
    setOverrideError("");
    try {
      const res = await fetch("/api/staff/verify-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId: overrideStaffId.trim(), pin: overridePin.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOverrideError(json?.error || "Admin override failed.");
        return;
      }
      if (target.type === "closed") {
        setClosedOverrideDates((prev) => {
          const next = new Set(prev);
          next.add(target.dateKey);
          return next;
        });
      } else {
        setBlackoutOverrideDates((prev) => {
          const next = new Set(prev);
          next.add(target.dateKey);
          return next;
        });
      }
      setDateKey(target.dateKey);
      setTime("");
      setOverrideTarget(null);
    } catch (err: any) {
      setOverrideError(err?.message || "Admin override failed.");
    } finally {
      setOverrideLoading(false);
    }
  }

  const closed = isClosedDateKey(dateKey);
  const hasClosedOverride = dateKey ? closedOverrideDates.has(dateKey) : false;
  const hasBlackoutOverride = dateKey ? blackoutOverrideDates.has(dateKey) : false;
  const closedForStaff = closed && !hasClosedOverride;
  const openWindowOverride = useMemo(
    () => (dateKey && hasClosedOverride ? getOpenWindowForDateKey(dateKey) : null),
    [dateKey, hasClosedOverride]
  );
  const partyAreaDuration = partyAreas.length ? partyAreaMinutes ?? 60 : 0;
  const bookingWindowMinutes = Math.max(effectiveDuration ?? 0, partyAreaDuration || 0);

  const slots = useMemo(() => {
    if (!bookingWindowMinutes || !dateKey) return [];
    if (isStaffMode && hasClosedOverride) {
      return buildTimeSlotsForWindow(openWindowOverride, bookingWindowMinutes);
    }
    return buildTimeSlotsForDate(dateKey, bookingWindowMinutes);
  }, [bookingWindowMinutes, dateKey, isStaffMode, hasClosedOverride, openWindowOverride]);

  const pricing = useMemo(() => {
    if (!activity || !effectiveDuration) return null;
    return calculatePrice(activity, effectiveDuration, partySize, {
      axeMinutes: comboAxeDuration ?? 0,
      duckpinMinutes: comboDuckpinDuration ?? 0,
    }, partyAreaDuration, partyAreas.length);
  }, [activity, effectiveDuration, partySize, comboAxeDuration, comboDuckpinDuration, partyAreaDuration, partyAreas.length]);

  const totalCents = pricing?.cents ?? 0;
  const discountedTotalCents = promoApplied?.totalCents ?? totalCents;
  const discountCents = promoApplied?.amountOffCents ?? 0;
  const cashProvidedCents = useMemo(() => {
    const value = Number(cashInput || "0");
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.round(value * 100));
  }, [cashInput]);
  const changeDueCents = Math.max(0, cashProvidedCents - discountedTotalCents);

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
        body: JSON.stringify({
          code: codeToApply,
          amount_cents: pricing.cents,
          customer_email: email.trim(),
          activity,
          duration_minutes: effectiveDuration,
        }),
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
    if (!time || !bookingWindowMinutes) return "—";
    return slotRangeLabel(time, bookingWindowMinutes);
  }, [time, bookingWindowMinutes]);

  const startMin = useMemo(() => (time ? parseLabelToMinutes(time) : null), [time]);
  const endMin = useMemo(
    () => (startMin != null && bookingWindowMinutes ? startMin + bookingWindowMinutes : null),
    [startMin, bookingWindowMinutes]
  );
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
    partyAreas?: PartyAreaName[];
    partyAreaMinutes?: number;
    dateKey: string;
    durationMinutes: number;
    comboAxeMinutes?: number;
    comboDuckpinMinutes?: number;
    openStartMin: number;
    openEndMin: number;
    slotIntervalMin: number;
    order?: "DUCKPIN_FIRST" | "AXE_FIRST";
    ignoreBlackouts?: boolean;
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
    if (!activity || !effectiveDuration || !dateKey || (isStaffMode ? closedForStaff : closed)) {
      availabilityAbortRef.current?.abort();
      setAvailabilityLoading(false);
      setBlockedStartMins([]);
      return;
    }

    const openWindow = isStaffMode && hasClosedOverride ? openWindowOverride : getOpenWindowForDateKey(dateKey);
    if (!openWindow) {
      availabilityAbortRef.current?.abort();
      setAvailabilityLoading(false);
      setBlockedStartMins([]);
      return;
    }

    const step = effectiveDuration === 15 ? 15 : 30;

    // debounce to avoid spamming API while changing
    if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);

    debounceTimerRef.current = window.setTimeout(() => {
      refreshAvailability({
        activity,
        partySize,
        partyAreas,
        partyAreaMinutes: partyAreas.length ? partyAreaDuration : undefined,
        dateKey,
        durationMinutes: effectiveDuration,
        comboAxeMinutes: activity === "Combo Package" ? comboAxeDuration ?? undefined : undefined,
        comboDuckpinMinutes: activity === "Combo Package" ? comboDuckpinDuration ?? undefined : undefined,
        openStartMin: openWindow.openMin,
        openEndMin: openWindow.closeMin,
        slotIntervalMin: step,
        order: activity === "Combo Package" ? (comboFirst === "DUCKPIN" ? "DUCKPIN_FIRST" : "AXE_FIRST") : undefined,
        ignoreBlackouts: isStaffMode && (hasClosedOverride || hasBlackoutOverride),
      });
    }, 200);

    return () => {
      if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activity,
    effectiveDuration,
    partySize,
    partyAreas,
    partyAreaDuration,
    dateKey,
    closed,
    closedForStaff,
    hasClosedOverride,
    hasBlackoutOverride,
    openWindowOverride,
    comboFirst,
    comboAxeDuration,
    comboDuckpinDuration,
    isStaffMode,
  ]);

  const effectiveBlockedSet = useMemo(() => {
    if (isStaffMode && hasClosedOverride && slots.length && blockedSet.size === slots.length) {
      return new Set<number>();
    }
    return blockedSet;
  }, [isStaffMode, hasClosedOverride, slots.length, blockedSet]);

  // Disable confirm if selected time is blocked
  const selectedTimeBlocked = useMemo(() => {
    if (!time) return false;
    const sm = parseLabelToMinutes(time);
    return effectiveBlockedSet.has(sm);
  }, [time, effectiveBlockedSet]);

  const canConfirm =
    !!activity &&
    !!effectiveDuration &&
    !!dateKey &&
    !!time &&
    !(partyAreas.length && !partyAreaDuration) &&
    !(isStaffMode ? closedForStaff : closed) &&
    !selectedTimeBlocked &&
    !selectedTimePast &&
    name.trim().length > 1 &&
    email.trim().length > 3 &&
    phone.trim().length > 6 &&
    consentChecked &&
    !submitting;

  async function createCheckoutSession(opts: { successPath: string; cancelPath: string; uiMode: "customer" | "staff" }) {
    if (!activity || !effectiveDuration || !dateKey || !time || (isStaffMode ? closedForStaff : closed)) return;
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
          durationMinutes: effectiveDuration,
          partySize,
          dateKey,
          startMin,
          partyAreas,
          partyAreaMinutes: partyAreas.length ? partyAreaDuration : undefined,
          customerName: name.trim(),
          customerEmail: email.trim(),
          customerPhone: phone.trim(),
          comboAxeMinutes: activity === "Combo Package" ? comboAxeDuration ?? undefined : undefined,
          comboDuckpinMinutes: activity === "Combo Package" ? comboDuckpinDuration ?? undefined : undefined,
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

    if (!activity || !effectiveDuration || !dateKey || !time || (isStaffMode ? closedForStaff : closed)) return;
    if (startMin == null || endMin == null) return;
    if (!pricing) return;

    if (isStaffMode) {
      setShowTerminalPanel(true);
      setAutoStartTerminal(true);
      loadTerminalReaders();
      return;
    }

    await createCheckoutSession({ successPath: "/book/confirmation", cancelPath: "/book", uiMode: "customer" });
  }

  function normalizeCashInput(value: string) {
    const cleaned = value.replace(/[^0-9.]/g, "");
    const parts = cleaned.split(".");
    const whole = parts[0] ?? "";
    const decimals = parts[1] ? parts[1].slice(0, 2) : "";
    if (parts.length > 1) {
      return `${whole}.${decimals}`;
    }
    return whole;
  }

  function openCashModal() {
    setCashInput("0.00");
    setCashError("");
    setShowTerminalPanel(false);
    setTerminalError("");
    setCashModalOpen(true);
  }

  function closeCashModal() {
    setCashModalOpen(false);
    setCashInput("0.00");
    setCashError("");
  }

  function backspaceCashInput() {
    setCashInput((prev) => prev.slice(0, -1));
  }

  function setCashAmount(amount: number) {
    setCashInput(amount.toFixed(2));
  }

  async function submitCashPayment() {
    setCashError("");
    if (!activity || !effectiveDuration || !dateKey || !time || (isStaffMode ? closedForStaff : closed)) return;
    if (startMin == null || endMin == null) return;
    if (!pricing) return;

    if (cashProvidedCents < discountedTotalCents) {
      setCashError("Cash provided must cover the total.");
      return;
    }

    setCashLoading(true);
    try {
      const res = await fetch("/api/staff/bookings/cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activity,
          durationMinutes: effectiveDuration,
          partySize,
          dateKey,
          startMin,
          partyAreas,
          partyAreaMinutes: partyAreas.length ? partyAreaDuration : undefined,
          customerName: name.trim(),
          customerEmail: email.trim(),
          customerPhone: phone.trim(),
          comboAxeMinutes: activity === "Combo Package" ? comboAxeDuration ?? undefined : undefined,
          comboDuckpinMinutes: activity === "Combo Package" ? comboDuckpinDuration ?? undefined : undefined,
          comboOrder: activity === "Combo Package" ? (comboFirst === "DUCKPIN" ? "DUCKPIN_FIRST" : "AXE_FIRST") : undefined,
          totalCentsOverride: discountedTotalCents,
          promoCode: promoApplied?.code || "",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCashError(json?.error || "Cash payment failed.");
        return;
      }

      const comboOrder = activity === "Combo Package" ? (comboFirst === "DUCKPIN" ? "DUCKPIN_FIRST" : "AXE_FIRST") : undefined;
      setConfirmation({
        activity,
        duration: effectiveDuration,
        dateKey,
        timeLabel: selectedTimeRange,
        partySize,
        customerName: name.trim(),
        customerEmail: email.trim(),
        customerPhone: phone.trim(),
        totalCents: discountedTotalCents,
        comboOrder,
        resourceNames: [],
      });
      setShowConfirmation(true);
      setShowPaymentOptions(false);
      setShowTerminalPanel(false);
      closeCashModal();
      resetBookingState();
    } catch (e: any) {
      setCashError(e?.message || "Cash payment failed.");
    } finally {
      setCashLoading(false);
    }
  }

  function resetBookingState() {
    setActivity("");
    setDuration(null);
    setComboAxeDuration(null);
    setComboDuckpinDuration(null);
    setPartySize(2);
    setPartyAreas([]);
    setPartyAreaMinutes(null);
    setComboSlot1("Duckpin Bowling");
    setDateKey("");
    setTime("");
    setName("");
    setEmail("");
    setPhone("");
    setConsentChecked(false);
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

  async function handleTerminalPayment(forcedReaderId?: string) {
    if (!terminalRef.current) {
      setTerminalError("Stripe Terminal not initialized.");
      return;
    }
    if (!activity || !effectiveDuration || !dateKey || !time || (isStaffMode ? closedForStaff : closed)) return;
    if (startMin == null || endMin == null) return;
    if (!pricing) return;
    const readerId = forcedReaderId || selectedReaderId;
    if (!readerId) {
      setTerminalError("Select a reader to continue.");
      return;
    }

    setTerminalLoading(true);
    setTerminalError("");

    try {
      const reader = terminalReaders.find((r) => r.id === readerId);
      if (!reader) {
        setTerminalError("Reader not found.");
        return;
      }

      const connectResult = await terminalRef.current.connectReader(reader);
      if ("error" in connectResult && connectResult.error) {
        setTerminalError(connectResult.error.message || "Failed to connect reader.");
        return;
      }

      const intentRes = await fetch("/api/stripe/terminal/payment_intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activity,
          durationMinutes: effectiveDuration,
          partySize,
          dateKey,
          startMin,
          partyAreas,
          partyAreaMinutes: partyAreas.length ? partyAreaDuration : undefined,
          customerName: name.trim(),
          customerEmail: email.trim(),
          customerPhone: phone.trim(),
          comboAxeMinutes: activity === "Combo Package" ? comboAxeDuration ?? undefined : undefined,
          comboDuckpinMinutes: activity === "Combo Package" ? comboDuckpinDuration ?? undefined : undefined,
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
      if ("error" in collectResult && collectResult.error) {
        setTerminalError(collectResult.error.message || "Payment collection failed.");
        return;
      }

      if (!("paymentIntent" in collectResult) || !collectResult.paymentIntent) {
        setTerminalError("Payment collection failed.");
        return;
      }

      const processResult = await terminalRef.current.processPayment(collectResult.paymentIntent);
      if ("error" in processResult && processResult.error) {
        setTerminalError(processResult.error.message || "Payment failed.");
        return;
      }

      if (!("paymentIntent" in processResult) || !processResult.paymentIntent) {
        setTerminalError("Payment completed, but no payment intent returned.");
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
        duration: effectiveDuration,
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

  async function handleCancelTerminalPayment() {
    if (!terminalRef.current) {
      setTerminalError("Stripe Terminal not initialized.");
      return;
    }
    try {
      setTerminalError("");
      const result = await terminalRef.current.cancelCollectPaymentMethod();
      if ("error" in result && result.error) {
        setTerminalError(result.error.message || "Failed to cancel payment.");
        return;
      }
      await terminalRef.current.disconnectReader();
      setTerminalError("Payment canceled.");
      setAutoStartTerminal(false);
      setShowTerminalPanel(false);
    } catch (e: any) {
      setTerminalError(e?.message || "Failed to cancel payment.");
    } finally {
      setTerminalLoading(false);
    }
  }

  useEffect(() => {
    if (!autoStartTerminal) return;
    if (!showTerminalPanel) return;
    if (terminalLoading) return;
    if (!terminalReaders.length) return;

    const readerId = selectedReaderId || terminalReaders[0]?.id || "";
    if (!readerId) return;
    if (!selectedReaderId) {
      setSelectedReaderId(readerId);
    }
    setAutoStartTerminal(false);
    handleTerminalPayment(readerId);
  }, [autoStartTerminal, showTerminalPanel, terminalReaders, selectedReaderId, terminalLoading]);

  useEffect(() => {
    if (!checkoutSessionId) return;

    (async () => {
      try {
        // Best-effort finalize to cover local dev without webhooks.
        const finalizeRes = await fetch(`/api/stripe/checkout/finalize?session_id=${checkoutSessionId}`, {
          method: "POST",
        });
        const finalizeJson = await finalizeRes.json().catch(() => ({}));
        const waiverUrl = String(finalizeJson?.waiverUrl || "");
        if (waiverUrl) {
          window.location.href = waiverUrl;
          return;
        }

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
    <div className="min-h-screen pb-12">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-8 rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-[0_24px_60px_rgba(0,0,0,0.35)] backdrop-blur">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white p-2 shadow-[0_10px_24px_rgba(0,0,0,0.35)]">
            <img src="/logo.png?v=2" alt="Axe Quacks" className="h-12 w-12 object-contain" />
            </div>
            <div>
              <div className="public-display text-xs text-[#FFD700]">Axe Quacks</div>
              <div className="mt-1 text-3xl font-extrabold text-white">Book Your Session</div>
              <div className="public-muted mt-2 text-sm">
                Choose your activity, duration, and time. Pricing updates instantly as you build your visit.
              </div>
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
                <div className="grid gap-4 md:grid-cols-2">
                  {[
                    { label: "Axe Throwing", value: comboAxeDuration, setValue: setComboAxeDuration },
                    { label: "Duckpin Bowling", value: comboDuckpinDuration, setValue: setComboDuckpinDuration },
                  ].map((group) => (
                    <div key={group.label} className="rounded-2xl border border-zinc-200 bg-white p-3">
                      <button
                        type="button"
                        disabled
                        className="w-full rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-extrabold text-white"
                      >
                        {group.label}
                      </button>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {[30, 60, 120].map((d) => {
                          const selected = group.value === d;
                          return (
                            <button
                              key={d}
                              type="button"
                              onClick={() => {
                                group.setValue(d);
                                setTime("");
                                setSubmitError("");
                                setSubmitSuccess("");
                              }}
                              className={cx(
                                "rounded-full border px-3 py-1 text-xs font-semibold transition",
                                selected
                                  ? "border-zinc-900 bg-zinc-900 text-white"
                                  : "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50"
                              )}
                            >
                              {labelDuration(d)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {(activity === "Axe Throwing" ? [15, 30, 60, 120] : [30, 60, 120]).map((d) => {
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
                <div className="text-base font-extrabold text-zinc-900">Private Party Areas (Optional)</div>
              </div>

              <div className="flex flex-wrap gap-2">
                {PARTY_AREA_OPTIONS.filter((area) => area.visible).map((area) => {
                  const selected = partyAreas.includes(area.name);
                  return (
                    <button
                      key={area.key}
                      type="button"
                      onClick={() => {
                        const nextAreas = selected
                          ? partyAreas.filter((name) => name !== area.name)
                          : [...partyAreas, area.name];
                        setPartyAreas(nextAreas);
                        setPartyAreaMinutes((prev) => (nextAreas.length ? prev ?? 60 : null));
                        setTime("");
                        setSubmitError("");
                        setSubmitSuccess("");
                      }}
                      className={cx(
                        "rounded-2xl border px-4 py-2 text-sm font-extrabold transition",
                        selected
                          ? "border-zinc-900 bg-zinc-900 text-white"
                          : "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50"
                      )}
                    >
                      {area.name}
                    </button>
                  );
                })}
              </div>
              {partyAreas.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-600">Duration</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[60, 120, 180, 240, 300, 360, 420, 480]
                      .filter((mins) => mins <= maxPartyAreaMinutes)
                      .map((mins) => {
                      const selected = partyAreaMinutes === mins;
                      return (
                        <button
                          key={mins}
                          type="button"
                          onClick={() => {
                            setPartyAreaMinutes(mins);
                            setTime("");
                            setSubmitError("");
                            setSubmitSuccess("");
                          }}
                          className={cx(
                            "rounded-full border px-3 py-1 text-xs font-semibold transition",
                            selected
                              ? "border-zinc-900 bg-zinc-900 text-white"
                              : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                          )}
                        >
                          {mins / 60} hr
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">$50 per hour • up to 8 hours</div>
                </div>
              )}
              <div className="mt-2 text-xs text-zinc-500">
                Add-on only. Booking can proceed without a party area.
              </div>
            </div>

            {/* Step 4 */}
            <div className="mb-6">
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-xs font-extrabold text-white">
                  4
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
                    "h-10 w-10 rounded-2xl border border-zinc-200 bg-white text-lg font-extrabold text-black hover:bg-zinc-50",
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
                    "h-10 w-10 rounded-2xl border border-zinc-200 bg-white text-lg font-extrabold text-black hover:bg-zinc-50",
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

            {/* Step 5 */}
            <div className="mb-6">
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-xs font-extrabold text-white">
                  5
                </div>
                <div className="text-base font-extrabold text-zinc-900">Date</div>
              </div>

              <MonthCalendar
                selectedDateKey={dateKey}
                onSelectDateKey={(dk) => {
                  if (isClosedDateKey(dk)) {
                    if (!isStaffMode) return;
                    if (closedOverrideDates.has(dk)) {
                      setDateKey(dk);
                      setTime("");
                      setSubmitError("");
                      setSubmitSuccess("");
                      return;
                    }
                    setDateKey(dk);
                    setTime("");
                    setSubmitError("");
                    setSubmitSuccess("");
                    requestClosedOverride(dk);
                    return;
                  }
                  setDateKey(dk);
                  setTime("");
                  setSubmitError("");
                  setSubmitSuccess("");
                }}
                allowClosed={isStaffMode}
                closedOverrideDates={closedOverrideDates}
              />

              <div className="mt-3 rounded-2xl border border-zinc-200 bg-white p-4 text-sm">
                <div className="font-extrabold text-zinc-900">{prettyDate(dateKey)}</div>
                <div className={cx("mt-1", closedForStaff ? "text-red-600" : "text-zinc-700")}>
                  {closedForStaff ? "Closed (admin override required)" : hoursForDateKey(dateKey)}
                </div>
                {isStaffMode && hasBlackoutOverride ? (
                  <div className="mt-1 text-xs font-semibold text-amber-700">Blackout override applied.</div>
                ) : null}
              </div>
            </div>

            {/* Step 6 */}
            <div>
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-xs font-extrabold text-white">
                  6
                </div>
                <div className="text-base font-extrabold text-zinc-900">Time</div>

                {availabilityLoading && (
                  <div className="ml-2 text-xs font-semibold text-zinc-500">Checking availability…</div>
                )}
              </div>

              {!effectiveDuration ? (
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
                  Select an activity and duration to see time slots.
                </div>
              ) : !dateKey ? (
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
                  Select a date to see time slots.
                </div>
              ) : (isStaffMode ? closedForStaff : closed) ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
                  <div>Axe Quacks is closed on this date. Admin override required to book.</div>
                  {isStaffMode && dateKey ? (
                    <div className="mt-3 grid gap-3">
                      <label className="text-xs font-semibold text-zinc-700">
                        Admin Staff ID
                        <input
                          value={overrideStaffId}
                          onChange={(e) => setOverrideStaffId(e.target.value)}
                          className="mt-1 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900"
                          placeholder="e.g. bda"
                          disabled={overrideLoading}
                        />
                      </label>
                      <label className="text-xs font-semibold text-zinc-700">
                        Admin PIN
                        <input
                          value={overridePin}
                          onChange={(e) => setOverridePin(e.target.value)}
                          type="password"
                          inputMode="numeric"
                          className="mt-1 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900"
                          placeholder="4-digit PIN"
                          disabled={overrideLoading}
                        />
                      </label>
                      {overrideError ? <div className="text-xs text-red-700">{overrideError}</div> : null}
                      <button
                        type="button"
                        onClick={() => submitClosedOverride({ dateKey, type: "closed" })}
                        className="w-fit rounded-full border border-red-300 bg-white px-3 py-1 text-xs font-extrabold text-red-700 hover:bg-red-100 disabled:opacity-60"
                        disabled={overrideLoading}
                      >
                        {overrideLoading ? "Verifying..." : "Approve Override"}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {slots.map((startLabel) => {
                    const sm = parseLabelToMinutes(startLabel);
                    const isBlocked = effectiveBlockedSet.has(sm);
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
                        {slotRangeLabel(startLabel, bookingWindowMinutes)}
                      </button>
                    );
                  })}
                </div>
              )}

              {isStaffMode && dateKey && !hasClosedOverride ? (
                <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
                  Need to override blackout restrictions?{" "}
                  <button
                    type="button"
                    onClick={() => requestBlackoutOverride(dateKey)}
                    className="ml-2 rounded-full border border-amber-300 bg-white px-3 py-1 text-[11px] font-extrabold text-amber-800 hover:bg-amber-100"
                  >
                    Admin Override
                  </button>
                </div>
              ) : null}

              {!(isStaffMode ? closedForStaff : closed) && effectiveDuration && dateKey && (
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
                  <span className="font-extrabold text-zinc-900">
                    {effectiveDuration ? labelDuration(effectiveDuration) : "—"}
                  </span>
                </div>

                {activity === "Combo Package" && (
                  <div className="text-xs text-zinc-600">
                    Axe: <span className="font-semibold">{labelDuration(comboAxeDuration)}</span> • Duckpin:{" "}
                    <span className="font-semibold">{labelDuration(comboDuckpinDuration)}</span>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-600">Date</span>
                  <span className="font-extrabold text-zinc-900">{dateKey ? prettyDate(dateKey) : "—"}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-600">Time</span>
                  <span className="font-extrabold text-zinc-900">
                    {time && effectiveDuration ? selectedTimeRange : "—"}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-600">Party Size</span>
                  <span className="font-extrabold text-zinc-900">{partySize}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-600">Party Areas</span>
                  <span className="font-extrabold text-zinc-900">
                    {partyAreas.length ? partyAreas.join(", ") : "None"}
                  </span>
                </div>
                {partyAreas.length ? (
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-zinc-600">Party Area Duration</span>
                    <span className="font-extrabold text-zinc-900">{partyAreaDuration / 60} hr</span>
                  </div>
                ) : null}

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
                  className="h-11 rounded-2xl border border-zinc-200 px-4 text-sm font-semibold text-black outline-none focus:border-zinc-900"
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
                  className="h-11 rounded-2xl border border-zinc-200 px-4 text-sm font-semibold text-black outline-none focus:border-zinc-900"
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
                  className="h-11 rounded-2xl border border-zinc-200 px-4 text-sm font-semibold text-black outline-none focus:border-zinc-900"
                  name="phone"
                  id="phone"
                  inputMode="tel"
                />
              </div>
              <label className="mt-3 flex items-start gap-10 text-xs text-zinc-600">
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(e) => {
                    setConsentChecked(e.target.checked);
                    setSubmitError("");
                    setSubmitSuccess("");
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span style={{ marginLeft: 8 }}>
                  I consent to providing my email address and phone number for booking updates and future marketing
                  communications.
                </span>
              </label>

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
                {submitting ? "Starting checkout..." : isStaffMode ? "Pay With Card" : "Confirm Booking"}
              </button>

              {isStaffMode && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    disabled={!canConfirm}
                    onClick={() => {
                      setShowPaymentOptions(false);
                      setShowTerminalPanel(false);
                      setTerminalError("");
                      setCashModalOpen(true);
                    }}
                    className={cx(
                      "h-11 rounded-2xl border text-sm font-extrabold transition",
                      canConfirm
                        ? "border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-800"
                        : "border-zinc-200 bg-zinc-100 text-zinc-400"
                    )}
                  >
                    Pay With Cash
                  </button>
                  <button
                    type="button"
                    disabled={!canConfirm || submitting}
                    onClick={async () => {
                      setSubmitError("");
                      setSubmitSuccess("");
                      if (!activity || !effectiveDuration || !dateKey || !time) return;
                      if (startMin == null || endMin == null) return;
                      if (!pricing) return;
                      setSubmitting(true);
                      try {
                        const res = await fetch("/api/staff/bookings/payment-link", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          activity,
                          durationMinutes: effectiveDuration,
                          partySize,
                          dateKey,
                          startMin,
                          partyAreas,
                          partyAreaMinutes: partyAreas.length ? partyAreaDuration : undefined,
                          customerName: name.trim(),
                          customerEmail: email.trim(),
                          customerPhone: phone.trim(),
                            comboAxeMinutes: activity === "Combo Package" ? comboAxeDuration ?? undefined : undefined,
                            comboDuckpinMinutes: activity === "Combo Package" ? comboDuckpinDuration ?? undefined : undefined,
                            comboOrder: activity === "Combo Package" ? (comboFirst === "DUCKPIN" ? "DUCKPIN_FIRST" : "AXE_FIRST") : undefined,
                            promoCode: promoApplied?.code || "",
                            totalCentsOverride: discountedTotalCents,
                          }),
                        });
                        const json = await res.json().catch(() => ({}));
                        if (!res.ok) {
                          setSubmitError(json?.error || "Failed to send payment link.");
                          return;
                        }
                        setSubmitSuccess("Payment link sent to the customer.");
                      } catch (e: any) {
                        setSubmitError(e?.message || "Failed to send payment link.");
                      } finally {
                        setSubmitting(false);
                      }
                    }}
                    className={cx(
                      "h-11 rounded-2xl border text-sm font-extrabold transition",
                      canConfirm
                        ? "border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-800"
                        : "border-zinc-200 bg-zinc-100 text-zinc-400"
                    )}
                  >
                    Send Payment Link
                  </button>
                </div>
              )}

              {isStaffMode && showTerminalPanel ? (
                <button
                  type="button"
                  onClick={handleCancelTerminalPayment}
                  className="mt-3 h-10 w-full rounded-2xl border border-red-200 bg-white text-xs font-extrabold text-red-700 hover:bg-red-50"
                >
                  Cancel Card Payment
                </button>
              ) : null}

              {!canConfirm && !submitting && (
                <div className="mt-2 text-xs text-zinc-500">
                  Complete activity, duration, date, time, and customer info to enable confirmation.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 text-xs text-zinc-500">Note: This saves bookings + resource reservations in Supabase now.</div>
      </div>

      {cashModalOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              data-booking-overlay
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 2147483647,
                background: "rgba(0,0,0,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "16px",
              }}
              onClick={(e) => {
                if (e.target === e.currentTarget) closeCashModal();
              }}
            >
              <div
                className="w-full max-w-4xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between">
                  <div className="text-lg font-semibold text-zinc-900">Cash Payment</div>
                  <button
                    type="button"
                    onClick={closeCashModal}
                    className="rounded-lg border border-zinc-200 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-50"
                  >
                    Close
                  </button>
                </div>

                <div className="mt-5 grid grid-cols-[1.1fr_1fr] gap-6">
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5">
                    <div className="text-xs font-semibold uppercase text-zinc-500">Total Due</div>
                    <div className="mt-2 text-3xl font-semibold text-zinc-900">
                      ${(discountedTotalCents / 100).toFixed(2)}
                    </div>

                    <div className="mt-6">
                      <label className="text-xs font-semibold uppercase text-zinc-500">Cash Given</label>
                      <input
                        ref={cashInputRef}
                        value={cashInput}
                        onChange={(e) => setCashInput(normalizeCashInput(e.target.value))}
                        inputMode="decimal"
                        className="mt-2 h-12 w-full rounded-xl border border-zinc-200 bg-white px-4 text-lg font-semibold"
                        placeholder="0.00"
                      />
                    </div>

                    <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                      <div className="text-xs font-semibold uppercase text-emerald-700">Change Due</div>
                      <div className="mt-2 text-4xl font-semibold text-emerald-700">
                        ${(changeDueCents / 100).toFixed(2)}
                      </div>
                    </div>

                    <div className="mt-6 grid grid-cols-5 gap-3">
                      {[5, 10, 20, 50, 100].map((amount) => (
                        <button
                          key={amount}
                          type="button"
                          onClick={() => setCashAmount(amount)}
                          className="rounded-xl border border-zinc-200 bg-white py-3 text-base font-semibold text-zinc-800 hover:bg-zinc-100"
                        >
                          ${amount}
                        </button>
                      ))}
                    </div>

                    {cashError ? <div className="mt-4 text-xs font-semibold text-red-600">{cashError}</div> : null}

                    <button
                      type="button"
                      onClick={submitCashPayment}
                      disabled={cashLoading || cashProvidedCents < discountedTotalCents}
                      className="mt-4 h-12 w-full rounded-xl border border-black bg-white text-base font-semibold text-black shadow-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {cashLoading ? "Recording…" : "Confirm Cash Payment"}
                    </button>
                  </div>

                  <div className="flex flex-col gap-4">
                    <button
                      type="button"
                      onClick={backspaceCashInput}
                      className="h-12 rounded-2xl border border-zinc-200 bg-white text-sm font-semibold text-zinc-700 shadow-sm hover:bg-zinc-50"
                    >
                      Backspace
                    </button>
                    <button
                      type="button"
                      onClick={() => setCashInput("0.00")}
                      className="h-12 rounded-2xl border border-zinc-200 bg-zinc-100 text-sm font-semibold text-zinc-700 hover:bg-zinc-200"
                    >
                      Clear
                    </button>
                    <div className="text-xs text-zinc-500">
                      Enter the amount using the hot buttons or type directly in the cash field.
                    </div>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {overrideTarget && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" data-booking-overlay>
              <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl">
                <div className="text-sm font-semibold text-zinc-900">Admin Override Required</div>
                <div className="mt-1 text-xs text-zinc-500">
                  Override requested for {prettyDate(overrideTarget.dateKey)}. Enter admin credentials to proceed.
                </div>
                <div className="mt-4 grid gap-3">
                  <label className="text-xs font-semibold text-zinc-600">
                    Admin Staff ID
                    <input
                      value={overrideStaffId}
                      onChange={(e) => setOverrideStaffId(e.target.value)}
                      className="mt-1 h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm"
                      placeholder="e.g. bda"
                      disabled={overrideLoading}
                    />
                  </label>
                  <label className="text-xs font-semibold text-zinc-600">
                    Admin PIN
                    <input
                      value={overridePin}
                      onChange={(e) => setOverridePin(e.target.value)}
                      type="password"
                      inputMode="numeric"
                      className="mt-1 h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm"
                      placeholder="4-digit PIN"
                      disabled={overrideLoading}
                    />
                  </label>
                  {overrideError ? <div className="text-xs text-red-600">{overrideError}</div> : null}
                </div>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setOverrideTarget(null)}
                    className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-semibold"
                    disabled={overrideLoading}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => submitClosedOverride()}
                    className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                    disabled={overrideLoading}
                  >
                    {overrideLoading ? "Verifying..." : "Approve Override"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {showConfirmation && confirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-booking-overlay>
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

      {showTerminalPanel ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" data-booking-overlay>
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
                onClick={() => {
                  setAutoStartTerminal(false);
                  handleTerminalPayment();
                }}
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
                onClick={handleCancelTerminalPayment}
                className="rounded-2xl border border-red-200 bg-white px-4 py-3 text-sm font-extrabold text-red-700 hover:bg-red-50"
              >
                Cancel Payment
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

export default function BookPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen">
          <div className="mx-auto max-w-5xl px-4 py-12">
            <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-[0_24px_60px_rgba(0,0,0,0.35)] backdrop-blur">
              <div className="public-muted text-sm font-semibold">Loading booking…</div>
            </div>
          </div>
        </div>
      }
    >
      <BookPageContent />
    </Suspense>
  );
}
