import nodemailer from "nodemailer";
import { createEvent, EventAttributes } from "ics";
import type { Lead } from "./supabase";

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
 * Build a .ics calendar invite for the tryout.
 * Returns a Promise resolving to the raw .ics text or null on failure.
 */
function buildTryoutICS(lead: Lead): Promise<string | null> {
  return new Promise((resolve) => {
    const date = lead.tryout_date || process.env.TRYOUT_DATE || "2026-08-15";
    const time = process.env.TRYOUT_TIME || "09:00";
    const location =
      process.env.TRYOUT_LOCATION || "Bliss Fields, Rehoboth MA";

    const [year, month, day] = date.split("-").map((n) => parseInt(n, 10));
    const [hour, minute] = time.split(":").map((n) => parseInt(n, 10));

    if (!year || !month || !day) {
      resolve(null);
      return;
    }

    const event: EventAttributes = {
      title: `PSS Tryout — ${lead.player_name}`,
      description: `Peace Soccer School Fall 2026 Tryout for ${lead.player_name} (age ${lead.player_age}). See you on the pitch! — Coach Mina`,
      location,
      start: [year, month, day, hour || 9, minute || 0],
      duration: { hours: 2 },
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
    };

    createEvent(event, (error, value) => {
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
  const date = lead.tryout_date || process.env.TRYOUT_DATE || "2026-08-15";
  const time = process.env.TRYOUT_TIME || "09:00";
  const location =
    process.env.TRYOUT_LOCATION || "Bliss Fields, Rehoboth MA";

  const niceDate = new Date(`${date}T${time}:00`).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

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
                  Thank you for signing <strong>${escapeHTML(lead.player_name)}</strong> up for our Fall 2026 tryout — we can't wait to see them on the field. This is going to be a really special season for PSS, and your family is part of it.
                </p>
                <div style="background:#0a0a0a;border:1px solid #1f1f1f;border-radius:10px;padding:18px 20px;margin:20px 0;">
                  <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#DC2626;font-weight:700;margin-bottom:10px;">Your tryout</div>
                  <div style="font-size:18px;font-weight:600;color:#fff;margin-bottom:6px;">${escapeHTML(niceDate)}</div>
                  <div style="font-size:14px;color:#a3a3a3;margin-bottom:4px;">⏰ ${escapeHTML(time)}</div>
                  <div style="font-size:14px;color:#a3a3a3;">📍 ${escapeHTML(location)}</div>
                </div>
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
                  I've attached a calendar invite — add it now so you don't miss it. If anything comes up, just reply to this email.
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
