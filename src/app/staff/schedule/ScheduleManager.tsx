"use client";

import { useEffect, useMemo, useState } from "react";

type StaffUser = {
  id: string;
  staff_id: string;
  full_name: string | null;
  role_label?: string | null;
};

type ShiftRow = {
  id: string;
  staff_user_id: string;
  shift_date: string;
  start_min: number;
  end_min: number;
  notes?: string | null;
  staff_users?: {
    full_name?: string | null;
    staff_id?: string | null;
    role_label?: string | null;
  } | null;
};

function timeToMinutes(value: string) {
  const [h, m] = value.split(":").map((part) => Number(part));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map((part) => Number(part));
  return new Date(year, (month || 1) - 1, day || 1);
}

function minutesToLabel(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function todayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function MonthCalendar(props: { selectedDateKey: string; onSelectDateKey: (dateKey: string) => void }) {
  const { selectedDateKey, onSelectDateKey } = props;
  const [cursor, setCursor] = useState(() => {
    const base = selectedDateKey ? fromDateKey(selectedDateKey) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const monthLabel = cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const days = useMemo(() => {
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const totalDays = end.getDate();

    const startWeekday = start.getDay();
    const cells: Array<{ date: Date | null }> = [];

    for (let i = 0; i < startWeekday; i++) cells.push({ date: null });
    for (let d = 1; d <= totalDays; d++) {
      cells.push({ date: new Date(cursor.getFullYear(), cursor.getMonth(), d) });
    }

    while (cells.length % 7 !== 0) cells.push({ date: null });

    return cells;
  }, [cursor]);

  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (
    <div className="w-full max-w-[420px] rounded-2xl border border-zinc-200 bg-white p-3 sm:max-w-none sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          className="rounded-xl border-2 border-black px-2 py-2 text-base font-black text-black hover:bg-zinc-50 sm:px-3"
          onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
        >
          ←
        </button>

        <div className="text-sm font-extrabold text-zinc-900">{monthLabel}</div>

        <button
          type="button"
          className="rounded-xl border-2 border-black px-2 py-2 text-base font-black text-black hover:bg-zinc-50 sm:px-3"
          onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
        >
          →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-zinc-500 sm:gap-2 sm:text-xs">
        {weekDays.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1 sm:gap-2">
        {days.map((cell, idx) => {
          if (!cell.date) return <div key={idx} className="h-9 rounded-xl bg-transparent sm:h-10" />;

          const dk = toDateKey(cell.date);
          const selected = selectedDateKey === dk;
          return (
            <button
              key={dk}
              type="button"
              onClick={() => onSelectDateKey(dk)}
              className={`h-9 rounded-xl border text-xs font-bold transition sm:h-10 sm:text-sm ${
                selected
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50"
              }`}
            >
              {cell.date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ScheduleManager() {
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [formError, setFormError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const [startDate, setStartDate] = useState(todayKey());
  const [endDate, setEndDate] = useState(todayKey());
  const [selectedDateKey, setSelectedDateKey] = useState(todayKey());

  const [staffUserId, setStaffUserId] = useState("");
  const [shiftDate, setShiftDate] = useState(todayKey());
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    fetch("/api/staff/users", { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => setStaffUsers(json.users || []))
      .catch(() => setStaffUsers([]));
  }, []);

  async function loadShifts() {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("startDate", startDate);
    params.set("endDate", endDate);
    const res = await fetch(`/api/staff/schedule?${params.toString()}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    setShifts(json.shifts || []);
    setLoading(false);
  }

  useEffect(() => {
    loadShifts();
  }, [startDate, endDate]);

  const staffLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const user of staffUsers) {
      map.set(user.id, `${user.full_name || user.staff_id} (${user.staff_id})`);
    }
    return map;
  }, [staffUsers]);

  function resetForm() {
    setEditingId(null);
    setStaffUserId("");
    setShiftDate(todayKey());
    setStartTime("09:00");
    setEndTime("17:00");
    setNotes("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!staffUserId) {
      setFormError("Select a staff member.");
      return;
    }
    const payload = {
      staff_user_id: staffUserId,
      shift_date: shiftDate,
      start_min: timeToMinutes(startTime),
      end_min: timeToMinutes(endTime),
      notes,
    };
    const res = await fetch("/api/staff/schedule", {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editingId ? { id: editingId, ...payload } : payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setFormError(json?.error || "Failed to save shift.");
      return;
    }
    resetForm();
    await loadShifts();
  }

  async function editShift(row: ShiftRow) {
    setEditingId(row.id);
    setStaffUserId(row.staff_user_id);
    setShiftDate(row.shift_date);
    setStartTime(`${String(Math.floor(row.start_min / 60)).padStart(2, "0")}:${String(row.start_min % 60).padStart(2, "0")}`);
    setEndTime(`${String(Math.floor(row.end_min / 60)).padStart(2, "0")}:${String(row.end_min % 60).padStart(2, "0")}`);
    setNotes(row.notes || "");
  }

  async function deleteShift(id: string) {
    if (!window.confirm("Delete this shift?")) return;
    const res = await fetch("/api/staff/schedule", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      await loadShifts();
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-zinc-900">Shift Scheduler</div>
            <div className="text-xs text-zinc-500">Create and edit shift schedules for staff.</div>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700"
          >
            Print
          </button>
        </div>

        <form className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-5" onSubmit={handleSubmit}>
          <select
            value={staffUserId}
            onChange={(e) => setStaffUserId(e.target.value)}
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm text-zinc-900"
            required
          >
            <option value="">Select staff</option>
            {staffUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.full_name || user.staff_id} ({user.staff_id})
              </option>
            ))}
          </select>
          <input
            type="date"
            value={shiftDate}
            onChange={(e) => setShiftDate(e.target.value)}
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm text-zinc-900"
            required
          />
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm text-zinc-900"
            required
          />
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm text-zinc-900"
            required
          />
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes"
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm text-zinc-900 placeholder:text-zinc-500"
          />
          {formError ? <div className="text-sm text-red-600 md:col-span-5">{formError}</div> : null}
          <div className="flex gap-2 md:col-span-5">
            <button
              type="submit"
              className="h-10 rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              {editingId ? "Update Shift" : "Add Shift"}
            </button>
            {editingId ? (
              <button
                type="button"
                onClick={resetForm}
                className="h-10 rounded-xl border border-zinc-200 px-4 text-sm"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,420px),1fr]">
          <MonthCalendar
            selectedDateKey={selectedDateKey}
            onSelectDateKey={(dateKey) => {
              setSelectedDateKey(dateKey);
              setStartDate(dateKey);
              setEndDate(dateKey);
            }}
          />

          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-extrabold text-zinc-900">Scheduled Shifts</div>
              <button
                type="button"
                onClick={loadShifts}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700"
              >
                Refresh
              </button>
            </div>

            {loading ? (
              <div className="text-sm text-zinc-600">Loading shifts…</div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-center text-zinc-900">
                    <tr>
                      <th className="py-2 text-center">Date</th>
                      <th className="py-2 text-center">Staff</th>
                      <th className="py-2 text-center">Time</th>
                      <th className="py-2 text-center">Notes</th>
                      <th className="py-2 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shifts.map((row) => (
                      <tr key={row.id} className="border-t border-zinc-100 text-zinc-900">
                        <td className="py-2 text-center">{row.shift_date}</td>
                        <td className="py-2 text-center">{staffLabel.get(row.staff_user_id) || row.staff_user_id}</td>
                        <td className="py-2 text-center">
                          {minutesToLabel(row.start_min)} - {minutesToLabel(row.end_min)}
                        </td>
                        <td className="py-2 text-center">{row.notes || "—"}</td>
                        <td className="py-2 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => editShift(row)}
                              className="inline-flex h-8 items-center justify-center rounded-lg border px-3 text-xs font-semibold"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteShift(row.id)}
                              className="inline-flex h-8 items-center justify-center rounded-lg border border-red-500 bg-red-500 px-3 text-xs font-semibold text-white"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!shifts.length ? (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-sm text-zinc-500">
                          No shifts scheduled.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
