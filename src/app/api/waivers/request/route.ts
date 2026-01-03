import { NextResponse } from "next/server";
import { ensureWaiverForBooking } from "@/lib/server/waiverService";
import type { ActivityUI, ComboOrder, BookingInput } from "@/lib/server/bookingService";

type RequestBody = {
  bookingId: string;
  activity: ActivityUI;
  partySize: number;
  dateKey: string;
  startMin: number;
  durationMinutes: number;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  comboOrder?: ComboOrder;
  returnPath?: string;
};

function isValid(body: RequestBody) {
  if (!body.bookingId) return false;
  if (!body.activity) return false;
  if (!Number.isFinite(body.partySize)) return false;
  if (!body.dateKey) return false;
  if (!Number.isFinite(body.startMin)) return false;
  if (!Number.isFinite(body.durationMinutes)) return false;
  if (!body.customerEmail) return false;
  return true;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RequestBody;
    if (!isValid(body)) {
      return NextResponse.json({ error: "Missing waiver request fields" }, { status: 400 });
    }

    const bookingInput: BookingInput = {
      activity: body.activity,
      partySize: body.partySize,
      dateKey: body.dateKey,
      startMin: body.startMin,
      durationMinutes: body.durationMinutes,
      customerName: body.customerName || "",
      customerEmail: body.customerEmail,
      customerPhone: body.customerPhone,
      comboOrder: body.comboOrder,
    };

    const result = await ensureWaiverForBooking({
      bookingId: body.bookingId,
      customerId: "",
      bookingInput,
    });

    let waiverUrl = result.waiverUrl || "";
    if (waiverUrl && body.returnPath) {
      const url = new URL(waiverUrl);
      url.searchParams.set("return", body.returnPath);
      waiverUrl = url.toString();
    }

    return NextResponse.json({ waiverUrl, required: result.required }, { status: 200 });
  } catch (err: any) {
    console.error("waiver request error:", err);
    return NextResponse.json({ error: err?.message || "Failed to request waiver" }, { status: 500 });
  }
}
