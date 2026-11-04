import nodemailer from "nodemailer";
import { APP_URL as REPORT_APP_URL, REPORT_SEASON_LABEL, type PlayerReport } from "./reports";
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

export function getTransport() {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = parseInt(process.env.SMTP_PORT || "465", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    throw new Error(
      "Missing SMTP credentials. Set SMTP_USER and SMTP_PASS in .env.local."
    );
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for 587
    auth: { user, pass },
  });
  // Every email to a family also shows up in Command Center > Messages.
  const send = transport.sendMail.bind(transport);
  (transport as unknown as { sendMail: typeof send }).sendMail = (async (opts: Parameters<typeof send>[0]) => {
    // Families' replies go to Command Center > Texts & Email (once REPLY_TO_ADDRESS is set).
    if (process.env.REPLY_TO_ADDRESS && !opts.replyTo) opts = { ...opts, replyTo: process.env.REPLY_TO_ADDRESS };
    const info = await send(opts);
    await logToCommandCenter(opts).catch(() => {}); // awaited so serverless doesn't cut it off
    return info;
  }) as typeof send;
  return transport;
}

const CC_LOG_URL = "https://pss-command-center.vercel.app/api/webhooks/log-message";
const INTERNAL = /(@peacesoccerschool\.com$)|(^minasfaltas@gmail\.com$)/i;

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

/** Phone + names for a family email, so Command Center files texts and emails under one family. */
async function familyFor(email: string): Promise<{ name?: string; phone?: string; child?: string }> {
  try {
    const { getSupabaseAdmin } = await import("./supabase");
    const db = getSupabaseAdmin();
    const { data: w } = await db.from("winter_2026_registrations")
      .select("guardian1_first_name, guardian1_last_name, guardian1_email, guardian1_cell_phone, guardian2_first_name, guardian2_last_name, guardian2_email, guardian2_cell_phone, player_first_name")
      .or(`guardian1_email.ilike.${email},guardian2_email.ilike.${email}`).order("created_at", { ascending: false }).limit(1);
    const r = w?.[0];
    if (r) {
      const g2 = (r.guardian2_email || "").toLowerCase() === email;
      return {
        name: g2 ? `${r.guardian2_first_name || ""} ${r.guardian2_last_name || ""}`.trim() : `${r.guardian1_first_name || ""} ${r.guardian1_last_name || ""}`.trim(),
        phone: (g2 ? r.guardian2_cell_phone : r.guardian1_cell_phone) || undefined,
        child: r.player_first_name || undefined,
      };
    }
    const { data: l } = await db.from("leads").select("parent_name, parent_phone, player_name").ilike("parent_email", email).order("created_at", { ascending: false }).limit(1);
    const x = l?.[0];
    return x ? { name: x.parent_name || undefined, phone: x.parent_phone || undefined, child: (x.player_name || "").split(" ")[0] || undefined } : {};
  } catch {
    return {};
  }
}

async function logToCommandCenter(opts: { to?: unknown; subject?: unknown; text?: unknown; html?: unknown }) {
  const key = process.env.MESSAGE_LOG_SECRET;
  if (!key) return;
  const raw = Array.isArray(opts.to) ? opts.to : [opts.to];
  const recipients = raw.map((r) => String(typeof r === "object" && r && "address" in (r as object) ? (r as { address: string }).address : r || ""))
    .flatMap((r) => r.split(","))
    .map((r) => (r.match(/<([^>]+)>/)?.[1] || r).trim().toLowerCase())
    .filter((r) => r && !INTERNAL.test(r));
  if (!recipients.length) return;
  const text = typeof opts.text === "string" && opts.text.trim() ? opts.text : typeof opts.html === "string" ? htmlToText(opts.html) : "";
  if (!text) return;
  await Promise.all(recipients.map(async (to) => fetch(CC_LOG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-log-key": key },
    body: JSON.stringify({ channel: "email", to, subject: String(opts.subject || ""), text, ...(await familyFor(to)) }),
    signal: AbortSignal.timeout(4000),
  }).catch(() => null)));
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

/**
 * Welcome email for anyone who joins the list (website form or Meta lead ad).
 * Fall 2026 tryouts are over, so this is about what's next: Winter indoor, then Spring 2027.
 * Update the WINTER_* lines when the season details change.
 */
const WINTER_LINE = "14 Saturday nights, Nov 21 – Mar 6, 7–9 PM";
const WINTER_PLACE = "Teamworks, 1314 Fall River Ave, Seekonk (indoor turf)";
const WINTER_PRICE = "$300, or $275 early bird through Nov 14. Siblings save 15%.";
const WINTER_URL = "https://www.peacesoccerschool.com/winter-indoor-soccer";

function welcomeEmailHTML(lead: Lead): string {
  // Meta lead forms don't ask for the child's name, so it's often stored as "(unknown)".
  const rawKid = (lead.player_name || "").trim();
  const kid = escapeHTML(rawKid && rawKid !== "(unknown)" ? rawKid : "your player");
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#111;border:1px solid #1f1f1f;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:linear-gradient(135deg,#1d4ed8 0%,#0b2f63 100%);padding:32px 28px;">
                <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#bfdbfe;font-weight:600;">Peace Soccer School</div>
                <div style="font-size:24px;font-weight:700;color:#fff;margin-top:6px;">Welcome to PSS, ${escapeHTML(lead.parent_name)} ⚽</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#e5e5e5;">Hi ${escapeHTML(lead.parent_name)},</p>
                <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#e5e5e5;">
                  Thanks for your interest in Peace Soccer School! We've added <strong>${kid}</strong> to our list, and good news: Winter registration is open right now.
                </p>
                <div style="background:#0a0a0a;border:1px solid #1f1f1f;border-radius:10px;padding:18px 20px;margin:0 0 12px;">
                  <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#60a5fa;font-weight:700;margin-bottom:8px;">Up next: Winter indoor training</div>
                  <div style="font-size:15px;color:#fff;margin-bottom:6px;">📅 ${WINTER_LINE}</div>
                  <div style="font-size:15px;color:#d4d4d4;margin-bottom:6px;">📍 ${WINTER_PLACE}</div>
                  <div style="font-size:15px;color:#d4d4d4;">💵 ${WINTER_PRICE}</div>
                </div>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#d4d4d4;">
                  Winter is limited to 50 kids, ages 5–13. Sign up in about 3 minutes here: <a href="https://www.peacesoccerschool.com/register/winter-2026" style="color:#60a5fa;font-weight:700;">peacesoccerschool.com/register/winter-2026</a>
                  Details are here: <a href="${WINTER_URL}" style="color:#60a5fa;">peacesoccerschool.com/winter-indoor-soccer</a>
                </p>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#d4d4d4;">
                  Our competitive Spring 2027 season comes after that, and we'll share tryout details soon.
                </p>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#d4d4d4;">
                  Questions? Just reply to this email, or call or text (774) 250-2370.
                </p>
                <p style="margin:0;font-size:15px;line-height:1.6;color:#d4d4d4;">
                  See you on the field,<br/>
                  <strong style="color:#fff;">Peace Soccer School</strong>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;border-top:1px solid #1f1f1f;font-size:12px;color:#737373;">
                Peace Soccer School • <a href="https://peacesoccerschool.com" style="color:#60a5fa;text-decoration:none;">peacesoccerschool.com</a>
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
    // New-lead alerts go to the club inbox (Mina, Oct 28 2026). Set LEAD_ALERT_EMAIL in Vercel to change it.
    const to = process.env.LEAD_ALERT_EMAIL || "info@peacesoccerschool.com";
    if (!to) {
      return { ok: false, error: "No ADMIN_NOTIFY_EMAIL or SMTP_USER set" };
    }

    const transport = getTransport();

    const dashUrl = `https://pss-tryouts-system.vercel.app/admin/leads/${lead.id}`;

    const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:24px 16px;">
<tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111;border:1px solid #1f1f1f;border-radius:12px;overflow:hidden;">
    <tr><td style="background:#DC2626;padding:18px 24px;">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#fecaca;font-weight:600;">PSS · New lead (interest list)</div>
      <div style="font-size:20px;font-weight:700;color:#fff;margin-top:4px;">${escapeHTML(lead.player_name)} <span style="font-weight:400;opacity:0.8;">— ${escapeHTML(lead.age_group || `age ${lead.player_age}`)}</span></div>
    </td></tr>
    <tr><td style="padding:20px 24px;">
      <table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;color:#d4d4d4;">
        <tr><td style="padding:6px 0;color:#a3a3a3;width:120px;">Parent</td><td style="padding:6px 0;color:#fff;">${escapeHTML(lead.parent_name)}</td></tr>
        <tr><td style="padding:6px 0;color:#a3a3a3;">Phone</td><td style="padding:6px 0;"><a href="https://wa.me/${lead.parent_phone.replace(/\D/g, "")}" style="color:#34d399;text-decoration:none;">${escapeHTML(lead.parent_phone)}</a></td></tr>
        <tr><td style="padding:6px 0;color:#a3a3a3;">Email</td><td style="padding:6px 0;"><a href="mailto:${escapeHTML(lead.parent_email)}" style="color:#60a5fa;text-decoration:none;">${escapeHTML(lead.parent_email)}</a></td></tr>
        <tr><td style="padding:6px 0;color:#a3a3a3;">Interested in</td><td style="padding:6px 0;color:#fff;">${escapeHTML(({ winter: "Winter indoor", spring: "Spring 2027", both: "Winter + Spring" } as Record<string, string>)[String(lead.interest || "")] || "not asked")}</td></tr>
        <tr><td style="padding:6px 0;color:#a3a3a3;">Source</td><td style="padding:6px 0;color:#fff;">${escapeHTML(String((lead as any).source ?? "website"))}</td></tr>
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
      subject: `New PSS lead: ${lead.player_name} (${lead.age_group || `age ${lead.player_age}`})${lead.interest ? ` · ${({ winter: "Winter", spring: "Spring", both: "Winter + Spring" } as Record<string, string>)[lead.interest] || lead.interest}` : ""}`,
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

    const info = await transport.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: lead.parent_email,
      subject: "Welcome to Peace Soccer School ⚽ What's next for your player",
      html: welcomeEmailHTML(lead),
    });

    console.log("[email] sent welcome to", lead.parent_email, info.messageId);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[email] sendWelcomeEmail failed:", message);
    return { ok: false, error: message };
  }
}

// ---------- Winter: "You're in!" email after payment ----------

const WINTER_PLACE_FULL = "Teamworks, 1314 Fall River Ave, Seekonk, MA 02771";

export type WinterReg = {
  id: string;
  guardian1_first_name: string | null;
  guardian1_email: string | null;
  player_first_name: string | null;
  player_last_name: string | null;
};

/** The 14 Winter Saturdays (no session Dec 26; Feb 13 is Spring tryouts), 7–9 PM. Teamworks contract: Nov 21 – Mar 6. */
const WINTER_DATES: [number, number, number][] = [
  [2026, 11, 21], [2026, 11, 28], [2026, 12, 5], [2026, 12, 12], [2026, 12, 19],
  [2027, 1, 2], [2027, 1, 9], [2027, 1, 16], [2027, 1, 23], [2027, 1, 30],
  [2027, 2, 6], [2027, 2, 20], [2027, 2, 27], [2027, 3, 6],
];
const WINTER_DATES_TEXT = "Nov 21, 28 · Dec 5, 12, 19 · Jan 2, 9, 16, 23, 30 · Feb 6, 20, 27 · Mar 6";

function winterSessionsICS(reg: WinterReg): Promise<string | null> {
  const kid = `${reg.player_first_name ?? ""}`.trim() || "your player";
  return new Promise((resolve) => {
    createEvents(
      WINTER_DATES.map(([y, m, d], i) => ({
        title: `PSS Winter training (${kid})`,
        description: `Peace Soccer School Winter indoor training, session ${i + 1} of ${WINTER_DATES.length}. Bring turf shoes or sneakers, shin guards and water. Arrive 10 minutes early.`,
        location: WINTER_PLACE_FULL,
        start: [y, m, d, 19, 0] as [number, number, number, number, number],
        startInputType: "local" as const,
        startOutputType: "local" as const,
        duration: { hours: 2, minutes: 0 },
        status: "CONFIRMED" as const,
        busyStatus: "BUSY" as const,
        uid: `pss-winter-${reg.id}-${i + 1}@peacesoccerschool.com`,
      })),
      (error, value) => resolve(error ? null : value)
    );
  });
}

export const WINTER_WHATSAPP_URL = process.env.WINTER_WHATSAPP_URL || "https://chat.whatsapp.com/LQDKLGosOx0Cqa5cwcBhdH";

function waLink(regId?: string): string {
  return regId ? `${REPORT_APP_URL}/go/wa/${regId}` : WINTER_WHATSAPP_URL;
}

function whatsappButtonHTML(regId?: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#ecfdf3;border:1px solid #bbf7d0;border-radius:12px;margin:0 0 18px;"><tr><td style="padding:18px 20px;">
      <div style="font-size:16px;font-weight:800;color:#14532d;margin-bottom:6px;">Join the Winter parents WhatsApp</div>
      <div style="font-size:14px;line-height:1.6;color:#166534;margin-bottom:14px;">This is where we post schedule changes, weather calls and reminders. One tap to join.</div>
      <a href="${waLink(regId)}" style="display:inline-block;background:#25d366;color:#ffffff;text-decoration:none;font-weight:800;font-size:16px;padding:13px 22px;border-radius:10px;">Join on WhatsApp</a>
    </td></tr></table>`;
}

function winterWelcomeHTML(reg: WinterReg): string {
  const parent = escapeHTML((reg.guardian1_first_name || "").trim() || "there");
  const kid = escapeHTML((reg.player_first_name || "").trim() || "your player");
  const row = (label: string, value: string) =>
    `<tr><td style="padding:8px 0;color:#64748b;width:120px;vertical-align:top;font-size:14px;">${label}</td><td style="padding:8px 0;color:#0b2f63;font-size:15px;font-weight:600;">${value}</td></tr>`;
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#eef3fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0b2f63;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3fb;padding:28px 14px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;">
  <tr><td style="background:#0b2f63;padding:30px 28px;">
    <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#bfd7f5;font-weight:700;">Peace Soccer School · Winter</div>
    <div style="font-size:28px;font-weight:800;color:#ffffff;margin-top:6px;">${kid} is in! ⚽</div>
  </td></tr>
  <tr><td style="padding:26px 28px;">
    <p style="margin:0 0 14px;font-size:16px;line-height:1.6;">Hi ${parent},</p>
    <p style="margin:0 0 18px;font-size:16px;line-height:1.6;">Thank you for registering ${kid} for Winter indoor training. Your payment went through and the spot is saved. Here's everything you need:</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;margin:0 0 18px;">
      ${row("First session", "Saturday, November 21, 7–9 PM")}
      ${row("All 14 Saturdays", `${WINTER_DATES_TEXT}<br/><span style=\"color:#64748b;font-weight:500;\">7–9 PM. No session Dec 26 or Feb 13 (Spring tryouts).</span>`)}
      ${row("Where", "Teamworks, 1314 Fall River Ave, Seekonk, MA (indoor turf)")}
      ${row("Arrive", "10 minutes early so we can start on time")}
    </table>
    ${whatsappButtonHTML(reg.id)}
    <p style="margin:0 0 8px;font-size:16px;font-weight:700;">What to bring</p>
    <ul style="margin:0 0 18px;padding-left:20px;font-size:15px;line-height:1.7;color:#334155;">
      <li>Turf shoes or sneakers (no metal studs)</li>
      <li>Shin guards and long socks</li>
      <li>A full water bottle</li>
      <li>A ball with their name on it, if they have one</li>
    </ul>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#334155;">We open and close every session in prayer with a short devotional. Parents are always welcome to stay and watch.</p>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#334155;">All 14 sessions are attached as a calendar invite, so you can add them in one tap. We'll send a reminder before the first session.</p>
    <p style="margin:0;font-size:15px;line-height:1.6;color:#334155;">Questions? Reply to this email or call/text (774) 250-2370.</p>
    <p style="margin:18px 0 0;font-size:15px;line-height:1.6;">See you on the field,<br/><strong>Peace Soccer School</strong></p>
  </td></tr>
  <tr><td style="padding:16px 28px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">Peace Soccer School · <a href="https://www.peacesoccerschool.com/winter-indoor-soccer" style="color:#1d4ed8;text-decoration:none;">peacesoccerschool.com</a></td></tr>
</table></td></tr></table></body></html>`;
}

export async function sendWinterWelcome(reg: WinterReg): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!reg.guardian1_email) return { ok: false, error: "no email" };
    const transport = getTransport();
    const ics = await winterSessionsICS(reg);
    await transport.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: reg.guardian1_email,
      replyTo: "info@peacesoccerschool.com",
      subject: `You're in! ${(reg.player_first_name || "Your player").trim()} starts Winter training Nov 21 ⚽`,
      html: winterWelcomeHTML(reg),
      attachments: ics
        ? [{ filename: "pss-winter-schedule.ics", content: ics, contentType: "text/calendar; charset=utf-8; method=REQUEST" }]
        : [],
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Short follow-up with the WhatsApp join button, for families who got the welcome before the button existed. */
export async function sendWinterWhatsAppInvite(reg: WinterReg): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!reg.guardian1_email) return { ok: false, error: "no email" };
    const parent = escapeHTML((reg.guardian1_first_name || "").trim() || "there");
    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#eef3fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0b2f63;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3fb;padding:28px 14px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;"><tr><td style="padding:26px 28px;">
<p style="margin:0 0 14px;font-size:16px;line-height:1.6;">Hi ${parent},</p>
<p style="margin:0 0 18px;font-size:16px;line-height:1.6;">One more thing before Winter starts Nov 21: we made a WhatsApp group for Winter families. It's where we'll post schedule changes, weather calls and reminders.</p>
${whatsappButtonHTML(reg.id)}
<p style="margin:0;font-size:15px;line-height:1.6;color:#334155;">Questions? Reply to this email or call/text (774) 250-2370.</p>
<p style="margin:18px 0 0;font-size:15px;line-height:1.6;">See you on the field,<br/><strong>Peace Soccer School</strong></p>
</td></tr></table></td></tr></table></body></html>`;
    await getTransport().sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: reg.guardian1_email,
      replyTo: "info@peacesoccerschool.com",
      subject: "Join the PSS Winter parents WhatsApp",
      html,
      text: `Hi ${(reg.guardian1_first_name || "").trim() || "there"},\n\nWe made a WhatsApp group for Winter families. Schedule changes, weather calls and reminders go there.\n\nJoin here: ${waLink(reg.id)}\n\nPeace Soccer School\n(774) 250-2370`,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------- Winter payment reminders ----------

export type PaymentReminderKind = "day1" | "day3" | "lastcall";

/** Friendly reminder for a Winter sign-up whose invoice is still unpaid. */
export async function sendWinterPaymentReminder(args: {
  to: string;
  parentFirst: string | null;
  players: string;
  amount: number;
  payUrl: string;
  kind: PaymentReminderKind;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const parent = escapeHTML((args.parentFirst || "").trim() || "there");
    const kids = escapeHTML(args.players || "your player");
    const amt = `$${args.amount.toFixed(2).replace(/\.00$/, "")}`;
    const beforeDeadline = Date.now() < Date.parse("2026-11-15T05:00:00Z"); // end of Nov 14, Eastern
    const subject =
      args.kind === "lastcall"
        ? `Last day tomorrow: early bird for ${args.players || "Winter"} ends Nov 14`
        : args.kind === "day3"
          ? `${args.players || "Your player"}'s Winter spot is still waiting`
          : `Finish ${args.players || "your player"}'s Winter registration`;
    const lead =
      args.kind === "lastcall"
        ? `Quick heads up: the $275 early bird price for Winter indoor ends <strong>tomorrow, Nov 14</strong>. ${kids}'s registration is saved, it just needs payment to lock in the spot.`
        : args.kind === "day3"
          ? `${kids}'s Winter registration is still waiting on payment. Spots are limited because the indoor space is small, so we wanted to make sure you didn't miss this.`
          : `Thanks for signing up ${kids} for Winter indoor training! It looks like the payment didn't go through yet, so the spot isn't locked in.`;
    const deadline = beforeDeadline
      ? `<p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#334155;">Early bird price of $275 is good through Nov 14.</p>`
      : "";
    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#eef3fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0b2f63;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3fb;padding:28px 14px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;"><tr><td style="padding:26px 28px;">
<p style="margin:0 0 14px;font-size:16px;line-height:1.6;">Hi ${parent},</p>
<p style="margin:0 0 18px;font-size:16px;line-height:1.6;">${lead}</p>
<table cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;margin:0 0 18px;">
<tr><td style="padding:8px 0;color:#64748b;width:120px;font-size:14px;">Program</td><td style="padding:8px 0;font-size:15px;font-weight:600;">Winter indoor · 14 Saturdays, 7–9 PM</td></tr>
<tr><td style="padding:8px 0;color:#64748b;font-size:14px;">Starts</td><td style="padding:8px 0;font-size:15px;font-weight:600;">Saturday, Nov 21 at Teamworks Seekonk</td></tr>
<tr><td style="padding:8px 0;color:#64748b;font-size:14px;">Amount</td><td style="padding:8px 0;font-size:15px;font-weight:600;">${amt}</td></tr>
</table>
${deadline}
<p style="margin:0 0 22px;"><a href="${args.payUrl}" style="display:inline-block;background:#d62828;color:#ffffff;text-decoration:none;font-weight:800;font-size:16px;padding:14px 26px;border-radius:10px;">Pay now and lock in the spot</a></p>
<p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#64748b;">Card or bank transfer, secure checkout by QuickBooks.</p>
<p style="margin:0;font-size:15px;line-height:1.6;color:#334155;">Already paid, or having trouble? Just reply to this email or call/text (774) 250-2370.</p>
<p style="margin:18px 0 0;font-size:15px;line-height:1.6;">See you on the field,<br/><strong>Peace Soccer School</strong></p>
</td></tr></table></td></tr></table></body></html>`;
    const text = `Hi ${(args.parentFirst || "").trim() || "there"},\n\n${lead.replace(/<[^>]+>/g, "")}\n\nWinter indoor: 14 Saturdays, 7-9 PM, starts Nov 21 at Teamworks Seekonk. Amount: ${amt}.\n\nPay here: ${args.payUrl}\n\nQuestions? Reply or call/text (774) 250-2370.\nPeace Soccer School`;
    await getTransport().sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: args.to,
      replyTo: "info@peacesoccerschool.com",
      subject,
      html,
      text,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------- Winter lead follow-ups (Meta lead form, website leads) ----------

export type LeadNurtureKind = "day2" | "day5" | "lastcall";
const NURTURE_APP = "https://pss-tryouts-system.vercel.app";
const REGISTER_URL = (content: string) =>
  `https://www.peacesoccerschool.com/register/winter-2026?utm_source=email&utm_medium=email&utm_campaign=winter2026&utm_content=${content}`;

/** Follow-up for someone who asked about Winter but hasn't registered yet. */
export async function sendWinterLeadNurture(args: {
  leadId: string;
  to: string;
  parentName: string | null;
  kind: LeadNurtureKind;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const first = ((args.parentName || "").trim().split(/\s+/)[0] || "there").replace(/^\(unknown\)$/i, "there");
    const hi = escapeHTML(first);
    const unsub = `${NURTURE_APP}/api/email/unsubscribe?l=${args.leadId}`;
    const beforeDeadline = Date.now() < Date.parse("2026-11-15T05:00:00Z");
    const price = beforeDeadline ? "$275 early bird through Nov 14 ($300 after)" : "$300";

    const copy = {
      day2: {
        subject: "What a Winter Saturday at PSS looks like",
        img: `${NURTURE_APP}/email/winter-launch.jpg`,
        body: `<p>Hi ${hi},</p>
<p>Thanks again for asking about Winter indoor soccer. Here's what a Saturday night looks like:</p>
<ul style="padding-left:20px;line-height:1.8">
<li><b>7:00</b> Warm-up and a short prayer</li>
<li><b>7:15</b> Ball mastery: hundreds of touches, turns and moves</li>
<li><b>7:45</b> Small-sided games by age and level</li>
<li><b>8:45</b> Short devotional and close in prayer</li>
</ul>
<p>14 Saturdays, Nov 21 – Mar 6, at Teamworks Seekonk (indoor turf). Ages 5–13, boys and girls, with USSF-licensed coaches. ${escapeHTML(price)}.</p>`,
        button: "Save a spot for Winter",
        content: "lead_day2",
      },
      day5: {
        subject: "Bring the brother or sister: siblings save 15%",
        img: `${NURTURE_APP}/email/winter-siblings.jpg`,
        body: `<p>Hi ${hi},</p>
<p>Quick reminder about Winter indoor soccer at Teamworks Seekonk. If you have more than one player, siblings save 15%, and they train in groups by age so everyone is challenged.</p>
<p>Spots are limited because the indoor space is small. ${beforeDeadline ? "The $275 early bird ends Nov 14." : ""} Sign-up takes about 3 minutes, and you can pay by card or bank transfer.</p>`,
        button: "Register for Winter",
        content: "lead_day5",
      },
      lastcall: {
        subject: "Early bird ends tomorrow: Winter indoor soccer",
        img: `${NURTURE_APP}/email/winter-launch.jpg`,
        body: `<p>Hi ${hi},</p>
<p>Heads up: the <b>$275 early bird for Winter indoor soccer ends tomorrow, Nov 14</b>. After that it's $300.</p>
<p>14 Saturdays, 7–9 PM at Teamworks Seekonk, starting Nov 21. Siblings save 15%.</p>`,
        button: "Lock in $275 now",
        content: "lead_lastcall",
      },
    }[args.kind];

    const url = REGISTER_URL(copy.content);
    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#eef3fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0b2f63;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3fb;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;">
<tr><td><img src="${copy.img}" width="600" alt="PSS Winter indoor soccer" style="display:block;width:100%;height:auto;border:0"></td></tr>
<tr><td style="padding:24px 26px;font-size:16px;line-height:1.6;color:#1f2937;">
${copy.body}
<p style="margin:22px 0;"><a href="${url}" style="display:inline-block;background:#d62828;color:#ffffff;text-decoration:none;font-weight:800;font-size:16px;padding:14px 26px;border-radius:10px;">${copy.button}</a></p>
<p style="font-size:15px;color:#334155;">Questions? Just reply, or call/text (774) 250-2370.</p>
<p style="margin-top:18px;">See you on the field,<br/><strong>Peace Soccer School</strong></p>
</td></tr></table>
<p style="max-width:600px;margin:14px auto 0;font-size:12px;line-height:1.5;color:#7a869a">Peace Soccer School · Attleboro, MA<br>You're getting this because you asked about Winter at Peace Soccer School. <a href="${unsub}" style="color:#7a869a">Unsubscribe</a></p>
</td></tr></table></body></html>`;
    const text = `${html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<li>/g, "- ").replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim()}\n\nRegister: ${url}\nUnsubscribe: ${unsub}`;

    await getTransport().sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: args.to,
      replyTo: "info@peacesoccerschool.com",
      subject: copy.subject,
      html,
      text,
      headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Player reports (end of season) ───────────────────────────────────────────

function playerReportEmailHTML(r: PlayerReport): string {
  const parent = escapeHTML((r.parent_first || "").trim() || "there");
  const kid = escapeHTML((r.player_first || "").trim() || "your player");
  const url = `${REPORT_APP_URL}/report/${r.report_token}`;
  const strength = r.strength ? escapeHTML(r.strength) : "";
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#eef3fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0b2f63;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3fb;padding:28px 14px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;">
  <tr><td style="background:#0b2f63;padding:30px 28px;">
    <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#bfd7f5;font-weight:700;">Peace Soccer School · ${REPORT_SEASON_LABEL}</div>
    <div style="font-size:26px;font-weight:800;color:#ffffff;margin-top:6px;">${kid}'s player report is ready</div>
  </td></tr>
  <tr><td style="padding:26px 28px;">
    <p style="margin:0 0 14px;font-size:16px;line-height:1.6;">Hi ${parent},</p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Thank you for trusting us with ${kid} this fall. ${escapeHTML(r.rated_by || "Our coach")} put together a short report on how ${kid} played this season: skill ratings, a strength, one thing to work on next, and a personal note.</p>
    ${strength ? `<div style="background:#f1f6fd;border-left:4px solid #1d4ed8;border-radius:8px;padding:14px 16px;margin:0 0 18px;font-size:15px;line-height:1.6;"><div style="font-size:12px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#1d4ed8;margin-bottom:4px;">Biggest strength</div>${strength}</div>` : ""}
    <p style="margin:0 0 22px;"><a href="${url}" style="display:inline-block;background:#0b2f63;color:#ffffff;text-decoration:none;font-weight:800;font-size:16px;padding:14px 24px;border-radius:10px;">View ${kid}'s full report</a></p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#334155;">Want to keep the progress going? Winter indoor training runs 14 Saturday nights at Teamworks Seekonk starting Nov 21, and it's the best way to work on the next step in the report. <a href="https://www.peacesoccerschool.com/winter-indoor-soccer?utm_source=email&utm_medium=report&utm_campaign=fall2026_report" style="color:#1d4ed8;font-weight:700;">See Winter details</a>.</p>
    <p style="margin:0;font-size:15px;line-height:1.6;color:#334155;">Questions about the report? Just reply to this email.</p>
    <p style="margin:18px 0 0;font-size:15px;line-height:1.6;">Grateful for your family,<br/><strong>Peace Soccer School</strong></p>
  </td></tr>
  <tr><td style="padding:16px 28px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">Peace Soccer School · <a href="https://www.peacesoccerschool.com" style="color:#1d4ed8;text-decoration:none;">peacesoccerschool.com</a></td></tr>
</table></td></tr></table></body></html>`;
}

export async function sendPlayerReport(r: PlayerReport, opts: { overrideTo?: string } = {}): Promise<{ ok: boolean; error?: string }> {
  try {
    const to = opts.overrideTo || r.parent_email;
    if (!to) return { ok: false, error: "no parent email" };
    const transport = getTransport();
    const kid = (r.player_first || "Your player").trim();
    await transport.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      cc: !opts.overrideTo && r.parent2_email && r.parent2_email !== r.parent_email ? r.parent2_email : undefined,
      replyTo: "info@peacesoccerschool.com",
      subject: `${opts.overrideTo ? "[TEST] " : ""}${kid}'s ${REPORT_SEASON_LABEL} player report ⚽`,
      html: playerReportEmailHTML(r),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
