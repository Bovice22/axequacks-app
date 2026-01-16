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
    <nav className="flex w-full flex-col items-center gap-3 text-sm font-semibold text-white sm:w-auto sm:flex-row sm:justify-end">
      <a
        href="https://book.axequacks.com"
        className={
          active === "book"
            ? "w-full rounded-full bg-[#F7941D] px-4 py-2 text-center text-black shadow-[0_8px_20px_rgba(247,148,29,0.35)] sm:w-auto"
            : "w-full rounded-full border border-white/20 px-4 py-2 text-center transition hover:border-white/50 hover:bg-white/10 sm:w-auto"
        }
      >
        Book
      </a>
      <a
        href="https://events.axequacks.com"
        className={
          active === "events"
            ? "w-full rounded-full bg-[#F7941D] px-4 py-2 text-center text-black shadow-[0_8px_20px_rgba(247,148,29,0.35)] sm:w-auto"
            : "w-full rounded-full border border-white/20 px-4 py-2 text-center transition hover:border-white/50 hover:bg-white/10 sm:w-auto"
        }
      >
        Events
      </a>
    </nav>
  );
}
