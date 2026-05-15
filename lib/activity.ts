import { getSupabaseAdmin } from "./supabase";

/**
 * Log an activity event against a lead. Soft-fails — never throw, just log.
 * Requires a `lead_activities` table in Supabase (schema documented in README).
 */
export async function logActivity(
  leadId: string,
  channel: "email" | "whatsapp" | "system",
  kind: string,
  detail: string | null,
  success: boolean
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("lead_activities").insert({
      lead_id: leadId,
      channel,
      kind,
      detail,
      success,
    });
    if (error) {
      console.warn("[activity] log insert error:", error.message);
    }
  } catch (err) {
    console.warn(
      "[activity] log failed (table may not exist yet):",
      err instanceof Error ? err.message : err
    );
  }
}
