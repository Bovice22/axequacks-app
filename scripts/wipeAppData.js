const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

function loadEnvFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    raw.split("\n").forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const idx = trimmed.indexOf("=");
      if (idx === -1) return;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] == null) {
        process.env[key] = value;
      }
    });
  } catch {
    // ignore missing env file
  }
}

const envPath = path.join(process.cwd(), ".env.local");
loadEnvFile(envPath);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

const TABLES = [
  "booking_tab_items",
  "booking_tabs",
  "booking_resources",
  "booking_changes",
  "bookings",
  "event_requests",
  "pos_sales_items",
  "pos_sales",
  "payment_logs",
  "staff_time_entries",
  "promo_redemptions",
  "gift_certificate_redemptions",
  "gift_certificates",
];

async function wipeTable(table) {
  const { error } = await supabase.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) {
    const message = String(error.message || error);
    if (message.toLowerCase().includes("could not find the table")) {
      console.log(`Skipping ${table} (missing table)`);
      return;
    }
    throw new Error(`Failed to wipe ${table}: ${message}`);
  }
  console.log(`Wiped ${table}`);
}

async function main() {
  console.log("Starting wipe...");
  for (const table of TABLES) {
    await wipeTable(table);
  }
  console.log("Wipe complete.");
}

main().catch((err) => {
  console.error("Wipe failed:", err.message || err);
  process.exit(1);
});
