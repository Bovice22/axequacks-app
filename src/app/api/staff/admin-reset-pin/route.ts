import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { pinToPassword } from "@/lib/pinAuth";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const adminPassword = String(body?.adminPassword || "");
    if (!process.env.ADMIN_PASSWORD || adminPassword !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const staffId = String(body?.staffId || "").trim().toLowerCase();
    const pin = String(body?.pin || "").trim();
    if (!staffId || pin.length !== 4) {
      return NextResponse.json({ error: "Missing staff ID or PIN" }, { status: 400 });
    }

    const sb = supabaseServer();
    const { data: staff, error: staffErr } = await sb
      .from("staff_users")
      .select("auth_user_id,auth_email,active")
      .eq("staff_id", staffId)
      .single();

    if (staffErr || !staff || !staff.active) {
      return NextResponse.json({ error: "Staff user not found" }, { status: 404 });
    }

    const { error: authErr } = await sb.auth.admin.updateUserById(String(staff.auth_user_id), {
      password: pinToPassword(pin, staffId),
      email_confirm: true,
    });

    if (authErr) {
      console.error("admin reset pin auth error:", authErr);
      return NextResponse.json({ error: "Failed to update PIN" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, staffId, authEmail: staff.auth_email }, { status: 200 });
  } catch (err: any) {
    console.error("admin reset pin error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
