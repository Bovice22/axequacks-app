"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

type CustomerRow = {
  id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  created_at: string;
  bookings_count: number;
  last_booking_start: string | null;
  has_axe_booking?: boolean;
  waiver_on_file?: boolean;
  waiver_token?: string | null;
  waiver_view_token?: string | null;
};

type BookingRow = {
  id: string;
  activity: string;
  party_size: number;
  start_ts: string;
  end_ts: string;
  status?: string | null;
  total_cents: number;
};

function mapActivityUI(activity: string) {
  const normalized = String(activity || "").trim().toUpperCase();
  if (!normalized) return null;
  if (normalized.includes("COMBO")) return "Combo Package";
  if (normalized.includes("DUCKPIN")) return "Duckpin Bowling";
  if (normalized.includes("AXE")) return "Axe Throwing";
  return null;
}

function needsWaiver(activity: string) {
  const normalized = String(activity || "").trim().toUpperCase();
  if (!normalized) return false;
  return normalized.includes("AXE") || normalized.includes("COMBO");
}

function getDateKeyInTZ(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function getStartMinInTZ(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateOnly(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimeOnly(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateTimeRange(startIso: string | null, endIso: string | null) {
  if (!startIso) return "—";
  const date = formatDateOnly(startIso);
  const startTime = formatTimeOnly(startIso);
  const endTime = endIso ? formatTimeOnly(endIso) : "";
  return endTime ? `${date} • ${startTime} – ${endTime}` : `${date} • ${startTime}`;
}

export default function CustomersTable() {
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [bookingsByCustomer, setBookingsByCustomer] = useState<Record<string, BookingRow[]>>({});
  const [detailErrorByCustomer, setDetailErrorByCustomer] = useState<Record<string, string>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [staffRole, setStaffRole] = useState<"admin" | "staff" | "">("");
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [waiverLoadingId, setWaiverLoadingId] = useState<string | null>(null);

  async function loadCustomers() {
    setLoading(true);
    const res = await fetch("/api/staff/customers", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    setRows(json.customers || []);
    setLoading(false);
  }

  useEffect(() => {
    loadCustomers();
    (async () => {
      const res = await fetch("/api/staff/me", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setStaffRole((json?.role as "admin" | "staff") || "");
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => {
      return (
        (r.full_name || "").toLowerCase().includes(s) ||
        (r.email || "").toLowerCase().includes(s) ||
        (r.phone || "").toLowerCase().includes(s)
      );
    });
  }, [rows, q]);

  async function toggleCustomer(customerId: string, email?: string) {
    if (expandedId === customerId) {
      setExpandedId(null);
      return;
    }

    setExpandedId(customerId);
    if (bookingsByCustomer[customerId]) return;

    setDetailLoadingId(customerId);
    setDetailErrorByCustomer((prev) => ({ ...prev, [customerId]: "" }));
    try {
      const emailParam = email ? `?email=${encodeURIComponent(email)}` : "";
      const res = await fetch(`/api/staff/customers/${customerId}${emailParam}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDetailErrorByCustomer((prev) => ({ ...prev, [customerId]: json?.error || "Failed to load bookings." }));
        return;
      }
      setBookingsByCustomer((prev) => ({ ...prev, [customerId]: json.bookings || [] }));
    } finally {
      setDetailLoadingId(null);
    }
  }

  async function deleteCustomer(customerId: string, name?: string | null) {
    if (!customerId) return;
    const confirmed = window.confirm(
      `Delete ${name || "this customer"}? This will remove the customer record and any linked data.`
    );
    if (!confirmed) return;

    setDeletingId(customerId);
    try {
      const res = await fetch(`/api/staff/customers/${customerId}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        alert(json?.error || "Failed to delete customer.");
        return;
      }
      setRows((prev) => prev.filter((row) => row.id !== customerId));
      setExpandedId((prev) => (prev === customerId ? null : prev));
    } finally {
      setDeletingId(null);
    }
  }

  async function addCustomer() {
    setAddError("");
    if (!addEmail.trim()) {
      setAddError("Email is required.");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/staff/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: addName,
          email: addEmail,
          phone: addPhone,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAddError(json?.error || "Failed to add customer.");
        return;
      }
      setAddName("");
      setAddEmail("");
      setAddPhone("");
      setShowAdd(false);
      await loadCustomers();
    } finally {
      setAdding(false);
    }
  }

  function startEdit(row: CustomerRow) {
    setEditingId(row.id);
    setEditName(row.full_name || "");
    setEditEmail(row.email || "");
    setEditPhone(row.phone || "");
    setEditError("");
  }

  async function saveEdit(customerId: string) {
    setEditError("");
    if (!editEmail.trim()) {
      setEditError("Email is required.");
      return;
    }
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/staff/customers/${customerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: editName,
          email: editEmail,
          phone: editPhone,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditError(json?.error || "Failed to update customer.");
        return;
      }
      setRows((prev) =>
        prev.map((row) => (row.id === customerId ? { ...row, full_name: editName, email: editEmail, phone: editPhone } : row))
      );
      setEditingId(null);
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleWaiverClick(row: CustomerRow) {
    if (row.waiver_on_file) return;
    if (waiverLoadingId === row.id) return;

    if (row.waiver_token) {
      window.open(`/waiver?token=${encodeURIComponent(row.waiver_token)}`, "_blank", "noopener");
      return;
    }

    setWaiverLoadingId(row.id);
    try {
      const existing = bookingsByCustomer[row.id];
      let bookings = existing;
      if (!bookings) {
        const emailParam = row.email ? `?email=${encodeURIComponent(row.email)}` : "";
        const res = await fetch(`/api/staff/customers/${row.id}${emailParam}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(json?.error || "Failed to load customer bookings.");
          return;
        }
        bookings = json.bookings || [];
      }

      const waiverBooking = (bookings || []).find((b) => needsWaiver(b.activity));
      if (!waiverBooking) {
        alert("No axe throwing or combo booking found for this customer.");
        return;
      }

      const activity = mapActivityUI(waiverBooking.activity);
      if (!activity) {
        alert("Unsupported activity for waiver request.");
        return;
      }

      const dateKey = getDateKeyInTZ(waiverBooking.start_ts, "America/New_York");
      const startMin = getStartMinInTZ(waiverBooking.start_ts, "America/New_York");
      const startMs = new Date(waiverBooking.start_ts).getTime();
      const endMs = waiverBooking.end_ts ? new Date(waiverBooking.end_ts).getTime() : Number.NaN;
      const diffMinutes = Number.isFinite(endMs) ? Math.round((endMs - startMs) / 60000) : 60;
      const durationMinutes = Math.max(1, diffMinutes || 60);

      const res = await fetch("/api/waivers/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId: waiverBooking.id,
          activity,
          partySize: waiverBooking.party_size,
          dateKey,
          startMin,
          durationMinutes,
          customerName: row.full_name || "",
          customerEmail: row.email,
          customerPhone: row.phone || undefined,
          returnPath: "/staff/customers",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.waiverUrl) {
        alert(json?.error || "Failed to create waiver request.");
        return;
      }
      window.open(String(json.waiverUrl), "_blank", "noopener");
      await loadCustomers();
    } finally {
      setWaiverLoadingId(null);
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email, phone..."
          className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
        />
        <div className="flex items-center gap-2">
          {staffRole === "admin" ? (
            <button
              type="button"
              onClick={() => setShowAdd((prev) => !prev)}
              className="rounded-xl border border-zinc-900 bg-zinc-900 px-3 py-2 text-sm font-semibold text-white"
            >
              Add Customer +
            </button>
          ) : null}
          <button
            type="button"
            onClick={loadCustomers}
            className="rounded-xl border border-zinc-900 bg-zinc-900 px-3 py-2 text-sm font-semibold text-white"
          >
            Refresh
          </button>
        </div>
      </div>

      {staffRole === "admin" && showAdd ? (
        <div className="mb-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <input
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="Full name"
              className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
            />
            <input
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
              placeholder="Email"
              className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
            />
            <input
              value={addPhone}
              onChange={(e) => setAddPhone(e.target.value)}
              placeholder="Phone"
              className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
            />
          </div>
          {addError ? <div className="mt-2 text-sm text-red-600">{addError}</div> : null}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={addCustomer}
              disabled={adding}
              className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {adding ? "Adding..." : "Save Customer"}
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-zinc-600">Loading customers…</div>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-600">
              <tr>
                <th className="px-2 py-2 text-center">Customer</th>
                <th className="px-2 py-2 text-center">Phone</th>
                <th className="px-2 py-2 text-center">Bookings</th>
                <th className="px-2 py-2 text-center">Waiver</th>
                <th className="px-2 py-2 text-center">Last Booking</th>
                <th className="px-2 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <Fragment key={r.id}>
                  <tr key={r.id} className="border-t border-zinc-100">
                    <td className="px-2 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => toggleCustomer(r.id, r.email)}
                        className="group mx-auto flex items-center gap-2 font-medium text-zinc-900 hover:underline"
                        title="View bookings"
                      >
                        <span className="text-xs text-zinc-500">{expandedId === r.id ? "▾" : "▸"}</span>
                        <span>{r.full_name || "—"}</span>
                        <span className="text-xs text-zinc-500 group-hover:text-zinc-700">View bookings</span>
                      </button>
                      <div className="text-xs text-zinc-600">{r.email}</div>
                    </td>
                    <td className="px-2 py-2 text-center">{r.phone || "—"}</td>
                    <td className="px-2 py-2 text-center">{r.bookings_count}</td>
                    <td className="px-2 py-2 text-center text-xs font-semibold">
                      {r.has_axe_booking ? (
                        r.waiver_on_file ? (
                          "WAIVER ON FILE"
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleWaiverClick(r)}
                            disabled={waiverLoadingId === r.id}
                            className="text-blue-600 underline disabled:text-zinc-400"
                          >
                            {waiverLoadingId === r.id ? "OPENING..." : "SIGN WAIVER"}
                          </button>
                        )
                      ) : (
                        "--"
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">{formatDate(r.last_booking_start)}</td>
                    <td className="px-2 py-2 text-center">
                      {r.has_axe_booking && r.waiver_on_file && r.waiver_view_token ? (
                        <button
                          type="button"
                          onClick={() =>
                            window.open(
                              `/waiver?token=${encodeURIComponent(r.waiver_view_token || "")}&view=1`,
                              "_blank",
                              "noopener"
                            )
                          }
                          className="ml-2 inline-flex items-center justify-center rounded-full bg-zinc-900 px-3 py-1 text-xs font-semibold text-white"
                        >
                          View Waiver
                        </button>
                      ) : null}
                      {staffRole === "admin" ? (
                        <button
                          type="button"
                          onClick={() => startEdit(r)}
                          className="ml-2 inline-flex items-center justify-center rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white"
                          style={{ backgroundColor: "#2563eb", color: "#ffffff" }}
                        >
                          Edit
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => deleteCustomer(r.id, r.full_name)}
                        disabled={deletingId === r.id}
                        className="ml-2 inline-flex items-center justify-center rounded-full bg-fuchsia-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
                        style={{ backgroundColor: "#c026d3", color: "#fff" }}
                      >
                        {deletingId === r.id ? "Deleting…" : "Delete"}
                      </button>
                    </td>
                  </tr>
                  {editingId === r.id ? (
                    <tr key={`${r.id}-edit`} className="border-t border-zinc-100 bg-zinc-50/60">
                      <td colSpan={5} className="px-3 py-3">
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            placeholder="Full name"
                            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
                          />
                          <input
                            value={editEmail}
                            onChange={(e) => setEditEmail(e.target.value)}
                            placeholder="Email"
                            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
                          />
                          <input
                            value={editPhone}
                            onChange={(e) => setEditPhone(e.target.value)}
                            placeholder="Phone"
                            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
                          />
                        </div>
                        {editError ? <div className="mt-2 text-sm text-red-600">{editError}</div> : null}
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => saveEdit(r.id)}
                            disabled={savingEdit}
                            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                          >
                            {savingEdit ? "Saving..." : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  {expandedId === r.id && (
                    <tr key={`${r.id}-detail`} className="border-t border-zinc-100 bg-zinc-50/60">
                      <td colSpan={6} className="py-3">
                        {detailLoadingId === r.id ? (
                          <div className="text-sm text-zinc-600">Loading bookings…</div>
                        ) : detailErrorByCustomer[r.id] ? (
                          <div className="text-sm text-red-600">{detailErrorByCustomer[r.id]}</div>
                        ) : (bookingsByCustomer[r.id] || []).length === 0 ? (
                          <div className="text-sm text-zinc-600">No bookings yet.</div>
                        ) : (
                          <div className="overflow-auto">
                            <table className="w-full text-sm">
                              <thead className="text-center text-zinc-600">
                                <tr>
                                  <th className="py-2 text-center">Date/Time</th>
                                  <th className="py-2 text-center">Activity</th>
                                  <th className="py-2 text-center">Party</th>
                                  <th className="py-2 text-center">Status</th>
                                  <th className="py-2 text-center">Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(bookingsByCustomer[r.id] || []).map((b) => (
                                  <tr key={b.id} className="border-t border-zinc-100">
                                    <td className="py-2 text-center">{formatDateTimeRange(b.start_ts, b.end_ts)}</td>
                                    <td className="py-2 text-center">{b.activity}</td>
                                    <td className="py-2 text-center">{b.party_size}</td>
                                    <td className="py-2 text-center">{b.status ?? "CONFIRMED"}</td>
                                    <td className="py-2 text-center">${(b.total_cents / 100).toFixed(2)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
