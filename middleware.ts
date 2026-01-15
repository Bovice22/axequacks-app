import { NextRequest, NextResponse } from "next/server";

const STAFF_HOST_PREFIX = "staff.";
const BOOK_HOST_PREFIX = "book.";
const EVENTS_HOST_PREFIX = "events.";

function isAssetPath(pathname: string) {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/robots.txt") ||
    pathname.startsWith("/sitemap") ||
    /\.[a-z0-9]+$/i.test(pathname)
  );
}

function handleHostRewrite(req: NextRequest, destination: string) {
  const { pathname } = req.nextUrl;
  if (isAssetPath(pathname)) {
    return NextResponse.next();
  }
  if (pathname === "/waiver" || pathname.startsWith("/waiver/")) {
    return NextResponse.next();
  }
  if (pathname === destination || pathname.startsWith(`${destination}/`)) {
    return NextResponse.next();
  }
  if (pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = destination;
    return NextResponse.redirect(url);
  }
  const url = req.nextUrl.clone();
  url.pathname = destination;
  return NextResponse.rewrite(url);
}

export function middleware(req: NextRequest) {
  const rawHost =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    req.nextUrl.hostname ||
    "";
  const host = rawHost.split(",")[0]?.trim().toLowerCase();

  if (host.startsWith(BOOK_HOST_PREFIX)) {
    return handleHostRewrite(req, "/book");
  }
  if (host.startsWith(EVENTS_HOST_PREFIX)) {
    return handleHostRewrite(req, "/host-event");
  }
  if (!host.startsWith(STAFF_HOST_PREFIX)) {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;
  if (process.env.STAFF_LOGIN_BYPASS === "true") {
    if (pathname === "/" || pathname === "/staff/login") {
      const url = req.nextUrl.clone();
      url.pathname = "/staff/bookings";
      return NextResponse.redirect(url);
    }
  }
  if (isAssetPath(pathname) || pathname.startsWith("/staff")) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  if (pathname === "/" || pathname === "/staff") {
    url.pathname = "/staff/login";
    return NextResponse.redirect(url);
  }

  url.pathname = `/staff${pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: "/:path*",
};
