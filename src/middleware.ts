import { NextRequest, NextResponse } from "next/server";

const STAFF_HOST_PREFIX = "staff.";

function isAssetPath(pathname: string) {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/robots.txt") ||
    pathname.startsWith("/sitemap")
  );
}

export function middleware(req: NextRequest) {
  const rawHost =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    req.nextUrl.hostname ||
    "";
  const host = rawHost.split(",")[0]?.trim().toLowerCase();
  if (!host.startsWith(STAFF_HOST_PREFIX)) {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;
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
