import { NextResponse } from "next/server";
import { getStripeTerminal } from "@/lib/server/stripe";

export async function POST() {
  try {
    const stripe = getStripeTerminal();
    const token = await stripe.terminal.connectionTokens.create();
    return NextResponse.json({ secret: token.secret }, { status: 200 });
  } catch (e: any) {
    console.error("terminal connection token error:", e);
    return NextResponse.json({ error: e?.message || "Failed to create connection token" }, { status: 500 });
  }
}
