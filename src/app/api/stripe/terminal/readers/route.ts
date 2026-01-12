import { NextResponse } from "next/server";
import { getStripeTerminal } from "@/lib/server/stripe";

export async function GET() {
  try {
    const stripe = getStripeTerminal();
    const readers = await stripe.terminal.readers.list({ limit: 100 });
    return NextResponse.json({ readers: readers.data }, { status: 200 });
  } catch (e: any) {
    console.error("terminal readers error:", e);
    return NextResponse.json({ error: e?.message || "Failed to load readers" }, { status: 500 });
  }
}
