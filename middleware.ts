import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const BOOK_HOST = "book.axequacks.com";
const EVENTS_HOST = "events.axequacks.com";

function isPublicFile(pathname: string) {
  return pathname.startsWith("/_next") || pathname.startsWith("/api") || pathname.includes(".");
}

export function middleware(req: NextRequest) {
  const hostname = req.headers.get("host")?.toLowerCase() || "";
  const pathname = req.nextUrl.pathname;

  if (isPublicFile(pathname)) return NextResponse.next();
  if (pathname.startsWith("/waiver")) return NextResponse.next();

  if (hostname === BOOK_HOST && !pathname.startsWith("/book")) {
    const url = req.nextUrl.clone();
    url.pathname = `/book${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url);
  }

  if (hostname === EVENTS_HOST && !pathname.startsWith("/host-event")) {
    const url = req.nextUrl.clone();
    url.pathname = `/host-event${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/:path*",
};
