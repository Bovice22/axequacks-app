import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";
import { generateGiftCode } from "@/lib/server/giftCertificates";

export async function GET() {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sb = supabaseServer();
    const { data, error } = await sb
      .from("gift_certificates")
      .select("id,code,original_amount_cents,balance_cents,status,expires_at,created_at,customers(full_name,email)")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("gift certificates list error:", error);
      return NextResponse.json({ error: "Failed to load gift certificates" }, { status: 500 });
    }

    return NextResponse.json({ certificates: data ?? [] }, { status: 200 });
  } catch (err: any) {
    console.error("gift certificates list fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const customerEmail = String(body?.customer_email || "").trim().toLowerCase();
    const amountDollars = Number(body?.amount_dollars ?? 0);
    const amountCents = Math.round(amountDollars * 100);

    if (!customerEmail || !customerEmail.includes("@")) {
      return NextResponse.json({ error: "Missing customer email" }, { status: 400 });
    }
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    const sb = supabaseServer();
    const { data: customer, error: customerErr } = await sb
      .from("customers")
      .select("id")
      .eq("email", customerEmail)
      .maybeSingle();

    if (customerErr) {
      console.error("gift certificate customer lookup error:", customerErr);
      return NextResponse.json({ error: "Failed to validate customer" }, { status: 500 });
    }
    if (!customer?.id) {
      return NextResponse.json({ error: "Customer not found" }, { status: 400 });
    }

    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    let created = null;
    let lastError: any = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateGiftCode();
      const { data, error } = await sb
        .from("gift_certificates")
        .insert({
          code,
          customer_id: customer.id,
          original_amount_cents: amountCents,
          balance_cents: amountCents,
          status: "ACTIVE",
          expires_at: expiresAt.toISOString(),
          created_by: staff.staff_id,
        })
        .select("id,code,original_amount_cents,balance_cents,status,expires_at,created_at,customers(full_name,email)")
        .single();

      if (!error && data) {
        created = data;
        break;
      }
      lastError = error;
    }

    if (!created) {
      console.error("gift certificate create error:", lastError);
      return NextResponse.json({ error: "Failed to create gift certificate" }, { status: 500 });
    }

    return NextResponse.json({ certificate: created }, { status: 200 });
  } catch (err: any) {
    console.error("gift certificates create fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
