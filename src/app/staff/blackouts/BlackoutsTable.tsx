"use client";

import { useEffect, useState } from "react";

type Blackout = {
  id: string;
  date_key: string;
  start_min: number | null;
  end_min: number | null;
  activity: string;
  reason: string | null;
  created_at: string;
};

export default function BlackoutsTable() {
  const [rows, setRows] = useState<Blackout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [dateKey, setDateKey] = useState("");
  const [startMin, setStartMin] = useState<number | "">("");
  const [endMin, setEndMin] = useState<number | "">("");
  const [activity, setActivity] = useState("ALL");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadBlackouts() {
    setLoading(true);
    const res = await fetch("/api/staff/blackouts", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    setRows(json.blackouts || []);
    setLoading(false);
  }

  useEffect(() => {
    loadBlackouts();
  }, []);

  async function createBlackout(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/staff/blackouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date_key: dateKey,
          start_min: startMin === "" ? null : startMin,
          end_min: endMin === "" ? null : endMin,
          activity,
          reason,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || "Failed to create blackout");
        return;
      }
      setDateKey("");
      setStartMin("");
      setEndMin("");
      setActivity("ALL");
      setReason("");
      await loadBlackouts();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="text-sm font-extrabold text-zinc-900">Add Blackout</div>
        <form className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-5" onSubmit={createBlackout}>
          <input
            type="date"
            value={dateKey}
            onChange={(e) => setDateKey(e.target.value)}
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
            required
          />
          <input
            type="number"
            value={startMin}
            onChange={(e) => setStartMin(e.target.value === "" ? "" : Number(e.target.value))}
            placeholder="Start min"
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
          />
          <input
            type="number"
            value={endMin}
            onChange={(e) => setEndMin(e.target.value === "" ? "" : Number(e.target.value))}
            placeholder="End min"
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
          />
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
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason"
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
          />
          {error ? <div className="text-sm text-red-600 md:col-span-5">{error}</div> : null}
          <button
            type="submit"
            disabled={saving}
            className="h-10 rounded-xl bg-zinc-900 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 md:col-span-5"
          >
            {saving ? "Saving..." : "Add Blackout"}
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-sm font-extrabold text-zinc-900">Blackouts</div>
          <button
            type="button"
            onClick={loadBlackouts}
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
          >
            Refresh
          </button>
        </div>
        {loading ? (
          <div className="text-sm text-zinc-600">Loading blackouts…</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-zinc-600">
                <tr>
                  <th className="py-2">Date</th>
                  <th className="py-2">Start</th>
                  <th className="py-2">End</th>
                  <th className="py-2">Activity</th>
                  <th className="py-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-zinc-100">
                    <td className="py-2">{r.date_key}</td>
                    <td className="py-2">{r.start_min ?? "—"}</td>
                    <td className="py-2">{r.end_min ?? "—"}</td>
                    <td className="py-2">{r.activity}</td>
                    <td className="py-2">{r.reason || "—"}</td>
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
