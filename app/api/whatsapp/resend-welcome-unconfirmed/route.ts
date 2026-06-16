import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendWhatsAppTemplate, WELCOME_TEMPLATE_NAME } from "@/lib/whatsapp";
import { logActivity } from "@/lib/activity";
import { isAdminPassword, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Bigger budget — could be sending to dozens of leads.
export const maxDuration = 60;

/**
 * GET /api/whatsapp/resend-welcome-unconfirmed?password=...&dry_run=1
 *
 * Admin-only. Re-fires the welcome WhatsApp template to every lead that:
 *   - has whatsapp_opt_in = true
 *   - has whatsapp_confirmed = false   (they never replied)
 *   - is NOT hidden
 *
 * Use this to nudge ghosters who got the welcome but never confirmed.
 *
 * The idempotency timestamps (welcome_whatsapp_sent_at) are deliberately
 * IGNORED here — that's the whole point of a nudge. Each send is logged as
 * `kind="welcome_resend"` so it's distinguishable from the original welcome.
 *
 * Pass &dry_run=1 to preview the recipient list without sending.
 */
export async function GET(req: NextRequest) {
  const password = req.nextUrl.searchParams.get("password");
  if (!isAdminPassword(password)) return unauthorized();

  const dryRun = req.nextUrl.searchParams.get("dry_run") === "1";

  const supabase = getSupabaseAdmin();
  const { data: leads, error } = await supabase
    .from("leads")
    .select("*")
    .eq("whatsapp_opt_in", true)
    .eq("whatsapp_confirmed", false)
    .or("hidden.is.null,hidden.eq.false");

  if (error) {
    return NextResponse.json(
      { error: "db_read_failed", detail: error.message },
      { status: 500 }
    );
  }

  const targets = leads || [];

  if (dryRun) {
    return NextResponse.json({
      dry_run: true,
      template: WELCOME_TEMPLATE_NAME,
      recipient_count: targets.length,
      recipients: targets.map((l: any) => ({
        id: l.id,
        name: l.parent_name,
        player: l.player_name,
        phone: l.parent_phone,
        original_sent_at: l.welcome_whatsapp_sent_at,
        created_at: l.created_at,
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

  for (const lead of targets) {
    const r = await sendWhatsAppTemplate(
      lead.parent_phone,
      WELCOME_TEMPLATE_NAME,
      [lead.parent_name, lead.player_name]
    );

    await logActivity(
      lead.id,
      "whatsapp",
      "welcome_resend",
      r.ok ? null : r.error || "unknown error",
      r.ok
    );

    // Refresh the dashboard badge so re-sends show as "sent" instead of
    // an old "failed" status if Meta finally accepts it.
    if (r.ok) {
      await supabase
        .from("leads")
        .update({
          whatsapp_send_status: "sent",
          whatsapp_send_error: null,
          welcome_whatsapp_sent_at: new Date().toISOString(),
        })
        .eq("id", lead.id);
    }

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
    `[resend-welcome] template=${WELCOME_TEMPLATE_NAME} sent=${sent} failed=${failed} total=${results.length}`
  );

  return NextResponse.json({
    template: WELCOME_TEMPLATE_NAME,
    total: results.length,
    sent,
    failed,
    results,
  });
}
