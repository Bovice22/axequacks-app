"use client";

import { useEffect, useState } from "react";

type BufferRule = {
  id: string;
  activity: string;
  before_min: number;
  after_min: number;
  active: boolean;
  created_at: string;
};

export default function BuffersTable() {
  const [rows, setRows] = useState<BufferRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [activity, setActivity] = useState("ALL");
  const [beforeMin, setBeforeMin] = useState(0);
  const [afterMin, setAfterMin] = useState(0);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadBuffers() {
    setLoading(true);
    const res = await fetch("/api/staff/buffers", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    setRows(json.buffers || []);
    setLoading(false);
  }

  useEffect(() => {
    loadBuffers();
  }, []);

  async function createBuffer(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/staff/buffers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activity,
          before_min: beforeMin,
          after_min: afterMin,
          active,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || "Failed to create buffer");
        return;
      }
      setActivity("ALL");
      setBeforeMin(0);
      setAfterMin(0);
      setActive(true);
      await loadBuffers();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(id: string, next: boolean) {
    const res = await fetch(`/api/staff/buffers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: next }),
    });
    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      if (json?.buffer) {
        setRows((prev) => prev.map((r) => (r.id === id ? json.buffer : r)));
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="text-sm font-extrabold text-zinc-900">Add Buffer Rule</div>
        <form className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4" onSubmit={createBuffer}>
          <select
            value={activity}
            onChange={(e) => setActivity(e.target.value)}
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
          >
            <option value="ALL">All</option>
            <option value="AXE">Axe</option>
            <option value="DUCKPIN">Duckpin</option>
            <option value="COMBO">Combo</option>
          </select>
          <input
            type="number"
            value={beforeMin}
            onChange={(e) => setBeforeMin(Number(e.target.value))}
            placeholder="Before (min)"
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm text-zinc-900 placeholder:text-zinc-900"
          />
          <input
            type="number"
            value={afterMin}
            onChange={(e) => setAfterMin(Number(e.target.value))}
            placeholder="After (min)"
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm text-zinc-900 placeholder:text-zinc-900"
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
            {saving ? "Saving..." : "Add Buffer"}
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-sm font-extrabold text-zinc-900">Buffers</div>
          <button
            type="button"
            onClick={loadBuffers}
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
          >
            Refresh
          </button>
        </div>
        {loading ? (
          <div className="text-sm text-zinc-600">Loading buffers…</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-zinc-600">
                <tr>
                  <th className="py-2">Activity</th>
                  <th className="py-2">Before (min)</th>
                  <th className="py-2">After (min)</th>
                  <th className="py-2">Active</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-zinc-100">
                    <td className="py-2">{r.activity}</td>
                    <td className="py-2">{r.before_min}</td>
                    <td className="py-2">{r.after_min}</td>
                    <td className="py-2">{r.active ? "Yes" : "No"}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => toggleActive(r.id, !r.active)}
                        className="rounded-lg border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50"
                      >
                        {r.active ? "Deactivate" : "Activate"}
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
