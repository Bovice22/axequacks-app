const { createClient } = require("@supabase/supabase-js");
const Stripe = require("stripe");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const stripeSecret = process.env.STRIPE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

if (!stripeSecret) {
  console.error("Missing STRIPE_SECRET_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" });

const PAGE_SIZE = 200;

async function fetchBookings(offset) {
  const { data, error } = await supabase
    .from("bookings")
    .select("id,paid,payment_intent_id,status")
    .eq("paid", true)
    .or("payment_intent_id.is.null,payment_intent_id.eq.")
    .order("created_at", { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);

  if (error) {
    throw new Error(error.message || "Failed to load bookings");
  }
  return data || [];
}

async function findPaymentIntentId(bookingId) {
  try {
    const search = await stripe.paymentIntents.search({
      query: `metadata['booking_id']:'${bookingId}'`,
      limit: 1,
    });
    return search.data?.[0]?.id || "";
  } catch (err) {
    console.error(`Stripe search error for ${bookingId}:`, err?.message || err);
    return "";
  }
}

async function updateBooking(bookingId, paymentIntentId) {
  if (!paymentIntentId) return false;
  const { error } = await supabase
    .from("bookings")
    .update({ payment_intent_id: paymentIntentId, paid: true })
    .eq("id", bookingId);
  if (error) {
    console.error(`Update error for ${bookingId}:`, error.message || error);
    return false;
  }
  return true;
}

async function main() {
  let offset = 0;
  let scanned = 0;
  let updated = 0;
  let missing = 0;

  while (true) {
    const rows = await fetchBookings(offset);
    if (!rows.length) break;

    for (const row of rows) {
      scanned += 1;
      const paymentIntentId = await findPaymentIntentId(row.id);
      if (!paymentIntentId) {
        missing += 1;
        continue;
      }
      const ok = await updateBooking(row.id, paymentIntentId);
      if (ok) updated += 1;

      if (scanned % 20 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    offset += rows.length;
  }

  console.log(
    JSON.stringify(
      {
        scanned,
        updated,
        missing,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
