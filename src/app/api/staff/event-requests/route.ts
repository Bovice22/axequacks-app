import { NextResponse } from "next/server";
import { getStaffUserFromCookies } from "@/lib/staffAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStripe } from "@/lib/server/stripe";

export async function GET() {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sb = supabaseServer();
    const { data, error } = await sb
      .from("event_requests")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("event requests fetch error:", error);
      return NextResponse.json({ error: "Failed to load requests" }, { status: 500 });
    }

    const stripe = getStripe();
    const sessionIdFromUrl = (url?: string | null) => {
      if (!url) return "";
      const match = url.match(/\/c\/pay\/(cs_[A-Za-z0-9_]+)/);
      return match?.[1] || "";
    };
    const hydrated = await Promise.all(
      (data || []).map(async (row: any) => {
        const status = String(row?.status || "").toUpperCase();
        const paymentStatus = String(row?.payment_status || "").toUpperCase();
        const derivedSessionId = sessionIdFromUrl(row?.payment_link_url);
        const sessionId =
          (row?.payment_session_id as string | undefined) ||
          (derivedSessionId ? derivedSessionId : undefined);
        if (status === "ACCEPTED" && paymentStatus !== "PAID" && sessionId) {
          try {
            const session = await stripe.checkout.sessions.retrieve(sessionId);
            if (session?.payment_status === "paid") {
              const paidAt = new Date().toISOString();
              const paymentIntentId = session.payment_intent as string | null;
              await sb
                .from("event_requests")
                .update({
                  payment_status: "PAID",
                  paid_at: paidAt,
                  payment_intent_id: paymentIntentId || row?.payment_intent_id || null,
                  payment_session_id: sessionId,
                })
                .eq("id", row.id);
              if (Array.isArray(row?.booking_ids) && row.booking_ids.length) {
                await sb.from("bookings").update({ paid: true }).in("id", row.booking_ids);
              }
              return {
                ...row,
                payment_status: "PAID",
                paid_at: paidAt,
                payment_intent_id: paymentIntentId || row?.payment_intent_id || null,
                payment_session_id: sessionId,
              };
            }
            if (!row?.payment_session_id && sessionId) {
              await sb.from("event_requests").update({ payment_session_id: sessionId }).eq("id", row.id);
            }
          } catch (stripeErr) {
            console.error("event request payment refresh error:", stripeErr);
          }
        }
        if (status === "ACCEPTED" && paymentStatus === "PAID" && Array.isArray(row?.booking_ids) && row.booking_ids.length) {
          await sb.from("bookings").update({ paid: true }).in("id", row.booking_ids);
        }
        return row;
      })
    );

    return NextResponse.json({ requests: hydrated || [] }, { status: 200 });
  } catch (err: any) {
    console.error("event requests route fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
