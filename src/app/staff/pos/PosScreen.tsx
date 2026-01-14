"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadStripeTerminal, type Terminal, type Reader } from "@stripe/terminal-js";

function todayDateKeyNY(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function fmtNY(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
}

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

type TabRow = {
  id: string;
  booking_id: string;
  customer_name: string | null;
  customer_email: string | null;
  status: string | null;
  created_at?: string | null;
};

type TabItemRow = {
  id: string;
  item_id: string;
  quantity: number;
  name: string;
  price_cents: number;
  image_url?: string | null;
  line_total_cents: number;
};

type BookingOption = {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  start_ts: string;
  end_ts: string;
  status?: string | null;
  activity?: string | null;
};

const TAX_RATE = 0.0725;

export default function PosScreen() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<Record<string, CartRow>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [tabs, setTabs] = useState<TabRow[]>([]);
  const [activeTabId, setActiveTabId] = useState("");
  const [activeTabName, setActiveTabName] = useState("");
  const [activeTabStatus, setActiveTabStatus] = useState("");
  const [tabItems, setTabItems] = useState<TabItemRow[]>([]);
  const [tabLoading, setTabLoading] = useState(false);
  const [tabModalOpen, setTabModalOpen] = useState(false);
  const [tabDateKey, setTabDateKey] = useState("");
  const [tabBookings, setTabBookings] = useState<BookingOption[]>([]);
  const [tabBookingsLoading, setTabBookingsLoading] = useState(false);
  const [tabBookingsError, setTabBookingsError] = useState("");
  const [tabOffset, setTabOffset] = useState(0);
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const tabTrackRef = useRef<HTMLDivElement | null>(null);
  const tabWheelAccumRef = useRef(0);
  const [tabDragging, setTabDragging] = useState(false);
  const [tabSearch, setTabSearch] = useState("");
  const [itemQuery, setItemQuery] = useState("");

  const [terminalReaders, setTerminalReaders] = useState<Reader[]>([]);
  const [selectedReaderId, setSelectedReaderId] = useState("");
  const [terminalLoading, setTerminalLoading] = useState(false);
  const [terminalError, setTerminalError] = useState("");
  const [terminalPhase, setTerminalPhase] = useState<"idle" | "connecting" | "collecting" | "processing">("idle");
  const [cashLoading, setCashLoading] = useState(false);
  const [cashModalOpen, setCashModalOpen] = useState(false);
  const [cashInput, setCashInput] = useState("");
  const cashInputRef = useRef<HTMLInputElement | null>(null);

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

  async function loadTabs(nextTabId?: string) {
    const res = await fetch("/api/staff/tabs?status=OPEN", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    const nextTabs = Array.isArray(json.tabs) ? (json.tabs as TabRow[]) : [];
    setTabs(nextTabs);
    if (nextTabId) {
      setActiveTabId(nextTabId);
      return;
    }
  }

  async function loadTabItems(tabId: string) {
    if (!tabId) {
      setTabItems([]);
      setActiveTabName("");
      setActiveTabStatus("");
      return;
    }
    setTabLoading(true);
    try {
      const res = await fetch(`/api/staff/tabs/${tabId}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || "Failed to load tab.");
        return;
      }
      setTabItems(Array.isArray(json.items) ? json.items : []);
      const tab = json?.tab;
      setActiveTabName(tab?.customer_name || tab?.customer_email || "Customer");
      setActiveTabStatus(String(tab?.status || ""));
      clearCart();
    } finally {
      setTabLoading(false);
    }
  }

  async function addToTab(item: InventoryItem) {
    if (!activeTabId) return;
    await fetch(`/api/staff/tabs/${activeTabId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_id: item.id, delta: 1 }),
    });
    await loadTabItems(activeTabId);
  }

  async function updateTabQty(itemId: string, delta: number) {
    if (!activeTabId) return;
    await fetch(`/api/staff/tabs/${activeTabId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_id: itemId, delta }),
    });
    await loadTabItems(activeTabId);
  }

  async function addCartToTab() {
    if (!activeTabId || !cartRows.length) return;
    for (const row of cartRows) {
      await fetch(`/api/staff/tabs/${activeTabId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: row.item.id, delta: row.quantity }),
      });
    }
    clearCart();
    await loadTabItems(activeTabId);
  }

  async function loadTabBookings(dateKey: string) {
    setTabBookingsLoading(true);
    setTabBookingsError("");
    try {
      const query = dateKey ? `?date_key=${encodeURIComponent(dateKey)}` : "";
      const res = await fetch(`/api/staff/tabs/bookings${query}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTabBookingsError(json?.error || "Failed to load bookings.");
        setTabBookings([]);
        return;
      }
      setTabBookings(Array.isArray(json.bookings) ? json.bookings : []);
      setTabOffset(0);
      setTabSearch("");
    } finally {
      setTabBookingsLoading(false);
    }
  }

  function openTabModal() {
    const nextDate = tabDateKey || "";
    setTabDateKey(nextDate);
    setTabModalOpen(true);
    loadTabBookings(nextDate);
  }

  function closeTabModal() {
    setTabModalOpen(false);
    setTabBookings([]);
    setTabBookingsError("");
    setTabOffset(0);
    setTabSearch("");
  }

  async function openTabForBooking(bookingId: string) {
    const res = await fetch("/api/staff/tabs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ booking_id: bookingId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.tab?.id) {
      setTabBookingsError(json?.error || "Failed to open tab.");
      return;
    }
    await loadTabs(json.tab.id);
    setActiveTabId(json.tab.id);
    closeTabModal();
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
    const params = new URLSearchParams(window.location.search);
    const tabId = params.get("tab") || "";
    if (tabId) {
      loadTabs(tabId);
    } else {
      loadTabs();
    }
    setTabDateKey("");
  }, []);

  useEffect(() => {
    if (!activeTabId) {
      setTabItems([]);
      setActiveTabName("");
      setActiveTabStatus("");
      return;
    }
    loadTabItems(activeTabId);
  }, [activeTabId]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    if (tabModalOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = prev || "";
    }
    return () => {
      document.body.style.overflow = prev || "";
    };
  }, [tabModalOpen]);

  useEffect(() => {
    setTabOffset(0);
  }, [tabBookings.length]);

  useEffect(() => {
    if (!cashModalOpen) return;
    const id = window.setTimeout(() => {
      cashInputRef.current?.focus();
      cashInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, [cashModalOpen]);

  const groupedTabBookings = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; customerLabel: string; start_ts: string; end_ts: string; bookingIds: string[]; activity: string }
    >();
    const query = tabSearch.trim().toLowerCase();
    for (const booking of tabBookings) {
      const label = (booking.customer_name || booking.customer_email || "Customer").trim();
      const matchTarget = label.toLowerCase();
      if (query && !matchTarget.includes(query)) {
        continue;
      }
      const customerKey = (booking.customer_name || booking.customer_email || "Customer").trim().toLowerCase();
      const key = `${customerKey}|${booking.start_ts}|${booking.end_ts}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          customerLabel: label || "Customer",
          start_ts: booking.start_ts,
          end_ts: booking.end_ts,
          bookingIds: [booking.id],
          activity: String(booking.activity || ""),
        });
      } else {
        groups.get(key)?.bookingIds.push(booking.id);
      }
    }
    return Array.from(groups.values()).sort(
      (a, b) => new Date(a.start_ts).getTime() - new Date(b.start_ts).getTime()
    );
  }, [tabBookings, tabSearch]);

  const colorKeyToDark = useMemo(() => {
    const map = new Map<string, boolean>();
    groupedTabBookings.forEach((group, idx) => {
      const dateKey = new Date(group.start_ts).toLocaleDateString("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const isCombo = String(group.activity || "").toUpperCase().includes("COMBO");
      const key = isCombo
        ? `${group.customerLabel.trim().toLowerCase()}|${dateKey}`
        : `__single__|${group.key}`;
      if (!map.has(key)) {
        map.set(key, idx % 2 === 0);
      }
    });
    return map;
  }, [groupedTabBookings]);

  const visibleTabGroups = groupedTabBookings.slice(tabOffset, tabOffset + 10);
  const totalTabGroups = groupedTabBookings.length;
  const maxTabOffset = Math.max(0, totalTabGroups - 10);
  const thumbSizePct =
    totalTabGroups > 0 ? Math.max(18, Math.round((10 / totalTabGroups) * 100)) : 100;
  const thumbTopPct =
    maxTabOffset > 0 ? Math.round((tabOffset / maxTabOffset) * (100 - thumbSizePct)) : 0;
  const handleTabWheel = (deltaY: number) => {
    if (totalTabGroups <= 10) return;
    tabWheelAccumRef.current += deltaY;
    if (Math.abs(tabWheelAccumRef.current) < 420) return;
    const step = tabWheelAccumRef.current > 0 ? 1 : -1;
    tabWheelAccumRef.current = 0;
    setTabOffset((prev) => Math.max(0, Math.min(maxTabOffset, prev + step)));
  };

  const updateOffsetFromClientY = (clientY: number) => {
    const track = tabTrackRef.current;
    if (!track || maxTabOffset <= 0) return;
    const rect = track.getBoundingClientRect();
    const y = Math.min(Math.max(clientY - rect.top, 0), rect.height);
    const ratio = rect.height > 0 ? y / rect.height : 0;
    const next = Math.round(ratio * maxTabOffset);
    setTabOffset(Math.max(0, Math.min(maxTabOffset, next)));
  };

  useEffect(() => {
    if (!tabDragging) return;
    const onMove = (e: MouseEvent) => updateOffsetFromClientY(e.clientY);
    const onUp = () => setTabDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [tabDragging, maxTabOffset]);

  const cartRows = useMemo(() => Object.values(cart), [cart]);
  const subtotalCents = useMemo(() => {
    if (activeTabId) {
      return tabItems.reduce((sum, row) => sum + row.line_total_cents, 0);
    }
    return cartRows.reduce((sum, row) => sum + row.item.price_cents * row.quantity, 0);
  }, [activeTabId, cartRows, tabItems]);
  const taxCents = useMemo(() => Math.round(subtotalCents * TAX_RATE), [subtotalCents]);
  const totalCents = useMemo(() => subtotalCents + taxCents, [subtotalCents, taxCents]);
  const cashProvidedCents = useMemo(() => {
    const value = Number(cashInput || "0");
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 100);
  }, [cashInput]);
  const changeDueCents = Math.max(0, cashProvidedCents - totalCents);

  function addToCart(item: InventoryItem) {
    if (activeTabId) {
      addToTab(item);
      return;
    }
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
    setTerminalPhase("connecting");

    if (!terminalRef.current) {
      setTerminalError("Stripe Terminal not initialized.");
      setTerminalPhase("idle");
      return;
    }
    if (activeTabId) {
      if (!tabItems.length) {
        setError("Add at least one item to the tab.");
        return;
      }
      if (cartRows.length) {
        setError('Add cart items to the tab before collecting payment.');
        return;
      }
    } else if (!cartRows.length) {
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
      if ("error" in connectResult && connectResult.error) {
        setTerminalError(connectResult.error.message || "Failed to connect reader.");
        setTerminalPhase("idle");
        return;
      }

      setTerminalPhase("collecting");
      const intentRes = await fetch("/api/stripe/terminal/pos_payment_intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: activeTabId
            ? tabItems.map((row) => ({ id: row.item_id, quantity: row.quantity }))
            : cartRows.map((row) => ({ id: row.item.id, quantity: row.quantity })),
          tab_id: activeTabId || null,
        }),
      });
      const intentJson = await intentRes.json().catch(() => ({}));
      if (!intentRes.ok || !intentJson?.client_secret) {
        setTerminalError(intentJson?.error || "Failed to create payment intent.");
        return;
      }

      const collectResult = await terminalRef.current.collectPaymentMethod(intentJson.client_secret);
      if ("error" in collectResult && collectResult.error) {
        setTerminalError(collectResult.error.message || "Payment collection failed.");
        setTerminalPhase("idle");
        return;
      }

      if (!("paymentIntent" in collectResult) || !collectResult.paymentIntent) {
        setTerminalError("Payment collection failed.");
        setTerminalPhase("idle");
        return;
      }

      setTerminalPhase("processing");
      const processResult = await terminalRef.current.processPayment(collectResult.paymentIntent);
      if ("error" in processResult && processResult.error) {
        setTerminalError(processResult.error.message || "Payment failed.");
        setTerminalPhase("idle");
        return;
      }

      if (!("paymentIntent" in processResult) || !processResult.paymentIntent) {
        setTerminalError("Payment completed, but no payment intent returned.");
        setTerminalPhase("idle");
        return;
      }

      const paymentIntentId = processResult.paymentIntent?.id;
      if (!paymentIntentId) {
        setTerminalError("Payment completed, but no payment intent returned.");
        setTerminalPhase("idle");
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
        setTerminalPhase("idle");
        return;
      }

      if (activeTabId) {
        await loadTabs();
        setActiveTabId("");
        setTabItems([]);
        setActiveTabName("");
        setActiveTabStatus("");
      } else {
        clearCart();
      }
      setSuccess("Payment completed and sale recorded.");
    } catch (e: any) {
      setTerminalError(e?.message || "Terminal payment failed.");
    } finally {
      setTerminalLoading(false);
      setTerminalPhase("idle");
    }
  }

  async function handleCancelPayment() {
    if (!terminalRef.current) {
      setTerminalError("Stripe Terminal not initialized.");
      return;
    }
    try {
      setTerminalError("");
      const result = await terminalRef.current.cancelCollectPaymentMethod();
      if ("error" in result && result.error) {
        setTerminalError(result.error.message || "Failed to cancel payment.");
        return;
      }
      await terminalRef.current.disconnectReader();
      setSuccess("Payment collection canceled.");
    } catch (e: any) {
      setTerminalError(e?.message || "Failed to cancel payment.");
    } finally {
      setTerminalLoading(false);
      setTerminalPhase("idle");
    }
  }

  async function handleReaderChange(nextId: string) {
    setSelectedReaderId(nextId);
    setTerminalError("");
    if (!terminalRef.current) return;
    try {
      await terminalRef.current.disconnectReader();
    } catch {
      // ignore disconnect errors
    }
  }

  async function handleCashPayment() {
    setError("");
    setSuccess("");

    if (activeTabId) {
      if (!tabItems.length) {
        setError("Add at least one item to the tab.");
        return false;
      }
      if (cartRows.length) {
        setError("Add cart items to the tab before collecting payment.");
        return false;
      }
    } else if (!cartRows.length) {
      setError("Add at least one item to the cart.");
      return false;
    }

    setCashLoading(true);
    try {
      const res = await fetch("/api/staff/pos/cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: activeTabId
            ? tabItems.map((row) => ({ id: row.item_id, quantity: row.quantity }))
            : cartRows.map((row) => ({ id: row.item.id, quantity: row.quantity })),
          tab_id: activeTabId || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || "Cash payment failed.");
        return false;
      }

      if (activeTabId) {
        await loadTabs();
        setActiveTabId("");
        setTabItems([]);
        setActiveTabName("");
        setActiveTabStatus("");
      } else {
        clearCart();
      }
      setSuccess("Cash payment recorded.");
      return true;
    } catch (e: any) {
      setError(e?.message || "Cash payment failed.");
      return false;
    } finally {
      setCashLoading(false);
    }
  }

  function openCashModal() {
    setCashInput("0.00");
    setCashModalOpen(true);
  }

  function closeCashModal() {
    setCashModalOpen(false);
    setCashInput("");
  }

  function appendCashInput(value: string) {
    setCashInput((prev) => normalizeCashInput(`${prev}${value}`));
  }

  function backspaceCashInput() {
    setCashInput((prev) => prev.slice(0, -1));
  }

  function setCashAmount(amount: number) {
    setCashInput(amount.toFixed(2));
  }

  function normalizeCashInput(value: string) {
    const cleaned = value.replace(/[^0-9.]/g, "");
    const parts = cleaned.split(".");
    const whole = parts[0] ?? "";
    const decimals = parts[1] ? parts[1].slice(0, 2) : "";
    if (parts.length > 1) {
      return `${whole}.${decimals}`;
    }
    return whole;
  }

  async function submitCashPayment() {
    setError("");
    if (cashProvidedCents < totalCents) {
      setError("Cash provided must cover the total.");
      return;
    }
    const ok = await handleCashPayment();
    if (ok) {
      closeCashModal();
    }
  }

  const sampleItems: InventoryItem[] = [
    { id: "axe-lanes", name: "Axe Lanes", description: "Lane rental", price_cents: 2500, image_url: null, active: true },
    { id: "duckpin", name: "Duckpin Bowling", description: "Lane rental", price_cents: 3000, image_url: null, active: true },
    { id: "arcade", name: "Arcade Credits", description: "Game card", price_cents: 1000, image_url: null, active: true },
    { id: "drinks", name: "Drinks", description: "Beverages", price_cents: 400, image_url: null, active: true },
    { id: "snacks", name: "Snacks", description: "Concessions", price_cents: 350, image_url: null, active: true },
    { id: "merch", name: "Merchandise", description: "Apparel", price_cents: 2000, image_url: null, active: true },
    { id: "addons", name: "Event Add-Ons", description: "Extras", price_cents: 1500, image_url: null, active: true },
    { id: "gift", name: "Gift Card", description: "Store credit", price_cents: 2500, image_url: null, active: true },
  ];
  const displayItems = items.length ? items : sampleItems;
  const filteredItems = useMemo(() => {
    const q = itemQuery.trim().toLowerCase();
    const itemsToFilter = !q
      ? displayItems
      : displayItems.filter((item) => (item.name || "").toLowerCase().includes(q));
    return [...itemsToFilter].sort((a, b) => {
      const aName = (a.name || "").toLowerCase();
      const bName = (b.name || "").toLowerCase();
      return aName.localeCompare(bName);
    });
  }, [displayItems, itemQuery]);

  return (
    <div className="flex h-screen flex-col bg-zinc-100 text-zinc-900">
      {cashModalOpen ? (
        <div
          className="fixed inset-0 z-[2147483646] flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeCashModal();
          }}
        >
          <div
            className="w-full max-w-4xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold text-zinc-900">Cash Payment</div>
              <button
                type="button"
                onClick={closeCashModal}
                className="rounded-lg border border-zinc-200 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-50"
              >
                Close
              </button>
            </div>

            <div className="mt-5 grid grid-cols-[1.1fr_1fr] gap-6">
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5">
                <div className="text-xs font-semibold uppercase text-zinc-500">Total Due</div>
                <div className="mt-2 text-3xl font-semibold text-zinc-900">
                  ${(totalCents / 100).toFixed(2)}
                </div>

                <div className="mt-6">
                  <label className="text-xs font-semibold uppercase text-zinc-500">Cash Given</label>
                  <input
                    ref={cashInputRef}
                    value={cashInput}
                    onChange={(e) => setCashInput(normalizeCashInput(e.target.value))}
                    inputMode="decimal"
                    className="mt-2 h-12 w-full rounded-xl border border-zinc-200 bg-white px-4 text-lg font-semibold"
                    placeholder="0.00"
                  />
                </div>

                <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="text-xs font-semibold uppercase text-emerald-700">Change Due</div>
                  <div className="mt-2 text-4xl font-semibold text-emerald-700">
                    ${(changeDueCents / 100).toFixed(2)}
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-5 gap-3">
                  {[5, 10, 20, 50, 100].map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => setCashAmount(amount)}
                      className="rounded-xl border border-zinc-200 bg-white py-3 text-base font-semibold text-zinc-800 hover:bg-zinc-100"
                    >
                      ${amount}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={submitCashPayment}
                  disabled={cashLoading || cashProvidedCents < totalCents}
                  className="mt-6 h-12 w-full rounded-xl border border-black bg-white text-base font-semibold text-black shadow-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {cashLoading ? "Recording…" : "Confirm Cash Payment"}
                </button>
              </div>

              <div className="flex flex-col gap-4">
                <button
                  type="button"
                  onClick={backspaceCashInput}
                  className="h-12 rounded-2xl border border-zinc-200 bg-white text-sm font-semibold text-zinc-700 shadow-sm hover:bg-zinc-50"
                >
                  Backspace
                </button>
                <button
                  type="button"
                  onClick={() => setCashInput("0.00")}
                  className="h-12 rounded-2xl border border-zinc-200 bg-zinc-100 text-sm font-semibold text-zinc-700 hover:bg-zinc-200"
                >
                  Clear
                </button>
                <div className="text-xs text-zinc-500">
                  Enter the amount using the hot buttons or type directly in the cash field.
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {tabModalOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
            zIndex: 2147483647,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeTabModal();
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "620px",
              background: "#ffffff",
              borderRadius: "16px",
              border: "1px solid #e5e7eb",
              padding: "16px",
              boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => {
              handleTabWheel(e.deltaY);
              e.preventDefault();
            }}
          >
            <div className="text-sm font-semibold text-zinc-900">Open New Tab</div>
            <div className="mt-1 text-xs text-zinc-500">
              Select a booking to open as the active tab.
            </div>

            <div className="mt-3">
              <input
                value={tabSearch}
                onChange={(e) => {
                  setTabSearch(e.target.value);
                  setTabOffset(0);
                }}
                placeholder="Search by customer name"
                className="h-9 w-full rounded-lg border border-zinc-200 px-3 text-sm"
              />
            </div>

            <div
              ref={tabListRef}
              className="relative mt-3 max-h-[420px] rounded-xl border border-zinc-200"
              style={{ overflow: "hidden", overscrollBehavior: "contain" }}
              onWheel={(e) => {
                handleTabWheel(e.deltaY);
                e.preventDefault();
              }}
            >
              {totalTabGroups > 10 ? (
                <div
                  ref={tabTrackRef}
                  className="absolute right-1 top-2 bottom-2 w-2 rounded-full bg-black/30"
                  style={{ zIndex: 30 }}
                  onMouseDown={(e) => {
                    updateOffsetFromClientY(e.clientY);
                    setTabDragging(true);
                    e.preventDefault();
                  }}
                >
                  <div
                    className="absolute left-0 right-0 rounded-full bg-black"
                    style={{ top: `${thumbTopPct}%`, height: `${thumbSizePct}%` }}
                    onMouseDown={(e) => {
                      setTabDragging(true);
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  />
                </div>
              ) : null}
              {tabBookingsLoading ? (
                <div className="p-3 text-sm text-zinc-600">Loading bookings…</div>
              ) : tabBookingsError ? (
                <div className="p-3 text-sm font-semibold text-red-600">{tabBookingsError}</div>
              ) : groupedTabBookings.length === 0 ? (
                <div className="p-3 text-sm text-zinc-600">No bookings match this search.</div>
              ) : (
                <div className="divide-y divide-zinc-100 pr-5">
                  {visibleTabGroups.map((group) => {
                    const rowStyle = { backgroundColor: "#111", color: "#fff", border: "1px solid #F3C04E" };
                    const subTextStyle = { color: "rgba(255,255,255,0.75)" };
                    const actionTextStyle = { color: "rgba(255,255,255,0.85)" };
                    return (
                    <button
                      key={group.key}
                      type="button"
                      onClick={() => openTabForBooking(group.bookingIds[0])}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition hover:brightness-125"
                      style={rowStyle}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-semibold">
                          {group.customerLabel}
                        </div>
                        <div className="text-xs" style={subTextStyle}>
                          {new Date(group.start_ts).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}{" "}
                          · {fmtNY(group.start_ts)} – {fmtNY(group.end_ts)}
                        </div>
                      </div>
                      <span className="text-xs font-semibold" style={actionTextStyle}>
                        Open Tab{group.bookingIds.length > 1 ? ` · ${group.bookingIds.length}` : ""}
                      </span>
                    </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeTabModal}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
              >
                Back
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex h-14 items-center justify-between bg-zinc-900 px-5 text-white shadow-sm">
        <div className="w-24" />
        <div className="text-lg font-semibold tracking-wide">Axe Quacks POS</div>
        <div className="w-24" />
      </div>

      <div className="flex flex-1 gap-4 overflow-hidden p-4">
        <div className="flex w-[35%] min-w-0 flex-col gap-4">
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="mb-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="mr-24 text-xs font-semibold uppercase text-zinc-500">Active Tab</div>
                <select
                  value={activeTabId}
                  onChange={(e) => setActiveTabId(e.target.value)}
                  className="mr-24 h-9 min-w-[220px] rounded-lg border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-800"
                >
                  <option value="">Walk-in (no tab)</option>
                  {tabs.map((tab) => (
                    <option key={tab.id} value={tab.id}>
                      {tab.customer_name || tab.customer_email || "Customer"} · {tab.id.slice(0, 6)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={openTabModal}
                  className="rounded-lg border border-zinc-900 bg-zinc-900 px-3 py-1 text-xs font-semibold text-white hover:bg-zinc-800"
                >
                  Open New Tab
                </button>
                {activeTabId ? (
                  <span className="text-xs font-semibold text-zinc-700">
                    Tab: {activeTabName || "Customer"}
                    {activeTabStatus ? (
                      <span
                        className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          activeTabStatus === "CLOSED" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {activeTabStatus === "CLOSED" ? "PAID" : "OPEN"}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="text-sm font-semibold text-zinc-700">Cart Items</div>
              <div className="flex min-w-0 flex-col gap-3">
                <div className="max-h-[300px] overflow-y-auto rounded-xl border border-zinc-100 bg-zinc-50 p-3">
                  {activeTabId ? (
                    tabLoading ? (
                      <div className="text-sm text-zinc-600">Loading tab…</div>
                    ) : tabItems.length === 0 ? (
                      <div className="text-sm text-zinc-600">No items on this tab yet.</div>
                    ) : (
                      <div className="space-y-3">
                        {tabItems.map((row) => (
                          <div key={row.id} className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-zinc-900">{row.name}</div>
                              <div className="text-xs text-zinc-500">${(row.price_cents / 100).toFixed(2)} each</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => updateTabQty(row.item_id, -1)}
                                className="h-7 w-7 rounded-full border border-zinc-200 text-sm"
                              >
                                -
                              </button>
                              <div className="w-6 text-center text-sm">{row.quantity}</div>
                              <button
                                type="button"
                                onClick={() => updateTabQty(row.item_id, 1)}
                                className="h-7 w-7 rounded-full border border-zinc-200 text-sm"
                              >
                                +
                              </button>
                            </div>
                            <div className="text-sm font-semibold text-zinc-900">
                              ${(row.line_total_cents / 100).toFixed(2)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  ) : !cartRows.length ? (
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
                </div>

                <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-600">Subtotal</span>
                    <span className="font-semibold text-zinc-900">${(subtotalCents / 100).toFixed(2)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-zinc-600">Tax (7.25%)</span>
                    <span className="font-semibold text-zinc-900">${(taxCents / 100).toFixed(2)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-base font-semibold text-zinc-900">
                    <span>Total</span>
                    <span>${(totalCents / 100).toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {error ? <div className="text-sm text-red-600">{error}</div> : null}
              {success ? <div className="text-sm text-emerald-600">{success}</div> : null}
            </div>
          </div>

          <div className="w-full rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase text-zinc-500">Terminal</div>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <select
                value={selectedReaderId}
                onChange={(e) => handleReaderChange(e.target.value)}
                className="h-12 w-full rounded-xl border border-zinc-200 px-4 text-sm"
              >
                <option value="">Select a reader</option>
                {terminalReaders.map((reader) => (
                  <option key={reader.id} value={reader.id}>
                    {reader.label || reader.device_type || reader.id}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handlePayment}
                disabled={terminalLoading}
                className="h-12 rounded-xl bg-teal-600 text-sm font-semibold text-white hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {terminalLoading ? "Processing…" : "Pay"}
              </button>
            </div>
            <div className="mt-3">
              <button
                type="button"
                onClick={openCashModal}
                disabled={cashLoading}
                className="h-11 w-full rounded-xl border border-black bg-black text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {cashLoading ? "Recording…" : "Pay With Cash"}
              </button>
            </div>
            {terminalError ? <div className="mt-2 text-xs text-red-600">{terminalError}</div> : null}
          </div>
        </div>

        <div className="flex flex-1 min-w-0 flex-col gap-4">
          <div className="flex min-h-0 w-full flex-1 flex-col rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="mb-3 text-sm font-semibold text-zinc-700">Items</div>
            <input
              value={itemQuery}
              onChange={(e) => setItemQuery(e.target.value)}
              placeholder="Search items"
              className="mb-3 h-9 w-full rounded-xl border border-zinc-200 px-3 text-sm"
            />
            {loading ? (
              <div className="text-sm text-zinc-600">Loading items…</div>
            ) : (
              <div className="grid flex-1 grid-cols-2 gap-2 overflow-y-auto pr-1 lg:grid-cols-3">
                {filteredItems.length === 0 ? (
                  <div className="text-sm text-zinc-500">No items found.</div>
                ) : (
                  filteredItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => addToCart(item)}
                      className="flex h-[120px] w-full flex-col items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-2 py-3 text-center text-xs shadow-sm transition hover:border-teal-400 hover:bg-white"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 text-[10px] font-bold text-teal-700">
                        {item.image_url ? (
                          <img src={item.image_url} alt={item.name} className="h-full w-full rounded-xl object-cover" />
                        ) : (
                          (item.name || "Item").slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div className="line-clamp-2 px-1 text-xs font-semibold text-zinc-800">{item.name}</div>
                      <div className="text-[11px] text-zinc-500">${(item.price_cents / 100).toFixed(2)}</div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
