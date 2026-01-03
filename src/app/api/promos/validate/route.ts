import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type ValidateBody = {
  code?: string;
  amount_cents?: number;
};

function normalizeCode(code: string) {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as ValidateBody;
    const codeRaw = String(body?.code || "");
    const code = normalizeCode(codeRaw);
    const amountCents = Number(body?.amount_cents ?? NaN);

    if (!code) return NextResponse.json({ error: "Missing promo code." }, { status: 400 });
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return NextResponse.json({ error: "Missing amount." }, { status: 400 });
    }

    const sb = supabaseServer();
    const { data, error } = await sb
      .from("promo_codes")
      .select("code,discount_type,discount_value,active,starts_at,ends_at,max_redemptions,redemptions_count")
      .eq("code", code)
      .maybeSingle();

    if (error) {
      console.error("promo validate error:", error);
      return NextResponse.json({ error: "Failed to validate promo." }, { status: 500 });
    }

    if (!data) return NextResponse.json({ error: "Promo not found." }, { status: 404 });
    if (!data.active) return NextResponse.json({ error: "Promo is inactive." }, { status: 400 });

    const now = new Date();
    if (data.starts_at && new Date(data.starts_at) > now) {
      return NextResponse.json({ error: "Promo not active yet." }, { status: 400 });
    }
    if (data.ends_at && new Date(data.ends_at) < now) {
      return NextResponse.json({ error: "Promo has expired." }, { status: 400 });
    }
    if (data.max_redemptions != null && data.redemptions_count >= data.max_redemptions) {
      return NextResponse.json({ error: "Promo has reached its limit." }, { status: 400 });
    }

    let amountOffCents = 0;
    if (data.discount_type === "PERCENT") {
      amountOffCents = Math.round((amountCents * Number(data.discount_value || 0)) / 100);
    } else {
      amountOffCents = Number(data.discount_value || 0);
    }
    amountOffCents = Math.max(0, Math.min(amountOffCents, amountCents));
    const totalCents = amountCents - amountOffCents;

    if (totalCents < 50) {
      return NextResponse.json({ error: "Promo discount exceeds total." }, { status: 400 });
    }

    return NextResponse.json(
      {
        promo: {
          code: data.code,
          discount_type: data.discount_type,
          discount_value: data.discount_value,
        },
        amount_off_cents: amountOffCents,
        total_cents: totalCents,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("promo validate fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
