import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendWhatsAppTemplate, normalizePhone } from "@/lib/whatsapp";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

/**
 * Winter registration WhatsApp launch. Runs every 15 minutes (vercel.json).
 *
 * Sends the Meta-approved template `pss_winter_open_v2` ({{1}} = parent first name)
 * ONCE to every warm WhatsApp lead: replied to us before (whatsapp_confirmed),
 * still opted in, not hidden or dead. Skips families already registered for Winter
 * and duplicate phone numbers. Replies are handled by the WhatsApp AI as usual.
 *
 * It starts on its own the first run after Meta approves the template: until then
 * the first send fails with a "template not found / not approved" error and the
 * run stops without touching anyone.
 *
 * Only sends 10 AM to 7 PM Eastern. Max 35 per run. Stop it any time with the
 * env var WINTER_WA_LAUNCH_OFF=true. Preview with ?password=ADMIN&dry_run=1.
 */
// Tried in order; the first one Meta has approved is used (v3 is a simpler backup in case v2 sits in review).
const TEMPLATES = (process.env.WINTER_WA_TEMPLATE || "pss_winter_open_v2,pss_winter_open_v3").split(",").map((t) => t.trim()).filter(Boolean);
const LANG = process.env.WINTER_WA_TEMPLATE_LANG || "en";
const KIND = "winter_open";
const PER_RUN = 35;

const TEXT_FOR_LOG = (first: string) =>
  `Hi ${first}! Winter indoor soccer registration is open at Peace Soccer School: 14 Saturday nights at Teamworks Seekonk, Nov 21 to Mar 6, 7-9 PM, ages 5-13. Early bird $275 through Nov 14 ($300 after), siblings save 15%, spots are limited. Register: peacesoccerschool.com/register/winter-2026`;

function firstName(name: string | null | undefined) {
  const f = (name || "").trim().split(/\s+/)[0] || "";
  return f ? f.charAt(0).toUpperCase() + f.slice(1).toLowerCase() : "there";
}

function etHour() {
  return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" }).format(new Date()));
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;
  const isCron = !!cronSecret && auth === `Bearer ${cronSecret}`;
  const isVercelCron = req.headers.get("x-vercel-cron") === "1" || (req.headers.get("user-agent") || "").startsWith("vercel-cron");
  const manual = req.nextUrl.searchParams.get("password");
  const isAdmin = !!process.env.ADMIN_PASSWORD && manual === process.env.ADMIN_PASSWORD;
  if (!isCron && !isVercelCron && !isAdmin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const dryRun = req.nextUrl.searchParams.get("dry_run") === "1";
  if (process.env.WINTER_WA_LAUNCH_OFF === "true" && !dryRun) return NextResponse.json({ off: true });

  const hour = etHour();
  if (!dryRun && (hour < 10 || hour >= 19)) return NextResponse.json({ waiting: "outside 10am-7pm ET", hour });

  const db = getSupabaseAdmin();

  const [{ data: leads, error }, { data: done }, { data: regs }] = await Promise.all([
    db.from("leads").select("id, parent_name, parent_phone, hidden, status")
      .eq("whatsapp_confirmed", true).eq("whatsapp_opt_in", true).order("created_at", { ascending: false }),
    db.from("lead_activities").select("lead_id, detail").eq("channel", "whatsapp").eq("kind", KIND),
    db.from("winter_2026_registrations").select("guardian1_cell_phone, guardian2_cell_phone"),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const last10 = (p: string | null | undefined) => (normalizePhone(p || "") || "").slice(-10);
  const sentPhones = new Set<string>();
  const sentLeads = new Set<string>();
  for (const a of done || []) {
    sentLeads.add(a.lead_id);
    const m = /phone:(\d{10})/.exec(a.detail || "");
    if (m) sentPhones.add(m[1]);
  }
  const registered = new Set<string>();
  for (const r of regs || []) {
    for (const p of [r.guardian1_cell_phone, r.guardian2_cell_phone]) { const d = last10(p); if (d) registered.add(d); }
  }

  const queue: { id: string; first: string; phone: string; p10: string }[] = [];
  const seen = new Set<string>();
  for (const l of leads || []) {
    if (l.hidden || l.status === "dead") continue;
    const p10 = last10(l.parent_phone);
    if (!p10 || seen.has(p10)) continue;
    seen.add(p10);
    if (sentLeads.has(l.id) || sentPhones.has(p10) || registered.has(p10)) continue;
    queue.push({ id: l.id, first: firstName(l.parent_name), phone: l.parent_phone, p10 });
  }

  if (dryRun) {
    return NextResponse.json({ dry_run: true, templates: TEMPLATES, remaining: queue.length, already_sent: sentLeads.size, skipped_registered: registered.size, preview: queue.slice(0, 10).map((q) => ({ first: q.first, phone: "…" + q.p10.slice(-4) })) });
  }
  if (!queue.length) return NextResponse.json({ ok: true, done: true, sent_total: sentLeads.size });

  let sent = 0;
  const failed: string[] = [];
  const notReady = (code: unknown) => [132001, 132000, 132015, 132016, 100].includes(Number(code));
  let template: string | null = null;
  for (const q of queue.slice(0, PER_RUN)) {
    let r: Awaited<ReturnType<typeof sendWhatsAppTemplate>>;
    if (template) {
      r = await sendWhatsAppTemplate(q.phone, template, [q.first], LANG);
    } else {
      // First send of the run: find a template Meta has approved.
      r = { ok: false, error: "no template approved" };
      const tried: string[] = [];
      for (const t of TEMPLATES) {
        r = await sendWhatsAppTemplate(q.phone, t, [q.first], LANG);
        if (r.ok) { template = t; break; }
        tried.push(`${t}: ${(r.raw as any)?.error?.code ?? ""} ${r.error}`);
        if (!notReady((r.raw as any)?.error?.code)) break;
      }
      if (!template && tried.length === TEMPLATES.length) {
        return NextResponse.json({ waiting: "no template approved yet", tried });
      }
    }
    if (!r.ok) {
      const code = (r.raw as any)?.error?.code;
      failed.push(`${q.id}: ${code ?? ""} ${r.error}`);
      await logActivity(q.id, "whatsapp", `${KIND}_failed`, `${r.error} phone:${q.p10}`, false);
      continue;
    }
    sent++;
    await logActivity(q.id, "whatsapp", KIND, `${TEXT_FOR_LOG(q.first)} phone:${q.p10}`, true);
  }
  return NextResponse.json({ ok: true, template, sent, failed, remaining: queue.length - sent - failed.length });
}
