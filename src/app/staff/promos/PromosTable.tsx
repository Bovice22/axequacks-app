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
  const [editError, setEditError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{
    code: string;
    discountType: string;
    discountValue: number;
    active: boolean;
  } | null>(null);
  const [editSaving, setEditSaving] = useState(false);

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

  function beginEdit(promo: Promo) {
    setEditingId(promo.id || promo.code);
    setEditValues({
      code: promo.code || "",
      discountType: promo.discount_type || "PERCENT",
      discountValue: Number(promo.discount_value || 0),
      active: !!promo.active,
    });
    setEditError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValues(null);
    setEditError("");
  }

  async function saveEdit(promo: Promo) {
    const promoId = promo.id || promo.code;
    if (!promoId || !editValues) return;
    setEditSaving(true);
    setEditError("");
    try {
      const normalizedCode = editValues.code.replace(/\s+/g, "").toUpperCase();
      const res = await fetch(`/api/staff/promos/${promoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: normalizedCode,
          discount_type: editValues.discountType,
          discount_value: editValues.discountValue,
          active: editValues.active,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditError(json?.error || "Failed to update promo");
        return;
      }
      if (json?.promo) {
        setRows((prev) =>
          prev.map((r) => (r.id === promoId || r.code === promo.code ? json.promo : r))
        );
      } else {
        await loadPromos();
      }
      cancelEdit();
    } finally {
      setEditSaving(false);
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
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm text-zinc-900 placeholder:text-zinc-900"
            required
          />
          <select
            value={discountType}
            onChange={(e) => setDiscountType(e.target.value)}
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm text-zinc-900"
          >
            <option value="PERCENT">Percent</option>
            <option value="AMOUNT">Amount (USD)</option>
          </select>
          <input
            type="number"
            value={discountValue}
            onChange={(e) => setDiscountValue(Number(e.target.value))}
            step="0.01"
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm text-zinc-900 placeholder:text-zinc-900"
          />
          <label className="flex items-center gap-2 text-sm text-zinc-900">
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
        {editError ? <div className="mb-2 text-sm text-red-600">{editError}</div> : null}
        {loading ? (
          <div className="text-sm text-zinc-900">Loading promos…</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-center text-zinc-900">
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
                {filtered.map((r) => {
                  const rowId = r.id || r.code;
                  const isEditing = editingId === rowId;
                  return (
                  <tr key={rowId} className="border-t border-zinc-100 text-zinc-900">
                    <td className="py-2 text-center font-mono text-xs">
                      {isEditing ? (
                        <input
                          value={editValues?.code || ""}
                          onChange={(e) =>
                            setEditValues((prev) => (prev ? { ...prev, code: e.target.value } : prev))
                          }
                          className="h-8 w-full rounded-lg border border-zinc-200 px-2 text-xs text-zinc-900"
                        />
                      ) : (
                        r.code
                      )}
                    </td>
                    <td className="py-2 text-center">
                      {isEditing ? (
                        <select
                          value={editValues?.discountType || "PERCENT"}
                          onChange={(e) =>
                            setEditValues((prev) =>
                              prev ? { ...prev, discountType: e.target.value } : prev
                            )
                          }
                          className="h-8 rounded-lg border border-zinc-200 px-2 text-xs text-zinc-900"
                        >
                          <option value="PERCENT">Percent</option>
                          <option value="AMOUNT">Amount (cents)</option>
                        </select>
                      ) : (
                        r.discount_type
                      )}
                    </td>
                    <td className="py-2 text-center">
                      {isEditing ? (
                        <input
                          type="number"
                          value={editValues?.discountValue ?? 0}
                          onChange={(e) =>
                            setEditValues((prev) =>
                              prev ? { ...prev, discountValue: Number(e.target.value) } : prev
                            )
                          }
                          step="0.01"
                          className="h-8 w-24 rounded-lg border border-zinc-200 px-2 text-xs text-zinc-900"
                        />
                      ) : (
                        r.discount_type === "AMOUNT"
                          ? `$${Number(r.discount_value || 0).toFixed(2)}`
                          : r.discount_value
                      )}
                    </td>
                    <td className="py-2 text-center">
                      {isEditing ? (
                        <label className="inline-flex items-center gap-2 text-xs text-zinc-900">
                          <input
                            type="checkbox"
                            checked={!!editValues?.active}
                            onChange={(e) =>
                              setEditValues((prev) =>
                                prev ? { ...prev, active: e.target.checked } : prev
                              )
                            }
                          />
                          Active
                        </label>
                      ) : r.active ? (
                        "Yes"
                      ) : (
                        "No"
                      )}
                    </td>
                    <td className="py-2 text-center">
                      {r.redemptions_count}
                      {r.max_redemptions != null ? ` / ${r.max_redemptions}` : ""}
                    </td>
                    <td className="py-2 text-center">
                      {isEditing ? (
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => saveEdit(r)}
                            disabled={editSaving}
                            className="inline-flex h-8 min-w-[70px] items-center justify-center rounded-lg bg-zinc-900 px-3 text-xs font-semibold text-white disabled:opacity-60"
                          >
                            {editSaving ? "Saving..." : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="inline-flex h-8 min-w-[70px] items-center justify-center rounded-lg border border-zinc-200 px-3 text-xs font-semibold text-zinc-700"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => beginEdit(r)}
                            className="inline-flex h-8 min-w-[70px] items-center justify-center rounded-lg border border-zinc-200 px-3 text-xs font-semibold text-zinc-700"
                          >
                            Edit
                          </button>
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
                            {actionLoadingId === (r.id || r.code)
                              ? "Working..."
                              : r.active
                              ? "Deactivate"
                              : "Activate"}
                          </button>
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
      </div>
    </div>
  );
}
