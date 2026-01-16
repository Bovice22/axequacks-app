"use client";

import { useEffect, useMemo, useState } from "react";
import { PARTY_AREA_OPTIONS, type PartyAreaName, partyAreaCostCents, totalCents } from "@/lib/bookingLogic";

const ACTIVITIES = ["Axe Throwing", "Duckpin Bowling"] as const;
const DURATIONS = [30, 60, 120] as const;

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

function getOpenWindowForDateKey(dateKey: string): { openMin: number; closeMin: number } | null {
  if (!dateKey) return null;
  const day = weekdayNY(dateKey);
  if (day === 4) return { openMin: 16 * 60, closeMin: 22 * 60 };
  if (day === 5) return { openMin: 16 * 60, closeMin: 23 * 60 };
  if (day === 6) return { openMin: 12 * 60, closeMin: 23 * 60 };
  if (day === 0) return { openMin: 12 * 60, closeMin: 21 * 60 };
  return null;
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
    <div className="rounded-2xl border border-zinc-200 bg-white p-4" style={{ width: 580, maxWidth: "100%" }}>
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

export default function HostEventPage() {
  const [selectedActivities, setSelectedActivities] = useState<Array<(typeof ACTIVITIES)[number]>>([]);
  const [durationByActivity, setDurationByActivity] = useState<Record<string, number>>({});
  const [partySize, setPartySize] = useState(10);
  const [partyAreas, setPartyAreas] = useState<PartyAreaName[]>([]);
  const [partyAreaMinutes, setPartyAreaMinutes] = useState<number | null>(null);
  const [partyAreaTiming, setPartyAreaTiming] = useState<"BEFORE" | "DURING" | "AFTER">("DURING");
  const [dateKey, setDateKey] = useState(() => todayDateKeyNY());
  const [startMin, setStartMin] = useState<number | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [blockedByActivity, setBlockedByActivity] = useState<Record<string, number[]>>({});
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [requestStatus, setRequestStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [requestMessage, setRequestMessage] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [promoApplied, setPromoApplied] = useState<{
    code: string;
    discountType: string;
    discountValue: number;
    amountOffCents: number;
    totalCents: number;
  } | null>(null);
  const [promoStatus, setPromoStatus] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);
  const [payInPerson, setPayInPerson] = useState(false);
  const [showRequestConfirmation, setShowRequestConfirmation] = useState(false);
  const [requestSummary, setRequestSummary] = useState<{
    dateKey: string;
    startMin: number | null;
    bookingWindowMinutes: number;
    activityDurationMinutes: number;
    partySize: number;
    activities: Array<{ activity: string; durationMinutes: number }>;
    partyAreas: string[];
    partyAreaDuration: number;
    partyAreaTiming: "BEFORE" | "DURING" | "AFTER";
    partyAreaStartMin?: number | null;
    partyAreaEndMin?: number | null;
    contactName: string;
    contactEmail: string;
    contactPhone: string;
    totalCents: number;
    promoCode?: string;
  } | null>(null);

  useEffect(() => {
    if (!partyAreas.length) {
      if (partyAreaMinutes != null) setPartyAreaMinutes(null);
      setPartyAreaTiming("DURING");
      return;
    }
    if (partyAreaMinutes == null || !Number.isFinite(partyAreaMinutes)) {
      setPartyAreaMinutes(60);
      return;
    }
    const clamped = Math.min(480, Math.max(60, Math.round(partyAreaMinutes / 60) * 60));
    if (clamped !== partyAreaMinutes) setPartyAreaMinutes(clamped);
  }, [partyAreas, partyAreaMinutes]);

  const totalDuration = useMemo(() => {
    return selectedActivities.reduce((sum, a) => sum + (durationByActivity[a] || 0), 0);
  }, [selectedActivities, durationByActivity]);
  const partyAreaDuration = partyAreas.length ? partyAreaMinutes ?? 60 : 0;
  const maxPartyAreaMinutes = Math.max(60, Math.floor(totalDuration / 60) * 60);
  const bookingWindowMinutes = Math.max(totalDuration, partyAreaDuration);

  const openWindow = useMemo(() => getOpenWindowForDateKey(dateKey), [dateKey]);
  const partyAreaWindow = useMemo(() => {
    if (!partyAreas.length || partyAreaDuration <= 0 || startMin == null) return null;
    const partyStart =
      partyAreaTiming === "BEFORE"
        ? startMin - partyAreaDuration
        : partyAreaTiming === "AFTER"
        ? startMin + totalDuration
        : startMin;
    return { startMin: partyStart, endMin: partyStart + partyAreaDuration };
  }, [partyAreas.length, partyAreaDuration, partyAreaTiming, startMin, totalDuration]);

  useEffect(() => {
    if (!openWindow || selectedActivities.length === 0 || totalDuration <= 0) {
      setBlockedByActivity({});
      setAvailabilityLoading(false);
      setAvailabilityError("");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setAvailabilityLoading(true);
    setAvailabilityError("");

    Promise.all(
      selectedActivities.map((activity) => {
        const durationMinutes = durationByActivity[activity] || 0;
        if (!durationMinutes) {
          return Promise.resolve({ activity, blockedStartMins: [] as number[] });
        }
          return fetch("/api/availability/event", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              activity,
              partySize,
              partyAreas,
              partyAreaMinutes: partyAreas.length ? partyAreaMinutes ?? 60 : undefined,
              partyAreaTiming: partyAreas.length ? partyAreaTiming : undefined,
              dateKey,
              durationMinutes,
              openStartMin: openWindow.openMin,
              openEndMin: openWindow.closeMin,
              slotIntervalMin: 30,
            }),
        })
          .then(async (res) => {
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
              const message = json?.error || "Availability check failed.";
              throw new Error(message);
            }
            return {
              activity,
              blockedStartMins: Array.isArray(json?.blockedStartMins) ? json.blockedStartMins : [],
            };
          });
      })
    )
      .then((results) => {
        if (cancelled) return;
        const next: Record<string, number[]> = {};
        results.forEach((r) => {
          next[r.activity] = r.blockedStartMins || [];
        });
        setBlockedByActivity(next);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setAvailabilityError(err?.message || "Unable to check availability.");
        setBlockedByActivity({});
      })
      .finally(() => {
        if (cancelled) return;
        setAvailabilityLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    selectedActivities,
    durationByActivity,
    partySize,
    partyAreas,
    partyAreaMinutes,
    partyAreaTiming,
    dateKey,
    openWindow,
    totalDuration,
  ]);

  const timeSlots = useMemo(() => {
    if (!openWindow || bookingWindowMinutes <= 0) return [];
    const lastStart = openWindow.closeMin - bookingWindowMinutes;
    if (lastStart < openWindow.openMin) return [];
    const slots: number[] = [];
    const nowMin = dateKey === todayDateKeyNY() ? nowMinutesNY() : -1;
    for (let m = openWindow.openMin; m <= lastStart; m += 30) {
      if (nowMin >= 0 && m < nowMin) continue;
      let offset = 0;
      let allowed = true;
      for (const activity of selectedActivities) {
        const duration = durationByActivity[activity] || 0;
        if (!duration) {
          allowed = false;
          break;
        }
        const blocked = new Set(blockedByActivity[activity] || []);
        if (blocked.has(m + offset)) {
          allowed = false;
          break;
        }
        offset += duration;
      }
      if (allowed) slots.push(m);
    }
    return slots;
  }, [openWindow, bookingWindowMinutes, selectedActivities, durationByActivity, blockedByActivity, dateKey]);

  const baseTotalCents = useMemo(() => {
    const activityTotal = selectedActivities.reduce((sum, a) => {
      const duration = durationByActivity[a] || 0;
      if (!duration) return sum;
      return sum + totalCents(a, partySize, duration);
    }, 0);
    return activityTotal + partyAreaCostCents(partyAreaDuration, partyAreas.length);
  }, [selectedActivities, durationByActivity, partySize, partyAreaDuration, partyAreas.length]);
  const discountedTotalCents = promoApplied?.totalCents ?? baseTotalCents;
  const discountCents = promoApplied?.amountOffCents ?? 0;

  const summary = useMemo(() => {
    const startLabel = startMin == null ? "—" : minutesToLabel(startMin);
    const endLabel = startMin == null ? "—" : minutesToLabel(startMin + bookingWindowMinutes);
    return {
      date: dateKey ? prettyDate(dateKey) : "—",
      time: startMin == null ? "—" : `${startLabel} – ${endLabel}`,
    };
  }, [dateKey, startMin, bookingWindowMinutes]);

  const canSubmitRequest =
    selectedActivities.length > 0 &&
    totalDuration > 0 &&
    !!dateKey &&
    startMin != null &&
    !(partyAreas.length && !partyAreaDuration) &&
    contactName.trim().length > 0 &&
    contactEmail.trim().length > 0;

  async function applyPromo(nextCode?: string) {
    const codeToApply = (nextCode ?? promoCode).trim();
    if (!codeToApply) {
      setPromoApplied(null);
      setPromoStatus("");
      return;
    }
    if (!baseTotalCents) {
      setPromoStatus("Select activities and duration first.");
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
          amount_cents: baseTotalCents,
          customer_email: contactEmail.trim(),
          activity: selectedActivities.length === 1 ? selectedActivities[0] : undefined,
          duration_minutes:
            selectedActivities.length === 1
              ? durationByActivity[selectedActivities[0]] || undefined
              : undefined,
          activities: selectedActivities.map((activity) => ({
            activity,
            durationMinutes: durationByActivity[activity] || 0,
          })),
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
        totalCents: json.total_cents ?? baseTotalCents,
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
    if (!promoApplied || !baseTotalCents) return;
    applyPromo(promoApplied.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseTotalCents]);

  const submitRequest = async () => {
    if (!canSubmitRequest || requestStatus === "submitting") return;
    setRequestStatus("submitting");
    setRequestMessage("");

    try {
      const res = await fetch("/api/event-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: contactName.trim(),
          customerEmail: contactEmail.trim(),
          customerPhone: contactPhone.trim(),
          partySize,
          partyAreas,
          partyAreaMinutes: partyAreas.length ? partyAreaMinutes ?? 60 : undefined,
          partyAreaTiming: partyAreas.length ? partyAreaTiming : undefined,
          dateKey,
          startMin,
          durationMinutes: totalDuration,
          activities: selectedActivities.map((activity) => ({
            activity,
            durationMinutes: durationByActivity[activity] || 0,
          })),
          totalCents: baseTotalCents,
          promoCode: promoApplied?.code || "",
          payInPerson,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Unable to submit request.");
      }

      setRequestStatus("success");
      setRequestMessage("Your Request Has Been Sent");
      setRequestSummary({
        dateKey,
        startMin,
        bookingWindowMinutes,
        activityDurationMinutes: totalDuration,
        partySize,
        activities: selectedActivities.map((activity) => ({
          activity,
          durationMinutes: durationByActivity[activity] || 0,
        })),
        partyAreas,
        partyAreaDuration,
        partyAreaTiming,
        partyAreaStartMin: partyAreaWindow?.startMin ?? null,
        partyAreaEndMin: partyAreaWindow?.endMin ?? null,
        contactName: contactName.trim(),
        contactEmail: contactEmail.trim(),
        contactPhone: contactPhone.trim(),
        totalCents: discountedTotalCents,
        promoCode: promoApplied?.code,
      });
      setShowRequestConfirmation(true);
      setSelectedActivities([]);
      setDurationByActivity({});
      setPartySize(10);
      setPartyAreas([]);
      setPartyAreaMinutes(null);
      setDateKey(todayDateKeyNY());
      setStartMin(null);
      setContactName("");
      setContactEmail("");
      setContactPhone("");
      setPromoCode("");
      setPromoApplied(null);
      setPromoStatus("");
      setBlockedByActivity({});
      setPayInPerson(false);
    } catch (err: any) {
      setRequestStatus("error");
      setRequestMessage(err?.message || "Unable to submit request.");
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-16 pt-10">
      <div className="mb-8 rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-[0_24px_60px_rgba(0,0,0,0.35)] backdrop-blur">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white p-2 shadow-[0_10px_24px_rgba(0,0,0,0.35)]">
            <img src="/logo.png?v=2" alt="Axe Quacks" className="h-12 w-12 object-contain" />
          </div>
          <div>
            <div className="public-display text-xs text-[#00AEEF]">Axe Quacks</div>
            <div className="mt-1 text-3xl font-extrabold text-white">Group Events</div>
            <div className="public-muted mt-2 text-sm">
              Build a custom event with multiple activities and see pricing update in real time.
            </div>
          </div>
          {requestStatus === "success" ? (
            <div className="ml-auto inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              {requestMessage}
            </div>
          ) : null}
        </div>
      </div>

      {showRequestConfirmation && requestStatus === "success" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 text-zinc-900 shadow-xl">
            <div className="text-lg font-extrabold">Event Request Sent</div>
            <div className="mt-1 text-sm text-zinc-600">
              We received your request and will follow up with payment and confirmation details.
            </div>
            <div className="mt-4 grid gap-3 text-sm">
              <div>
                <span className="font-semibold text-zinc-700">Date:</span>{" "}
                {requestSummary?.dateKey ? prettyDate(requestSummary.dateKey) : "—"}
              </div>
              <div>
                <span className="font-semibold text-zinc-700">Start/End:</span>{" "}
                {requestSummary?.startMin != null && requestSummary.bookingWindowMinutes
                  ? timeRangeLabel(requestSummary.startMin, requestSummary.bookingWindowMinutes)
                  : "—"}
              </div>
              {requestSummary?.partyAreas?.length ? (
                <div>
                  <span className="font-semibold text-zinc-700">Private Party Area:</span>{" "}
                  {requestSummary.partyAreaStartMin != null &&
                  requestSummary.partyAreaEndMin != null &&
                  requestSummary.partyAreaStartMin >= 0
                    ? timeRangeLabel(
                        requestSummary.partyAreaStartMin,
                        requestSummary.partyAreaEndMin - requestSummary.partyAreaStartMin
                      )
                    : "—"}
                </div>
              ) : null}
              <div>
                <span className="font-semibold text-zinc-700">Party Size:</span>{" "}
                {requestSummary?.partySize ?? partySize}
              </div>
              <div>
                <span className="font-semibold text-zinc-700">Activities:</span>{" "}
                {requestSummary?.activities?.length
                  ? requestSummary.activities
                      .map((item) => {
                        const mins = item.durationMinutes || 0;
                        return `${item.activity} (${mins ? `${mins} min` : "—"})`;
                      })
                      .join(", ")
                  : "—"}
              </div>
              <div>
                <span className="font-semibold text-zinc-700">Party Areas:</span>{" "}
                {requestSummary?.partyAreas?.length ? requestSummary.partyAreas.join(", ") : "None"}
              </div>
              {requestSummary?.partyAreas?.length ? (
                <div>
                  <span className="font-semibold text-zinc-700">Party Area Duration:</span>{" "}
                  {requestSummary.partyAreaDuration ? `${requestSummary.partyAreaDuration / 60} hr` : "—"}
                </div>
              ) : null}
              {requestSummary?.partyAreas?.length ? (
                <div>
                  <span className="font-semibold text-zinc-700">Party Area Timing:</span>{" "}
                  {requestSummary.partyAreaTiming === "BEFORE"
                    ? "Before Activities"
                    : requestSummary.partyAreaTiming === "AFTER"
                    ? "After Activities"
                    : "During Activities"}
                </div>
              ) : null}
              <div>
                <span className="font-semibold text-zinc-700">Contact:</span>{" "}
                {requestSummary?.contactName || "—"} • {requestSummary?.contactEmail || "—"} •{" "}
                {requestSummary?.contactPhone || "—"}
              </div>
              <div>
                <span className="font-semibold text-zinc-700">Total (est):</span>{" "}
                {requestSummary ? (requestSummary.totalCents / 100).toFixed(2) : "0.00"}
              </div>
              {requestSummary?.promoCode ? (
                <div>
                  <span className="font-semibold text-zinc-700">Promo:</span> {requestSummary.promoCode}
                </div>
              ) : null}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowRequestConfirmation(false)}
                className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-8">
        <div className="space-y-8">
          <section className="rounded-2xl border border-zinc-200 bg-white p-5">
            <div className="text-sm font-semibold text-zinc-800">1) Choose Activities</div>
            <div className="mt-3 flex flex-wrap gap-3">
              {ACTIVITIES.map((activity) => {
                const selected = selectedActivities.includes(activity);
                return (
                  <button
                    key={activity}
                    type="button"
                    onClick={() => {
                      const wasSelected = selectedActivities.includes(activity);
                      setSelectedActivities((prev) =>
                        wasSelected ? prev.filter((a) => a !== activity) : [...prev, activity]
                      );
                      setDurationByActivity((prev) => {
                        if (wasSelected) {
                          const { [activity]: _, ...rest } = prev;
                          return rest;
                        }
                        return prev[activity] ? prev : { ...prev, [activity]: 60 };
                      });
                      setStartMin(null);
                    }}
                    className={`rounded-2xl border px-4 py-2 text-sm font-extrabold transition ${
                      selected
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50"
                    }`}
                  >
                    {activity}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 rounded-2xl border border-zinc-100 bg-zinc-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-600">Duration</div>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                {ACTIVITIES.map((activity) => {
                  const isSelected = selectedActivities.includes(activity);
                  return (
                    <div key={activity} className="rounded-2xl border border-zinc-200 bg-white p-3">
                      <div className="inline-flex items-center rounded-full bg-zinc-900 px-3 py-1 text-xs font-semibold text-white">
                        {activity}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {DURATIONS.map((d) => {
                          const selected = durationByActivity[activity] === d;
                          return (
                            <button
                              key={d}
                              type="button"
                              disabled={!isSelected}
                              onClick={() => {
                                if (!isSelected) return;
                                setDurationByActivity((prev) => ({ ...prev, [activity]: d }));
                                setStartMin(null);
                              }}
                              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                                !isSelected
                                  ? "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400"
                                  : selected
                                  ? "border-zinc-900 bg-zinc-900 text-white"
                                  : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                              }`}
                            >
                              {d === 30 ? "30 Minutes" : d === 60 ? "1-Hour" : "2-Hours"}
                            </button>
                          );
                        })}
                      </div>
                      {!isSelected ? (
                        <div className="mt-2 text-[10px] text-zinc-400">Select this activity to choose a duration.</div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {selectedActivities.length === 0 ? (
                <div className="mt-3 text-xs text-zinc-500">Select one or more activities to continue.</div>
              ) : null}
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-5">
            <div className="text-sm font-semibold text-zinc-800">2) Private Party Areas (Optional)</div>
            <div className="mt-3 flex flex-wrap gap-3">
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
                      setStartMin(null);
                    }}
                    className={`rounded-2xl border px-4 py-2 text-sm font-extrabold transition ${
                      selected
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50"
                    }`}
                  >
                    {area.name}
                  </button>
                );
              })}
            </div>
            {partyAreas.length > 0 ? (
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
                          setStartMin(null);
                        }}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                          selected
                            ? "border-zinc-900 bg-zinc-900 text-white"
                            : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                        }`}
                      >
                        {mins / 60} hr
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1 text-xs text-zinc-500">$50 per hour • up to 8 hours</div>
                <div className="mt-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-600">Timing</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {([
                      { value: "BEFORE", label: "Before Activities" },
                      { value: "DURING", label: "During Activities" },
                      { value: "AFTER", label: "After Activities" },
                    ] as const).map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          setPartyAreaTiming(option.value);
                          setStartMin(null);
                        }}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                          partyAreaTiming === option.value
                            ? "border-zinc-900 bg-zinc-900 text-white"
                            : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-3 text-xs text-zinc-500">
                  {partyAreaWindow && partyAreaWindow.startMin >= 0
                    ? `Party area will be reserved ${timeRangeLabel(
                        partyAreaWindow.startMin,
                        partyAreaDuration
                      )}.`
                    : "Choose a start time that leaves room for the party area."}
                </div>
              </div>
            ) : null}
            <div className="mt-2 text-xs text-zinc-500">Add-on only. Event requests can proceed without a party area.</div>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-5">
            <div className="text-sm font-semibold text-zinc-800">3) Group Size</div>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setPartySize((p) => Math.max(1, p - 1))}
                className="h-10 w-10 rounded-2xl border border-zinc-200 bg-white text-lg font-extrabold text-black hover:bg-zinc-50"
              >
                −
              </button>
              <input
                type="number"
                min={1}
                max={100}
                value={partySize}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setPartySize(Math.max(1, Math.min(100, Number.isFinite(next) ? next : 1)));
                }}
                className="h-10 w-24 rounded-2xl border border-zinc-200 bg-white px-3 text-center text-sm font-extrabold text-zinc-900"
              />
              <button
                type="button"
                onClick={() => setPartySize((p) => Math.min(100, p + 1))}
                className="h-10 w-10 rounded-2xl border border-zinc-200 bg-white text-lg font-extrabold text-black hover:bg-zinc-50"
              >
                +
              </button>
              <div className="text-xs text-zinc-500">Max 100 guests</div>
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-5">
            <div className="text-sm font-semibold text-zinc-800">4) Contact Info</div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Full name"
                className="h-11 rounded-2xl border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-900"
              />
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="Email address"
                className="h-11 rounded-2xl border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-900"
              />
              <input
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="Phone (optional)"
                className="h-11 rounded-2xl border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-900 md:col-span-2"
              />
            </div>
            <label className="mt-4 flex items-center gap-2 text-xs font-semibold text-zinc-700">
              <input
                type="checkbox"
                checked={payInPerson}
                onChange={(e) => setPayInPerson(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 text-zinc-900"
              />
              Pay in person (reserve now, pay at the venue)
            </label>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-5">
            <div className="text-sm font-semibold text-zinc-800">5) Date & Time</div>
            <div className="mt-4 flex flex-col gap-4 md:flex-row">
              <div>
                <MonthCalendar selectedDateKey={dateKey} onSelectDateKey={(dk) => {
                  setDateKey(dk);
                  setStartMin(null);
                }} />

                <div className="mt-4">
                  {!openWindow ? (
                    <div className="text-xs text-zinc-500">Closed on selected day (Mon–Wed).</div>
                  ) : totalDuration <= 0 ? (
                    <div className="text-xs text-zinc-500">Select activities and durations to see time slots.</div>
                  ) : availabilityLoading ? (
                    <div className="text-xs text-zinc-500">Checking availability…</div>
                  ) : availabilityError ? (
                    <div className="text-xs text-red-600">{availabilityError}</div>
                  ) : timeSlots.length === 0 ? (
                    <div className="text-xs text-zinc-500">No time slots available for the selected durations.</div>
                  ) : (
                    <div>
                      <div className="mb-2 text-xs text-zinc-500">Select a start time</div>
                      <div className="flex flex-wrap gap-2">
                        {timeSlots.map((m) => {
                          const selected = startMin === m;
                          return (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setStartMin(m)}
                              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                                selected
                                  ? "border-zinc-900 bg-zinc-900 text-white"
                                  : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                              }`}
                            >
                              {timeRangeLabel(m, bookingWindowMinutes)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <aside className="w-full md:w-[42%] md:min-w-[320px] rounded-2xl border border-zinc-200 bg-white p-3">
                <button
                  type="button"
                  disabled={!canSubmitRequest || requestStatus === "submitting"}
                  onClick={submitRequest}
                  className="mb-3 w-full rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-extrabold text-white disabled:opacity-50"
                >
                  {requestStatus === "submitting" ? "Submitting..." : "Request Event"}
                </button>
                {requestStatus === "success" ? (
                  <div className="mb-2 text-xs font-semibold text-emerald-600">{requestMessage}</div>
                ) : null}
                {requestStatus === "error" ? (
                  <div className="mb-2 text-xs font-semibold text-red-600">{requestMessage}</div>
                ) : null}
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-600">Event Summary</div>
                <div className="mt-2 grid gap-1 text-[10px] leading-tight text-zinc-600">
                  <div>
                    <div className="text-[10px] text-zinc-500">Date</div>
                    <div className="font-semibold text-zinc-900">{summary.date}</div>
                  </div>
                  <div>
                          <div className="text-[10px] text-zinc-500">Time</div>
                          <div className="font-semibold text-zinc-900">{summary.time}</div>
                  </div>
                  <div>
                          <div className="text-[10px] text-zinc-500">Group Size</div>
                          <div className="font-semibold text-zinc-900">{partySize} guests</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-zinc-500">Party Areas</div>
                    <div className="font-semibold text-zinc-900">
                      {partyAreas.length ? partyAreas.join(", ") : "None"}
                    </div>
                  </div>
                  {partyAreas.length ? (
                    <div>
                      <div className="text-[10px] text-zinc-500">Party Area Duration</div>
                      <div className="font-semibold text-zinc-900">{partyAreaDuration / 60} hr</div>
                    </div>
                  ) : null}
                  <div>
                    <div className="text-[10px] text-zinc-500">Activities</div>
                    {selectedActivities.length === 0 ? (
                      <div className="text-zinc-500">No activities selected.</div>
                    ) : (
                      <div className="mt-1 space-y-1">
                        {selectedActivities.map((activity) => {
                          const duration = durationByActivity[activity] || 0;
                          const price = duration ? totalCents(activity, partySize, duration) : 0;
                          return (
                            <div key={activity} className="flex items-center justify-between gap-2">
                              <div>
                                <div className="text-[10px] font-semibold text-zinc-900">{activity}</div>
                                <div className="text-[10px] text-zinc-500">
                                  {duration ? `${duration} mins` : "Select duration"}
                                </div>
                              </div>
                              <div className="text-[10px] font-semibold text-zinc-900">
                                {duration ? `$${(price / 100).toFixed(2)}` : "—"}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-2">
                  <div className="text-[10px] text-zinc-500">Estimated Total</div>
                  <div className="mt-1 text-base font-extrabold text-zinc-900">
                    ${((discountedTotalCents || 0) / 100).toFixed(2)}
                  </div>
                  {promoApplied && discountCents > 0 ? (
                    <div className="mt-1 text-[10px] text-zinc-500">
                      Promo {promoApplied.code}: -${(discountCents / 100).toFixed(2)}
                    </div>
                  ) : null}
                  <div className="mt-1 text-[9px] text-zinc-500">
                    Final pricing may change based on staffing and resource availability.
                  </div>
                </div>
                <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">Promo Code</div>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      value={promoCode}
                      onChange={(e) => {
                        setPromoCode(e.target.value);
                        setPromoStatus("");
                      }}
                      placeholder="Enter code"
                      className="h-9 flex-1 rounded-lg border border-zinc-200 px-2 text-[10px] font-semibold text-zinc-700"
                    />
                    {promoApplied ? (
                      <button
                        type="button"
                        onClick={() => {
                          setPromoApplied(null);
                          setPromoStatus("");
                          setPromoCode("");
                        }}
                        className="h-9 rounded-lg border border-zinc-200 px-3 text-[10px] font-semibold text-zinc-700"
                      >
                        Remove
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => applyPromo()}
                        disabled={promoLoading || !promoCode.trim()}
                        className={`h-9 rounded-lg px-3 text-[10px] font-semibold ${
                          promoLoading || !promoCode.trim()
                            ? "bg-zinc-100 text-zinc-400"
                            : "bg-zinc-900 text-white"
                        }`}
                      >
                        {promoLoading ? "Checking..." : "Apply"}
                      </button>
                    )}
                  </div>
                  {promoStatus ? (
                    <div className="mt-2 text-[10px] font-semibold text-zinc-600">{promoStatus}</div>
                  ) : null}
                </div>
              </aside>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
