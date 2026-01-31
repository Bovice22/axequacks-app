import { NextRequest, NextResponse } from "next/server";

const STAFF_HOST_PREFIX = "staff.";
const BOOK_HOST_PREFIX = "book.";
const EVENTS_HOST_PREFIX = "events.";
const ACCESS_TOKEN_COOKIE = "staff_access_token";
const REFRESH_TOKEN_COOKIE = "staff_refresh_token";
const REFRESH_GRACE_MS = 5 * 60 * 1000;

type RefreshedTokens = {
  access: string;
  refresh: string;
};

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

function decodeJwtExp(token: string | undefined | null) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = payload.length % 4;
    if (pad) payload = payload + "=".repeat(4 - pad);
    const decoded = JSON.parse(atob(payload));
    if (!decoded?.exp) return null;
    return Number(decoded.exp) * 1000;
  } catch {
    return null;
  }
}

async function refreshStaffSession(refreshToken: string): Promise<RefreshedTokens | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return null;

  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!res.ok) return null;
  const json = await res.json();
  if (!json?.access_token || !json?.refresh_token) return null;
  return { access: json.access_token, refresh: json.refresh_token };
}

async function maybeRefreshStaffTokens(req: NextRequest): Promise<RefreshedTokens | null> {
  const accessToken = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = req.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  if (!refreshToken) return null;

  const expMs = decodeJwtExp(accessToken);
  const needsRefresh = !accessToken || !expMs || Date.now() > expMs - REFRESH_GRACE_MS;
  if (!needsRefresh) return null;

  return refreshStaffSession(refreshToken);
}

export async function middleware(req: NextRequest) {
  const rawHost =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    req.nextUrl.hostname ||
    "";
  const host = rawHost.split(",")[0]?.trim().toLowerCase();
  const secure = process.env.NODE_ENV === "production";
  const cookieDomain = host.endsWith(".axequacks.com") ? ".axequacks.com" : undefined;
  const refreshedTokens = host.startsWith(STAFF_HOST_PREFIX) ? await maybeRefreshStaffTokens(req) : null;

  if (host.startsWith(BOOK_HOST_PREFIX)) {
    const res = handleHostRewrite(req, "/book");
    if (refreshedTokens) {
      res.cookies.set(ACCESS_TOKEN_COOKIE, refreshedTokens.access, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        domain: cookieDomain,
      });
      res.cookies.set(REFRESH_TOKEN_COOKIE, refreshedTokens.refresh, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        domain: cookieDomain,
      });
    }
    return res;
  }
  if (host.startsWith(EVENTS_HOST_PREFIX)) {
    const res = handleHostRewrite(req, "/host-event");
    if (refreshedTokens) {
      res.cookies.set(ACCESS_TOKEN_COOKIE, refreshedTokens.access, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        domain: cookieDomain,
      });
      res.cookies.set(REFRESH_TOKEN_COOKIE, refreshedTokens.refresh, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        domain: cookieDomain,
      });
    }
    return res;
  }
  if (!host.startsWith(STAFF_HOST_PREFIX)) {
    const res = NextResponse.next();
    if (refreshedTokens) {
      res.cookies.set(ACCESS_TOKEN_COOKIE, refreshedTokens.access, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        domain: cookieDomain,
      });
      res.cookies.set(REFRESH_TOKEN_COOKIE, refreshedTokens.refresh, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        domain: cookieDomain,
      });
    }
    return res;
  }

  const { pathname } = req.nextUrl;
  if (process.env.STAFF_LOGIN_BYPASS === "true") {
    if (pathname === "/" || pathname === "/staff/login") {
      const url = req.nextUrl.clone();
      url.pathname = "/staff/bookings";
      const res = NextResponse.redirect(url);
      if (refreshedTokens) {
        res.cookies.set(ACCESS_TOKEN_COOKIE, refreshedTokens.access, {
          httpOnly: true,
          sameSite: "lax",
          secure,
          path: "/",
          domain: cookieDomain,
        });
        res.cookies.set(REFRESH_TOKEN_COOKIE, refreshedTokens.refresh, {
          httpOnly: true,
          sameSite: "lax",
          secure,
          path: "/",
          domain: cookieDomain,
        });
      }
      return res;
    }
  }
  if (isAssetPath(pathname) || pathname.startsWith("/staff")) {
    const res = NextResponse.next();
    if (refreshedTokens) {
      res.cookies.set(ACCESS_TOKEN_COOKIE, refreshedTokens.access, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        domain: cookieDomain,
      });
      res.cookies.set(REFRESH_TOKEN_COOKIE, refreshedTokens.refresh, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        domain: cookieDomain,
      });
    }
    return res;
  }

  const url = req.nextUrl.clone();
  if (pathname === "/" || pathname === "/staff") {
    url.pathname = "/staff/login";
    const res = NextResponse.redirect(url);
    if (refreshedTokens) {
      res.cookies.set(ACCESS_TOKEN_COOKIE, refreshedTokens.access, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        domain: cookieDomain,
      });
      res.cookies.set(REFRESH_TOKEN_COOKIE, refreshedTokens.refresh, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        domain: cookieDomain,
      });
    }
    return res;
  }

  url.pathname = `/staff${pathname}`;
  const res = NextResponse.rewrite(url);
  if (refreshedTokens) {
    res.cookies.set(ACCESS_TOKEN_COOKIE, refreshedTokens.access, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      domain: cookieDomain,
    });
    res.cookies.set(REFRESH_TOKEN_COOKIE, refreshedTokens.refresh, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      domain: cookieDomain,
    });
  }
  return res;
}

export const config = {
  matcher: "/:path*",
};
