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
  { href: "/staff/promos", label: "Promo Codes" },
  { href: "/staff/gift-certificates", label: "Gift Certificates" },
  { href: "/staff/reports", label: "Reporting" },
  { href: "/staff/buffers", label: "Buffers/Blackouts/Policies" },
  { href: "/staff/events", label: "Event Requests" },
];

export default function StaffNav() {
  const [role, setRole] = useState<"staff" | "admin" | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
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
    <nav className="mt-2 w-full">
      <ul className="flex flex-wrap items-center justify-center gap-3 text-xs font-semibold text-zinc-700 sm:gap-4 sm:text-sm">
        {MAIN_ITEMS.map((item) => (
          <li
            key={item.href}
            className="flex items-center after:mx-2 after:text-zinc-300 after:content-[''] sm:after:mx-3 sm:after:content-['|'] last:after:content-['']"
          >
            <a href={item.href} className="hover:underline">
              {item.label}
            </a>
          </li>
        ))}
        {role === "admin" ? (
          <li
            ref={adminMenuRef}
            className="relative flex items-center pb-2 after:mx-2 after:text-zinc-300 after:content-[''] sm:after:mx-3 sm:after:content-['|'] last:after:content-['']"
          >
            <button
              type="button"
              className="inline-flex items-center gap-2 hover:underline"
              aria-haspopup="true"
              aria-expanded={adminOpen}
              onClick={() => setAdminOpen((prev) => !prev)}
            >
              Admin
              <span className="text-xs">▾</span>
            </button>
            <ul
              className={`absolute z-20 mt-0 w-56 rounded-xl border border-zinc-200 bg-white py-2 text-sm shadow-lg ${
                adminOpen ? "block" : "hidden"
              }`}
              style={{ top: "100%", left: 0 }}
            >
              {ADMIN_ITEMS.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    className="block px-4 py-2 text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900"
                    onClick={() => setAdminOpen(false)}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
