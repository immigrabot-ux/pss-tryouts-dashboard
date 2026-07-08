import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client using the service role key.
 * NEVER import this from a Client Component.
 */
let _serverClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (_serverClient) return _serverClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  _serverClient = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return _serverClient;
}

/**
 * Public anon client — usable from the browser. Reads are gated by RLS.
 * We mostly use service-role on the server, but this is here for completeness.
 */
export function getSupabaseAnon(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Shared type — mirrors the `leads` table in Supabase.
export type Lead = {
  id: string;
  created_at: string;
  parent_name: string;
  player_name: string;
  player_age: number;
  parent_phone: string;
  parent_email: string;
  whatsapp_opt_in: boolean;
  whatsapp_confirmed: boolean;
  whatsapp_confirmed_at?: string | null;
  status: string;
  tryout_date: string | null;
  /** Which day(s) the parent selected: "day1" | "day2" | "both". */
  tryout_day?: "day1" | "day2" | "both" | string | null;
  /** Original age-group label, e.g. "U10 (9-10 yrs)". Numeric age is in player_age. */
  age_group?: string | null;
  /** Delivery status of the welcome WhatsApp template. */
  whatsapp_send_status?: "sent" | "failed" | "confirmed" | string | null;
  /** Last Meta error message if the send failed. */
  whatsapp_send_error?: string | null;
  /** Lead source: "website", "meta_lead_ad", etc. */
  source?: string | null;
  /** Meta Lead Ads leadgen_id for deduplication during polling */
  meta_leadgen_id?: string | null;
  /**
   * Idempotency guard for welcome email. Present = already sent, NEVER resend.
   * Set via the atomic helper claimWelcomeEmail() in lib/idempotency.ts.
   */
  welcome_email_sent_at?: string | null;
  /**
   * Idempotency guard for welcome WhatsApp. Present = already sent, NEVER resend.
   * Set via the atomic helper claimWelcomeWhatsApp() in lib/idempotency.ts.
   */
  welcome_whatsapp_sent_at?: string | null;
  /**
   * When we last *nudged* this lead (re-sent the welcome to a non-replier).
   * Used by the "Nudge unconfirmed" button to enforce a cooldown — we never
   * nudge the same lead twice within the cooldown window.
   */
  last_nudged_at?: string | null;
  /** How many times we've nudged this lead so far. Caps prevent spam. */
  nudge_count?: number | null;
  /**
   * When we last sent a reminder WhatsApp (using pss_reminder template).
   * Used to enforce a 24-hour guard against duplicate reminder sends.
   */
  last_reminder_sent_at?: string | null;
  /**
   * Soft-delete flag. Hidden leads stay in the DB (so the cron's
   * meta_leadgen_id dedup still recognizes them and DOESN'T re-process),
   * but they're filtered out of the admin dashboard by default.
   */
  hidden?: boolean | null;
  /** Why the lead was hidden — e.g. "test_lead", "duplicate", "invalid_phone". */
  hidden_reason?: string | null;
  notes: string | null;
};

export type LeadActivity = {
  id: string;
  lead_id: string;
  created_at: string;
  channel: "email" | "whatsapp" | "system";
  kind: string;
  detail: string | null;
  success: boolean;
};
