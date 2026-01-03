"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Customer = {
  id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  created_at: string;
};

type Waiver = {
  id: string;
  signer_name: string;
  signer_email: string | null;
  signed_at: string;
  created_at: string;
  booking_id: string | null;
};

type Booking = {
  id: string;
  activity: string;
  party_size: number;
  start_ts: string;
  end_ts: string;
  status?: string | null;
  total_cents: number;
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function CustomerDetail({ customerId }: { customerId: string }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [waivers, setWaivers] = useState<Waiver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/staff/customers/${customerId}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(json?.error || "Failed to load customer.");
          return;
        }
        setCustomer(json.customer || null);
        setBookings(json.bookings || []);
        setWaivers(json.waivers || []);
        setEditName(json?.customer?.full_name || "");
        setEditEmail(json?.customer?.email || "");
        setEditPhone(json?.customer?.phone || "");
      } finally {
        setLoading(false);
      }
    })();
  }, [customerId]);

  async function saveCustomer() {
    if (!customer) return;
    setEditSaving(true);
    setEditError("");
    try {
      const res = await fetch(`/api/staff/customers/${customer.id}`, {
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
      setCustomer(json.customer || null);
    } finally {
      setEditSaving(false);
    }
  }

  async function deleteCustomer() {
    if (!customer) return;
    setDeleteError("");
    if (!confirm("Delete this customer? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/staff/customers/${customer.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleteError(json?.error || "Failed to delete customer.");
        return;
      }
      window.location.href = "/staff/customers";
    } catch (err: any) {
      setDeleteError(err?.message || "Failed to delete customer.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/staff/customers" className="text-sm font-semibold text-zinc-700 hover:underline">
          ← Back to customers
        </Link>
      </div>

      {loading ? (
        <div className="text-sm text-zinc-600">Loading customer…</div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      ) : customer ? (
        <>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="text-lg font-extrabold text-zinc-900">{customer.full_name || "Customer"}</div>
            <div className="mt-2 text-sm text-zinc-700">Email: {customer.email}</div>
            <div className="mt-1 text-sm text-zinc-700">Phone: {customer.phone || "—"}</div>
            <div className="mt-1 text-xs text-zinc-500">
              Created: {new Date(customer.created_at).toLocaleDateString("en-US")}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="text-sm font-extrabold text-zinc-900">Edit Profile</div>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Full Name"
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
              {editError ? <div className="text-sm text-red-600 md:col-span-3">{editError}</div> : null}
              <div className="flex items-center gap-2 md:col-span-3">
                <button
                  type="button"
                  onClick={saveCustomer}
                  disabled={editSaving}
                  className="h-10 rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {editSaving ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  onClick={deleteCustomer}
                  className="h-10 rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-700"
                >
                  Delete Customer
                </button>
              </div>
              {deleteError ? <div className="text-sm text-red-600 md:col-span-3">{deleteError}</div> : null}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="text-sm font-extrabold text-zinc-900">Waivers</div>
            {waivers.length === 0 ? (
              <div className="mt-3 text-sm text-zinc-600">No signed waivers on file.</div>
            ) : (
              <div className="mt-3 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-zinc-600">
                    <tr>
                      <th className="py-2">Signed By</th>
                      <th className="py-2">Email</th>
                      <th className="py-2">Signed At</th>
                      <th className="py-2">Booking</th>
                    </tr>
                  </thead>
                  <tbody>
                    {waivers.map((w) => (
                      <tr key={w.id} className="border-t border-zinc-100">
                        <td className="py-2">{w.signer_name}</td>
                        <td className="py-2">{w.signer_email || "—"}</td>
                        <td className="py-2">{formatDateTime(w.signed_at)}</td>
                        <td className="py-2">{w.booking_id || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="text-sm font-extrabold text-zinc-900">Booking History</div>
            {bookings.length === 0 ? (
              <div className="mt-3 text-sm text-zinc-600">No bookings yet.</div>
            ) : (
              <div className="mt-3 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-zinc-600">
                    <tr>
                      <th className="py-2">Date/Time</th>
                      <th className="py-2">Activity</th>
                      <th className="py-2">Party</th>
                      <th className="py-2">Status</th>
                      <th className="py-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.map((b) => (
                      <tr key={b.id} className="border-t border-zinc-100">
                        <td className="py-2">{formatDateTime(b.start_ts)}</td>
                        <td className="py-2">{b.activity}</td>
                        <td className="py-2">{b.party_size}</td>
                        <td className="py-2">{b.status ?? "CONFIRMED"}</td>
                        <td className="py-2">${(b.total_cents / 100).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
