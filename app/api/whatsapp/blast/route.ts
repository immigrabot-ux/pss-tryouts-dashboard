import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendWhatsAppTemplate } from "@/lib/whatsapp";
import { logActivity } from "@/lib/activity";
import { isAdminPassword, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/whatsapp/blast?password=...&template=pss_reminder&dry_run=1
 *
 * Admin-only. Fires a WhatsApp template to every lead where
 * whatsapp_confirmed = true.
 *
 * Templates supported:
 *  - pss_reminder     ({{1}} parent, {{2}} player, {{3}} location)        DEFAULT
 *  - pss_reminder_3day  ({{1}} parent, {{2}} player, {{3}} location)
 *  - pss_reminder_1day  ({{1}} parent, {{2}} player, {{3}} time, {{4}} location)
 *  - pss_reminder_today ({{1}} parent, {{2}} player, {{3}} time, {{4}} location)
 *  - pss_welcome      ({{1}} parent, {{2}} player)
 *
 * Pass &dry_run=1 to preview the list of recipients without sending.
 */
export async function GET(req: NextRequest) {
  const password = req.nextUrl.searchParams.get("password");
  if (!isAdminPassword(password)) return unauthorized();

  const template = req.nextUrl.searchParams.get("template") || "pss_reminder";
  const dryRun = req.nextUrl.searchParams.get("dry_run") === "1";

  const supabase = getSupabaseAdmin();
  const { data: leads, error } = await supabase
    .from("leads")
    .select("*")
    .eq("whatsapp_confirmed", true)
    .eq("whatsapp_opt_in", true);

  if (error) {
    return NextResponse.json(
      { error: "db_read_failed", detail: error.message },
      { status: 500 }
    );
  }

  const location = process.env.TRYOUT_LOCATION || "Bliss Fields, Rehoboth MA";
  const time = process.env.TRYOUT_TIME || "09:00";

  // Build template params per template type.
  function paramsFor(lead: any): string[] {
    switch (template) {
      case "pss_welcome":
        return [lead.parent_name, lead.player_name];
      case "pss_reminder_1day":
      case "pss_reminder_today":
        return [lead.parent_name, lead.player_name, time, location];
      case "pss_reminder":
      case "pss_reminder_3day":
      default:
        return [lead.parent_name, lead.player_name, location];
    }
  }

  if (dryRun) {
    return NextResponse.json({
      dry_run: true,
      template,
      recipient_count: leads?.length || 0,
      recipients: (leads || []).map((l: any) => ({
        id: l.id,
        name: l.parent_name,
        phone: l.parent_phone,
        params: paramsFor(l),
      })),
    });
  }

  const results: Array<{
    leadId: string;
    name: string;
    phone: string;
    ok: boolean;
    error?: string;
    messageId?: string;
  }> = [];

  for (const lead of leads || []) {
    const r = await sendWhatsAppTemplate(
      lead.parent_phone,
      template,
      paramsFor(lead)
    );
    await logActivity(
      lead.id,
      "whatsapp",
      `blast_${template}`,
      r.error || null,
      r.ok
    );
    results.push({
      leadId: lead.id,
      name: lead.parent_name,
      phone: lead.parent_phone,
      ok: r.ok,
      error: r.error,
      messageId: r.messageId,
    });
  }

  const sent = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  console.log(
    `[blast] template=${template} sent=${sent} failed=${failed} total=${results.length}`
  );

  return NextResponse.json({
    template,
    total: results.length,
    sent,
    failed,
    results,
  });
}
