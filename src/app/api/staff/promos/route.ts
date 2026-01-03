import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

export async function GET() {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sb = supabaseServer();
    const { data, error } = await sb
      .from("promo_codes")
      .select("id,code,discount_type,discount_value,active,starts_at,ends_at,max_redemptions,redemptions_count,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("promos list error:", error);
      return NextResponse.json({ error: "Failed to load promos" }, { status: 500 });
    }

    return NextResponse.json({ promos: data ?? [] }, { status: 200 });
  } catch (err: any) {
    console.error("promos list fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const code = String(body?.code || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
    const discountType = String(body?.discount_type || "PERCENT").toUpperCase();
    const discountValue = Number(body?.discount_value ?? 0);
    const active = !!body?.active;
    const startsAt = body?.starts_at ? String(body.starts_at) : null;
    const endsAt = body?.ends_at ? String(body.ends_at) : null;
    const maxRedemptions = body?.max_redemptions != null ? Number(body.max_redemptions) : null;

    if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 });
    if (!["PERCENT", "AMOUNT"].includes(discountType)) {
      return NextResponse.json({ error: "Invalid discount type" }, { status: 400 });
    }

    const sb = supabaseServer();
    const { data, error } = await sb
      .from("promo_codes")
      .insert({
        code,
        discount_type: discountType,
        discount_value: discountValue,
        active,
        starts_at: startsAt,
        ends_at: endsAt,
        max_redemptions: maxRedemptions,
      })
      .select("id,code,discount_type,discount_value,active,starts_at,ends_at,max_redemptions,redemptions_count,created_at")
      .single();

    if (error) {
      console.error("promos create error:", error);
      return NextResponse.json({ error: "Failed to create promo" }, { status: 500 });
    }

    return NextResponse.json({ promo: data }, { status: 200 });
  } catch (err: any) {
    console.error("promos create fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
