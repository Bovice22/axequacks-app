"use client";

import { useEffect, useMemo, useState } from "react";

type Promo = {
  id: string;
  code: string;
  discount_type: string;
  discount_value: number;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  max_redemptions: number | null;
  redemptions_count: number;
  created_at: string;
};

export default function PromosTable() {
  const [rows, setRows] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState("PERCENT");
  const [discountValue, setDiscountValue] = useState(10);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  async function loadPromos() {
    setLoading(true);
    const res = await fetch("/api/staff/promos", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    setRows(json.promos || []);
    setLoading(false);
  }

  useEffect(() => {
    loadPromos();
  }, []);

  const filtered = useMemo(() => rows, [rows]);

  async function createPromo(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const normalizedCode = code.replace(/\s+/g, "").toUpperCase();
      const res = await fetch("/api/staff/promos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: normalizedCode,
          discount_type: discountType,
          discount_value: discountValue,
          active,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || "Failed to create promo");
        return;
      }
      setCode("");
      setDiscountType("PERCENT");
      setDiscountValue(10);
      setActive(true);
      await loadPromos();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(id: string, next: boolean, promoCode: string) {
    const promoId = id || promoCode;
    if (!promoId) {
      setActionError("Missing promo id");
      return;
    }
    setActionError("");
    setActionLoadingId(promoId);
    try {
      const res = await fetch(`/api/staff/promos/${promoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next, code: promoCode }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(json?.error || "Failed to update promo");
        return;
      }
      if (json?.promo) {
        setRows((prev) =>
          prev.map((r) =>
            r.id === promoId || r.code === promoCode ? json.promo : r
          )
        );
      } else {
        await loadPromos();
      }
    } finally {
      setActionLoadingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="text-sm font-extrabold text-zinc-900">Create Promo Code</div>
        <form className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4" onSubmit={createPromo}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="CODE10"
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
            required
          />
          <select
            value={discountType}
            onChange={(e) => setDiscountType(e.target.value)}
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
          >
            <option value="PERCENT">Percent</option>
            <option value="AMOUNT">Amount (cents)</option>
          </select>
          <input
            type="number"
            value={discountValue}
            onChange={(e) => setDiscountValue(Number(e.target.value))}
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
          />
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Active
          </label>
          {error ? <div className="text-sm text-red-600 md:col-span-4">{error}</div> : null}
          <button
            type="submit"
            disabled={saving}
            className="h-10 rounded-xl bg-zinc-900 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 md:col-span-4"
          >
            {saving ? "Saving..." : "Add Promo"}
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-sm font-extrabold text-zinc-900">Promo Codes</div>
          <button
            type="button"
            onClick={loadPromos}
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
          >
            Refresh
          </button>
        </div>
        {actionError ? <div className="mb-2 text-sm text-red-600">{actionError}</div> : null}
        {loading ? (
          <div className="text-sm text-zinc-600">Loading promos…</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-center text-zinc-600">
                <tr>
                  <th className="py-2 text-center">Code</th>
                  <th className="py-2 text-center">Type</th>
                  <th className="py-2 text-center">Value</th>
                  <th className="py-2 text-center">Active</th>
                  <th className="py-2 text-center">Redemptions</th>
                  <th className="py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t border-zinc-100">
                    <td className="py-2 text-center font-mono text-xs">{r.code}</td>
                    <td className="py-2 text-center">{r.discount_type}</td>
                    <td className="py-2 text-center">{r.discount_value}</td>
                    <td className="py-2 text-center">{r.active ? "Yes" : "No"}</td>
                    <td className="py-2 text-center">
                      {r.redemptions_count}
                      {r.max_redemptions != null ? ` / ${r.max_redemptions}` : ""}
                    </td>
                    <td className="py-2 text-center">
                      <button
                        type="button"
                        onClick={() => {
                          const promoId = r.id || r.code || "";
                          toggleActive(promoId, !r.active, r.code || "");
                        }}
                        disabled={actionLoadingId === (r.id || r.code)}
                        className="inline-flex h-8 min-w-[92px] items-center justify-center rounded-lg border px-3 text-xs font-semibold disabled:opacity-60"
                        style={
                          r.active
                            ? { backgroundColor: "#dc2626", borderColor: "#dc2626", color: "#ffffff" }
                            : { backgroundColor: "#16a34a", borderColor: "#16a34a", color: "#ffffff" }
                        }
                      >
                        {actionLoadingId === (r.id || r.code) ? "Working..." : r.active ? "Deactivate" : "Activate"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
