import { NextResponse } from "next/server";
import { getStaffUserFromCookies } from "@/lib/staffAuth";
import { repairBookingReservations } from "@/lib/server/bookingService";

export async function POST(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const id = url.pathname.split("/").slice(-2)[0] || url.searchParams.get("id") || "";
    if (!id) return NextResponse.json({ error: "Missing booking id" }, { status: 400 });

    const result = await repairBookingReservations(id);
    return NextResponse.json({ ok: true, bookingId: result.bookingId }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to repair booking" }, { status: 500 });
  }
}
