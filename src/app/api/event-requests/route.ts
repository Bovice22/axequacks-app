import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type Activity = "Axe Throwing" | "Duckpin Bowling";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const customerName = String(body?.customerName || "").trim();
    const customerEmail = String(body?.customerEmail || "").trim().toLowerCase();
    const customerPhone = String(body?.customerPhone || "").trim();
    const partySize = Number(body?.partySize);
    const dateKey = String(body?.dateKey || "");
    const startMin = Number(body?.startMin);
    const durationMinutes = Number(body?.durationMinutes);
    const totalCents = Number(body?.totalCents);
    const activities = Array.isArray(body?.activities) ? body.activities : [];

    if (!customerName || !customerEmail) {
      return NextResponse.json({ error: "Missing contact info" }, { status: 400 });
    }
    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }
    if (!Number.isFinite(partySize) || partySize < 1 || partySize > 100) {
      return NextResponse.json({ error: "Invalid party size" }, { status: 400 });
    }
    if (!Number.isFinite(startMin) || startMin < 0) {
      return NextResponse.json({ error: "Invalid start time" }, { status: 400 });
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return NextResponse.json({ error: "Invalid duration" }, { status: 400 });
    }
    if (!Number.isFinite(totalCents) || totalCents < 0) {
      return NextResponse.json({ error: "Invalid total" }, { status: 400 });
    }
    if (!activities.length) {
      return NextResponse.json({ error: "Select at least one activity" }, { status: 400 });
    }

    const cleanActivities = activities
      .map((a: any) => ({
        activity: a?.activity as Activity,
        durationMinutes: Number(a?.durationMinutes),
      }))
      .filter(
        (a: any) =>
          (a.activity === "Axe Throwing" || a.activity === "Duckpin Bowling") &&
          [30, 60, 120].includes(a.durationMinutes)
      );

    if (!cleanActivities.length) {
      return NextResponse.json({ error: "Invalid activities" }, { status: 400 });
    }

    const sb = supabaseServer();
    const { data, error } = await sb
      .from("event_requests")
      .insert({
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone || null,
        party_size: partySize,
        date_key: dateKey,
        start_min: startMin,
        duration_minutes: durationMinutes,
        total_cents: totalCents,
        activities: cleanActivities,
        status: "PENDING",
      })
      .select("id")
      .single();

    if (error) {
      console.error("event request insert error:", error);
      return NextResponse.json({ error: "Unable to submit request" }, { status: 500 });
    }

    return NextResponse.json({ id: data?.id }, { status: 200 });
  } catch (err: any) {
    console.error("event request route fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
