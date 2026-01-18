import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

type ImportRow = {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function POST(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const customers = Array.isArray(body?.customers) ? (body.customers as ImportRow[]) : [];
    if (!customers.length) {
      return NextResponse.json({ error: "No customers provided" }, { status: 400 });
    }

    const unique = new Map<string, { full_name: string | null; email: string; phone: string | null }>();
    let skipped = 0;
    for (const row of customers) {
      const email = normalizeEmail(String(row?.email || ""));
      if (!email) {
        skipped += 1;
        continue;
      }
      const fullName = String(row?.full_name || "").trim();
      const phone = String(row?.phone || "").trim();
      unique.set(email, {
        full_name: fullName || null,
        email,
        phone: phone || null,
      });
    }

    const payload = Array.from(unique.values());
    if (!payload.length) {
      return NextResponse.json({ error: "No valid rows with email" }, { status: 400 });
    }

    const sb = supabaseServer();
    const chunkSize = 500;
    for (let i = 0; i < payload.length; i += chunkSize) {
      const chunk = payload.slice(i, i + chunkSize);
      const { error } = await sb.from("customers").upsert(chunk, { onConflict: "email" });
      if (error) {
        console.error("customers import error:", error);
        return NextResponse.json({ error: "Failed to import customers" }, { status: 500 });
      }
    }

    return NextResponse.json(
      { processed: payload.length, skipped },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("customers import fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
