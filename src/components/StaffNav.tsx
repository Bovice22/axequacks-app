"use client";

import React, { useEffect, useRef, useState } from "react";

type NavItem = { href: string; label: string };

const MAIN_ITEMS: NavItem[] = [
  { href: "/staff/bookings", label: "Bookings" },
  { href: "/staff/customers", label: "Customers" },
  { href: "/staff/pos", label: "POS" },
  { href: "/staff/time-clock", label: "Time Clock" },
];

const ADMIN_ITEMS: NavItem[] = [
  { href: "/staff/addons", label: "Inventory" },
  { href: "/staff/admin", label: "Staff" },
  { href: "/staff/schedule", label: "Schedule" },
  { href: "/staff/bulk-bookings", label: "Bulk Bookings" },
  { href: "/staff/promos", label: "Promo Codes" },
  { href: "/staff/gift-certificates", label: "Gift Certificates" },
  { href: "/staff/reports", label: "Reporting" },
  { href: "/staff/buffers", label: "Buffers/Blackouts/Policies" },
  { href: "/staff/events", label: "Event Requests" },
];

export default function StaffNav() {
  const [role, setRole] = useState<"staff" | "admin" | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [pendingEventCount, setPendingEventCount] = useState(0);
  const adminMenuRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch("/api/staff/me", { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (!mounted) return;
        setRole(json?.role === "admin" ? "admin" : "staff");
      })
      .catch(() => {
        if (!mounted) return;
        setRole("staff");
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (role !== "admin") return;
    let active = true;
    const loadCount = async () => {
      try {
        const res = await fetch("/api/staff/event-requests/count", { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        setPendingEventCount(Number(json?.pending || 0));
      } catch {
        if (!active) return;
        setPendingEventCount(0);
      }
    };
    loadCount();
    const interval = setInterval(loadCount, 30 * 1000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [role]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target || !adminMenuRef.current?.contains(target)) {
        setAdminOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAdminOpen(false);
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <nav className="mt-2 w-full rounded-xl bg-white py-2">
      <ul className="flex flex-wrap items-center justify-center gap-3 text-xs font-semibold leading-none text-black sm:gap-4 sm:text-sm">
        {MAIN_ITEMS.map((item) => (
          <li
            key={item.href}
            className="flex items-center after:mx-2 after:text-zinc-300 after:content-[''] sm:after:mx-3 sm:after:content-['|'] last:after:content-['']"
          >
            <a href={item.href} className="text-black hover:underline">
              {item.label}
            </a>
          </li>
        ))}
        {role === "admin" ? (
          <li
            ref={adminMenuRef}
            className="relative flex items-center after:mx-2 after:text-zinc-300 after:content-[''] sm:after:mx-3 sm:after:content-['|'] last:after:content-['']"
          >
            <button
              type="button"
              className="inline-flex items-center gap-2 leading-none text-black hover:underline"
              aria-haspopup="true"
              aria-expanded={adminOpen}
              onClick={() => setAdminOpen((prev) => !prev)}
            >
              Admin
              <span className="text-xs">▾</span>
              {pendingEventCount > 0 ? (
                <span className="ml-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {pendingEventCount}
                </span>
              ) : null}
            </button>
            <ul
              className={`absolute z-20 mt-0 w-56 rounded-xl border border-zinc-200 bg-white py-2 text-sm shadow-lg ${
                adminOpen ? "block" : "hidden"
              }`}
              style={{ top: "100%", left: 0 }}
            >
              {ADMIN_ITEMS.map((item) => {
                if (item.href === "/staff/events" && pendingEventCount > 0) {
                  return (
                    <React.Fragment key={item.href}>
                      <li className="px-4 py-1 text-[10px] font-semibold text-red-600">
                        Pending requests: {pendingEventCount}
                      </li>
                      <li>
                        <a
                          href={item.href}
                          className="flex items-center justify-between px-4 py-2 text-black hover:bg-zinc-50"
                          onClick={() => setAdminOpen(false)}
                        >
                          <span>{item.label}</span>
                          <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                            {pendingEventCount}
                          </span>
                        </a>
                      </li>
                    </React.Fragment>
                  );
                }
                return (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      className="block px-4 py-2 text-black hover:bg-zinc-50"
                      onClick={() => setAdminOpen(false)}
                    >
                      {item.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
