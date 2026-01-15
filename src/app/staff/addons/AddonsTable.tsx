"use client";

import { useEffect, useRef, useState } from "react";

type Addon = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  image_url?: string | null;
  category?: string | null;
  active: boolean;
  created_at: string;
};

export default function AddonsTable() {
  const categoryOptions = ["Concessions", "Beverages", "Alcohol", "Merchandise"];
  const [rows, setRows] = useState<Addon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [editImagePreview, setEditImagePreview] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const editSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!imageFile) {
      setImagePreview(null);
      return;
    }
    const next = URL.createObjectURL(imageFile);
    setImagePreview(next);
    return () => URL.revokeObjectURL(next);
  }, [imageFile]);

  useEffect(() => {
    if (!editImageFile) {
      setEditImagePreview(null);
      return;
    }
    const next = URL.createObjectURL(editImageFile);
    setEditImagePreview(next);
    return () => URL.revokeObjectURL(next);
  }, [editImageFile]);

  async function loadAddons() {
    setLoading(true);
    const res = await fetch("/api/staff/addons", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json?.error || "Failed to load inventory.");
      setRows([]);
      setLoading(false);
      return;
    }
    setRows(json.addons || []);
    setLoading(false);
  }

  useEffect(() => {
    loadAddons();
  }, []);

  useEffect(() => {
    if (!editId || !editSectionRef.current) return;
    editSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [editId]);

  async function uploadImage() {
    if (!imageFile) return "";
    const form = new FormData();
    form.append("file", imageFile);
    const res = await fetch("/api/staff/inventory/upload", { method: "POST", body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.url) {
      throw new Error(json?.error || "Failed to upload image");
    }
    return String(json.url);
  }

  async function uploadEditImage() {
    if (!editImageFile) return "";
    const form = new FormData();
    form.append("file", editImageFile);
    const res = await fetch("/api/staff/inventory/upload", { method: "POST", body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.url) {
      throw new Error(json?.error || "Failed to upload image");
    }
    return String(json.url);
  }

  async function createAddon(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const parsedPrice = Number(price);
      if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
        setError("Enter a valid price.");
        return;
      }
      const priceCents = Math.round(parsedPrice * 100);
      const imageUrl = await uploadImage();

      const res = await fetch("/api/staff/addons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          price_cents: priceCents,
          image_url: imageUrl,
          category: category || null,
          active,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || "Failed to create add-on");
        return;
      }
      setName("");
      setDescription("");
      setPrice("");
      setCategory("");
      setImageFile(null);
      setActive(true);
      await loadAddons();
    } catch (err: any) {
      setError(err?.message || "Failed to create product.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(id: string, next: boolean, name?: string) {
    const fallbackName = name?.trim() || "";
    const loadingKey = id || fallbackName;
    if (!loadingKey) {
      setActionError("Missing product id");
      return;
    }
    setActionError("");
    setActionLoadingId(loadingKey);
    try {
      const res = id
        ? await fetch(`/api/staff/addons/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: next }),
          })
        : await fetch("/api/staff/addons", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: fallbackName, active: next }),
          });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(json?.error || "Failed to update product");
        return;
      }
      if (json?.addon) {
        setRows((prev) => prev.map((r) => (r.id === id ? json.addon : r)));
      } else {
        await loadAddons();
      }
    } finally {
      setActionLoadingId(null);
    }
  }

  async function deleteProduct(id: string) {
    if (!id) {
      setActionError("Missing product id");
      return;
    }
    setActionError("");
    setActionLoadingId(id);
    try {
      const res = await fetch(`/api/staff/addons/${id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(json?.error || "Failed to delete product");
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== id));
    } finally {
      setActionLoadingId(null);
    }
  }

  function startEdit(addon: Addon) {
    setEditId(addon.id);
    setEditName(addon.name);
    setEditDescription(addon.description || "");
    setEditPrice((addon.price_cents / 100).toFixed(2));
    setEditCategory(addon.category || "");
    setEditImageFile(null);
    setEditImagePreview(null);
    setEditError("");
  }

  async function saveEdit() {
    if (!editId) return;
    setEditSaving(true);
    setEditError("");
    try {
      const parsedPrice = Number(editPrice);
      if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
        setEditError("Enter a valid price.");
        return;
      }
      const priceCents = Math.round(parsedPrice * 100);
      const imageUrl = await uploadEditImage();

      const res = await fetch(`/api/staff/addons/${editId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          description: editDescription,
          price_cents: priceCents,
          image_url: imageUrl || undefined,
          category: editCategory || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditError(json?.error || "Failed to update product");
        return;
      }
      if (json?.addon) {
        setRows((prev) => prev.map((r) => (r.id === editId ? json.addon : r)));
      } else {
        await loadAddons();
      }
      setEditId(null);
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="text-sm font-extrabold text-zinc-900">Create Product</div>
        <form className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-6" onSubmit={createAddon}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm text-zinc-900 placeholder:text-zinc-900"
            required
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description"
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm text-zinc-900 placeholder:text-zinc-900"
          />
          <input
            type="number"
            step="0.01"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Price (USD)"
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm text-zinc-900 placeholder:text-zinc-900"
            required
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
          >
            <option value="">Category</option>
            {categoryOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <label className="flex h-10 items-center gap-2 rounded-xl border border-zinc-200 px-3 text-sm text-zinc-900">
            <input
              type="file"
              accept="image/*"
              className="text-sm"
              onChange={(e) => setImageFile(e.target.files?.[0] || null)}
            />
            <span>Image</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-900">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Active
          </label>
          {imagePreview ? (
            <div className="flex items-center gap-3 md:col-span-6">
              <img
                src={imagePreview}
                alt="Preview"
                width={100}
                height={100}
                className="block h-[100px] w-[100px] rounded-2xl object-contain"
                style={{ width: 100, height: 100, maxWidth: 100, maxHeight: 100 }}
              />
              <span className="text-xs text-zinc-900">Preview</span>
            </div>
          ) : null}
          {error ? <div className="text-sm text-red-600 md:col-span-6">{error}</div> : null}
          <button
            type="submit"
            disabled={saving}
            className="h-10 rounded-xl bg-zinc-900 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 md:col-span-6"
          >
            {saving ? "Saving..." : "Add Product"}
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-sm font-extrabold text-zinc-900">Inventory</div>
          <button
            type="button"
            onClick={loadAddons}
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
          >
            Refresh
          </button>
        </div>
        {actionError ? <div className="mb-2 text-sm text-red-600">{actionError}</div> : null}
        {loading ? (
          <div className="text-sm text-zinc-900">Loading add-ons…</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-zinc-900">
                <tr>
                  <th className="px-2 py-2 text-center">Product</th>
                  <th className="px-2 py-2 text-center">Description</th>
                  <th className="px-2 py-2 text-center">Price</th>
                  <th className="px-2 py-2 text-center">Category</th>
                  <th className="px-2 py-2 text-center">Active</th>
                  <th className="px-2 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-zinc-100">
                    <td className="px-2 py-2 text-center align-middle">
                      <div className="flex w-full flex-col items-center justify-center gap-2 text-center">
                        <div
                          className="flex items-center justify-center overflow-hidden rounded-2xl border border-zinc-200"
                          style={{ width: 100, height: 100 }}
                        >
                          {r.image_url ? (
                            <img
                              src={r.image_url}
                              alt={r.name}
                              width={100}
                              height={100}
                              className="block h-full w-full object-contain"
                              style={{ width: 100, height: 100, maxWidth: 100, maxHeight: 100 }}
                            />
                          ) : (
                            <span className="text-[10px] text-zinc-900">No image</span>
                          )}
                        </div>
                        <div className="font-medium text-zinc-900">{r.name}</div>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-center text-zinc-900">{r.description || "—"}</td>
                    <td className="px-2 py-2 text-center text-zinc-900">
                      ${(r.price_cents / 100).toFixed(2)}
                    </td>
                    <td className="px-2 py-2 text-center text-zinc-900">{r.category || "—"}</td>
                    <td className="px-2 py-2 text-center text-zinc-900">{r.active ? "Yes" : "No"}</td>
                    <td className="px-2 py-2 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(r)}
                          className="inline-flex h-8 min-w-[72px] items-center justify-center rounded-lg border px-3 text-xs font-semibold text-white"
                          style={{ backgroundColor: "#2563eb", borderColor: "#2563eb" }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleActive(r.id, !r.active, r.name)}
                          disabled={actionLoadingId === (r.id || r.name)}
                          className="inline-flex h-8 min-w-[92px] items-center justify-center rounded-lg border px-3 text-xs font-semibold disabled:opacity-60"
                          style={
                            r.active
                              ? { backgroundColor: "#dc2626", borderColor: "#dc2626", color: "#ffffff" }
                              : { backgroundColor: "#16a34a", borderColor: "#16a34a", color: "#ffffff" }
                          }
                        >
                          {actionLoadingId === (r.id || r.name) ? "Working..." : r.active ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteProduct(r.id)}
                          disabled={actionLoadingId === r.id}
                          className="inline-flex h-8 min-w-[72px] items-center justify-center rounded-lg border px-3 text-xs font-semibold text-white disabled:opacity-60"
                          style={{ backgroundColor: "#7c3aed", borderColor: "#7c3aed" }}
                        >
                          {actionLoadingId === r.id ? "Working..." : "Delete"}
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

      {editId ? (
        <div ref={editSectionRef} className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="mb-3 text-sm font-extrabold text-zinc-900">Edit Product</div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Name"
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm text-zinc-900 placeholder:text-zinc-900"
            required
          />
          <input
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            placeholder="Description"
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm text-zinc-900 placeholder:text-zinc-900"
          />
            <input
              type="number"
              step="0.01"
            min="0"
            value={editPrice}
            onChange={(e) => setEditPrice(e.target.value)}
            placeholder="Price (USD)"
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm text-zinc-900 placeholder:text-zinc-900"
            required
          />
            <select
              value={editCategory}
              onChange={(e) => setEditCategory(e.target.value)}
              className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
            >
              <option value="">Category</option>
              {categoryOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <label className="flex h-10 items-center gap-2 rounded-xl border border-zinc-200 px-3 text-sm text-zinc-900">
              <input
                type="file"
                accept="image/*"
                className="text-sm"
                onChange={(e) => setEditImageFile(e.target.files?.[0] || null)}
              />
              <span>Image</span>
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={saveEdit}
                disabled={editSaving}
                className="h-10 rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60"
              >
                {editSaving ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setEditId(null)}
                className="h-10 rounded-xl border border-zinc-200 px-4 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
          {editImagePreview ? (
            <div className="mt-3 flex items-center gap-3">
              <img
                src={editImagePreview}
                alt="Preview"
                width={100}
                height={100}
                className="block h-[100px] w-[100px] rounded-2xl object-contain"
                style={{ width: 100, height: 100, maxWidth: 100, maxHeight: 100 }}
              />
              <span className="text-xs text-zinc-900">Preview</span>
            </div>
          ) : null}
          {editError ? <div className="mt-2 text-sm text-red-600">{editError}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
