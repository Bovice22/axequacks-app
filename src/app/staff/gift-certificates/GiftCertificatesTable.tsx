"use client";

import { useEffect, useState } from "react";

type GiftCertificate = {
  id: string;
  code: string;
  original_amount_cents: number;
  balance_cents: number;
  status: string;
  expires_at: string;
  created_at: string;
  customers?: { full_name?: string | null; email?: string | null } | null;
};

function formatMoney(cents: number) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function GiftCertificatesTable() {
  const [rows, setRows] = useState<GiftCertificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createError, setCreateError] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [customerEmail, setCustomerEmail] = useState("");
  const [amountDollars, setAmountDollars] = useState("50");

  async function loadCertificates() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/staff/gift-certificates", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || "Failed to load gift certificates.");
        return;
      }
      setRows(json?.certificates || []);
    } catch (err: any) {
      setError(err?.message || "Failed to load gift certificates.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCertificates();
  }, []);

  async function createCertificate() {
    setCreateLoading(true);
    setCreateError("");
    try {
      const res = await fetch("/api/staff/gift-certificates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_email: customerEmail.trim(),
          amount_dollars: Number(amountDollars || "0"),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCreateError(json?.error || "Failed to create gift certificate.");
        return;
      }
      if (json?.certificate) {
        setRows((prev) => [json.certificate, ...prev]);
        setCustomerEmail("");
        setAmountDollars("50");
      }
    } catch (err: any) {
      setCreateError(err?.message || "Failed to create gift certificate.");
    } finally {
      setCreateLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-lg font-bold text-zinc-900">Gift Certificates</div>
          <div className="text-xs text-zinc-500">Admin only. Codes are auto-generated and expire in 1 year.</div>
        </div>
        <button
          type="button"
          onClick={loadCertificates}
          className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
        >
          Refresh
        </button>
      </div>

      <div className="mb-6 grid gap-3 rounded-2xl border border-zinc-100 bg-zinc-50 p-4 md:grid-cols-3">
        <label className="text-xs font-semibold text-zinc-600">
          Customer Email
          <input
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
            className="mt-1 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900"
            placeholder="customer@email.com"
          />
        </label>
        <label className="text-xs font-semibold text-zinc-600">
          Amount (USD)
          <input
            value={amountDollars}
            onChange={(e) => setAmountDollars(e.target.value)}
            className="mt-1 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900"
            placeholder="50"
            inputMode="decimal"
          />
        </label>
        <div className="flex items-end">
          <button
            type="button"
            onClick={createCertificate}
            disabled={createLoading}
            className="h-10 w-full rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {createLoading ? "Creating..." : "Create Gift Certificate"}
          </button>
        </div>
      </div>
      {createError ? <div className="mb-4 text-xs font-semibold text-red-600">{createError}</div> : null}
      {error ? <div className="text-xs font-semibold text-red-600">{error}</div> : null}
      {loading ? (
        <div className="text-sm text-zinc-700">Loading gift certificates…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs text-zinc-700">
            <thead>
              <tr className="border-b border-zinc-200 text-[11px] uppercase text-zinc-500">
                <th className="py-2 pr-4">Code</th>
                <th className="py-2 pr-4">Customer</th>
                <th className="py-2 pr-4">Balance</th>
                <th className="py-2 pr-4">Original</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Expires</th>
                <th className="py-2 pr-4">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-zinc-100 last:border-0">
                  <td className="py-2 pr-4 font-semibold text-zinc-900">{row.code}</td>
                  <td className="py-2 pr-4">
                    <div className="font-semibold text-zinc-900">{row.customers?.full_name || "—"}</div>
                    <div className="text-[11px] text-zinc-500">{row.customers?.email || "—"}</div>
                  </td>
                  <td className="py-2 pr-4 font-semibold text-emerald-700">{formatMoney(row.balance_cents)}</td>
                  <td className="py-2 pr-4">{formatMoney(row.original_amount_cents)}</td>
                  <td className="py-2 pr-4">{row.status}</td>
                  <td className="py-2 pr-4">{formatDate(row.expires_at)}</td>
                  <td className="py-2 pr-4">{formatDate(row.created_at)}</td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-sm text-zinc-500">
                    No gift certificates yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
