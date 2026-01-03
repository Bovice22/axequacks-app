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

    const authUserId = String(body?.authUserId || "").trim();
    const staffId = String(body?.staffId || "").trim().toLowerCase();
    const fullName = String(body?.fullName || "").trim();
    const role = String(body?.role || "admin");
    const pin = String(body?.pin || "").trim();

    if (!authUserId || !staffId || pin.length !== 4) {
      return NextResponse.json({ error: "Missing auth user ID, staff ID, or PIN" }, { status: 400 });
    }
    if (!["staff", "admin"].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const email = `${staffId}@axequacks.local`;
    const sb = supabaseServer();

    const { error: authErr } = await sb.auth.admin.updateUserById(authUserId, {
      email,
      password: pinToPassword(pin, staffId),
    });
    if (authErr) {
      console.error("bootstrap auth update error:", authErr);
      return NextResponse.json({ error: authErr.message || "Failed to update auth user" }, { status: 500 });
    }

    const { data: staffRow, error: staffErr } = await sb
      .from("staff_users")
      .upsert(
        {
          auth_user_id: authUserId,
          staff_id: staffId,
          auth_email: email,
          full_name: fullName || null,
          role,
          active: true,
        },
        { onConflict: "staff_id" }
      )
      .select("id,staff_id,full_name,role,active,created_at")
      .single();

    if (staffErr) {
      console.error("bootstrap staff upsert error:", staffErr);
      return NextResponse.json({ error: staffErr.message || "Failed to update staff record" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, user: staffRow }, { status: 200 });
  } catch (err: any) {
    console.error("bootstrap route fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
