import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

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

export async function GET(req: Request, context: RouteContext) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const customerIdRaw = await getRouteId(req, context);
    const url = new URL(req.url);
    const emailParam = url.searchParams.get("email") || "";
    const customerId =
      customerIdRaw && customerIdRaw !== "undefined" && customerIdRaw !== "null" ? customerIdRaw : "";
    if (!customerId && !emailParam) return NextResponse.json({ error: "Missing customer id" }, { status: 400 });

    const sb = supabaseServer();
    let customer: any = null;
    let customerErr: any = null;
    if (customerId) {
      const res = await sb
        .from("customers")
        .select("id,full_name,email,phone,created_at")
        .eq("id", customerId)
        .single();
      customer = res.data;
      customerErr = res.error;
    } else if (emailParam) {
      const res = await sb
        .from("customers")
        .select("id,full_name,email,phone,created_at")
        .eq("email", emailParam)
        .single();
      customer = res.data;
      customerErr = res.error;
    }

    if (customerErr) {
      console.error("customer fetch error:", customerErr);
      return NextResponse.json({ error: "Failed to load customer" }, { status: 500 });
    }

    let bookings: any[] = [];
    if (customer?.id) {
      const { data: rows, error: bookingsErr } = await sb
        .from("bookings")
        .select("id,activity,party_size,start_ts,end_ts,status,total_cents")
        .eq("customer_id", customer.id)
        .order("start_ts", { ascending: false })
        .limit(100);
      if (bookingsErr) {
        console.error("customer bookings fetch error:", bookingsErr);
        return NextResponse.json({ error: "Failed to load customer bookings" }, { status: 500 });
      }
      bookings = rows ?? [];
    }

    let rows = bookings ?? [];
    if (rows.length === 0 && (customer?.email || emailParam)) {
      const { data: fallbackRows, error: fallbackErr } = await sb
        .from("bookings")
        .select("id,activity,party_size,start_ts,end_ts,status,total_cents")
        .eq("customer_email", customer?.email || emailParam)
        .order("start_ts", { ascending: false })
        .limit(100);

      if (fallbackErr) {
        console.error("customer bookings fallback error:", fallbackErr);
      } else {
        rows = fallbackRows ?? [];
      }
    }

    let waivers: any[] = [];
    if (customer?.id) {
      const { data: waiverRows, error: waiverErr } = await sb
        .from("customer_waivers")
        .select("id,signer_name,signer_email,signed_at,created_at,booking_id")
        .eq("customer_id", customer.id)
        .order("signed_at", { ascending: false })
        .limit(10);
      if (waiverErr) {
        console.error("customer waiver fetch error:", waiverErr);
      } else {
        waivers = waiverRows ?? [];
      }
    }

    return NextResponse.json({ customer, bookings: rows, waivers }, { status: 200 });
  } catch (err: any) {
    console.error("customer detail fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = await getRouteId(req, context);
    if (!id) return NextResponse.json({ error: "Missing customer id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const updates: Record<string, any> = {};
    if (body?.full_name != null) updates.full_name = String(body.full_name).trim() || null;
    if (body?.email != null) updates.email = String(body.email).trim().toLowerCase();
    if (body?.phone != null) updates.phone = String(body.phone).trim() || null;

    const sb = supabaseServer();
    const { data, error } = await sb
      .from("customers")
      .update(updates)
      .eq("id", id)
      .select("id,full_name,email,phone,created_at")
      .single();

    if (error) {
      console.error("customer update error:", error);
      return NextResponse.json({ error: error.message || "Failed to update customer" }, { status: 500 });
    }

    return NextResponse.json({ customer: data }, { status: 200 });
  } catch (err: any) {
    console.error("customer update fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let id = await getRouteId(_req, context);
    if (!id) {
      try {
        const url = new URL(_req.url);
        const parts = url.pathname.split("/").filter(Boolean);
        id = String(parts[parts.length - 1] || "").trim();
      } catch {
        id = "";
      }
    }
    if (!id) return NextResponse.json({ error: "Missing customer id" }, { status: 400 });

    const sb = supabaseServer();
    await sb.from("bookings").update({ customer_id: null }).eq("customer_id", id);
    const { error } = await sb.from("customers").delete().eq("id", id);

    if (error) {
      console.error("customer delete error:", error);
      return NextResponse.json({ error: error.message || "Failed to delete customer" }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    console.error("customer delete fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
