import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabaseServer";
import { pinToPassword } from "@/lib/pinAuth";

export const runtime = "nodejs";

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
      .select("auth_email,auth_user_id,role,active")
      .eq("staff_id", staffId)
      .single();

    if (staffErr || !staff || !staff.active) {
      console.error("staff login lookup failed", {
        staffId,
        staffErr: staffErr?.message || staffErr,
        staffActive: staff?.active ?? null,
        staffFound: Boolean(staff),
      });
      return NextResponse.json({ error: "Invalid staff ID or PIN" }, { status: 401 });
    }

    const sb = anonClient();
    const authEmail = staff.auth_email || `${staffId}@axequacks.local`;
    let { data: authData, error: authErr } = await sb.auth.signInWithPassword({
      email: authEmail,
      password: pinToPassword(pin, staffId),
    });

    if (authErr || !authData.session) {
      if (staff.auth_user_id) {
        const { error: resetErr } = await admin.auth.admin.updateUserById(String(staff.auth_user_id), {
          password: pinToPassword(pin, staffId),
          email: authEmail,
          email_confirm: true,
        });
        if (!resetErr) {
          const retry = await sb.auth.signInWithPassword({
            email: authEmail,
            password: pinToPassword(pin, staffId),
          });
          authData = retry.data;
          authErr = retry.error;
        }
      }
      if (authErr || !authData.session) {
        console.error("staff login auth failed", {
          staffId,
          authEmail: staff.auth_email,
          authErr: authErr?.message || authErr,
          session: Boolean(authData?.session),
        });
        return NextResponse.json({ error: "Invalid staff ID or PIN" }, { status: 401 });
      }
    }

    if (authData?.user?.id && staff.auth_user_id !== authData.user.id) {
      const { error: staffUpdateErr } = await admin
        .from("staff_users")
        .update({ auth_user_id: authData.user.id, auth_email: authEmail })
        .eq("staff_id", staffId);
      if (staffUpdateErr) {
        console.error("staff login user sync failed", {
          staffId,
          authEmail,
          authUserId: authData.user.id,
          staffUpdateErr: staffUpdateErr?.message || staffUpdateErr,
        });
      }
    }

    const res = NextResponse.json({ ok: true, role: staff.role }, { status: 200 });
    const secure = process.env.NODE_ENV === "production";
    res.cookies.set("staff_access_token", authData.session.access_token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
    });
    res.cookies.set("staff_refresh_token", authData.session.refresh_token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
    });

    return res;
  } catch (err: any) {
    console.error("staff login error:", err);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
