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
      "assigned_staff_id",
      "tip_cents",
      "tip_staff_id",
    ];
    const selectWithPayment = [...baseFields, "payment_intent_id", "notes", "paid"].join(",");
    const selectWithPaid = [...baseFields, "notes", "paid"].join(",");

    let data: any[] | null = null;
    let error: any = null;
    ({ data, error } = await sb
      .from("bookings")
      .select(selectWithPayment)
      .order("start_ts", { ascending })
      .limit(200));

    const errorMessage = String(error?.message || "").toLowerCase();
    if (error && errorMessage.includes("payment_intent")) {
      ({ data, error } = await sb
        .from("bookings")
        .select(selectWithPaid)
        .order("start_ts", { ascending })
        .limit(200));
    }
    if (
      error &&
      (String(error?.message || "").toLowerCase().includes("paid") ||
        String(error?.message || "").toLowerCase().includes("notes"))
    ) {
      ({ data, error } = await sb
        .from("bookings")
        .select(baseFields.join(","))
        .order("start_ts", { ascending })
        .limit(200));
    }
    if (
      error &&
      (errorMessage.includes("assigned_staff_id") ||
        errorMessage.includes("tip_staff_id") ||
        errorMessage.includes("tip_cents"))
    ) {
      const minimalFields = baseFields.filter(
        (field) => !["assigned_staff_id", "tip_cents", "tip_staff_id"].includes(field)
      );
      ({ data, error } = await sb
        .from("bookings")
        .select(minimalFields.join(","))
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

    const TAX_RATE = 0.0725;
    let tabStatusByBooking = new Map<string, { status: string; tabId: string | null; totalCents: number }>();
    if (bookingIds.length > 0) {
      const { data: tabs, error: tabErr } = await sb
        .from("booking_tabs")
        .select("id,booking_id,status")
        .in("booking_id", bookingIds);
      if (tabErr) {
        console.error("tab lookup error:", tabErr);
      } else {
        const openTabs = (tabs ?? []).filter((row) => String(row.status || "").toUpperCase() === "OPEN");
        const closedTabs = (tabs ?? []).filter((row) => String(row.status || "").toUpperCase() === "CLOSED");
        for (const row of openTabs) {
          if (!row?.booking_id) continue;
          tabStatusByBooking.set(row.booking_id, { status: "OPEN", tabId: row.id, totalCents: 0 });
        }
        for (const row of closedTabs) {
          if (!row?.booking_id) continue;
          if (!tabStatusByBooking.has(row.booking_id)) {
            tabStatusByBooking.set(row.booking_id, { status: "CLOSED", tabId: row.id, totalCents: 0 });
          }
        }
      }
    }

    if (tabStatusByBooking.size > 0) {
      const openTabIds = Array.from(tabStatusByBooking.values())
        .filter((row) => row.status === "OPEN" && row.tabId)
        .map((row) => row.tabId as string);
      if (openTabIds.length > 0) {
        const { data: tabItems, error: tabItemsErr } = await sb
          .from("booking_tab_items")
          .select("id,tab_id,item_id,quantity")
          .in("tab_id", openTabIds);
        if (tabItemsErr) {
          console.error("tab items load error:", tabItemsErr);
        } else {
          const itemIds = Array.from(new Set((tabItems ?? []).map((row) => row.item_id).filter(Boolean)));
          const { data: addons, error: addonsErr } = await sb
            .from("add_ons")
            .select("id,price_cents")
            .in("id", itemIds);
          if (addonsErr) {
            console.error("tab addons load error:", addonsErr);
          } else {
            const addonById = new Map((addons ?? []).map((row) => [row.id, row]));
            const totalsByTab = new Map<string, number>();
            for (const item of tabItems ?? []) {
              const addon = addonById.get(item.item_id);
              if (!addon) continue;
              const lineTotal = (Number(addon.price_cents || 0) || 0) * (Number(item.quantity || 0) || 0);
              totalsByTab.set(item.tab_id, (totalsByTab.get(item.tab_id) || 0) + lineTotal);
            }
            for (const row of tabStatusByBooking.values()) {
              if (!row.tabId) continue;
              const subtotal = totalsByTab.get(row.tabId) || 0;
              const tax = Math.round(subtotal * TAX_RATE);
              row.totalCents = subtotal + tax;
            }
          }
        }
      }
    }

    const enriched = (data ?? []).map((row) => {
      const tabInfo = tabStatusByBooking.get(row.id);
      return {
        ...row,
        tab_status: tabInfo?.status || null,
        tab_id: tabInfo?.tabId || null,
        tab_total_cents: tabInfo?.totalCents || 0,
      };
    });

    return NextResponse.json(
      { bookings: enriched, resources: resources ?? [], reservations, eventRequests },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("staff bookings route fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
