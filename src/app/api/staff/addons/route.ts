import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

export async function GET() {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sb = supabaseServer();
    const { data, error } = await sb
      .from("add_ons")
      .select("id,name,description,price_cents,image_url,active,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("addons list error:", error);
      return NextResponse.json({ error: error.message || "Failed to load add-ons" }, { status: 500 });
    }

    return NextResponse.json({ addons: data ?? [] }, { status: 200 });
  } catch (err: any) {
    console.error("addons list fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const name = String(body?.name || "").trim();
    const description = String(body?.description || "").trim();
    const priceCents = Number(body?.price_cents ?? 0);
    const imageUrl = String(body?.image_url || "").trim();
    const active = !!body?.active;

    if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });

    const sb = supabaseServer();
    const { data, error } = await sb
      .from("add_ons")
      .insert({
        name,
        description: description || null,
        price_cents: priceCents,
        image_url: imageUrl || null,
        active,
      })
      .select("id,name,description,price_cents,image_url,active,created_at")
      .single();

    if (error) {
      console.error("addon create error:", error);
      return NextResponse.json({ error: error.message || "Failed to create add-on" }, { status: 500 });
    }

    return NextResponse.json({ addon: data }, { status: 200 });
  } catch (err: any) {
    console.error("addon create fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || "").trim();
    const name = String(body?.name || "").trim();

    if (!id && !name) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const updates: Record<string, any> = {};
    if (body?.name != null) updates.name = String(body.name).trim();
    if (body?.description != null) updates.description = String(body.description).trim() || null;
    if (body?.price_cents != null) updates.price_cents = Number(body.price_cents);
    if (body?.image_url != null) updates.image_url = String(body.image_url).trim() || null;
    if (body?.active != null) updates.active = !!body.active;

    const sb = supabaseServer();
    const query = sb.from("add_ons").update(updates);
    const { data, error } = await (id ? query.eq("id", id) : query.eq("name", name))
      .select("id,name,description,price_cents,image_url,active,created_at")
      .single();

    if (error) {
      console.error("addon update error:", error);
      return NextResponse.json({ error: error.message || "Failed to update add-on" }, { status: 500 });
    }

    return NextResponse.json({ addon: data }, { status: 200 });
  } catch (err: any) {
    console.error("addon update fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
