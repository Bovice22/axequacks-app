"use client";

import { useEffect, useMemo, useState } from "react";

type StaffUser = {
  id: string | number | null;
  auth_user_id?: string | null;
  staff_id: string;
  full_name: string | null;
  role: "staff" | "admin";
  active: boolean;
  created_at: string;
};

export default function StaffUsersAdmin() {
  const [rows, setRows] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const [staffId, setStaffId] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"staff" | "admin">("staff");
  const [pin, setPin] = useState("");
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function loadUsers() {
    setLoading(true);
    const res = await fetch("/api/staff/users", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    setRows(json.users || []);
    setLoading(false);
  }

  useEffect(() => {
    loadUsers();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      r.staff_id.toLowerCase().includes(s) ||
      (r.full_name || "").toLowerCase().includes(s) ||
      r.role.toLowerCase().includes(s)
    );
  }, [rows, q]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setSaving(true);
    try {
      const res = await fetch("/api/staff/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId, fullName, role, pin }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(json?.error || "Failed to create user");
        return;
      }
      setStaffId("");
      setFullName("");
      setRole("staff");
      setPin("");
      await loadUsers();
    } finally {
      setSaving(false);
    }
  }

  async function updateUser(id: string, patch: Partial<StaffUser> & { pin?: string }) {
    if (!id) {
      setActionError("Missing staff user id");
      return;
    }
    setActionError("");
    setActionLoadingId(id);
    try {
      const res = await fetch(`/api/staff/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(json?.error || "Failed to update staff user");
        return;
      }
      if (json.user) {
        setRows((prev) => prev.map((r) => (r.id === id ? json.user : r)));
      } else {
        await loadUsers();
      }
    } finally {
      setActionLoadingId(null);
    }
  }

  async function deleteUser(id: string, label: string) {
    if (!id) {
      setActionError("Missing staff user id");
      return;
    }
    const confirmed = window.confirm(`Delete ${label}? This cannot be undone.`);
    if (!confirmed) return;
    setActionError("");
    setDeletingId(id);
    try {
      const res = await fetch(`/api/staff/users/${id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(json?.error || "Failed to delete staff user");
        return;
      }
      setRows((prev) => prev.filter((r) => String(r.id ?? r.auth_user_id ?? "") !== String(id)));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="text-sm font-extrabold text-zinc-900">Add Staff Member</div>
        <form className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2" onSubmit={createUser}>
          <input
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
            placeholder="Staff ID (short username)"
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
            required
          />
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Full name"
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "staff" | "admin")}
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
          >
            <option value="staff">Staff</option>
            <option value="admin">Admin</option>
          </select>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="4-digit PIN"
            inputMode="numeric"
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
            required
          />
          {formError ? <div className="text-sm text-red-600">{formError}</div> : null}
          <button
            type="submit"
            disabled={saving}
            className="h-10 rounded-xl bg-zinc-900 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Add Staff"}
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search staff ID, name, role..."
            className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={loadUsers}
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
          >
            Refresh
          </button>
        </div>

        {actionError ? <div className="mb-2 text-sm text-red-600">{actionError}</div> : null}

        {loading ? (
          <div className="text-sm text-zinc-600">Loading staff…</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-center text-zinc-600">
                <tr>
                  <th className="py-2 text-center">Staff ID</th>
                  <th className="py-2 text-center">Name</th>
                  <th className="py-2 text-center">Role</th>
                  <th className="py-2 text-center">Active</th>
                  <th className="py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t border-zinc-100">
                    <td className="py-2 text-center font-mono text-xs">{r.staff_id}</td>
                    <td className="py-2 text-center">{r.full_name || "—"}</td>
                    <td className="py-2 text-center">{r.role}</td>
                    <td className="py-2 text-center">{r.active ? "Yes" : "No"}</td>
                    <td className="py-2 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const userId = r.id ?? r.auth_user_id;
                            updateUser(userId != null ? String(userId) : "", { active: !r.active, staffId: r.staff_id });
                          }}
                          disabled={actionLoadingId === String(r.id ?? r.auth_user_id ?? "")}
                          className="inline-flex h-8 min-w-[92px] items-center justify-center rounded-lg border px-3 text-xs font-semibold disabled:opacity-60"
                          style={
                            r.active
                              ? { backgroundColor: "#dc2626", borderColor: "#dc2626", color: "#ffffff" }
                              : { backgroundColor: "#16a34a", borderColor: "#16a34a", color: "#ffffff" }
                          }
                        >
                          {actionLoadingId === String(r.id ?? r.auth_user_id ?? "") ? "Working..." : r.active ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const newPin = prompt("Enter new 4-digit PIN");
                            if (newPin) {
                              const userId = r.id ?? r.auth_user_id;
                              updateUser(userId != null ? String(userId) : "", { pin: newPin, staffId: r.staff_id });
                            }
                          }}
                          disabled={actionLoadingId === String(r.id ?? r.auth_user_id ?? "")}
                          className="inline-flex h-8 min-w-[92px] items-center justify-center rounded-lg border px-3 text-xs font-semibold disabled:opacity-60"
                          style={{ backgroundColor: "#2563eb", borderColor: "#2563eb", color: "#ffffff" }}
                        >
                          {actionLoadingId === String(r.id ?? r.auth_user_id ?? "") ? "Working..." : "Reset PIN"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const userId = r.id ?? r.auth_user_id;
                            const newRole = r.role === "admin" ? "staff" : "admin";
                            updateUser(userId != null ? String(userId) : "", { role: newRole, staffId: r.staff_id });
                          }}
                          disabled={actionLoadingId === String(r.id ?? r.auth_user_id ?? "")}
                          className="inline-flex h-8 min-w-[110px] items-center justify-center rounded-lg border px-3 text-xs font-semibold disabled:opacity-60"
                          style={{ backgroundColor: "#0f172a", borderColor: "#0f172a", color: "#ffffff" }}
                        >
                          {actionLoadingId === String(r.id ?? r.auth_user_id ?? "") ? "Working..." : "Change Role"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const userId = r.id ?? r.auth_user_id;
                            deleteUser(userId != null ? String(userId) : "", r.full_name || r.staff_id);
                          }}
                          disabled={deletingId === String(r.id ?? r.auth_user_id ?? "")}
                          className="inline-flex h-8 min-w-[88px] items-center justify-center rounded-lg border px-3 text-xs font-semibold disabled:opacity-60"
                          style={{ backgroundColor: "#c026d3", borderColor: "#c026d3", color: "#ffffff" }}
                        >
                          {deletingId === String(r.id ?? r.auth_user_id ?? "") ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
