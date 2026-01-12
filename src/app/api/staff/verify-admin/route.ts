import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabaseServer";
import { pinToPassword } from "@/lib/pinAuth";

function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return createClient(url, anonKey, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const staffIdRaw = String(body?.staffId || "").trim();
    const pin = String(body?.pin || "").trim();

    if (!staffIdRaw || pin.length !== 4) {
      return NextResponse.json({ error: "Missing staff ID or PIN" }, { status: 400 });
    }

    const staffId = staffIdRaw.toLowerCase();
    const admin = supabaseServer();
    const { data: staff, error: staffErr } = await admin
      .from("staff_users")
      .select("auth_email,role,active")
      .eq("staff_id", staffId)
      .single();

    if (staffErr || !staff || !staff.active || staff.role !== "admin") {
      return NextResponse.json({ error: "Admin credentials required" }, { status: 401 });
    }

    const sb = anonClient();
    const { error: authErr } = await sb.auth.signInWithPassword({
      email: staff.auth_email,
      password: pinToPassword(pin, staffId),
    });

    if (authErr) {
      return NextResponse.json({ error: "Invalid admin credentials" }, { status: 401 });
    }

    await sb.auth.signOut();
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    console.error("verify admin error:", err);
    return NextResponse.json({ error: "Admin verification failed" }, { status: 500 });
  }
}
