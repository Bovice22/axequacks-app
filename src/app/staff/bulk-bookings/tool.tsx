"use client";

import { useState } from "react";

const SAMPLE = `# Date | Start Time | Activity | Duration | Party Size | Name | Email | Phone | Paid | Notes | Combo Order | Combo Axe Minutes | Combo Duck Minutes | Total Cents
2026-02-01 | 4:00 PM | Axe Throwing | 60 | 6 | Alex Smith | alex@example.com | 9375550101 | PAID | Birthday party
2026-02-01 | 6:00 PM | Duckpin Bowling | 60 | 4 | Jamie Lee | jamie@example.com | 9375550102 | UNPAID | Walk-in
2026-02-02 | 5:30 PM | Combo Package | 120 | 10 | Taylor Reid | taylor@example.com | 9375550103 | PAID | Combo | DUCKPIN_FIRST | 60 | 60 | 24000`;

export default function BulkBookingsTool() {
  const [lines, setLines] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  async function submit() {
    setError("");
    setStatus("");
    setWorking(true);
    const res = await fetch("/api/staff/bookings/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = Array.isArray(json.detail) ? json.detail.join(" ") : json.detail;
      setError(detail || json?.error || "Failed to import bookings.");
      setWorking(false);
      return;
    }
    setStatus(`Created ${json.created} bookings.`);
    setLines("");
    setWorking(false);
  }

  return (
    <div className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-4">
      <div>
        <div className="text-sm font-extrabold text-zinc-900">Paste bookings</div>
        <div className="text-xs text-zinc-500">
          One booking per line. Use the pipe separator. Required: Date, Start Time, Activity, Duration, Party Size, Name, Email.
        </div>
      </div>

      <textarea
        value={lines}
        onChange={(e) => setLines(e.target.value)}
        placeholder={SAMPLE}
        className="min-h-[220px] w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400"
      />

      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {status ? <div className="text-sm text-emerald-600">{status}</div> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={working || !lines.trim()}
          className="h-10 rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          {working ? "Importing..." : "Import Bookings"}
        </button>
        <button
          type="button"
          onClick={() => setLines(SAMPLE)}
          className="h-10 rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-700"
        >
          Load Sample
        </button>
      </div>
    </div>
  );
}
