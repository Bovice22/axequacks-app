"use client";

import { useState } from "react";

export default function StaffBootstrapPage() {
  const [authUserId, setAuthUserId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("admin");
  const [pin, setPin] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [status, setStatus] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("");
    const res = await fetch("/api/staff/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authUserId, staffId, fullName, role, pin, adminPassword }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(json?.error || "Bootstrap failed");
      return;
    }
    setStatus(`OK: ${json?.user?.staff_id || "updated"}`);
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-lg px-4 py-12">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-xl font-extrabold text-zinc-900">Staff Bootstrap</div>
          <div className="mt-1 text-sm text-zinc-600">One-time setup for your first admin.</div>

          <form className="mt-6 space-y-3" onSubmit={onSubmit}>
            <input
              value={authUserId}
              onChange={(e) => setAuthUserId(e.target.value)}
              placeholder="Supabase Auth User ID (UUID)"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm"
              required
            />
            <input
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              placeholder="Staff ID (e.g., bda)"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm"
              required
            />
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Full name"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm"
            >
              <option value="admin">Admin</option>
              <option value="staff">Staff</option>
            </select>
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="4-digit PIN"
              inputMode="numeric"
              type="password"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm"
              required
            />
            <input
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder="Admin bootstrap password"
              type="password"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm"
              required
            />
            {status ? <div className="text-sm text-zinc-700">{status}</div> : null}
            <button
              type="submit"
              className="h-11 w-full rounded-xl bg-zinc-900 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              Bootstrap Admin
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
