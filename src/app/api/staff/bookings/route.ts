import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sb = getSupabaseAdmin();
    const { searchParams } = new URL(req.url);
    const orderParam = searchParams.get("order");
    const ascending = orderParam === "newest" ? false : true;

    const baseFields = [
      "id",
      "activity",
      "party_size",
      "duration_minutes",
      "total_cents",
      "customer_name",
      "customer_email",
      "customer_id",
      "start_ts",
      "end_ts",
      "combo_order",
      "status",
      "created_at",
    ];
    const selectWithPaid = [...baseFields, "notes", "paid"].join(",");

    let data: any[] | null = null;
    let error: any = null;
    ({ data, error } = await sb
      .from("bookings")
      .select(selectWithPaid)
      .order("start_ts", { ascending })
      .limit(200));

    const errorMessage = String(error?.message || "").toLowerCase();
    if (error && (errorMessage.includes("paid") || errorMessage.includes("notes"))) {
      ({ data, error } = await sb
        .from("bookings")
        .select(baseFields.join(","))
        .order("start_ts", { ascending })
        .limit(200));
    }

    if (error) {
      console.error("staff bookings list error:", error);
      return NextResponse.json({ error: "Failed to load bookings" }, { status: 500 });
    }

    const bookingIds = (data ?? []).map((row) => row.id).filter(Boolean);

    const { data: resources, error: resErr } = await sb
      .from("resources")
      .select("id,type,active,name,sort_order")
      .order("type", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });

    if (resErr) {
      console.error("staff resources load error:", resErr);
    }

    let reservations: any[] = [];
    if (bookingIds.length > 0) {
      const { data: rr, error: rrErr } = await sb
        .from("resource_reservations")
        .select("id,booking_id,resource_id,start_ts,end_ts")
        .in("booking_id", bookingIds);

      if (rrErr) {
        console.error("staff reservations load error:", rrErr);
      } else {
        reservations = rr ?? [];
      }
    }

    const eventRequestIds = (data ?? [])
      .map((row) => {
        const note = String((row as any)?.notes || "");
        const match = note.match(/Event Request:\s*([a-f0-9-]+)/i);
        return match ? match[1] : null;
      })
      .filter((id): id is string => !!id);

    let eventRequests: { id: string; party_size: number | null }[] = [];
    if (eventRequestIds.length > 0) {
      const { data: er, error: erErr } = await sb
        .from("event_requests")
        .select("id,party_size")
        .in("id", eventRequestIds);
      if (erErr) {
        console.error("event requests lookup error:", erErr);
      } else {
        eventRequests = er ?? [];
      }
    }

    return NextResponse.json(
      { bookings: data ?? [], resources: resources ?? [], reservations, eventRequests },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("staff bookings route fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
