import { NextResponse } from "next/server";
import { createBookingBypassResources, type ActivityUI, type ComboOrder, type BookingInput } from "@/lib/server/bookingService";
import { canonicalPartyAreaName, type PartyAreaName, MAX_PARTY_SIZES } from "@/lib/bookingLogic";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

type ParsedRow = {
  activity: ActivityUI;
  partySize: number;
  dateKey: string;
  startMin: number;
  durationMinutes: number;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  paid: boolean;
  notes?: string;
  comboOrder?: ComboOrder;
  comboAxeMinutes?: number;
  comboDuckpinMinutes?: number;
  totalCentsOverride?: number;
  partyAreas?: PartyAreaName[];
  partyAreaMinutes?: number;
};

function parseMinutesFromTime(input: string) {
  const raw = input.trim().toUpperCase();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const mins = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3] || "";
  if (!Number.isFinite(hour) || !Number.isFinite(mins)) return null;
  if (meridiem) {
    if (hour === 12) hour = 0;
    if (meridiem === "PM") hour += 12;
  }
  if (hour < 0 || hour > 23 || mins < 0 || mins > 59) return null;
  return hour * 60 + mins;
}

function parseActivity(input: string): ActivityUI | null {
  const value = input.trim().toUpperCase();
  if (!value) return null;
  if (value.includes("AXE")) return "Axe Throwing";
  if (value.includes("DUCK")) return "Duckpin Bowling";
  if (value.includes("COMBO")) return "Combo Package";
  return null;
}

function parseComboOrder(input: string): ComboOrder | undefined {
  const value = input.trim().toUpperCase();
  if (value.includes("AXE")) return "AXE_FIRST";
  if (value.includes("DUCK")) return "DUCKPIN_FIRST";
  return undefined;
}

function parsePaid(input: string) {
  const value = input.trim().toUpperCase();
  if (!value) return false;
  return value === "PAID" || value === "YES" || value === "TRUE";
}

function parseRows(raw: string) {
  const rows: ParsedRow[] = [];
  const errors: string[] = [];
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx];
    const parts = line.split("|").map((part) => part.trim());
    const [
      dateKey,
      startTime,
      activityRaw,
      durationRaw,
      partySizeRaw,
      customerName,
      customerEmail,
      customerPhone,
      paidRaw,
      notes,
      comboOrderRaw,
      comboAxeRaw,
      comboDuckRaw,
      totalCentsRaw,
    ] = parts;

    const activity = parseActivity(activityRaw || "");
    const startMin = parseMinutesFromTime(startTime || "");
    const durationMinutes = Number(durationRaw);
    const partySize = Number(partySizeRaw);
    const paid = parsePaid(paidRaw || "");

    if (!dateKey || !activity || startMin == null || !Number.isFinite(durationMinutes) || !Number.isFinite(partySize)) {
      errors.push(`Line ${idx + 1}: Missing or invalid required fields.`);
      continue;
    }
    if (partySize > 100) {
      errors.push(`Line ${idx + 1}: Group size must be 100 or less.`);
      continue;
    }
    const normalizedEmail = customerEmail ? customerEmail.trim() : "";

    const comboOrder = comboOrderRaw ? parseComboOrder(comboOrderRaw) : undefined;
    const comboAxeMinutes = comboAxeRaw ? Number(comboAxeRaw) : undefined;
    const comboDuckpinMinutes = comboDuckRaw ? Number(comboDuckRaw) : undefined;
    const totalCentsOverride = totalCentsRaw ? Number(totalCentsRaw) : undefined;

    rows.push({
      activity,
      partySize,
      dateKey,
      startMin,
      durationMinutes,
      customerName: customerName || "Customer",
      customerEmail: normalizedEmail,
      customerPhone,
      paid,
      notes,
      comboOrder,
      comboAxeMinutes: Number.isFinite(comboAxeMinutes) ? comboAxeMinutes : undefined,
      comboDuckpinMinutes: Number.isFinite(comboDuckpinMinutes) ? comboDuckpinMinutes : undefined,
      totalCentsOverride: Number.isFinite(totalCentsOverride) ? totalCentsOverride : undefined,
    });
  }

  return { rows, errors };
}

type IncomingRow = {
  activity: ActivityUI;
  durationMinutes: number;
  comboAxeMinutes?: number;
  comboDuckpinMinutes?: number;
  partyArea?: string | null;
  partyAreaMinutes?: number | null;
  partySize: number;
  dateKey: string;
  startTime: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  paid?: boolean;
  totalCentsOverride?: number;
};

export async function POST(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    let rows: ParsedRow[] = [];
    if (Array.isArray(body?.rows)) {
      const inputRows = body.rows as IncomingRow[];
      const errors: string[] = [];
      rows = inputRows
        .map((row, idx) => {
          const startMin = parseMinutesFromTime(String(row.startTime || ""));
          if (!row.dateKey || !row.activity || !Number.isFinite(Number(row.durationMinutes)) || !Number.isFinite(Number(row.partySize)) || startMin == null) {
            errors.push(`Row ${idx + 1}: Missing required fields.`);
            return null;
          }
          if (Number(row.partySize) > 100) {
            errors.push(`Row ${idx + 1}: Group size must be 100 or less.`);
            return null;
          }
          const customerEmail = row.customerEmail ? String(row.customerEmail).trim() : "";
          const canonicalPartyArea = row.partyArea ? canonicalPartyAreaName(String(row.partyArea)) : null;
          const partyAreas: PartyAreaName[] = canonicalPartyArea ? [canonicalPartyArea] : [];
          return {
            activity: row.activity,
            partySize: Number(row.partySize),
            dateKey: row.dateKey,
            startMin,
            durationMinutes: Number(row.durationMinutes),
            customerName: row.customerName || "Customer",
            customerEmail,
            customerPhone: row.customerPhone,
            paid: !!row.paid,
            notes: "",
            partyAreas,
            partyAreaMinutes: Number.isFinite(Number(row.partyAreaMinutes)) ? Number(row.partyAreaMinutes) : undefined,
            comboAxeMinutes: Number.isFinite(Number(row.comboAxeMinutes)) ? Number(row.comboAxeMinutes) : undefined,
            comboDuckpinMinutes: Number.isFinite(Number(row.comboDuckpinMinutes)) ? Number(row.comboDuckpinMinutes) : undefined,
            totalCentsOverride: Number.isFinite(Number(row.totalCentsOverride)) ? Number(row.totalCentsOverride) : undefined,
          } as ParsedRow;
        })
        .filter(Boolean) as ParsedRow[];
      if (errors.length) {
        return NextResponse.json({ error: "Invalid booking rows", detail: errors }, { status: 400 });
      }
    } else {
      const raw = String(body?.lines || "");
      if (!raw.trim()) {
        return NextResponse.json({ error: "Missing booking lines" }, { status: 400 });
      }

      const parsed = parseRows(raw);
      if (parsed.errors.length) {
        return NextResponse.json({ error: "Invalid booking lines", detail: parsed.errors }, { status: 400 });
      }
      rows = parsed.rows;
    }

    const sb = supabaseServer();
    const results: Array<{ bookingId: string; line: number }> = [];

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const activityMax = MAX_PARTY_SIZES[row.activity] ?? 24;
      const partySizeForResources = Math.min(row.partySize, activityMax);
      const bookingInput: BookingInput = {
        activity: row.activity,
        partySize: partySizeForResources,
        dateKey: row.dateKey,
        startMin: row.startMin,
        durationMinutes: row.durationMinutes,
        comboAxeMinutes: row.comboAxeMinutes,
        comboDuckpinMinutes: row.comboDuckpinMinutes,
        customerName: row.customerName,
        customerEmail: row.customerEmail,
        customerPhone: row.customerPhone,
        comboOrder: row.comboOrder,
        totalCentsOverride: row.totalCentsOverride,
        partyAreas: row.partyAreas as PartyAreaName[] | undefined,
        partyAreaMinutes: row.partyAreaMinutes,
      };

      const result = await createBookingBypassResources(bookingInput);
      const importNote = row.notes ? `IMPORTED_FROM_SQUARE | ${row.notes}` : "IMPORTED_FROM_SQUARE";
      const { error: updateErr } = await sb
        .from("bookings")
        .update({
          party_size: row.partySize,
          paid: row.paid,
          notes: importNote,
        })
        .eq("id", result.bookingId);
      if (updateErr) {
        console.error("bulk booking update error:", updateErr);
        throw new Error(updateErr.message || "Failed to finalize bulk booking");
      }
      results.push({ bookingId: result.bookingId, line: i + 1 });
    }

    return NextResponse.json({ ok: true, created: results.length, results }, { status: 200 });
  } catch (err: any) {
    console.error("bulk booking create error:", err);
    return NextResponse.json({ error: err?.message || "Failed to create bookings" }, { status: 500 });
  }
}
