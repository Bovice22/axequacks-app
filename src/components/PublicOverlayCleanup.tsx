"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function PublicOverlayCleanup() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === "/book") return;
    const overlays = document.querySelectorAll("[data-booking-overlay]");
    overlays.forEach((node) => node.remove());

    const candidates = Array.from(document.querySelectorAll("div"));
    candidates.forEach((node) => {
      const style = window.getComputedStyle(node);
      if (style.position !== "fixed") return;
      if (style.top !== "0px" || style.left !== "0px" || style.right !== "0px" || style.bottom !== "0px") return;
      if (style.backgroundColor === "rgba(0, 0, 0, 0)" || style.backgroundColor === "transparent") return;
      node.remove();
    });

    document.body.style.overflow = "";
    document.documentElement.style.overflow = "";
  }, [pathname]);

  return null;
}
