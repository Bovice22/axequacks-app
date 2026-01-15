"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type Confirmation = {
  activity: string;
  dateKey: string;
  timeLabel: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  resourceNames: string[];
  comboOrder?: "DUCKPIN_FIRST" | "AXE_FIRST";
  waiverUrl?: string;
  bookingId?: string;
  partySize?: number;
  startMin?: number;
  durationMinutes?: number;
  totalCents?: number;
};

function fromDateKey(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function prettyDate(dateKey: string) {
  if (!dateKey) return "—";
  const d = fromDateKey(dateKey);
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function formatTimeFromMinutes(minsFromMidnight: number) {
  const h24 = Math.floor(minsFromMidnight / 60);
  const m = minsFromMidnight % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function needsWaiver(activity: string) {
  const normalized = String(activity || "").toUpperCase();
  return normalized.includes("AXE") || normalized.includes("COMBO");
}

function BookingConfirmationContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  const returnPath = sessionId ? `/book/confirmation?session_id=${encodeURIComponent(sessionId)}` : "";

  useEffect(() => {
    if (!sessionId) {
      setError("Missing checkout session.");
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const finalizeRes = await fetch(`/api/stripe/checkout/finalize?session_id=${sessionId}`, { method: "POST" });
        const finalizeJson = await finalizeRes.json().catch(() => ({}));
        if (!finalizeRes.ok) {
          setError(finalizeJson?.error || "Failed to finalize booking.");
          setLoading(false);
          return;
        }

        const res = await fetch(`/api/stripe/checkout/session?session_id=${sessionId}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(json?.error || "Failed to load checkout details.");
          setLoading(false);
          return;
        }

        const meta = json?.metadata || {};
        const activity = String(meta.activity || "");
        const dateKey = String(meta.date_key || "");
        const startMin = Number(meta.start_min);
        const durationMinutes = Number(meta.duration_minutes);
        const comboOrder =
          activity === "Combo Package"
            ? ((meta.combo_order as "DUCKPIN_FIRST" | "AXE_FIRST") || undefined)
            : undefined;

        if (!activity || !dateKey || !Number.isFinite(startMin) || !Number.isFinite(durationMinutes)) {
          setError("Missing booking details from checkout.");
          setLoading(false);
          return;
        }

        const timeLabel = `${formatTimeFromMinutes(startMin)} – ${formatTimeFromMinutes(startMin + durationMinutes)}`;
        const totalBefore = Number(meta.total_before_discount);
        const discountAmount = Number(meta.discount_amount);
        const sessionTotal = Number(json?.session?.amount_total);
        const totalCents =
          Number.isFinite(totalBefore) && Number.isFinite(discountAmount)
            ? Math.max(0, totalBefore - discountAmount)
            : Number.isFinite(sessionTotal)
            ? sessionTotal
            : undefined;
        const resources = Array.isArray(finalizeJson?.resources) ? finalizeJson.resources : [];

        const bookingId = String(finalizeJson?.bookingId || "");
        let waiverUrl = String(finalizeJson?.waiverUrl || "");
        if (waiverUrl) {
          const url = new URL(waiverUrl);
          if (bookingId && !url.searchParams.get("booking_id")) {
            url.searchParams.set("booking_id", bookingId);
          }
          if (returnPath) {
            url.searchParams.set("return", returnPath);
          }
          waiverUrl = url.toString();
        }

        setConfirmation({
          activity,
          dateKey,
          timeLabel,
          customerName: String(meta.customer_name || ""),
          customerEmail: String(meta.customer_email || ""),
          customerPhone: String(meta.customer_phone || ""),
          resourceNames: resources,
          comboOrder,
          waiverUrl,
          bookingId,
          partySize: Number(meta.party_size),
          startMin,
          durationMinutes,
          totalCents,
        });
      } catch (err: any) {
        setError(err?.message || "Failed to load confirmation.");
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId]);

  useEffect(() => {
    if (!confirmation) return;
    if (confirmation.waiverUrl) return;
    if (!needsWaiver(confirmation.activity)) return;
    if (!confirmation.bookingId) return;

    (async () => {
      try {
        const res = await fetch("/api/waivers/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bookingId: confirmation.bookingId,
            activity: confirmation.activity,
            partySize: confirmation.partySize ?? 1,
            dateKey: confirmation.dateKey,
            startMin: confirmation.startMin ?? 0,
            durationMinutes: confirmation.durationMinutes ?? 60,
            customerName: confirmation.customerName,
            customerEmail: confirmation.customerEmail,
            customerPhone: confirmation.customerPhone,
            comboOrder: confirmation.comboOrder,
            returnPath,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json?.waiverUrl) {
          setConfirmation((prev) => (prev ? { ...prev, waiverUrl: String(json.waiverUrl) } : prev));
        }
      } catch (err) {
        console.error("waiver request failed:", err);
      }
    })();
  }, [confirmation]);

  useEffect(() => {
    if (!confirmation?.waiverUrl) return;
    setRedirecting(true);
    const timer = setTimeout(() => {
      window.location.href = confirmation.waiverUrl as string;
    }, 5000);
    return () => clearTimeout(timer);
  }, [confirmation?.waiverUrl]);

  return (
    <div className="min-h-screen pb-12">
      <div className="mx-auto max-w-xl px-4 py-12">
        <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-[0_24px_60px_rgba(0,0,0,0.35)] backdrop-blur">
          <div className="mb-4 flex justify-center">
            <img src="/logo.png" alt="Axe Quacks" className="h-20 w-auto" />
          </div>
          <div className="text-2xl font-extrabold text-white">Thanks for booking at Axe Quacks!</div>
          <div className="public-muted mt-2 text-sm">Here are your booking details:</div>

          {loading && <div className="public-muted mt-6 text-sm font-semibold">Loading confirmation…</div>}

          {!loading && error && (
            <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {error}
            </div>
          )}

          {!loading && confirmation && (
            <div className="mt-6 space-y-2 text-sm text-white">
              <div>
                <span className="font-semibold text-white/80">Name:</span> {confirmation.customerName || "—"}
              </div>
              {confirmation.activity === "Combo Package" && confirmation.comboOrder ? (
                <div>
                  <span className="font-semibold text-white/80">Combo Order:</span>{" "}
                  {confirmation.comboOrder === "DUCKPIN_FIRST"
                    ? "First: Duckpin Bowling, Second: Axe Throwing"
                    : "First: Axe Throwing, Second: Duckpin Bowling"}
                </div>
              ) : null}
              <div>
                <span className="font-semibold text-white/80">Activity:</span> {confirmation.activity}
              </div>
              <div>
                <span className="font-semibold text-white/80">Date:</span> {prettyDate(confirmation.dateKey)}
              </div>
              <div>
                <span className="font-semibold text-white/80">Start/End Time:</span> {confirmation.timeLabel}
              </div>
              <div>
                <span className="font-semibold text-white/80">Resource:</span>{" "}
                {confirmation.resourceNames.length ? confirmation.resourceNames.join(", ") : "TBD"}
              </div>
              <div>
                <span className="font-semibold text-white/80">Amount:</span>{" "}
                {typeof confirmation.totalCents === "number"
                  ? `$${(confirmation.totalCents / 100).toFixed(2)} PAID`
                  : "—"}
              </div>
              <div>
                <span className="font-semibold text-white/80">Email:</span> {confirmation.customerEmail || "—"}
              </div>
              {confirmation.waiverUrl ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Waiver required for this booking. We’ll redirect you to the waiver in 5 seconds.
                  <div className="mt-1">
                    <a className="font-semibold underline" href={confirmation.waiverUrl}>
                      Sign waiver now
                    </a>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/book" className="inline-flex">
              <div
                className="bg-[#FFD700] px-5 text-sm font-extrabold text-black hover:bg-[#ffe24a]"
                style={{ width: "160px", height: "44px", borderRadius: "9999px", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}
              >
                Done
              </div>
            </Link>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex border border-white/30 bg-white/10 px-5 text-sm font-extrabold text-white hover:bg-white/20"
              style={{ width: "160px", height: "44px", borderRadius: "16px", alignItems: "center", justifyContent: "center" }}
            >
              Print Receipt
            </button>
            {redirecting ? <div className="public-muted mt-2 text-xs">Redirecting to waiver…</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BookingConfirmationPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen">
          <div className="mx-auto max-w-xl px-4 py-12">
            <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-[0_24px_60px_rgba(0,0,0,0.35)] backdrop-blur">
              <div className="public-muted text-sm font-semibold">Loading confirmation…</div>
            </div>
          </div>
        </div>
      }
    >
      <BookingConfirmationContent />
    </Suspense>
  );
}
