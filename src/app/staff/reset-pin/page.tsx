"use client";

import { useState } from "react";

export default function StaffResetPinPage() {
  const [staffId, setStaffId] = useState("");
  const [pin, setPin] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [status, setStatus] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("");

    const res = await fetch("/api/staff/admin-reset-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staffId, pin, adminPassword }),
    });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setStatus(json?.error || "Reset failed");
      return;
    }

    setStatus(`OK: ${json?.staffId || "updated"}`);
    setStaffId("");
    setPin("");
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-md px-4 py-12">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-xl font-extrabold text-zinc-900">Reset Staff PIN</div>
          <div className="mt-1 text-sm text-zinc-600">
            Use the admin password to set a new 4-digit PIN.
          </div>

          <form className="mt-6 space-y-3" onSubmit={onSubmit}>
            <input
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              placeholder="Staff ID"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm font-semibold outline-none focus:border-zinc-900"
              required
            />
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="New 4-digit PIN"
              inputMode="numeric"
              type="password"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm font-semibold outline-none focus:border-zinc-900"
              required
            />
            <input
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder="Admin password"
              type="password"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm font-semibold outline-none focus:border-zinc-900"
              required
            />

            {status ? <div className="text-sm text-zinc-700">{status}</div> : null}

            <button
              type="submit"
              className="h-11 w-full rounded-xl bg-zinc-900 text-sm font-extrabold text-white hover:bg-zinc-800"
            >
              Reset PIN
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
