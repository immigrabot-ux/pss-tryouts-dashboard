/**
 * Hand every new family to the Command Center, which texts them instantly
 * (only if they checked the texting-consent box) and lets the AI take the conversation.
 */
const CC_NEW_LEAD_URL = "https://pss-command-center.vercel.app/api/webhooks/new-lead";

export type NewLeadSource = "meta" | "site_tryout" | "site_contact" | "site_trial" | "winter_registration";

export async function notifyNewLead(p: {
  source: NewLeadSource;
  name?: string;
  phone?: string;
  email?: string;
  child?: string;
  child_age?: number | string | null;
  sms_consent: boolean;
  note?: string;
}): Promise<void> {
  const key = process.env.MESSAGE_LOG_SECRET;
  if (!key) return;
  try {
    const res = await fetch(CC_NEW_LEAD_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-log-key": key },
      body: JSON.stringify({ ...p, child: p.child && p.child !== "(unknown)" ? p.child : undefined }),
      signal: AbortSignal.timeout(8000),
    });
    console.log(`[cc-new-lead] ${p.source} → ${res.status} ${await res.text().catch(() => "")}`);
  } catch (e) {
    console.error("[cc-new-lead] failed:", e);
  }
}

/** True if the Meta lead checked a texting-consent checkbox on the instant form. */
export function metaSmsConsent(lead: any): boolean {
  const disclaimers: any[] = lead?.custom_disclaimer_responses || [];
  if (disclaimers.some((d) => d?.is_checked === true || d?.is_checked === "1" || d?.is_checked === 1)) return true;
  // Fallback: a yes/no question about texts in field_data.
  const fd: Array<{ name: string; values: string[] }> = lead?.field_data || [];
  return fd.some((f) => /text|sms/i.test(f?.name || "") && /^(yes|true|1|i agree|agree)/i.test((f?.values?.[0] || "").toString().trim()));
}

export const META_LEAD_FIELDS = "id,created_time,ad_id,form_id,field_data,custom_disclaimer_responses";
