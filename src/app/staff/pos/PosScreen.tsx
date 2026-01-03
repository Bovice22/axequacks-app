"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadStripeTerminal, type Terminal, type Reader } from "@stripe/terminal-js";

type InventoryItem = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  image_url?: string | null;
  active: boolean;
};

type CartRow = {
  item: InventoryItem;
  quantity: number;
};

const TAX_RATE = 0.0725;

export default function PosScreen() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<Record<string, CartRow>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [terminalReaders, setTerminalReaders] = useState<Reader[]>([]);
  const [selectedReaderId, setSelectedReaderId] = useState("");
  const [terminalLoading, setTerminalLoading] = useState(false);
  const [terminalError, setTerminalError] = useState("");

  const terminalRef = useRef<Terminal | null>(null);
  const terminalReadyRef = useRef(false);

  useEffect(() => {
    if (terminalReadyRef.current) return;
    terminalReadyRef.current = true;

    loadStripeTerminal().then((StripeTerminal) => {
      if (!StripeTerminal) {
        setTerminalError("Stripe Terminal failed to load. Please refresh.");
        return;
      }
      terminalRef.current = StripeTerminal.create({
        onFetchConnectionToken: async () => {
          const res = await fetch("/api/stripe/terminal/connection_token", { method: "POST" });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || !json?.secret) {
            throw new Error(json?.error || "Failed to fetch connection token.");
          }
          return json.secret as string;
        },
        onUnexpectedReaderDisconnect: () => {
          setTerminalError("Reader disconnected. Please reconnect.");
        },
      });
    });
  }, []);

  async function loadItems() {
    setLoading(true);
    const res = await fetch("/api/staff/addons", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    setItems((json.addons || []).filter((item: InventoryItem) => item.active));
    setLoading(false);
  }

  async function loadReaders() {
    try {
      const res = await fetch("/api/stripe/terminal/readers");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTerminalError(json?.error || "Failed to load card readers.");
        return;
      }
      setTerminalReaders(json.readers || []);
      if (!selectedReaderId && json.readers?.length) {
        setSelectedReaderId(json.readers[0].id);
      }
    } catch (e: any) {
      setTerminalError(e?.message || "Failed to load card readers.");
    }
  }

  useEffect(() => {
    loadItems();
    loadReaders();
  }, []);

  const cartRows = useMemo(() => Object.values(cart), [cart]);
  const subtotalCents = useMemo(
    () => cartRows.reduce((sum, row) => sum + row.item.price_cents * row.quantity, 0),
    [cartRows]
  );
  const taxCents = useMemo(() => Math.round(subtotalCents * TAX_RATE), [subtotalCents]);
  const totalCents = useMemo(() => subtotalCents + taxCents, [subtotalCents, taxCents]);

  function addToCart(item: InventoryItem) {
    setCart((prev) => {
      const existing = prev[item.id];
      const nextQty = existing ? existing.quantity + 1 : 1;
      return { ...prev, [item.id]: { item, quantity: nextQty } };
    });
  }

  function updateQty(itemId: string, nextQty: number) {
    setCart((prev) => {
      if (nextQty <= 0) {
        const next = { ...prev };
        delete next[itemId];
        return next;
      }
      return { ...prev, [itemId]: { ...prev[itemId], quantity: nextQty } };
    });
  }

  function clearCart() {
    setCart({});
  }

  async function handlePayment() {
    setError("");
    setSuccess("");
    setTerminalError("");

    if (!terminalRef.current) {
      setTerminalError("Stripe Terminal not initialized.");
      return;
    }
    if (!cartRows.length) {
      setError("Add at least one item to the cart.");
      return;
    }
    if (!selectedReaderId) {
      setTerminalError("Select a reader to continue.");
      return;
    }

    setTerminalLoading(true);
    try {
      const reader = terminalReaders.find((r) => r.id === selectedReaderId);
      if (!reader) {
        setTerminalError("Reader not found.");
        return;
      }

      const connectResult = await terminalRef.current.connectReader(reader);
      if (connectResult.error) {
        setTerminalError(connectResult.error.message || "Failed to connect reader.");
        return;
      }

      const intentRes = await fetch("/api/stripe/terminal/pos_payment_intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cartRows.map((row) => ({ id: row.item.id, quantity: row.quantity })),
        }),
      });
      const intentJson = await intentRes.json().catch(() => ({}));
      if (!intentRes.ok || !intentJson?.client_secret) {
        setTerminalError(intentJson?.error || "Failed to create payment intent.");
        return;
      }

      const collectResult = await terminalRef.current.collectPaymentMethod(intentJson.client_secret);
      if (collectResult.error) {
        setTerminalError(collectResult.error.message || "Payment collection failed.");
        return;
      }

      const processResult = await terminalRef.current.processPayment(collectResult.paymentIntent);
      if (processResult.error) {
        setTerminalError(processResult.error.message || "Payment failed.");
        return;
      }

      const paymentIntentId = processResult.paymentIntent?.id;
      if (!paymentIntentId) {
        setTerminalError("Payment completed, but no payment intent returned.");
        return;
      }

      const finalizeRes = await fetch("/api/stripe/terminal/pos_finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_intent_id: paymentIntentId }),
      });
      const finalizeJson = await finalizeRes.json().catch(() => ({}));
      if (!finalizeRes.ok) {
        setTerminalError(finalizeJson?.error || "Payment succeeded but POS record failed.");
        return;
      }

      clearCart();
      setSuccess("Payment completed and sale recorded.");
    } catch (e: any) {
      setTerminalError(e?.message || "Terminal payment failed.");
    } finally {
      setTerminalLoading(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-sm font-extrabold text-zinc-900">Inventory</div>
          <button
            type="button"
            onClick={loadItems}
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="text-sm text-zinc-600">Loading inventory…</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => addToCart(item)}
                className="flex flex-col rounded-2xl border border-zinc-200 bg-white p-3 text-left transition hover:border-zinc-300"
              >
                <div className="mb-2 flex items-center gap-3">
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt={item.name}
                      className="h-12 w-12 rounded-xl border border-zinc-200 object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-dashed border-zinc-300 text-[10px] text-zinc-400">
                      No image
                    </div>
                  )}
                  <div>
                    <div className="text-sm font-semibold text-zinc-900">{item.name}</div>
                    <div className="text-xs text-zinc-500">{item.description || "No description"}</div>
                  </div>
                </div>
                <div className="mt-auto text-sm font-semibold text-zinc-900">
                  ${Number(item.price_cents / 100).toFixed(2)}
                </div>
                <div className="mt-2 rounded-xl border border-zinc-200 px-3 py-2 text-center text-xs font-semibold text-zinc-700">
                  Add to cart
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="mb-3 text-sm font-extrabold text-zinc-900">Cart</div>
          {!cartRows.length ? (
            <div className="text-sm text-zinc-600">No items added yet.</div>
          ) : (
            <div className="space-y-3">
              {cartRows.map((row) => (
                <div key={row.item.id} className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-zinc-900">{row.item.name}</div>
                    <div className="text-xs text-zinc-500">
                      ${(row.item.price_cents / 100).toFixed(2)} each
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateQty(row.item.id, row.quantity - 1)}
                      className="h-7 w-7 rounded-full border border-zinc-200 text-sm"
                    >
                      -
                    </button>
                    <div className="w-6 text-center text-sm">{row.quantity}</div>
                    <button
                      type="button"
                      onClick={() => updateQty(row.item.id, row.quantity + 1)}
                      className="h-7 w-7 rounded-full border border-zinc-200 text-sm"
                    >
                      +
                    </button>
                  </div>
                  <div className="text-sm font-semibold text-zinc-900">
                    ${(row.item.price_cents * row.quantity / 100).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 border-t border-zinc-200 pt-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-zinc-600">Subtotal</span>
              <span className="font-semibold text-zinc-900">${(subtotalCents / 100).toFixed(2)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-zinc-600">Tax (7.25%)</span>
              <span className="font-semibold text-zinc-900">${(taxCents / 100).toFixed(2)}</span>
            </div>
            <div className="mt-3 flex items-center justify-between text-base font-semibold text-zinc-900">
              <span>Total</span>
              <span>${(totalCents / 100).toFixed(2)}</span>
            </div>
          </div>

          {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
          {success ? <div className="mt-3 text-sm text-emerald-600">{success}</div> : null}
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="mb-3 text-sm font-extrabold text-zinc-900">Terminal</div>
          <label className="text-xs font-semibold uppercase text-zinc-500">Reader</label>
          <select
            value={selectedReaderId}
            onChange={(e) => setSelectedReaderId(e.target.value)}
            className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
          >
            <option value="">Select a reader</option>
            {terminalReaders.map((reader) => (
              <option key={reader.id} value={reader.id}>
                {reader.label || reader.device_type || reader.id}
              </option>
            ))}
          </select>

          {terminalError ? <div className="mt-3 text-sm text-red-600">{terminalError}</div> : null}

          <button
            type="button"
            onClick={handlePayment}
            disabled={terminalLoading}
            className="mt-4 w-full rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {terminalLoading ? "Processing…" : "Collect Payment"}
          </button>
        </div>
      </div>
    </div>
  );
}
