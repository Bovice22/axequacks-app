"use client";

import { usePathname } from "next/navigation";
import { useMemo } from "react";

export default function PublicNav() {
  const pathname = usePathname();
  const host = typeof window !== "undefined" ? window.location.host.toLowerCase() : "";

  const active = useMemo(() => {
    if (host.startsWith("book.")) return "book";
    if (host.startsWith("events.")) return "events";
    if (pathname?.startsWith("/host-event")) return "events";
    if (pathname?.startsWith("/book")) return "book";
    return "book";
  }, [host, pathname]);

  return (
    <nav className="flex items-center gap-3 text-sm font-semibold text-white">
      <a
        href="https://book.axequacks.com"
        className={
          active === "book"
            ? "rounded-full bg-[#F7941D] px-4 py-2 text-black shadow-[0_8px_20px_rgba(247,148,29,0.35)]"
            : "rounded-full border border-white/20 px-4 py-2 transition hover:border-white/50 hover:bg-white/10"
        }
      >
        Book
      </a>
      <a
        href="https://events.axequacks.com"
        className={
          active === "events"
            ? "rounded-full bg-[#F7941D] px-4 py-2 text-black shadow-[0_8px_20px_rgba(247,148,29,0.35)]"
            : "rounded-full border border-white/20 px-4 py-2 transition hover:border-white/50 hover:bg-white/10"
        }
      >
        Events
      </a>
    </nav>
  );
}
