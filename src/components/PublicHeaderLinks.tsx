"use client";

import { useSearchParams } from "next/navigation";
import PublicNav from "@/components/PublicNav";

export default function PublicHeaderLinks() {
  const searchParams = useSearchParams();
  const isStaffMode = searchParams?.get("mode") === "staff";
  const homeHref = isStaffMode ? "https://staff.axequacks.com/staff/bookings" : "https://www.axequacks.com";

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
      <a href={homeHref} className="flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white p-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.35)] sm:h-14 sm:w-14">
          <img src="/logo.png?v=2" alt="Axe Quacks" className="h-9 w-9 object-contain sm:h-10 sm:w-10" />
        </span>
        <span className="public-display text-base tracking-[0.18em] text-white sm:text-lg sm:tracking-[0.2em]">
          Axe Quacks
        </span>
      </a>
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={homeHref}
          className="rounded-full border border-white/30 px-4 py-2 text-xs font-extrabold uppercase tracking-[0.2em] text-white transition hover:bg-white/10"
        >
          Back to Home
        </a>
        <PublicNav />
      </div>
    </div>
  );
}
