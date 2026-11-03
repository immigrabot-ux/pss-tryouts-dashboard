import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getTransport } from "@/lib/email";
import { winterLaunchEmail } from "@/lib/campaign-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

/**
 * Email campaign sender. Runs every 5 minutes (vercel.json).
 * Only sends for campaigns with status = 'sending' (set by hand once the email is approved).
 * 30 emails per run, 8 AM to 9 PM Eastern. Skips anyone in email_unsubscribes.
 */
const PER_RUN = 30;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const ok = (!!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) || req.headers.get("x-vercel-cron") === "1" || (req.headers.get("user-agent") || "").startsWith("vercel-cron");
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" }).format(new Date()));
  if (hour < 8 || hour >= 21) return NextResponse.json({ waiting: "outside 8am-9pm ET" });

  const db = getSupabaseAdmin();
  const { data: camp } = await db.from("email_campaigns").select("id, status").eq("status", "sending").order("created_at").limit(1).maybeSingle();
  if (!camp) return NextResponse.json({ idle: true });

  const { data: batch } = await db.from("email_recipients").select("id, email, first_name, kid_name").eq("campaign_id", camp.id).eq("status", "queued").order("created_at").limit(PER_RUN);
  if (!batch?.length) {
    await db.from("email_campaigns").update({ status: "done" }).eq("id", camp.id);
    return NextResponse.json({ done: true });
  }
  const { data: unsubs } = await db.from("email_unsubscribes").select("email").in("email", batch.map((b) => b.email));
  const blocked = new Set((unsubs || []).map((u) => u.email));

  const transport = getTransport();
  const from = `"Peace Soccer School" <${process.env.SMTP_USER}>`;
  let sent = 0, failed = 0, skipped = 0;
  for (const r of batch) {
    if (blocked.has(r.email)) {
      skipped++;
      await db.from("email_recipients").update({ status: "skipped", error: "unsubscribed" }).eq("id", r.id);
      continue;
    }
    const m = winterLaunchEmail(r);
    try {
      await transport.sendMail({
        from, to: r.email, replyTo: process.env.SMTP_USER, subject: m.subject, text: m.text, html: m.html,
        headers: { "List-Unsubscribe": `<${m.unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      });
      sent++;
      await db.from("email_recipients").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", r.id);
    } catch (err) {
      failed++;
      await db.from("email_recipients").update({ status: "failed", error: String(err instanceof Error ? err.message : err).slice(0, 300) }).eq("id", r.id);
    }
  }
  return NextResponse.json({ campaign: camp.id, sent, failed, skipped });
}
