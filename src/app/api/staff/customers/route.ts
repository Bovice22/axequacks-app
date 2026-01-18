import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

type CustomerRow = {
  id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  created_at: string;
};

export async function GET() {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sb = supabaseServer();
    const { data, error } = await sb
      .from("customers")
      .select("id,full_name,email,phone,created_at")
      .order("created_at", { ascending: false })
      .limit(2000);

    if (error) {
      console.error("customers list error:", error);
      return NextResponse.json({ error: "Failed to load customers" }, { status: 500 });
    }

    const customers = (data ?? []) as CustomerRow[];
    const ids = customers.map((c) => c.id).filter(Boolean);

    let bookingMeta: Record<string, { count: number; lastStart?: string; hasAxe?: boolean }> = {};
    if (ids.length) {
      const { data: bookings, error: bookingsErr } = await sb
        .from("bookings")
        .select("customer_id,start_ts,activity")
        .in("customer_id", ids);

      if (bookingsErr) {
        console.error("customers booking meta error:", bookingsErr);
      } else {
        for (const row of bookings ?? []) {
          const customerId = (row as any)?.customer_id as string | null;
          if (!customerId) continue;
          const startTs = (row as any)?.start_ts as string | null;
          const activity = String((row as any)?.activity || "").toUpperCase();
          if (!bookingMeta[customerId]) bookingMeta[customerId] = { count: 0 };
          bookingMeta[customerId].count += 1;
          if (startTs) {
            const prev = bookingMeta[customerId].lastStart;
            if (!prev || new Date(startTs).getTime() > new Date(prev).getTime()) {
              bookingMeta[customerId].lastStart = startTs;
            }
          }
          if (activity.includes("AXE") || activity.includes("COMBO")) {
            bookingMeta[customerId].hasAxe = true;
          }
        }
      }
    }

    let waiverMeta: Record<string, boolean> = {};
    let waiverLinkMeta: Record<string, string> = {};
    let waiverViewMeta: Record<string, string> = {};
    if (ids.length) {
      const { data: waivers, error: waiversErr } = await sb
        .from("customer_waivers")
        .select("customer_id,signed_at")
        .in("customer_id", ids);

      if (waiversErr) {
        console.error("customers waiver meta error:", waiversErr);
      } else {
        for (const row of waivers ?? []) {
          const customerId = (row as any)?.customer_id as string | null;
          if (!customerId) continue;
          waiverMeta[customerId] = true;
        }
      }
    }

    if (ids.length) {
      const { data: waiverRequests, error: waiverReqErr } = await sb
        .from("waiver_requests")
        .select("customer_id,token,status,created_at")
        .in("customer_id", ids)
        .order("created_at", { ascending: false });

      if (waiverReqErr) {
        console.error("customers waiver request meta error:", waiverReqErr);
      } else {
        for (const row of waiverRequests ?? []) {
          const customerId = (row as any)?.customer_id as string | null;
          const token = String((row as any)?.token || "");
          const status = String((row as any)?.status || "");
          if (!customerId || !token) continue;
          if (status === "SIGNED") {
            if (!waiverViewMeta[customerId]) {
              waiverViewMeta[customerId] = token;
            }
          } else if (!waiverLinkMeta[customerId]) {
            waiverLinkMeta[customerId] = token;
          }
        }
      }
    }

    const enriched = customers.map((c) => ({
      ...c,
      bookings_count: bookingMeta[c.id]?.count ?? 0,
      last_booking_start: bookingMeta[c.id]?.lastStart ?? null,
      has_axe_booking: bookingMeta[c.id]?.hasAxe ?? false,
      waiver_on_file: waiverMeta[c.id] ?? false,
      waiver_token: waiverLinkMeta[c.id] ?? null,
      waiver_view_token: waiverViewMeta[c.id] ?? null,
    }));

    return NextResponse.json({ customers: enriched }, { status: 200 });
  } catch (err: any) {
    console.error("customers list fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const fullName = String(body?.full_name || body?.fullName || "").trim();
    const email = String(body?.email || "").trim().toLowerCase();
    const phone = String(body?.phone || "").trim();

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const sb = supabaseServer();
    const { data, error } = await sb
      .from("customers")
      .upsert(
        {
          full_name: fullName || null,
          email,
          phone: phone || null,
        },
        { onConflict: "email" }
      )
      .select("id,full_name,email,phone,created_at")
      .single();

    if (error) {
      console.error("customer create error:", error);
      return NextResponse.json({ error: "Failed to add customer" }, { status: 500 });
    }

    return NextResponse.json({ customer: data }, { status: 200 });
  } catch (err: any) {
    console.error("customer create fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
