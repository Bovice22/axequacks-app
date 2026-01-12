import Stripe from "stripe";

let stripe: Stripe | null = null;
let stripeTerminal: Stripe | null = null;

export function getStripe() {
  if (stripe) return stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  stripe = new Stripe(key, { apiVersion: "2025-12-15.clover" });
  return stripe;
}

export function getStripeTerminal() {
  if (stripeTerminal) return stripeTerminal;
  const key = process.env.STRIPE_TERMINAL_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_TERMINAL_SECRET_KEY");
  stripeTerminal = new Stripe(key, { apiVersion: "2025-12-15.clover" });
  return stripeTerminal;
}
