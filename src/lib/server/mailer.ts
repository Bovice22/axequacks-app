import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import type { ActivityUI, ComboOrder } from "@/lib/server/bookingService";
import { ensureWaiverForBooking } from "@/lib/server/waiverService";

type EmailBookingInput = {
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
  resourceNames?: string[];
  waiverUrl?: string;
  totalCents?: number;
  paid?: boolean;
};

type PaymentLinkEmailInput = {
  activity: ActivityUI;
  partySize: number;
  dateKey: string;
  startMin: number;
  durationMinutes: number;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  totalCents?: number;
};

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function formatTimeFromMinutes(minsFromMidnight: number) {
  const h24 = Math.floor(minsFromMidnight / 60);
  const m = minsFromMidnight % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function prettyDate(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function buildWaiverUrl(token: string, bookingId?: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const url = new URL("/waiver", base);
  url.searchParams.set("token", token);
  if (bookingId) {
    url.searchParams.set("booking_id", bookingId);
  }
  return url.toString();
}

const LOGO_CID = "axequacks-logo";

function getLogoAttachment() {
  try {
    const logoEmailPath = path.join(process.cwd(), "public", "logo-email.png");
    const logoPath = fs.existsSync(logoEmailPath)
      ? logoEmailPath
      : path.join(process.cwd(), "public", "logo.png");
    if (!fs.existsSync(logoPath)) return null;
    const content = fs.readFileSync(logoPath).toString("base64");
    return {
      filename: path.basename(logoPath),
      content,
      content_type: "image/png",
      content_id: LOGO_CID,
      contentType: "image/png",
      contentId: LOGO_CID,
    };
  } catch (err) {
    console.error("logo load error:", err);
    return null;
  }
}

function getLogoUrl() {
  const explicit = process.env.RESEND_LOGO_URL || "";
  if (explicit) return explicit;

  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.NODE_ENV === "production" ? "https://axequacks.com" : "http://localhost:3000");
  const logoEmailPath = path.join(process.cwd(), "public", "logo-email.png");
  const logoPath = fs.existsSync(logoEmailPath)
    ? "/logo-email.png"
    : fs.existsSync(path.join(process.cwd(), "public", "logo.png"))
    ? "/logo.png"
    : "";
  return logoPath ? `${base}${logoPath}` : "";
}


async function fetchBookingResources(bookingId: string) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("resource_reservations")
    .select("resource_id, resources!inner(name,type)")
    .eq("booking_id", bookingId);

  if (error) {
    console.error("email resource lookup error:", error);
    return [];
  }

  return (data ?? [])
    .map((row: any) => row?.resources?.name as string | undefined)
    .filter((name: string | undefined) => !!name);
}

export async function sendBookingConfirmationEmail(input: EmailBookingInput): Promise<{
  sent: boolean;
  id?: string;
  skippedReason?: string;
}> {
  const apiKey = process.env.RESEND_API_KEY || "";
  const fromEmail = process.env.RESEND_FROM_EMAIL || "";
  const fromName = process.env.RESEND_FROM_NAME || "Axe Quacks";
  if (!apiKey || !fromEmail) {
    console.warn("Resend config missing; skipping confirmation email.");
    return { sent: false, skippedReason: "missing_config" };
  }

  if (!input.customerEmail || !input.customerEmail.includes("@")) {
    return { sent: false, skippedReason: "invalid_recipient" };
  }

  const resources =
    input.resourceNames && input.resourceNames.length
      ? input.resourceNames
      : await fetchBookingResources(input.bookingId);

  let waiverUrl = input.waiverUrl || "";
  if (!waiverUrl) {
    try {
      const waiverResult = await ensureWaiverForBooking({
        bookingId: input.bookingId,
        customerId: "",
        bookingInput: {
          activity: input.activity,
          partySize: input.partySize,
          dateKey: input.dateKey,
          startMin: input.startMin,
          durationMinutes: input.durationMinutes,
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone,
          comboOrder: input.comboOrder,
        },
      });
      waiverUrl = waiverResult.waiverUrl || "";
    } catch (waiverErr) {
      console.error("waiver request error:", waiverErr);
    }
  }
  if (!waiverUrl && input.bookingId) {
    try {
      const sb = supabaseAdmin();
      const { data, error } = await sb
        .from("waiver_requests")
        .select("token,status")
        .eq("booking_id", input.bookingId)
        .maybeSingle();
      if (!error && data?.token && data?.status !== "SIGNED") {
        waiverUrl = buildWaiverUrl(data.token as string, input.bookingId);
      }
    } catch (waiverErr) {
      console.error("waiver lookup error:", waiverErr);
    }
  }

  const startLabel = formatTimeFromMinutes(input.startMin);
  const endLabel = formatTimeFromMinutes(input.startMin + input.durationMinutes);

  const comboOrder =
    input.activity === "Combo Package"
      ? input.comboOrder === "DUCKPIN_FIRST"
        ? "First: Duckpin Bowling, Second: Axe Throwing"
        : input.comboOrder === "AXE_FIRST"
        ? "First: Axe Throwing, Second: Duckpin Bowling"
        : null
      : null;

  const subject = "Your Axe Quacks Booking Confirmation";
  const priceLine =
    typeof input.totalCents === "number"
      ? `Amount: $${(input.totalCents / 100).toFixed(2)} ${input.paid ? "PAID" : ""}`.trim()
      : null;

  const lines = [
    `Name: ${input.customerName || "—"}`,
    comboOrder ? `Combo Order: ${comboOrder}` : null,
    `Activity: ${input.activity}`,
    `Date: ${prettyDate(input.dateKey)}`,
    `Start/End Time: ${startLabel} – ${endLabel}`,
    `Resource: ${resources.length ? resources.join(", ") : "TBD"}`,
    `Group Size: ${input.partySize}`,
    priceLine,
    waiverUrl ? `Waiver Link: ${waiverUrl}` : null,
  ].filter(Boolean) as string[];

  const detailRows = lines.map((line) => {
    const idx = line.indexOf(":");
    if (idx === -1) return { label: "", value: line };
    return {
      label: line.slice(0, idx).trim(),
      value: line.slice(idx + 1).trim(),
    };
  });

  const text = `Axe Quacks booking confirmation\n\n${lines.join("\n")}`;
  const logoAttachment = getLogoAttachment();
  const logoUrl = getLogoUrl();
  const logoSrc = logoAttachment ? `cid:${LOGO_CID}` : logoUrl;
  const html = `
    <div style="font-family: Arial, sans-serif; color: #111; background: #f6f6f6; padding: 14px;">
      <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 14px; border: 1px solid #e6e6e6;">
        ${
          logoSrc
            ? `<div style="text-align: center; padding-bottom: 6px;">
            <img src="${logoSrc}" alt="Axe Quacks" style="max-width: 96px; height: auto; display: block; margin: 0 auto;" />
          </div>`
            : ""
        }
        <div style="text-align: center; font-size: 15px; font-weight: 700; margin-bottom: 6px;">
          Booking Confirmation
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size: 13px; border-collapse: collapse;">
          ${detailRows
            .map(
              (row) => `
            <tr>
              <td style="padding: 3px 0; color: #666; width: 34%;">${row.label || "&nbsp;"}</td>
              <td style="padding: 3px 0; color: #111; font-weight: 600;">${row.value}</td>
            </tr>
          `
            )
            .join("")}
        </table>
        ${
          waiverUrl
            ? `<div style="margin-top: 10px; text-align: center;">
            <a href="${waiverUrl}" style="display: inline-block; padding: 8px 16px; background: #111; color: #fff; border-radius: 999px; text-decoration: none; font-weight: 700; font-size: 12px;">
              Sign Waiver
            </a>
            <div style="margin-top: 6px; font-size: 11px; color: #666;">
              Waiver required for axe throwing. If the button doesn’t work, use: ${waiverUrl}
            </div>
          </div>`
            : ""
        }
        <div style="margin-top: 10px; font-size: 11px; color: #666; text-align: center;">
          Reply to this email with any questions.
        </div>
      </div>
    </div>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [input.customerEmail],
      subject,
      text,
      html,
      attachments: logoAttachment ? [logoAttachment] : undefined,
    }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = typeof payload?.message === "string" ? payload.message : JSON.stringify(payload || {});
    throw new Error(`Resend email failed: ${res.status} ${error}`.trim());
  }

  return { sent: true, id: payload?.id };
}

export async function sendOwnerNotification(input: {
  subject: string;
  lines: string[];
}): Promise<{ sent: boolean; id?: string; skippedReason?: string }> {
  const apiKey = process.env.RESEND_API_KEY || "";
  const fromEmail = process.env.RESEND_FROM_EMAIL || "";
  const fromName = process.env.RESEND_FROM_NAME || "Axe Quacks";
  const ownerEmail = process.env.OWNER_NOTIFY_EMAIL || "unsurpassedgraphics@gmail.com";

  if (!apiKey || !fromEmail) {
    console.warn("Resend config missing; skipping owner notification.");
    return { sent: false, skippedReason: "missing_config" };
  }

  if (!ownerEmail || !ownerEmail.includes("@")) {
    return { sent: false, skippedReason: "invalid_recipient" };
  }

  const detailRows = (input.lines || []).map((line) => {
    const idx = line.indexOf(":");
    if (idx === -1) return { label: "", value: line };
    return {
      label: line.slice(0, idx).trim(),
      value: line.slice(idx + 1).trim(),
    };
  });

  const text = `${input.subject}\n\n${(input.lines || []).join("\n")}`;
  const html = `
    <div style="font-family: Arial, sans-serif; color: #111; background: #f6f6f6; padding: 14px;">
      <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 14px; border: 1px solid #e6e6e6;">
        <div style="text-align: center; font-size: 15px; font-weight: 700; margin-bottom: 6px;">
          ${input.subject}
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size: 13px; border-collapse: collapse;">
          ${detailRows
            .map(
              (row) => `
            <tr>
              <td style="padding: 3px 0; color: #666; width: 34%;">${row.label || "&nbsp;"}</td>
              <td style="padding: 3px 0; color: #111; font-weight: 600;">${row.value}</td>
            </tr>
          `
            )
            .join("")}
        </table>
      </div>
    </div>
  `;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [ownerEmail],
        subject: input.subject,
        text,
        html,
      }),
    });

    if (!res.ok) {
      const error = await res.text().catch(() => "");
      throw new Error(`Resend email failed: ${res.status} ${error}`.trim());
    }

    const data = await res.json().catch(() => ({}));
    return { sent: true, id: data?.id };
  } catch (err: any) {
    console.error("owner email error:", err);
    return { sent: false, skippedReason: err?.message || "send_failed" };
  }
}

type EventRequestEmailInput = {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  dateKey: string;
  startMin: number;
  durationMinutes: number;
  partySize: number;
  activities: Array<{ activity: string; durationMinutes: number }>;
  totalCents?: number;
};

export async function sendEventRequestAcceptedEmail(input: EventRequestEmailInput): Promise<{
  sent: boolean;
  id?: string;
  skippedReason?: string;
}> {
  const apiKey = process.env.RESEND_API_KEY || "";
  const fromEmail = process.env.RESEND_FROM_EMAIL || "";
  const fromName = process.env.RESEND_FROM_NAME || "Axe Quacks";
  if (!apiKey || !fromEmail) {
    console.warn("Resend config missing; skipping event request email.");
    return { sent: false, skippedReason: "missing_config" };
  }

  if (!input.customerEmail || !input.customerEmail.includes("@")) {
    return { sent: false, skippedReason: "invalid_recipient" };
  }

  const startLabel = formatTimeFromMinutes(input.startMin);
  const endLabel = formatTimeFromMinutes(input.startMin + input.durationMinutes);
  const totalLine =
    typeof input.totalCents === "number"
      ? `Estimated Total: $${(input.totalCents / 100).toFixed(2)}`
      : null;

  const activitiesLine = input.activities.length
    ? input.activities.map((a) => `${a.activity} (${a.durationMinutes} mins)`).join(", ")
    : "—";

  const lines = [
    `Name: ${input.customerName || "—"}`,
    `Date: ${prettyDate(input.dateKey)}`,
    `Time: ${startLabel} – ${endLabel}`,
    `Group Size: ${input.partySize}`,
    `Activities: ${activitiesLine}`,
    totalLine,
  ].filter(Boolean) as string[];

  const text = `Your Axe Quacks event request has been accepted.\n\n${lines.join("\n")}`;
  const subject = "Your Axe Quacks Event Request Was Accepted";
  const logoAttachment = getLogoAttachment();
  const logoUrl = getLogoUrl();
  const logoSrc = logoAttachment ? `cid:${LOGO_CID}` : logoUrl;

  const detailRows = lines.map((line) => {
    const idx = line.indexOf(":");
    if (idx === -1) return { label: "", value: line };
    return { label: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
  });

  const html = `
    <div style="font-family: Arial, sans-serif; color: #111; background: #f6f6f6; padding: 14px;">
      <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 14px; border: 1px solid #e6e6e6;">
        ${
          logoSrc
            ? `<div style="text-align:center; margin-bottom: 12px;"><img src="${logoSrc}" alt="Axe Quacks" style="max-width: 160px; height: auto;" /></div>`
            : ""
        }
        <h2 style="font-size: 18px; margin: 0 0 12px;">Your event request is accepted</h2>
        <p style="margin: 0 0 10px;">Our team has accepted your event request. We will follow up with payment details.</p>
        <table style="width: 100%; border-collapse: collapse;">
          ${detailRows
            .map(
              (row) => `
              <tr>
                <td style="padding: 6px 0; color: #666; font-size: 13px; width: 40%;">${row.label}</td>
                <td style="padding: 6px 0; font-size: 13px; font-weight: 600;">${row.value}</td>
              </tr>`
            )
            .join("")}
        </table>
      </div>
    </div>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [input.customerEmail],
      subject,
      text,
      html,
      attachments: logoAttachment ? [logoAttachment] : undefined,
    }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = typeof payload?.message === "string" ? payload.message : JSON.stringify(payload || {});
    throw new Error(`Resend email failed: ${res.status} ${error}`.trim());
  }

  return { sent: true, id: payload?.id };
}

export async function sendEventPaymentLinkEmail(
  input: EventRequestEmailInput & { paymentUrl: string }
): Promise<{
  sent: boolean;
  id?: string;
  skippedReason?: string;
}> {
  const apiKey = process.env.RESEND_API_KEY || "";
  const fromEmail = process.env.RESEND_FROM_EMAIL || "";
  const fromName = process.env.RESEND_FROM_NAME || "Axe Quacks";
  if (!apiKey || !fromEmail) {
    console.warn("Resend config missing; skipping payment link email.");
    return { sent: false, skippedReason: "missing_config" };
  }

  if (!input.customerEmail || !input.customerEmail.includes("@")) {
    return { sent: false, skippedReason: "invalid_recipient" };
  }

  const startLabel = formatTimeFromMinutes(input.startMin);
  const endLabel = formatTimeFromMinutes(input.startMin + input.durationMinutes);
  const totalLine =
    typeof input.totalCents === "number"
      ? `Estimated Total: $${(input.totalCents / 100).toFixed(2)}`
      : null;

  const activitiesLine = input.activities.length
    ? input.activities.map((a) => `${a.activity} (${a.durationMinutes} mins)`).join(", ")
    : "—";

  const lines = [
    `Name: ${input.customerName || "—"}`,
    `Date: ${prettyDate(input.dateKey)}`,
    `Time: ${startLabel} – ${endLabel}`,
    `Group Size: ${input.partySize}`,
    `Activities: ${activitiesLine}`,
    totalLine,
  ].filter(Boolean) as string[];

  const text = `Complete payment for your Axe Quacks event:\n${input.paymentUrl}\n\n${lines.join("\n")}`;
  const subject = "Your Axe Quacks Event Payment Link";
  const logoAttachment = getLogoAttachment();
  const logoUrl = getLogoUrl();
  const logoSrc = logoAttachment ? `cid:${LOGO_CID}` : logoUrl;

  const detailRows = lines.map((line) => {
    const idx = line.indexOf(":");
    if (idx === -1) return { label: "", value: line };
    return { label: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
  });

  const html = `
    <div style="font-family: Arial, sans-serif; color: #111; background: #f6f6f6; padding: 14px;">
      <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 14px; border: 1px solid #e6e6e6;">
        ${
          logoSrc
            ? `<div style="text-align:center; margin-bottom: 12px;"><img src="${logoSrc}" alt="Axe Quacks" style="max-width: 160px; height: auto;" /></div>`
            : ""
        }
        <h2 style="font-size: 18px; margin: 0 0 12px;">Complete your payment</h2>
        <p style="margin: 0 0 12px;">Use the secure payment link below to finalize your event booking.</p>
        <div style="margin: 12px 0; text-align: center;">
          <a href="${input.paymentUrl}" style="display: inline-block; padding: 10px 16px; background: #111; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600;">Pay for Event</a>
        </div>
        <table style="width: 100%; border-collapse: collapse;">
          ${detailRows
            .map(
              (row) => `
              <tr>
                <td style="padding: 6px 0; color: #666; font-size: 13px; width: 40%;">${row.label}</td>
                <td style="padding: 6px 0; font-size: 13px; font-weight: 600;">${row.value}</td>
              </tr>`
            )
            .join("")}
        </table>
      </div>
    </div>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [input.customerEmail],
      subject,
      text,
      html,
      attachments: logoAttachment ? [logoAttachment] : undefined,
    }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = typeof payload?.message === "string" ? payload.message : JSON.stringify(payload || {});
    throw new Error(`Resend email failed: ${res.status} ${error}`.trim());
  }

  return { sent: true, id: payload?.id };
}

export async function sendBookingPaymentLinkEmail(
  input: PaymentLinkEmailInput & { paymentUrl: string }
): Promise<{ sent: boolean; id?: string; skippedReason?: string }> {
  const apiKey = process.env.RESEND_API_KEY || "";
  const fromEmail = process.env.RESEND_FROM_EMAIL || "";
  const fromName = process.env.RESEND_FROM_NAME || "Axe Quacks";
  if (!apiKey || !fromEmail) {
    console.warn("Resend config missing; skipping payment link email.");
    return { sent: false, skippedReason: "missing_config" };
  }

  if (!input.customerEmail || !input.customerEmail.includes("@")) {
    return { sent: false, skippedReason: "invalid_recipient" };
  }

  const startLabel = formatTimeFromMinutes(input.startMin);
  const endLabel = formatTimeFromMinutes(input.startMin + input.durationMinutes);
  const totalLine =
    typeof input.totalCents === "number"
      ? `Estimated Total: $${(input.totalCents / 100).toFixed(2)}`
      : null;

  const lines = [
    `Name: ${input.customerName || "—"}`,
    `Activity: ${input.activity}`,
    `Date: ${prettyDate(input.dateKey)}`,
    `Time: ${startLabel} – ${endLabel}`,
    `Group Size: ${input.partySize}`,
    totalLine,
  ].filter(Boolean) as string[];

  const text = `Complete payment for your Axe Quacks booking:\n${input.paymentUrl}\n\n${lines.join("\n")}`;
  const subject = "Your Axe Quacks Booking Payment Link";
  const logoAttachment = getLogoAttachment();
  const logoUrl = getLogoUrl();
  const logoSrc = logoAttachment ? `cid:${LOGO_CID}` : logoUrl;

  const detailRows = lines.map((line) => {
    const idx = line.indexOf(":");
    if (idx === -1) return { label: "", value: line };
    return { label: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
  });

  const html = `
    <div style="font-family: Arial, sans-serif; color: #111; background: #f6f6f6; padding: 14px;">
      <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 14px; border: 1px solid #e6e6e6;">
        ${
          logoSrc
            ? `<div style="text-align:center; margin-bottom: 12px;"><img src="${logoSrc}" alt="Axe Quacks" style="max-width: 160px; height: auto;" /></div>`
            : ""
        }
        <h2 style="font-size: 18px; margin: 0 0 12px;">Complete your payment</h2>
        <p style="margin: 0 0 12px;">Use the secure payment link below to finalize your booking.</p>
        <div style="margin: 12px 0; text-align: center;">
          <a href="${input.paymentUrl}" style="display: inline-block; padding: 10px 16px; background: #111; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600;">Pay for Booking</a>
        </div>
        <table style="width: 100%; border-collapse: collapse;">
          ${detailRows
            .map(
              (row) => `
              <tr>
                <td style="padding: 6px 0; color: #666; font-size: 13px; width: 40%;">${row.label}</td>
                <td style="padding: 6px 0; font-size: 13px; font-weight: 600;">${row.value}</td>
              </tr>`
            )
            .join("")}
        </table>
      </div>
    </div>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [input.customerEmail],
      subject,
      text,
      html,
      attachments: logoAttachment ? [logoAttachment] : undefined,
    }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = typeof payload?.message === "string" ? payload.message : JSON.stringify(payload || {});
    throw new Error(`Resend email failed: ${res.status} ${error}`.trim());
  }

  return { sent: true, id: payload?.id };
}

export async function sendWaiverRequestEmail(input: {
  customerName: string;
  customerEmail: string;
  waiverUrl: string;
}): Promise<{ sent: boolean; id?: string; skippedReason?: string }> {
  const apiKey = process.env.RESEND_API_KEY || "";
  const fromEmail = process.env.RESEND_FROM_EMAIL || "";
  const fromName = process.env.RESEND_FROM_NAME || "Axe Quacks";
  if (!apiKey || !fromEmail) {
    console.warn("Resend config missing; skipping waiver email.");
    return { sent: false, skippedReason: "missing_config" };
  }

  if (!input.customerEmail || !input.customerEmail.includes("@")) {
    return { sent: false, skippedReason: "invalid_recipient" };
  }

  const subject = "Axe Quacks Waiver Required";
  const text = `Hi ${input.customerName || "there"},\n\nPlease sign your waiver before your axe throwing session:\n${input.waiverUrl}\n\nThanks,\nAxe Quacks`;
  const logoAttachment = getLogoAttachment();
  const logoUrl = getLogoUrl();
  const logoSrc = logoAttachment ? `cid:${LOGO_CID}` : logoUrl;
  const html = `
    <div style="font-family: Arial, sans-serif; color: #111; background: #f6f6f6; padding: 16px;">
      <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 16px; border: 1px solid #e6e6e6;">
        ${
          logoSrc
            ? `<div style="text-align: center; padding-bottom: 8px;">
          <img src="${logoSrc}" alt="Axe Quacks" style="max-width: 100px; height: auto; display: block; margin: 0 auto;" />
        </div>`
            : ""
        }
        <div style="text-align: center; font-size: 16px; font-weight: 700; margin-bottom: 8px;">
          Waiver Required
        </div>
        <div style="font-size: 13px; color: #333; text-align: center;">
          Hi ${input.customerName || "there"}, please complete your waiver before your axe throwing session.
        </div>
        <div style="margin: 16px auto 8px; text-align: center;">
          <a href="${input.waiverUrl}" style="display: inline-block; padding: 10px 18px; background: #111; color: #fff; border-radius: 999px; text-decoration: none; font-weight: 700; font-size: 13px;">
            Sign Waiver
          </a>
        </div>
        <div style="margin-top: 12px; font-size: 11px; color: #666; text-align: center;">
          If the button doesn’t work, paste this link into your browser: ${input.waiverUrl}
        </div>
      </div>
    </div>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [input.customerEmail],
      subject,
      text,
      html,
      attachments: logoAttachment ? [logoAttachment] : undefined,
    }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = typeof payload?.message === "string" ? payload.message : JSON.stringify(payload || {});
    throw new Error(`Resend email failed: ${res.status} ${error}`.trim());
  }

  return { sent: true, id: payload?.id };
}
