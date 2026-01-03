"use client";

import { useEffect, useState } from "react";

type Policy = {
  id: string;
  cancel_window_hours: number;
  reschedule_window_hours: number;
  refund_policy: string;
  notes: string | null;
  updated_at: string;
};

export default function PoliciesForm() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [cancelHours, setCancelHours] = useState(24);
  const [reschedHours, setReschedHours] = useState(12);
  const [refundPolicy, setRefundPolicy] = useState("FULL_BEFORE_WINDOW");
  const [notes, setNotes] = useState("");

  async function loadPolicy() {
    setLoading(true);
    setError("");
    const res = await fetch("/api/staff/policies", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json?.error || "Failed to load policies.");
      setLoading(false);
      return;
    }
    if (json?.policy) {
      const p = json.policy as Policy;
      setPolicy(p);
      setCancelHours(p.cancel_window_hours);
      setReschedHours(p.reschedule_window_hours);
      setRefundPolicy(p.refund_policy);
      setNotes(p.notes || "");
    }
    setLoading(false);
  }

  useEffect(() => {
    loadPolicy();
  }, []);

  async function savePolicy(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/staff/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cancel_window_hours: cancelHours,
          reschedule_window_hours: reschedHours,
          refund_policy: refundPolicy,
          notes,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || "Failed to save policies.");
        return;
      }
      setPolicy(json.policy || null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="text-sm font-extrabold text-zinc-900">Reschedule + Cancel Policies</div>
      {loading ? (
        <div className="mt-3 text-sm text-zinc-600">Loading…</div>
      ) : (
        <form className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2" onSubmit={savePolicy}>
          <label className="text-xs font-semibold text-zinc-600">
            Cancel Window (hours)
            <input
              type="number"
              min={0}
              value={cancelHours}
              onChange={(e) => setCancelHours(Number(e.target.value))}
              className="mt-1 h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm"
            />
          </label>
          <label className="text-xs font-semibold text-zinc-600">
            Reschedule Window (hours)
            <input
              type="number"
              min={0}
              value={reschedHours}
              onChange={(e) => setReschedHours(Number(e.target.value))}
              className="mt-1 h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm"
            />
          </label>
          <label className="text-xs font-semibold text-zinc-600 md:col-span-2">
            Refund Policy
            <select
              value={refundPolicy}
              onChange={(e) => setRefundPolicy(e.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm"
            >
              <option value="FULL_BEFORE_WINDOW">Full refund before window</option>
              <option value="PARTIAL_BEFORE_WINDOW">Partial refund before window</option>
              <option value="NO_REFUND">No refunds</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-zinc-600 md:col-span-2">
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 min-h-[80px] w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
            />
          </label>

          {error ? <div className="text-sm text-red-600 md:col-span-2">{error}</div> : null}
          <button
            type="submit"
            disabled={saving}
            className="h-10 rounded-xl bg-zinc-900 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 md:col-span-2"
          >
            {saving ? "Saving..." : "Save Policies"}
          </button>
        </form>
      )}
      {policy?.updated_at ? (
        <div className="mt-2 text-xs text-zinc-500">Last updated: {new Date(policy.updated_at).toLocaleString()}</div>
      ) : null}
    </div>
  );
}
