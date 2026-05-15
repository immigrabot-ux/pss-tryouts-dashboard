// Standalone email test — verifies SMTP credentials and renders the actual
// welcome email + .ics invite that parents will receive.
//
// Run with:
//   node --env-file=.env.local scripts/test-email.mjs <recipient-email>
//
// If no recipient is passed, it sends to SMTP_USER (your own inbox).

import nodemailer from "nodemailer";
import { createEvent } from "ics";

const recipient = process.argv[2] || process.env.SMTP_USER;

if (!recipient) {
  console.error("Usage: node --env-file=.env.local scripts/test-email.mjs <recipient>");
  process.exit(1);
}

const required = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing env vars: ${missing.join(", ")}`);
  console.error("Make sure you ran with --env-file=.env.local");
  process.exit(1);
}

const FROM_NAME = "Peace Soccer School";
const FROM_EMAIL = process.env.SMTP_FROM || process.env.SMTP_USER;

const fakeLead = {
  parent_name: "Test Parent",
  player_name: "Test Player",
  player_age: 9,
  parent_email: recipient,
  whatsapp_opt_in: true,
  tryout_date: process.env.TRYOUT_DATE || "2026-08-15",
};

console.log("→ Building ICS calendar invite…");
const ics = await buildICS(fakeLead);
console.log(ics ? "  ✓ ICS built" : "  ✗ ICS failed (continuing without attachment)");

console.log(`→ Connecting to ${process.env.SMTP_HOST}:${process.env.SMTP_PORT}…`);
const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT, 10),
  secure: parseInt(process.env.SMTP_PORT, 10) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

console.log("→ Verifying SMTP connection…");
try {
  await transport.verify();
  console.log("  ✓ SMTP credentials accepted");
} catch (err) {
  console.error("  ✗ SMTP verify failed:", err.message);
  process.exit(1);
}

console.log(`→ Sending test email to ${recipient}…`);
try {
  const info = await transport.sendMail({
    from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
    to: recipient,
    subject: "Welcome to PSS — Your Fall 2026 Tryout is Confirmed ⚽ (TEST)",
    html: welcomeHTML(fakeLead),
    attachments: ics
      ? [
          {
            filename: "pss-tryout.ics",
            content: ics,
            contentType: "text/calendar; charset=utf-8; method=REQUEST",
          },
        ]
      : [],
  });
  console.log("  ✓ Email sent");
  console.log("    messageId:", info.messageId);
  console.log("    accepted: ", info.accepted);
  console.log("    rejected: ", info.rejected);
  console.log("    response: ", info.response);
} catch (err) {
  console.error("  ✗ Send failed:", err.message);
  process.exit(1);
}

console.log("\n✅ Done. Check the inbox for", recipient);

function buildICS(lead) {
  return new Promise((resolve) => {
    const date = lead.tryout_date || "2026-08-15";
    const time = process.env.TRYOUT_TIME || "09:00";
    const location = process.env.TRYOUT_LOCATION || "Bliss Fields, Rehoboth MA";
    const [year, month, day] = date.split("-").map((n) => parseInt(n, 10));
    const [hour, minute] = time.split(":").map((n) => parseInt(n, 10));

    createEvent(
      {
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
      },
      (err, val) => resolve(err ? null : val)
    );
  });
}

function welcomeHTML(lead) {
  const date = lead.tryout_date;
  const time = process.env.TRYOUT_TIME || "09:00";
  const location = process.env.TRYOUT_LOCATION || "Bliss Fields, Rehoboth MA";
  const niceDate = new Date(`${date}T${time}:00`).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#111;border:1px solid #1f1f1f;border-radius:12px;overflow:hidden;">
    <tr><td style="background:linear-gradient(135deg,#DC2626 0%,#7f1d1d 100%);padding:32px 28px;">
      <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#fecaca;font-weight:600;">Peace Soccer School · TEST</div>
      <div style="font-size:24px;font-weight:700;color:#fff;margin-top:6px;">Welcome to PSS, ${lead.parent_name} ⚽</div>
    </td></tr>
    <tr><td style="padding:28px;">
      <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#e5e5e5;">Hi ${lead.parent_name},</p>
      <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#e5e5e5;">Thank you for signing <strong>${lead.player_name}</strong> up for our Fall 2026 tryout — we can't wait to see them on the field.</p>
      <div style="background:#0a0a0a;border:1px solid #1f1f1f;border-radius:10px;padding:18px 20px;margin:20px 0;">
        <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#DC2626;font-weight:700;margin-bottom:10px;">Your tryout</div>
        <div style="font-size:18px;font-weight:600;color:#fff;margin-bottom:6px;">${niceDate}</div>
        <div style="font-size:14px;color:#a3a3a3;margin-bottom:4px;">⏰ ${time}</div>
        <div style="font-size:14px;color:#a3a3a3;">📍 ${location}</div>
      </div>
      <p style="margin:20px 0 16px;font-size:15px;line-height:1.6;color:#d4d4d4;">I've attached a calendar invite — add it now so you don't miss it.</p>
      <p style="margin:0;font-size:15px;line-height:1.6;color:#d4d4d4;">See you on the pitch,<br/><strong style="color:#fff;">Coach Mina</strong><br/><span style="color:#737373;">Peace Soccer School</span></p>
      <p style="margin:24px 0 0;font-size:11px;color:#525252;border-top:1px solid #1f1f1f;padding-top:14px;">This is a test email from the PSS Tryouts System. If you weren't expecting it, you can safely ignore it.</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}
