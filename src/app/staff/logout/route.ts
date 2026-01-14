import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/staff/login", req.url), 303);
  const rawHost = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const hostname = rawHost.split(",")[0]?.trim().toLowerCase();
  const cookieDomain = hostname.endsWith(".axequacks.com") ? ".axequacks.com" : undefined;
  res.cookies.set("staff_access_token", "", { path: "/", expires: new Date(0), domain: cookieDomain });
  res.cookies.set("staff_refresh_token", "", { path: "/", expires: new Date(0), domain: cookieDomain });
  return res;
}
