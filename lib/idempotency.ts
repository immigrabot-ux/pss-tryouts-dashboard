import { getSupabaseAdmin } from "./supabase";

/**
 * Idempotency helpers for one-time welcome sends.
 *
 * Each "claim" runs an ATOMIC conditional update against Supabase:
 *   UPDATE leads SET <ts> = now() WHERE id = $1 AND <ts> IS NULL RETURNING id
 *
 * - If the timestamp column was null, the update succeeds and returns a row →
 *   THIS call wins and should send. Future calls see the timestamp set.
 * - If the timestamp was already set (another path sent it), no row is
 *   returned → we skip and log.
 *
 * Postgres serializes the conditional update, so concurrent invocations
 * cannot both win — exactly one will send. This is the "NEVER re-send"
 * guarantee the cron needs.
 *
 * On send failure, the caller can optionally call `release*` to clear the
 * timestamp so a future poll retries. Without release, the lead just stays
 * "stuck" until someone clicks the manual button in the dashboard. We
 * default to NOT releasing on failure — that matches the spec ("after
 * SUCCESSFUL send, the timestamp stays set") and avoids the race where
 * a transient SMTP failure causes us to spam the parent on the next minute.
 */

/**
 * Attempt to claim the welcome-email slot for this lead.
 * Returns true if THIS caller should send; false if it's already been sent.
 */
export async function claimWelcomeEmail(leadId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("leads")
    .update({ welcome_email_sent_at: new Date().toISOString() })
    .eq("id", leadId)
    .is("welcome_email_sent_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.warn(`[idempotency] claimWelcomeEmail error for ${leadId}:`, error.message);
    // Fail-closed: if Supabase is having issues, do NOT send — we prefer
    // missed messages to duplicate ones.
    return false;
  }
  return !!data;
}

/**
 * Attempt to claim the welcome-WhatsApp slot for this lead.
 * Returns true if THIS caller should send; false if it's already been sent.
 */
export async function claimWelcomeWhatsApp(leadId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("leads")
    .update({ welcome_whatsapp_sent_at: new Date().toISOString() })
    .eq("id", leadId)
    .is("welcome_whatsapp_sent_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.warn(`[idempotency] claimWelcomeWhatsApp error for ${leadId}:`, error.message);
    return false;
  }
  return !!data;
}

/**
 * Clear the welcome-email timestamp so a future call can retry.
 * Use sparingly — only when the send fails in a way that's safe to retry
 * (e.g. transient SMTP error). Don't release if Meta says "duplicate" etc.
 */
export async function releaseWelcomeEmail(leadId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase
    .from("leads")
    .update({ welcome_email_sent_at: null })
    .eq("id", leadId);
}

export async function releaseWelcomeWhatsApp(leadId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase
    .from("leads")
    .update({ welcome_whatsapp_sent_at: null })
    .eq("id", leadId);
}
