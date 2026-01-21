import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";
import { sendGiftCertificateEmail } from "@/lib/server/mailer";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

async function getRouteId(req: Request, context: RouteContext) {
  const resolvedParams = await Promise.resolve(context.params);
  if (resolvedParams?.id) return String(resolvedParams.id).trim();
  try {
    const path = new URL(req.url).pathname;
    return path.split("/").pop() || "";
  } catch {
    return "";
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = await getRouteId(req, context);
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const sb = supabaseServer();
    const { data, error } = await sb
      .from("gift_certificates")
      .select("id,code,balance_cents,expires_at,customers(full_name,email)")
      .eq("id", id)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({ error: "Gift certificate not found" }, { status: 404 });
    }

    const customerEmail = String((data as any)?.customers?.email || "");
    if (!customerEmail) {
      return NextResponse.json({ error: "Missing customer email" }, { status: 400 });
    }

    await sendGiftCertificateEmail({
      customerEmail,
      customerName: (data as any)?.customers?.full_name || null,
      code: data.code,
      balanceCents: Number(data.balance_cents || 0),
      expiresAt: data.expires_at,
      subject: "Axe Quacks Gift Certificate Balance",
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    console.error("gift certificate send fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
