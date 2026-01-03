import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/staff/login", req.url));
  res.cookies.set("staff_access_token", "", { path: "/", expires: new Date(0) });
  res.cookies.set("staff_refresh_token", "", { path: "/", expires: new Date(0) });
  return res;
}
