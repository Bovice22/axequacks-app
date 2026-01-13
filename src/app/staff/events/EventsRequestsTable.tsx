"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadStripeTerminal, type Reader, type Terminal } from "@stripe/terminal-js";

type EventRequest = {
  id: string;
  created_at?: string;
  status?: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string | null;
  party_size?: number;
  date_key?: string;
  start_min?: number;
  duration_minutes?: number;
  total_cents?: number;
  activities?: Array<{ activity: string; durationMinutes: number }>;
  party_areas?: string[] | null;
  party_area_minutes?: number | null;
  booking_ids?: string[] | null;
  payment_link_url?: string | null;
  payment_link_sent_at?: string | null;
  payment_status?: string | null;
  paid_at?: string | null;
  declined_at?: string | null;
  pay_in_person?: boolean | null;
};

function todayDateKeyNY(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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

function minutesToLabel(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function prettyDate(dateKey?: string) {
  if (!dateKey) return "—";
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function EventsRequestsTable() {
  const [requests, setRequests] = useState<EventRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [sendingPaymentId, setSendingPaymentId] = useState<string | null>(null);
  const [payingRequest, setPayingRequest] = useState<EventRequest | null>(null);
  const [terminalReaders, setTerminalReaders] = useState<Reader[]>([]);
  const [selectedReaderId, setSelectedReaderId] = useState("");
  const [terminalLoading, setTerminalLoading] = useState(false);
  const [terminalError, setTerminalError] = useState("");
  const terminalRef = useRef<Terminal | null>(null);
  const terminalReadyRef = useRef(false);
  const [rescheduleRequest, setRescheduleRequest] = useState<EventRequest | null>(null);
  const [rescheduleDateKey, setRescheduleDateKey] = useState("");
  const [rescheduleStartMin, setRescheduleStartMin] = useState<number | null>(null);
  const [reschedulePartySize, setReschedulePartySize] = useState<number>(1);
  const [rescheduleBlockedByActivity, setRescheduleBlockedByActivity] = useState<Record<string, number[]>>({});
  const [rescheduleLoading, setRescheduleLoading] = useState(false);
  const [rescheduleError, setRescheduleError] = useState("");
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const node = document.createElement("div");
    node.setAttribute("data-events-modal-root", "true");
    document.body.appendChild(node);
    setPortalRoot(node);
    return () => {
      document.body.removeChild(node);
    };
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    fetch("/api/staff/event-requests", { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        setRequests(Array.isArray(json?.requests) ? json.requests : []);
      })
      .catch(() => setError("Unable to load event requests."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (terminalReadyRef.current) return;
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
  }, []);

  const sorted = useMemo(() => {
    return [...requests].sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bTime - aTime;
    });
  }, [requests]);

  const acceptRequest = async (id: string) => {
    if (acceptingId || decliningId) return;
    setAcceptingId(id);
    try {
      const res = await fetch(`/api/staff/event-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      });
      if (!res.ok) {
        const raw = await res.text();
        let detail = "";
        try {
          const parsed = JSON.parse(raw || "{}");
          detail = parsed?.detail || parsed?.error || "";
        } catch {
          detail = raw;
        }
        throw new Error(detail || "Unable to accept request.");
      }
      load();
    } catch (err: any) {
      setError(err?.message || "Unable to accept request.");
    } finally {
      setAcceptingId(null);
    }
  };

  const declineRequest = async (id: string) => {
    if (acceptingId || decliningId) return;
    setDecliningId(id);
    try {
      const res = await fetch(`/api/staff/event-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decline" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Unable to decline request.");
      }
      load();
    } catch (err: any) {
      setError(err?.message || "Unable to decline request.");
    } finally {
      setDecliningId(null);
    }
  };

  const sendPaymentLink = async (id: string) => {
    if (sendingPaymentId) return;
    setSendingPaymentId(id);
    try {
      const res = await fetch(`/api/staff/event-requests/${id}/payment-link`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Unable to send payment link.");
      }
      load();
    } catch (err: any) {
      setError(err?.message || "Unable to send payment link.");
    } finally {
      setSendingPaymentId(null);
    }
  };

  const loadReaders = async () => {
    try {
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
  };

  const openPayNow = (req: EventRequest) => {
    setPayingRequest(req);
    setTerminalError("");
    setTerminalLoading(false);
    loadReaders();
  };

  const closePayNow = () => {
    setPayingRequest(null);
    setTerminalError("");
  };

  const handlePayNow = async () => {
    if (!payingRequest) return;
    if (!terminalRef.current) {
      setTerminalError("Stripe Terminal not initialized.");
      return;
    }
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
      if ("error" in connectResult && connectResult.error) {
        setTerminalError(connectResult.error.message || "Failed to connect reader.");
        return;
      }

      const intentRes = await fetch("/api/stripe/terminal/event_payment_intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_request_id: payingRequest.id }),
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

      const finalizeRes = await fetch("/api/stripe/terminal/event_finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_intent_id: paymentIntentId }),
      });
      const finalizeJson = await finalizeRes.json().catch(() => ({}));
      if (!finalizeRes.ok) {
        setTerminalError(finalizeJson?.error || "Payment succeeded but request update failed.");
        return;
      }

      closePayNow();
      load();
    } catch (err: any) {
      setTerminalError(err?.message || "Terminal payment failed.");
    } finally {
      setTerminalLoading(false);
    }
  };

  const openReschedule = (req: EventRequest) => {
    setRescheduleRequest(req);
    setRescheduleDateKey(req.date_key || todayDateKeyNY());
    setRescheduleStartMin(Number.isFinite(Number(req.start_min)) ? Number(req.start_min) : null);
    setReschedulePartySize(Math.max(1, Math.min(100, Number(req.party_size || 1))));
    setRescheduleBlockedByActivity({});
    setRescheduleError("");
  };

  const closeReschedule = () => {
    setRescheduleRequest(null);
    setRescheduleDateKey("");
    setRescheduleStartMin(null);
    setReschedulePartySize(1);
    setRescheduleBlockedByActivity({});
    setRescheduleError("");
  };

  const submitReschedule = async () => {
    if (!rescheduleRequest || !rescheduleDateKey || rescheduleStartMin == null) return;
    setRescheduleLoading(true);
    setRescheduleError("");
    try {
      const res = await fetch(`/api/staff/event-requests/${rescheduleRequest.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reschedule",
          dateKey: rescheduleDateKey,
          startMin: rescheduleStartMin,
          partySize: reschedulePartySize,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Unable to reschedule request.");
      }
      closeReschedule();
      load();
    } catch (err: any) {
      setRescheduleError(err?.message || "Unable to reschedule request.");
    } finally {
      setRescheduleLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold text-zinc-800">Event Requests</div>
        <button
          type="button"
          onClick={load}
          className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
        >
          Refresh
        </button>
      </div>

      {error ? <div className="mb-3 text-xs font-semibold text-red-600">{error}</div> : null}
      {loading ? (
        <div className="text-xs text-zinc-500">Loading requests…</div>
      ) : sorted.length === 0 ? (
        <div className="text-xs text-zinc-500">No event requests yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-center text-xs">
            <thead className="text-[11px] uppercase text-zinc-500">
              <tr>
                <th className="px-2 py-2">Requested</th>
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2">Time</th>
                <th className="px-2 py-2">Party</th>
                <th className="px-2 py-2">Contact</th>
                <th className="px-2 py-2">Activities</th>
                <th className="px-2 py-2">Total</th>
                <th className="px-2 py-2">Payment</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="text-zinc-700">
              {sorted.map((req) => {
                const startMin = Number(req.start_min || 0);
                const duration = Number(req.duration_minutes || 0);
                const timeLabel =
                  duration > 0 ? `${minutesToLabel(startMin)} – ${minutesToLabel(startMin + duration)}` : "—";
                const totalLabel =
                  typeof req.total_cents === "number" ? `$${(req.total_cents / 100).toFixed(2)}` : "—";
                const status = String(req.status || "PENDING").replace(/\s+/g, "_").toUpperCase();
                const paymentStatus = String(req.payment_status || "UNPAID").replace(/\s+/g, "").toUpperCase();
                const payInPerson = Boolean(req.pay_in_person);
                const isPaid = paymentStatus === "PAID";
                const paymentLabel = payInPerson ? "PAY IN PERSON" : paymentStatus;
                const canSendPaymentLink = status.startsWith("ACCEPT") && !isPaid && !payInPerson;
                const canReschedule = status.startsWith("ACCEPT") && (isPaid || payInPerson);
                const canPayNow = status.startsWith("ACCEPT") && payInPerson && !isPaid;
                return (
                  <tr key={req.id} className="border-t border-zinc-100">
                    <td className="px-2 py-3 text-zinc-500">
                      {req.created_at ? new Date(req.created_at).toLocaleString("en-US") : "—"}
                    </td>
                    <td className="px-2 py-3">{prettyDate(req.date_key)}</td>
                    <td className="px-2 py-3">{timeLabel}</td>
                    <td className="px-2 py-3">{req.party_size ?? "—"}</td>
                    <td className="px-2 py-3">
                      <div className="font-semibold text-zinc-900">{req.customer_name || "—"}</div>
                      <div className="text-zinc-500">{req.customer_email || "—"}</div>
                      {req.customer_phone ? <div className="text-zinc-500">{req.customer_phone}</div> : null}
                    </td>
                    <td className="px-2 py-3">
                      {Array.isArray(req.activities) && req.activities.length ? (
                        <div className="space-y-1">
                          {req.activities.map((a, idx) => (
                            <div key={`${req.id}-${idx}`} className="text-zinc-600">
                              {a.activity} · {a.durationMinutes} mins
                            </div>
                          ))}
                          {Array.isArray(req.party_areas) && req.party_areas.length ? (
                            <div className="text-[10px] font-semibold text-emerald-700">
                              Party areas: {req.party_areas.join(", ")}
                              {req.party_area_minutes ? ` · ${Math.round(req.party_area_minutes / 60)} hr` : ""}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2 py-3 font-semibold text-zinc-900">{totalLabel}</td>
                    <td className="px-2 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                          payInPerson
                            ? "bg-amber-50 text-amber-700"
                            : paymentStatus === "PAID"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-zinc-100 text-zinc-700"
                        }`}
                      >
                        {paymentLabel}
                      </span>
                    </td>
                    <td className="px-2 py-3">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                        status.startsWith("ACCEPT")
                          ? "bg-emerald-50 text-emerald-700"
                          : status === "PENDING"
                          ? "bg-zinc-100 text-zinc-700"
                          : "bg-amber-50 text-amber-700"
                      }`}>
                        {status}
                      </span>
                      {status.startsWith("ACCEPT") && req.payment_link_sent_at ? (
                        <div className="mt-1 text-[10px] text-zinc-400">Payment link sent</div>
                      ) : null}
                    </td>
                    <td className="px-2 py-3">
                      {status === "PENDING" ? (
                        <div className="grid min-w-[120px] place-items-center gap-2">
                          <div className="text-[9px] text-zinc-400">status={status}</div>
                          <button
                            type="button"
                            onClick={() => acceptRequest(req.id)}
                            className="w-full rounded-full px-3 py-1 text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
                            style={{
                              backgroundColor: "#16a34a",
                              color: "#ffffff",
                              border: "1px solid #15803d",
                              opacity: 1,
                            }}
                            disabled={acceptingId === req.id || decliningId === req.id}
                          >
                            {acceptingId === req.id ? "Accepting..." : "Accept"}
                          </button>
                          <button
                            type="button"
                            onClick={() => declineRequest(req.id)}
                            className="w-full rounded-full border border-red-200 bg-white px-3 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
                            disabled={acceptingId === req.id || decliningId === req.id}
                          >
                            {decliningId === req.id ? "Declining..." : "Decline"}
                          </button>
                        </div>
                      ) : status.startsWith("ACCEPT") ? (
                        <div className="flex flex-col items-center gap-2">
                          {canSendPaymentLink ? (
                            <button
                              type="button"
                              onClick={() => sendPaymentLink(req.id)}
                              className="w-full rounded-full px-3 py-1 text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
                              style={{
                                backgroundColor: "#2563eb",
                                color: "#ffffff",
                                border: "1px solid #1d4ed8",
                                opacity: 1,
                              }}
                              disabled={sendingPaymentId === req.id}
                            >
                              {sendingPaymentId === req.id ? "Sending..." : "Send Payment Link"}
                            </button>
                          ) : null}
                          {canPayNow ? (
                            <button
                              type="button"
                              onClick={() => openPayNow(req)}
                              className="w-full rounded-full px-3 py-1 text-[11px] font-semibold text-white hover:opacity-90"
                              style={{
                                backgroundColor: "#7c3aed",
                                color: "#ffffff",
                                border: "1px solid #6d28d9",
                              }}
                            >
                              Pay Now
                            </button>
                          ) : null}
                          {canReschedule ? (
                            <button
                              type="button"
                              onClick={() => openReschedule(req)}
                              className="w-full rounded-full px-3 py-1 text-[11px] font-semibold text-white hover:opacity-90"
                              style={{
                                backgroundColor: "#16a34a",
                                color: "#ffffff",
                                border: "1px solid #15803d",
                              }}
                            >
                              Reschedule
                            </button>
                          ) : null}
                          <span className="text-[10px] text-zinc-400">
                            {req.booking_ids?.length ? "Scheduled" : "Accepted"}
                          </span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1 text-[10px] text-zinc-400">
                          <span>Processed</span>
                          <span>status={status}</span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rescheduleRequest && portalRoot
        ? createPortal(
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0, 0, 0, 0.6)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "16px",
                zIndex: 2147483647,
                pointerEvents: "auto",
              }}
            >
              <div
                style={{
                  width: "100%",
                  maxWidth: "520px",
                  background: "#ffffff",
                  borderRadius: "16px",
                  border: "1px solid #e5e7eb",
                  padding: "16px",
                  boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
                }}
              >
                <div className="mb-2 text-sm font-semibold text-zinc-900">Reschedule Event</div>
                <div className="text-xs text-zinc-500">Select a new date and start time for this event.</div>

                <div className="mt-4 space-y-3">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={reschedulePartySize}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setReschedulePartySize(Math.max(1, Math.min(100, Number.isFinite(next) ? next : 1)));
                    }}
                    className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm"
                    placeholder="Group size"
                  />
                  <input
                    type="date"
                    value={rescheduleDateKey}
                    onChange={(e) => {
                      setRescheduleDateKey(e.target.value);
                      setRescheduleStartMin(null);
                    }}
                    className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm"
                  />

                  {rescheduleError ? (
                    <div className="text-xs font-semibold text-red-600">{rescheduleError}</div>
                  ) : null}
                  <RescheduleTimes
                    request={rescheduleRequest}
                    dateKey={rescheduleDateKey}
                    startMin={rescheduleStartMin}
                    setStartMin={setRescheduleStartMin}
                    partySize={reschedulePartySize}
                    blockedByActivity={rescheduleBlockedByActivity}
                    setBlockedByActivity={setRescheduleBlockedByActivity}
                    setError={setRescheduleError}
                  />
                </div>

                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeReschedule}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submitReschedule}
                    disabled={rescheduleLoading || rescheduleStartMin == null}
                    className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    {rescheduleLoading ? "Saving..." : "Save New Time"}
                  </button>
                </div>
              </div>
            </div>,
            portalRoot
          )
        : null}

      {payingRequest && portalRoot
        ? createPortal(
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0, 0, 0, 0.6)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "16px",
                zIndex: 2147483647,
                pointerEvents: "auto",
              }}
            >
              <div
                style={{
                  width: "100%",
                  maxWidth: "520px",
                  background: "#ffffff",
                  borderRadius: "16px",
                  border: "1px solid #e5e7eb",
                  padding: "16px",
                  boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
                }}
              >
                <div className="text-sm font-semibold text-zinc-900">Pay In Person</div>
                <div className="mt-1 text-xs text-zinc-500">Select a reader, then collect payment.</div>

                <div className="mt-4 grid gap-2">
                  <label className="text-[11px] font-semibold text-zinc-500">Reader</label>
                  <select
                    value={selectedReaderId}
                    onChange={(e) => setSelectedReaderId(e.target.value)}
                    className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-900"
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

                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={closePayNow}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handlePayNow}
                    disabled={terminalLoading}
                    className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    {terminalLoading ? "Processing..." : "Collect Payment"}
                  </button>
                </div>
              </div>
            </div>,
            portalRoot
          )
        : null}
    </div>
  );
}

function RescheduleTimes(props: {
  request: EventRequest;
  dateKey: string;
  startMin: number | null;
  setStartMin: (value: number | null) => void;
  partySize: number;
  blockedByActivity: Record<string, number[]>;
  setBlockedByActivity: (value: Record<string, number[]>) => void;
  setError: (value: string) => void;
}) {
  const { request, dateKey, startMin, setStartMin, partySize, blockedByActivity, setBlockedByActivity, setError } = props;
  const activities = Array.isArray(request.activities) ? request.activities : [];
  const totalDuration = activities.reduce((sum, a) => sum + (Number(a?.durationMinutes) || 0), 0);
  const openWindow = useMemo(() => getOpenWindowForDateKey(dateKey), [dateKey]);

  useEffect(() => {
    if (!openWindow || activities.length === 0 || totalDuration <= 0 || !dateKey) {
      setBlockedByActivity({});
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setError("");

    Promise.all(
      activities.map((activityItem: any) => {
        const activity = String(activityItem?.activity || "");
        const durationMinutes = Number(activityItem?.durationMinutes || 0);
        if (!activity || !durationMinutes) {
          return Promise.resolve({ activity, blockedStartMins: [] as number[] });
        }
        return fetch("/api/availability/event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            activity,
            partySize: Number(partySize || 1),
            dateKey,
            durationMinutes,
            openStartMin: openWindow.openMin,
            openEndMin: openWindow.closeMin,
            slotIntervalMin: 30,
          }),
        })
          .then((res) => res.json())
          .then((json) => ({
            activity,
            blockedStartMins: Array.isArray(json?.blockedStartMins) ? json.blockedStartMins : [],
          }));
      })
    )
      .then((results) => {
        if (cancelled) return;
        const next: Record<string, number[]> = {};
        results.forEach((r) => {
          if (r.activity) next[r.activity] = r.blockedStartMins || [];
        });
        setBlockedByActivity(next);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Unable to check availability.");
        setBlockedByActivity({});
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activities, dateKey, openWindow, request.party_size, setBlockedByActivity, setError, totalDuration]);

  const timeSlots = useMemo(() => {
    if (!openWindow || totalDuration <= 0) return [];
    const lastStart = openWindow.closeMin - totalDuration;
    if (lastStart < openWindow.openMin) return [];
    const slots: number[] = [];
    const nowMin = dateKey === todayDateKeyNY() ? nowMinutesNY() : -1;
    for (let m = openWindow.openMin; m <= lastStart; m += 30) {
      if (nowMin >= 0 && m < nowMin) continue;
      let offset = 0;
      let allowed = true;
      for (const activityItem of activities) {
        const activity = String(activityItem?.activity || "");
        const duration = Number(activityItem?.durationMinutes || 0);
        if (!activity || !duration) {
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
  }, [activities, blockedByActivity, dateKey, openWindow, totalDuration]);

  if (!openWindow) {
    return <div className="text-xs text-zinc-500">Closed on selected day (Mon–Wed).</div>;
  }

  if (!activities.length || totalDuration <= 0) {
    return <div className="text-xs text-zinc-500">No activities selected.</div>;
  }

  if (timeSlots.length === 0) {
    return <div className="text-xs text-zinc-500">No available time slots.</div>;
  }

  return (
    <div>
      <div className="mb-2 text-xs text-zinc-500">Select a new start time</div>
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
              {minutesToLabel(m)} – {minutesToLabel(m + totalDuration)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
