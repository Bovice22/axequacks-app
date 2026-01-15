"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function StaffLoginPage() {
  const router = useRouter();
  const [staffId, setStaffId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/staff/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ staffId, pin }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(json?.error || "Login failed");
        return;
      }

      window.location.href = "/staff/bookings";
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-md px-4 py-12">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-xl font-extrabold text-zinc-900">Staff Login</div>
          <div className="mt-1 text-sm text-zinc-600">Enter your Staff ID and PIN.</div>

          <form className="mt-6 space-y-3" onSubmit={onSubmit}>
            <input
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              placeholder="Staff ID"
              autoComplete="username"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm font-semibold text-zinc-900 outline-none placeholder:text-zinc-900 focus:border-zinc-900"
              required
            />
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="4-digit PIN"
              autoComplete="current-password"
              inputMode="numeric"
              type="password"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm font-semibold text-zinc-900 outline-none placeholder:text-zinc-900 focus:border-zinc-900"
              required
            />

            {error ? <div className="text-sm text-red-600">{error}</div> : null}

            <button
              type="submit"
              disabled={loading}
              className="h-11 w-full rounded-xl bg-zinc-900 text-sm font-extrabold text-white hover:bg-zinc-800 disabled:opacity-60"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
