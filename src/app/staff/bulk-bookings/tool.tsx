"use client";

import { useMemo, useState } from "react";
import { PARTY_AREA_OPTIONS } from "@/lib/bookingLogic";

type Row = {
  activity: "Axe Throwing" | "Duckpin Bowling" | "Combo Package";
  durationMinutes: number;
  partyArea: string;
  partyAreaMinutes: number;
  partySize: number;
  dateKey: string;
  startTime: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  paid: boolean;
};

const DEFAULT_ROW: Row = {
  activity: "Axe Throwing",
  durationMinutes: 60,
  partyArea: "",
  partyAreaMinutes: 60,
  partySize: 2,
  dateKey: "",
  startTime: "",
  customerName: "",
  customerEmail: "",
  customerPhone: "",
  paid: false,
};

export default function BulkBookingsTool() {
  const [rows, setRows] = useState<Row[]>([{ ...DEFAULT_ROW }]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  const partyAreas = useMemo(() => {
    return PARTY_AREA_OPTIONS.filter((option) => option.visible);
  }, []);

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((prev) => [...prev, { ...DEFAULT_ROW }]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit() {
    setError("");
    setStatus("");
    setWorking(true);
    const res = await fetch("/api/staff/bookings/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = Array.isArray(json.detail) ? json.detail.join(" ") : json.detail;
      setError(detail || json?.error || "Failed to import bookings.");
      setWorking(false);
      return;
    }
    setStatus(`Created ${json.created} bookings.`);
    setRows([{ ...DEFAULT_ROW }]);
    setWorking(false);
  }

  return (
    <div className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-4">
      <div>
        <div className="text-sm font-extrabold text-zinc-900">Bulk Booking Entry</div>
        <div className="text-xs text-zinc-500">Fill each row, then publish all bookings at once.</div>
      </div>

      <div className="overflow-auto">
        <table className="w-full min-w-[1100px] text-xs text-zinc-900">
          <thead className="text-left text-zinc-900">
            <tr>
              <th className="px-2 py-2">Activity</th>
              <th className="px-2 py-2">Duration</th>
              <th className="px-2 py-2">Party Area</th>
              <th className="px-2 py-2">Party Area Minutes</th>
              <th className="px-2 py-2">Party Size</th>
              <th className="px-2 py-2">Date</th>
              <th className="px-2 py-2">Start Time</th>
              <th className="px-2 py-2">Customer Name</th>
              <th className="px-2 py-2">Customer Email</th>
              <th className="px-2 py-2">Phone</th>
              <th className="px-2 py-2">Paid</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} className="border-t border-zinc-100">
                <td className="px-2 py-2">
                  <select
                    value={row.activity}
                    onChange={(e) => updateRow(idx, { activity: e.target.value as Row["activity"] })}
                    className="h-9 rounded-lg border border-zinc-200 px-2 text-xs text-zinc-900"
                  >
                    <option value="Axe Throwing">Axe Throwing</option>
                    <option value="Duckpin Bowling">Duckpin Bowling</option>
                    <option value="Combo Package">Combo Package</option>
                  </select>
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    min="15"
                    step="15"
                    value={row.durationMinutes}
                    onChange={(e) => updateRow(idx, { durationMinutes: Number(e.target.value || 0) })}
                    className="h-9 w-20 rounded-lg border border-zinc-200 px-2 text-xs text-zinc-900"
                  />
                </td>
                <td className="px-2 py-2">
                  <select
                    value={row.partyArea}
                    onChange={(e) => updateRow(idx, { partyArea: e.target.value })}
                    className="h-9 rounded-lg border border-zinc-200 px-2 text-xs text-zinc-900"
                  >
                    <option value="">None</option>
                    {partyAreas.map((area) => (
                      <option key={area.name} value={area.name}>
                        {area.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    min="15"
                    step="15"
                    value={row.partyAreaMinutes}
                    onChange={(e) => updateRow(idx, { partyAreaMinutes: Number(e.target.value || 0) })}
                    className="h-9 w-20 rounded-lg border border-zinc-200 px-2 text-xs text-zinc-900"
                    disabled={!row.partyArea}
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    min="1"
                    value={row.partySize}
                    onChange={(e) => updateRow(idx, { partySize: Number(e.target.value || 0) })}
                    className="h-9 w-20 rounded-lg border border-zinc-200 px-2 text-xs text-zinc-900"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="date"
                    value={row.dateKey}
                    onChange={(e) => updateRow(idx, { dateKey: e.target.value })}
                    className="h-9 rounded-lg border border-zinc-200 px-2 text-xs text-zinc-900"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="text"
                    placeholder="4:00 PM"
                    value={row.startTime}
                    onChange={(e) => updateRow(idx, { startTime: e.target.value })}
                    className="h-9 w-20 rounded-lg border border-zinc-200 px-2 text-xs text-zinc-900 placeholder:text-zinc-400"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="text"
                    value={row.customerName}
                    onChange={(e) => updateRow(idx, { customerName: e.target.value })}
                    className="h-9 w-40 rounded-lg border border-zinc-200 px-2 text-xs text-zinc-900"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="email"
                    value={row.customerEmail}
                    onChange={(e) => updateRow(idx, { customerEmail: e.target.value })}
                    className="h-9 w-48 rounded-lg border border-zinc-200 px-2 text-xs text-zinc-900"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="text"
                    value={row.customerPhone}
                    onChange={(e) => updateRow(idx, { customerPhone: e.target.value })}
                    className="h-9 w-28 rounded-lg border border-zinc-200 px-2 text-xs text-zinc-900"
                  />
                </td>
                <td className="px-2 py-2 text-center">
                  <select
                    value={row.paid ? "PAID" : "UNPAID"}
                    onChange={(e) => updateRow(idx, { paid: e.target.value === "PAID" })}
                    className="h-9 rounded-lg border border-zinc-200 px-2 text-xs text-zinc-900"
                  >
                    <option value="UNPAID">UNPAID</option>
                    <option value="PAID">PAID</option>
                  </select>
                </td>
                <td className="px-2 py-2">
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    className="h-9 rounded-lg border border-red-200 bg-red-50 px-2 text-[11px] font-semibold text-red-700"
                    disabled={rows.length === 1}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {status ? <div className="text-sm text-emerald-600">{status}</div> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={addRow}
          className="h-10 rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-700"
        >
          Add Row
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={working}
          className="h-10 rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          {working ? "Publishing..." : "Publish Bookings"}
        </button>
      </div>
    </div>
  );
}
