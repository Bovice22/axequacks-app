"use client";

import React, { useEffect, useState } from "react";

type NavItem = { href: string; label: string };

const MAIN_ITEMS: NavItem[] = [
  { href: "/staff/bookings", label: "Bookings" },
  { href: "/staff/customers", label: "Customers" },
  { href: "/staff/pos", label: "POS" },
];

const ADMIN_ITEMS: NavItem[] = [
  { href: "/staff/addons", label: "Inventory" },
  { href: "/staff/admin", label: "Staff" },
  { href: "/staff/promos", label: "Promo Codes" },
  { href: "/staff/reports", label: "Reporting" },
  { href: "/staff/buffers", label: "Buffers/Blackouts/Policies" },
  { href: "/staff/events", label: "Event Requests" },
];

export default function StaffNav() {
  const [role, setRole] = useState<"staff" | "admin" | null>(null);

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

  return (
    <nav className="mt-2">
      <ul className="flex flex-nowrap items-center justify-center gap-4 text-sm font-semibold text-zinc-700">
        {MAIN_ITEMS.map((item) => (
          <li
            key={item.href}
            className="flex items-center after:mx-3 after:text-zinc-300 after:content-['|'] last:after:content-['']"
          >
            <a href={item.href} className="hover:underline">
              {item.label}
            </a>
          </li>
        ))}
        {role === "admin" ? (
          <li
            className="group relative flex items-center pb-2 after:mx-3 after:text-zinc-300 after:content-['|'] last:after:content-['']"
          >
            <button
              type="button"
              className="inline-flex items-center gap-2 hover:underline"
              aria-haspopup="true"
            >
              Admin
              <span className="text-xs">▾</span>
            </button>
            <ul
              className="absolute z-20 mt-0 hidden w-56 rounded-xl border border-zinc-200 bg-white py-2 text-sm shadow-lg group-hover:block group-focus-within:block"
              style={{ top: "100%", left: 0 }}
            >
              {ADMIN_ITEMS.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    className="block px-4 py-2 text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900"
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
