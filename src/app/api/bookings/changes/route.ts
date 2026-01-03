import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const bookingId = String(body?.booking_id || "");
    const changeType = String(body?.change_type || "");
    const note = String(body?.note || "").trim();

    if (!bookingId) return NextResponse.json({ error: "Missing booking_id" }, { status: 400 });
    if (!["RESCHEDULE", "CANCEL", "REFUND"].includes(changeType)) {
      return NextResponse.json({ error: "Invalid change_type" }, { status: 400 });
    }

    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("booking_changes")
      .insert({
        booking_id: bookingId,
        change_type: changeType,
        status: "PENDING",
        note: note || null,
      })
      .select("id,booking_id,change_type,status,requested_at")
      .single();

    if (error) {
      console.error("booking change create error:", error);
      return NextResponse.json({ error: "Failed to create booking change" }, { status: 500 });
    }

    return NextResponse.json({ change: data }, { status: 200 });
  } catch (err: any) {
    console.error("booking change create fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
