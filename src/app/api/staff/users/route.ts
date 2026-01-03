import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { pinToPassword } from "@/lib/pinAuth";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

function normalizeStaffId(staffId: string) {
  return staffId.trim().toLowerCase();
}

export async function GET() {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sb = supabaseServer();
    const { data, error } = await sb
      .from("staff_users")
      .select("id,auth_user_id,staff_id,full_name,role,active,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("staff users list error:", error);
      return NextResponse.json({ error: "Failed to load staff users" }, { status: 500 });
    }

    return NextResponse.json({ users: data ?? [] }, { status: 200 });
  } catch (err: any) {
    console.error("staff users route fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const staffIdRaw = String(body?.staffId || "");
    const fullName = String(body?.fullName || "").trim();
    const role = String(body?.role || "staff");
    const pin = String(body?.pin || "").trim();

    if (!staffIdRaw || pin.length !== 4) {
      return NextResponse.json({ error: "Missing staff ID or PIN" }, { status: 400 });
    }
    if (!["staff", "admin"].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const staffId = normalizeStaffId(staffIdRaw);
    const email = `${staffId}@axequacks.local`;

    const sb = supabaseServer();
    const { data: auth, error: authErr } = await sb.auth.admin.createUser({
      email,
      password: pinToPassword(pin, staffId),
      email_confirm: true,
    });

    if (authErr || !auth?.user) {
      console.error("staff user auth create error:", authErr);
      return NextResponse.json({ error: "Failed to create auth user" }, { status: 500 });
    }

    const { data: staffRow, error: staffErr } = await sb
      .from("staff_users")
      .insert({
        auth_user_id: auth.user.id,
        staff_id: staffId,
        auth_email: email,
        full_name: fullName || null,
        role,
        active: true,
      })
      .select("id,auth_user_id,staff_id,full_name,role,active,created_at")
      .single();

    if (staffErr) {
      console.error("staff user insert error:", staffErr);
      await sb.auth.admin.deleteUser(auth.user.id);
      return NextResponse.json({ error: "Failed to create staff user" }, { status: 500 });
    }

    return NextResponse.json({ user: staffRow }, { status: 200 });
  } catch (err: any) {
    console.error("staff users create fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
