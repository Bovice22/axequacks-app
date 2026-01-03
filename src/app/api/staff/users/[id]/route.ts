import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { pinToPassword } from "@/lib/pinAuth";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const id = params.id;

    const body = await req.json().catch(() => ({}));
    const fullName = body?.fullName != null ? String(body.fullName).trim() : undefined;
    const role = body?.role != null ? String(body.role) : undefined;
    const staffId = body?.staffId != null ? String(body.staffId).trim().toLowerCase() : undefined;
    const active = body?.active;
    const pin = body?.pin != null ? String(body.pin).trim() : undefined;

    if (role && !["staff", "admin"].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    if (pin && pin.length !== 4) {
      return NextResponse.json({ error: "Invalid PIN" }, { status: 400 });
    }

    const sb = supabaseServer();
    const idParam =
      id && id !== "undefined" && id !== "null" ? id : null;

    let staffRow = null as any;
    let staffErr = null as any;

    if (idParam) {
      const res = await sb
        .from("staff_users")
        .select("id,auth_user_id,staff_id")
        .or(`id.eq.${idParam},auth_user_id.eq.${idParam}`)
        .single();
      staffRow = res.data;
      staffErr = res.error;
    } else if (staffId) {
      const res = await sb
        .from("staff_users")
        .select("id,auth_user_id,staff_id")
        .eq("staff_id", staffId)
        .single();
      staffRow = res.data;
      staffErr = res.error;
    } else {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    if (staffErr || !staffRow) {
      return NextResponse.json({ error: "Staff user not found" }, { status: 404 });
    }

    if (pin) {
      const effectiveStaffId = staffId ?? staffRow.staff_id;
      const { error: pwErr } = await sb.auth.admin.updateUserById(staffRow.auth_user_id, {
        password: pinToPassword(pin, effectiveStaffId),
      });
      if (pwErr) {
        console.error("staff user password update error:", pwErr);
        return NextResponse.json({ error: "Failed to update PIN" }, { status: 500 });
      }
    }
    if (staffId) {
      const { error: emailErr } = await sb.auth.admin.updateUserById(staffRow.auth_user_id, {
        email: `${staffId}@axequacks.local`,
      });
      if (emailErr) {
        console.error("staff user email update error:", emailErr);
        return NextResponse.json({ error: "Failed to update staff ID" }, { status: 500 });
      }
    }

    const updates: Record<string, any> = {};
    if (fullName !== undefined) updates.full_name = fullName || null;
    if (role !== undefined) updates.role = role;
    if (staffId !== undefined) {
      updates.staff_id = staffId;
      updates.auth_email = `${staffId}@axequacks.local`;
    }
    if (active !== undefined) updates.active = !!active;

    if (Object.keys(updates).length > 0) {
      const { error: updErr } = await sb.from("staff_users").update(updates).eq("id", staffRow.id);
      if (updErr) {
        console.error("staff user update error:", updErr);
        return NextResponse.json({ error: "Failed to update staff user" }, { status: 500 });
      }
    }

    const { data: updated, error: fetchErr } = await sb
      .from("staff_users")
      .select("id,staff_id,full_name,role,active,created_at")
      .eq("id", staffRow.id)
      .single();

    if (fetchErr) {
      console.error("staff user fetch error:", fetchErr);
      return NextResponse.json({ error: "Failed to load staff user" }, { status: 500 });
    }

    return NextResponse.json({ user: updated }, { status: 200 });
  } catch (err: any) {
    console.error("staff users update fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let id = params.id;
    if (!id) {
      try {
        const url = new URL(req.url);
        const parts = url.pathname.split("/").filter(Boolean);
        id = String(parts[parts.length - 1] || "").trim();
      } catch {
        id = "";
      }
    }
    const sb = supabaseServer();
    const idParam = id && id !== "undefined" && id !== "null" ? id : null;

    let staffRow = null as any;
    let staffErr = null as any;

    if (idParam) {
      const res = await sb
        .from("staff_users")
        .select("id,auth_user_id,staff_id")
        .or(`id.eq.${idParam},auth_user_id.eq.${idParam}`)
        .single();
      staffRow = res.data;
      staffErr = res.error;
    } else {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    if (staffErr || !staffRow) {
      return NextResponse.json({ error: "Staff user not found" }, { status: 404 });
    }

    if (staffRow.auth_user_id) {
      const { error: authErr } = await sb.auth.admin.deleteUser(staffRow.auth_user_id);
      if (authErr) {
        console.error("staff user auth delete error:", authErr);
        return NextResponse.json({ error: "Failed to delete auth user" }, { status: 500 });
      }
    }

    const { error: deleteErr } = await sb.from("staff_users").delete().eq("id", staffRow.id);
    if (deleteErr) {
      console.error("staff user delete error:", deleteErr);
      return NextResponse.json({ error: "Failed to delete staff user" }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    console.error("staff users delete fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
