/** Winter 2026 launch email (campaign "winter2026_launch"). Plain, personal, mobile-friendly. */
export const SITE = "https://www.peacesoccerschool.com";
export const APP = "https://pss-tryouts-system.vercel.app";
export const MAIL_ADDRESS = "Peace Soccer School · Attleboro, MA";

export function winterLaunchEmail(r: { id: string; first_name: string | null; kid_name: string | null }) {
  const hi = r.first_name ? `Hi ${r.first_name},` : "Hi there,";
  const kid = r.kid_name ? `${r.kid_name}` : "your child";
  const reg = `${SITE}/register/winter-2026?utm_source=email&utm_medium=email&utm_campaign=winter2026`;
  const unsub = `${APP}/api/email/unsubscribe?r=${r.id}`;
  const subject = "Early bird $275 ends Nov 14: Winter indoor soccer";

  const text = `${hi}

Winter indoor soccer at Peace Soccer School is open, and we'd love to have ${kid} with us this winter.

- 14 Saturday nights, Nov 21 to Mar 6 (no session Dec 26 or Feb 13)
- 7 to 9 PM at Teamworks, 1314 Fall River Ave, Seekonk
- Boys and girls ages 5 to 13, all levels
- Ball mastery, small-sided games, one-on-one coaching inside every session, and prayer to open and close each night
- Early bird $275 until Nov 14 ($300 after). Siblings save 15%.

Register (about 3 minutes): ${reg}

Spots are limited this season.

Bringing a brother or sister? Siblings save 15%, so 2 kids are $467.50 for the whole Winter with the early bird.

Questions? Just reply to this email.

See you on the field,
Peace Soccer School

${MAIL_ADDRESS}
Unsubscribe: ${unsub}`;

  const html = `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#0B1636">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td><a href="${reg}"><img src="${APP}/email/winter-launch.jpg" width="600" alt="Winter is better with your team. Peace Soccer School Winter indoor training." style="display:block;width:100%;height:auto;border:0"></a></td></tr>
<tr><td style="padding:26px 26px 8px;font-size:16px;line-height:1.55">
<p style="margin:0 0 14px">${hi}</p>
<p style="margin:0 0 14px">Winter indoor soccer at Peace Soccer School is open, and we'd love to have ${kid} with us this winter.</p>
<ul style="margin:0 0 16px;padding-left:20px">
<li><b>14 Saturday nights</b>, Nov 21 to Mar 6 (no session Dec 26 or Feb 13)</li>
<li><b>7 to 9 PM</b> at Teamworks, 1314 Fall River Ave, Seekonk</li>
<li>Boys and girls <b>ages 5 to 13</b>, all levels</li>
<li>Ball mastery, small-sided games, one-on-one coaching inside every session, and prayer to open and close each night</li>
<li><b>Early bird $275</b> until Nov 14 ($300 after). <b>Siblings save 15%.</b></li>
</ul>
</td></tr>
<tr><td align="center" style="padding:4px 26px 22px">
<a href="${reg}" style="display:inline-block;background:#D7263D;color:#ffffff;text-decoration:none;font-weight:bold;font-size:17px;padding:14px 28px;border-radius:10px">Register for Winter</a>
<p style="margin:12px 0 0;font-size:14px;color:#4A5B78">Takes about 3 minutes. Spots are limited this season.</p>
</td></tr>
<tr><td style="padding:0 26px 8px"><a href="${reg}"><img src="${APP}/email/winter-siblings.jpg" width="548" alt="Bring the brother or sister. Siblings save 15%: 2 kids are $467.50 for the whole Winter with the early bird." style="display:block;width:100%;height:auto;border:0;border-radius:10px"></a></td></tr>
<tr><td style="padding:14px 26px 26px;font-size:16px;line-height:1.55">
<p style="margin:0 0 14px"><b>Bringing a brother or sister?</b> Siblings save 15%, so 2 kids are $467.50 for the whole Winter with the early bird.</p>
<p style="margin:0 0 14px">Questions? Just reply to this email.</p>
<p style="margin:0">See you on the field,<br><b>Peace Soccer School</b></p>
</td></tr>
</table>
<p style="max-width:600px;margin:14px auto 0;font-size:12px;line-height:1.5;color:#7a869a">${MAIL_ADDRESS}<br>You're getting this because you signed up with Peace Soccer School. <a href="${unsub}" style="color:#7a869a">Unsubscribe</a></p>
</td></tr></table></body></html>`;
  return { subject, text, html, unsub };
}
