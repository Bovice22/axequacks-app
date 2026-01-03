import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const urlId = (() => {
      try {
        const path = new URL(req.url).pathname;
        return path.split("/").pop() || "";
      } catch {
        return "";
      }
    })();
    const id = (params.id || urlId || "").trim();
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const updates: Record<string, any> = {};
    if (body?.name != null) updates.name = String(body.name).trim();
    if (body?.description != null) updates.description = String(body.description).trim() || null;
    if (body?.price_cents != null) updates.price_cents = Number(body.price_cents);
    if (body?.image_url != null) updates.image_url = String(body.image_url).trim() || null;
    if (body?.active != null) updates.active = !!body.active;

    const sb = supabaseServer();
    const { error: updErr } = await sb.from("add_ons").update(updates).eq("id", id);
    if (updErr) {
      console.error("addon update error:", updErr);
      return NextResponse.json({ error: "Failed to update add-on" }, { status: 500 });
    }

    const { data, error } = await sb
      .from("add_ons")
      .select("id,name,description,price_cents,image_url,active,created_at")
      .eq("id", id)
      .single();

    if (error) {
      console.error("addon fetch error:", error);
      return NextResponse.json({ error: "Failed to load add-on" }, { status: 500 });
    }

    return NextResponse.json({ addon: data }, { status: 200 });
  } catch (err: any) {
    console.error("addon update fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const urlId = (() => {
      try {
        const path = new URL(req.url).pathname;
        return path.split("/").pop() || "";
      } catch {
        return "";
      }
    })();
    const id = (params.id || urlId || "").trim();
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const sb = supabaseServer();
    const { error } = await sb.from("add_ons").delete().eq("id", id);
    if (error) {
      console.error("addon delete error:", error);
      return NextResponse.json({ error: error.message || "Failed to delete add-on" }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    console.error("addon delete fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
