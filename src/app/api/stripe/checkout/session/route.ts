import { NextResponse } from "next/server";
import { getStripe } from "@/lib/server/stripe";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("session_id");
    if (!sessionId) return NextResponse.json({ error: "Missing session_id" }, { status: 400 });

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const paymentIntentId = session.payment_intent as string | null;

    let metadata = session.metadata || {};
    if (paymentIntentId) {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
      metadata = intent.metadata || metadata;
    }

    return NextResponse.json(
      {
        session: {
          id: session.id,
          amount_total: session.amount_total,
          currency: session.currency,
          customer_email: session.customer_details?.email || session.customer_email,
        },
        metadata,
      },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("checkout session fetch error:", e);
    return NextResponse.json({ error: e?.message || "Failed to fetch session" }, { status: 500 });
  }
}
