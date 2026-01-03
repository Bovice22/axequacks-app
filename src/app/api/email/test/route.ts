import { NextResponse } from "next/server";
import { getStaffUserFromCookies } from "@/lib/staffAuth";
import { sendBookingConfirmationEmail } from "@/lib/server/mailer";

export async function POST(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const to = String(body?.to || "").trim();
    if (!to || !to.includes("@")) {
      return NextResponse.json({ error: "Missing valid recipient email" }, { status: 400 });
    }

    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
      return NextResponse.json(
        { error: "Missing RESEND_API_KEY or RESEND_FROM_EMAIL" },
        { status: 500 }
      );
    }

    const result = await sendBookingConfirmationEmail({
      bookingId: "test-booking",
      activity: "Combo Package",
      partySize: 2,
      dateKey: "2025-12-26",
      startMin: 16 * 60 + 30,
      durationMinutes: 120,
      customerName: "Test Guest",
      customerEmail: to,
      customerPhone: "555-555-5555",
      comboOrder: "DUCKPIN_FIRST",
      resourceNames: ["Lane 1", "Axe Bay 2"],
    });

    if (!result.sent) {
      return NextResponse.json(
        { error: "Email not sent", reason: result.skippedReason || "unknown" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, id: result.id || null }, { status: 200 });
  } catch (err: any) {
    console.error("test email error:", err);
    return NextResponse.json({ error: err?.message || "Failed to send test email" }, { status: 500 });
  }
}
