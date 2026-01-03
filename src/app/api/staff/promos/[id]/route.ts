import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = params.id;
    const body = await req.json().catch(() => ({}));
    const codeFallback =
      body?.code != null
        ? String(body.code).trim().toUpperCase()
        : "";
    const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    const idParam = id ? String(id).trim() : "";
    const idIsUuid = idParam ? isUuid(idParam) : false;
    const codeTarget = (codeFallback || idParam).trim().toUpperCase();
    if (!idParam && !codeFallback) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const updates: Record<string, any> = {};
    if (body?.code != null) {
      updates.code = String(body.code)
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");
    }
    if (body?.discount_type != null) updates.discount_type = String(body.discount_type).toUpperCase();
    if (body?.discount_value != null) updates.discount_value = Number(body.discount_value);
    if (body?.active != null) updates.active = !!body.active;
    if (body?.starts_at != null) updates.starts_at = body.starts_at || null;
    if (body?.ends_at != null) updates.ends_at = body.ends_at || null;
    if (body?.max_redemptions != null) updates.max_redemptions = Number(body.max_redemptions);

    const sb = supabaseServer();
    const updateQuery = idIsUuid
      ? sb
          .from("promo_codes")
          .update(updates)
          .eq("id", idParam)
          .select("id,code,discount_type,discount_value,active,starts_at,ends_at,max_redemptions,redemptions_count,created_at")
          .maybeSingle()
      : sb
          .from("promo_codes")
          .update(updates)
          .eq("code", codeTarget)
          .select("id,code,discount_type,discount_value,active,starts_at,ends_at,max_redemptions,redemptions_count,created_at")
          .maybeSingle();
    const { data, error } = await updateQuery;
    if (error) {
      console.error("promo update error:", error);
      return NextResponse.json(
        { error: "Failed to update promo", detail: error?.message || error },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json({ error: "Promo not found" }, { status: 404 });
    }

    return NextResponse.json({ promo: data }, { status: 200 });
  } catch (err: any) {
    console.error("promo update fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
