import nodemailer from "nodemailer";
import { createEvents, EventAttributes } from "ics";
import type { Lead } from "./supabase";
import {
  TRYOUT_DAYS,
  TRYOUT_LOCATION,
  daysForSelection,
  selectionLabel,
} from "./tryout-config";

const FROM_NAME = "Peace Soccer School";
// SMTP_FROM lets us authenticate as info@ but send "From:" as the tryouts@ alias.
// Falls back to SMTP_USER if SMTP_FROM isn't set.
const FROM_EMAIL =
  process.env.SMTP_FROM || process.env.SMTP_USER || "tryouts@peacesoccerschool.com";

function getTransport() {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = parseInt(process.env.SMTP_PORT || "465", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    throw new Error(
      "Missing SMTP credentials. Set SMTP_USER and SMTP_PASS in .env.local."
    );
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for 587
    auth: { user, pass },
  });
}

/**
 * Build a .ics calendar invite covering BOTH tryout days.
 * Generates two events in a single .ics file so the parent's calendar app
 * imports them as two distinct entries.
 */
function buildTryoutICS(lead: Lead): Promise<string | null> {
  return new Promise((resolve) => {
    const days = daysForSelection(lead.tryout_day);
    const events: EventAttributes[] = days.map((day, idx) => {
      const [year, month, dom] = day.date.split("-").map((n) => parseInt(n, 10));
      const durationHours = day.endHour - day.startHour;
      const durationMinutes = day.endMinute - day.startMinute;

      return {
        title: `PSS Tryout ${day.label} — ${lead.player_name}`,
        description: `Peace Soccer School Fall 2026 Tryout (${day.label} of 2) for ${lead.player_name} (age ${lead.player_age}). ${day.displayTime}. See you on the pitch! — Coach Mina`,
        location: TRYOUT_LOCATION,
        start: [year, month, dom, day.startHour, day.startMinute],
        // "local" → ics library emits the time as floating local time, so
        // viewers see "10am" regardless of Vercel's UTC server timezone.
        startInputType: "local",
        startOutputType: "local",
        duration: {
          hours: durationHours,
          minutes: durationMinutes,
        },
        status: "CONFIRMED",
        busyStatus: "BUSY",
        organizer: { name: "Coach Mina", email: FROM_EMAIL },
        attendees: [
          {
            name: lead.parent_name,
            email: lead.parent_email,
            rsvp: true,
            partstat: "NEEDS-ACTION",
            role: "REQ-PARTICIPANT",
          },
        ],
        uid: `pss-tryout-${lead.id}-day${idx + 1}@peacesoccerschool.com`,
      };
    });

    createEvents(events, (error, value) => {
      if (error) {
        console.error("[email] ics build error:", error);
        resolve(null);
      } else {
        resolve(value);
      }
    });
  });
}

function welcomeEmailHTML(lead: Lead): string {
  const selectedDays = daysForSelection(lead.tryout_day);
  const multiDay = selectedDays.length > 1;
  const intro = multiDay
    ? "Tryouts run over <strong>two days</strong>:"
    : `You're signed up for <strong>${selectedDays[0].label}</strong>:`;

  const daysHTML = selectedDays.map(
    (day) => `
      <div style="background:#0a0a0a;border:1px solid #1f1f1f;border-radius:10px;padding:18px 20px;margin:0 0 12px;">
        <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#DC2626;font-weight:700;margin-bottom:8px;">${escapeHTML(day.label)}</div>
        <div style="font-size:18px;font-weight:600;color:#fff;margin-bottom:6px;">${escapeHTML(day.displayDate)}</div>
        <div style="font-size:14px;color:#a3a3a3;">⏰ ${escapeHTML(day.displayTime)}</div>
      </div>`
  ).join("");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#111;border:1px solid #1f1f1f;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:linear-gradient(135deg,#DC2626 0%,#7f1d1d 100%);padding:32px 28px;">
                <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#fecaca;font-weight:600;">Peace Soccer School</div>
                <div style="font-size:24px;font-weight:700;color:#fff;margin-top:6px;">Welcome to PSS, ${escapeHTML(lead.parent_name)} ⚽</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#e5e5e5;">
                  Hi ${escapeHTML(lead.parent_name)},
                </p>
                <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#e5e5e5;">
                  Thank you for signing <strong>${escapeHTML(lead.player_name)}</strong> up for our Fall 2026 tryout — we can't wait to see them on the field. ${intro}
                </p>
                ${daysHTML}
                <div style="font-size:14px;color:#a3a3a3;margin:14px 0 20px;">📍 ${escapeHTML(TRYOUT_LOCATION)}${multiDay ? " (both days)" : ""}</div>
                <p style="margin:0 0 8px;font-size:16px;font-weight:600;color:#fff;">What to bring</p>
                <ul style="margin:0 0 20px;padding-left:20px;font-size:15px;line-height:1.7;color:#d4d4d4;">
                  <li>Cleats and shin guards</li>
                  <li>Water bottle (lots of it)</li>
                  <li>Soccer ball if you have one</li>
                  <li>A great attitude — that's the most important part</li>
                </ul>
                ${
                  lead.whatsapp_opt_in
                    ? `<div style="background:#052e16;border:1px solid #14532d;border-radius:10px;padding:14px 18px;margin:20px 0;font-size:14px;color:#bbf7d0;">
                        📱 You opted in for WhatsApp reminders. You'll receive a quick message from us in the next day or two to confirm — just reply to lock it in.
                      </div>`
                    : ""
                }
                <p style="margin:20px 0 16px;font-size:15px;line-height:1.6;color:#d4d4d4;">
                  I've attached ${multiDay ? "calendar invites for both days" : "a calendar invite"} — add ${multiDay ? "them" : "it"} now so you don't miss anything. If anything comes up, just reply to this email.
                </p>
                <p style="margin:0;font-size:15px;line-height:1.6;color:#d4d4d4;">
                  See you on the pitch,<br/>
                  <strong style="color:#fff;">Coach Mina</strong><br/>
                  <span style="color:#737373;">Peace Soccer School</span>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;border-top:1px solid #1f1f1f;font-size:12px;color:#737373;">
                Peace Soccer School • <a href="https://peacesoccerschool.com" style="color:#DC2626;text-decoration:none;">peacesoccerschool.com</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHTML(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Notify the admin (Coach Mina) that a new lead just signed up.
 * Fires alongside the welcome email — non-blocking, soft-fail.
 *
 * Recipient is ADMIN_NOTIFY_EMAIL if set, otherwise falls back to SMTP_USER.
 * Comma-separate multiple recipients if you want to notify a team.
 */
export async function sendAdminNotification(
  lead: Lead
): Promise<{ ok: boolean; error?: string }> {
  try {
    const to = process.env.ADMIN_NOTIFY_EMAIL || process.env.SMTP_USER;
    if (!to) {
      return { ok: false, error: "No ADMIN_NOTIFY_EMAIL or SMTP_USER set" };
    }

    const transport = getTransport();

    const selLabel = selectionLabel(lead.tryout_day);
    const dashUrl = `https://pss-tryouts-system.vercel.app/admin/leads/${lead.id}`;

    const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:24px 16px;">
<tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111;border:1px solid #1f1f1f;border-radius:12px;overflow:hidden;">
    <tr><td style="background:#DC2626;padding:18px 24px;">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#fecaca;font-weight:600;">PSS · New tryout signup</div>
      <div style="font-size:20px;font-weight:700;color:#fff;margin-top:4px;">${escapeHTML(lead.player_name)} <span style="font-weight:400;opacity:0.8;">— ${escapeHTML(lead.age_group || `age ${lead.player_age}`)}</span></div>
    </td></tr>
    <tr><td style="padding:20px 24px;">
      <table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;color:#d4d4d4;">
        <tr><td style="padding:6px 0;color:#a3a3a3;width:120px;">Parent</td><td style="padding:6px 0;color:#fff;">${escapeHTML(lead.parent_name)}</td></tr>
        <tr><td style="padding:6px 0;color:#a3a3a3;">Phone</td><td style="padding:6px 0;"><a href="https://wa.me/${lead.parent_phone.replace(/\D/g, "")}" style="color:#34d399;text-decoration:none;">${escapeHTML(lead.parent_phone)}</a></td></tr>
        <tr><td style="padding:6px 0;color:#a3a3a3;">Email</td><td style="padding:6px 0;"><a href="mailto:${escapeHTML(lead.parent_email)}" style="color:#60a5fa;text-decoration:none;">${escapeHTML(lead.parent_email)}</a></td></tr>
        <tr><td style="padding:6px 0;color:#a3a3a3;">Days</td><td style="padding:6px 0;color:#fff;">${escapeHTML(selLabel)}</td></tr>
        <tr><td style="padding:6px 0;color:#a3a3a3;">WhatsApp</td><td style="padding:6px 0;color:#fff;">${lead.whatsapp_opt_in ? "✓ opted in" : "not opted in"}</td></tr>
      </table>
      <div style="margin-top:20px;">
        <a href="${dashUrl}" style="display:inline-block;background:#DC2626;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">View in dashboard →</a>
      </div>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;

    const info = await transport.sendMail({
      from: `"PSS Tryouts" <${FROM_EMAIL}>`,
      to,
      subject: `New PSS signup: ${lead.player_name} (${lead.age_group || `age ${lead.player_age}`}) — ${selectionLabel(lead.tryout_day)}`,
      html,
    });

    console.log("[email] admin notification sent to", to, info.messageId);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[email] sendAdminNotification failed:", message);
    return { ok: false, error: message };
  }
}

export async function sendWelcomeEmail(lead: Lead): Promise<{ ok: boolean; error?: string }> {
  try {
    const transport = getTransport();
    const ics = await buildTryoutICS(lead);

    const attachments = ics
      ? [
          {
            filename: "pss-tryout.ics",
            content: ics,
            contentType: "text/calendar; charset=utf-8; method=REQUEST",
          },
        ]
      : [];

    const info = await transport.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: lead.parent_email,
      subject: "Welcome to PSS — Your Fall 2026 Tryout is Confirmed ⚽",
      html: welcomeEmailHTML(lead),
      attachments,
    });

    console.log("[email] sent welcome to", lead.parent_email, info.messageId);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[email] sendWelcomeEmail failed:", message);
    return { ok: false, error: message };
  }
}
