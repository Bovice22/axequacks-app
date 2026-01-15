"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function PublicOverlayCleanup() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === "/book") return;
    const overlays = document.querySelectorAll("[data-booking-overlay]");
    overlays.forEach((node) => node.remove());
  }, [pathname]);

  return null;
}
