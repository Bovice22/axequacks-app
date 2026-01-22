"use client";

import { useEffect, useState } from "react";

type TimeEntry = {
  id: string;
  clock_in_ts: string;
  clock_out_ts: string | null;
  created_at?: string;
  staff_users?: {
    full_name?: string | null;
    staff_id?: string | null;
  } | null;
};

type StaffUser = {
  id: string;
  staff_id: string;
  full_name: string | null;
};

function formatTimestamp(ts: string) {
  return new Date(ts).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });
}

function durationMinutes(entry: TimeEntry) {
  if (!entry.clock_out_ts) return null;
  const start = new Date(entry.clock_in_ts).getTime();
  const end = new Date(entry.clock_out_ts).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.round((end - start) / 60000);
}

function staffLabel(entry: TimeEntry) {
  const fullName = entry.staff_users?.full_name?.trim();
  const staffId = entry.staff_users?.staff_id?.trim();
  if (fullName && staffId) return `${fullName} (${staffId})`;
  if (fullName) return fullName;
  if (staffId) return staffId;
  return "—";
}

export default function TimeClockPanel() {
  const [openEntry, setOpenEntry] = useState<TimeEntry | null>(null);
  const [recent, setRecent] = useState<TimeEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [role, setRole] = useState<"staff" | "admin">("staff");
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>("");

  async function loadStatus() {
    setLoading(true);
    const params = new URLSearchParams();
    if (role === "admin" && selectedStaffId) {
      params.set("staff_user_id", selectedStaffId);
    }
    const res = await fetch(`/api/staff/time-clock?${params.toString()}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json?.error || "Failed to load time clock.");
      setLoading(false);
      return;
    }
    setOpenEntry(json.openEntry || null);
    setRecent(json.recent || []);
    if (!selectedStaffId && json.staff_user_id) {
      setSelectedStaffId(json.staff_user_id);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetch("/api/staff/me", { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => setRole(json?.role === "admin" ? "admin" : "staff"))
      .catch(() => setRole("staff"));
    fetch("/api/staff/users", { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => setStaffUsers(json.users || []))
      .catch(() => setStaffUsers([]));
    loadStatus();
  }, []);

  useEffect(() => {
    if (role === "admin" && selectedStaffId) {
      loadStatus();
    }
  }, [role, selectedStaffId]);

  async function handleAction(action: "clock_in" | "clock_out") {
    setError("");
    setWorking(true);
    const res = await fetch("/api/staff/time-clock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, staff_user_id: role === "admin" ? selectedStaffId : undefined }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json?.error || "Unable to update time clock.");
      setWorking(false);
      return;
    }
    await loadStatus();
    setWorking(false);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="text-sm font-extrabold text-zinc-900">Clock In / Clock Out</div>
        {role === "admin" ? (
          <div className="mt-3">
            <label className="mb-1 block text-xs font-semibold text-zinc-600">Select staff member</label>
            <select
              value={selectedStaffId}
              onChange={(e) => setSelectedStaffId(e.target.value)}
              className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm text-zinc-900"
            >
              <option value="">Select staff</option>
              {staffUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name || user.staff_id} ({user.staff_id})
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="mt-2 text-sm text-zinc-600">
          {loading ? "Loading status…" : openEntry ? `Clocked in since ${formatTimestamp(openEntry.clock_in_ts)}` : "Not clocked in."}
        </div>
        {error ? <div className="mt-2 text-sm text-red-600">{error}</div> : null}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => handleAction("clock_in")}
            disabled={working || !!openEntry || (role === "admin" && !selectedStaffId)}
            className="h-10 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            Clock In
          </button>
          <button
            type="button"
            onClick={() => handleAction("clock_out")}
            disabled={working || !openEntry || (role === "admin" && !selectedStaffId)}
            className="h-10 rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            Clock Out
          </button>
          <button
            type="button"
            onClick={loadStatus}
            className="h-10 rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-700"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="text-sm font-extrabold text-zinc-900">Recent Shifts</div>
        <div className="mt-3 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-center text-zinc-900">
              <tr>
                <th className="py-2 text-center">Staff</th>
                <th className="py-2 text-center">Clock In</th>
                <th className="py-2 text-center">Clock Out</th>
                <th className="py-2 text-center">Minutes</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((entry) => {
                const minutes = durationMinutes(entry);
                return (
                  <tr key={entry.id} className="border-t border-zinc-100 text-zinc-900">
                    <td className="py-2 text-center">{staffLabel(entry)}</td>
                    <td className="py-2 text-center">{formatTimestamp(entry.clock_in_ts)}</td>
                    <td className="py-2 text-center">
                      {entry.clock_out_ts ? formatTimestamp(entry.clock_out_ts) : "In progress"}
                    </td>
                    <td className="py-2 text-center">{minutes != null ? minutes : "—"}</td>
                  </tr>
                );
              })}
              {!recent.length ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-sm text-zinc-500">
                    No time entries yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
