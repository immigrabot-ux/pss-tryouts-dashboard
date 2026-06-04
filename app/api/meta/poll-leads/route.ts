import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendWelcomeEmail, sendAdminNotification } from "@/lib/email";
import { sendWhatsAppTemplate, WELCOME_TEMPLATE_NAME } from "@/lib/whatsapp";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Allow up to 60 seconds for polling large batches

/**
 * GET /api/meta/poll-leads
 *
 * Polls Meta's Graph API for new leads from the configured Lead Form.
 * This endpoint is triggered by Vercel Cron every 5 minutes, or can be
 * called manually for backfilling.
 *
 * Flow:
 * 1. Fetch leads from Graph API (with pagination)
 * 2. For each lead, check if meta_leadgen_id already exists in DB
 * 3. If new, parse field_data and insert lead with source='meta_lead_ad'
 * 4. Send welcome email + WhatsApp + admin notification
 * 5. Log activity
 *
 * Returns: { ok: true, newLeads: number, skipped: number, errors: string[] }
 */
export async function GET(req: NextRequest) {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const formId = process.env.META_FORM_ID;

  if (!accessToken) {
    return NextResponse.json(
      { ok: false, error: "META_ACCESS_TOKEN not configured" },
      { status: 500 }
    );
  }

  if (!formId) {
    return NextResponse.json(
      { ok: false, error: "META_FORM_ID not configured" },
      { status: 500 }
    );
  }

  const supabase = getSupabaseAdmin();
  let newLeads = 0;
  let skipped = 0;
  const errors: string[] = [];

  try {
    // Fetch all leads from Meta (handle pagination)
    const allLeads: any[] = [];
    let nextUrl: string | null = `https://graph.facebook.com/v18.0/${encodeURIComponent(
      formId
    )}/leads?access_token=${encodeURIComponent(accessToken)}`;

    while (nextUrl) {
      const res: Response = await fetch(nextUrl);
      const data = await res.json();

      if (!res.ok) {
        console.error("[meta-poll] Graph API error:", data.error);
        errors.push(
          `Graph API error: ${data.error?.message || res.statusText}`
        );
        break;
      }

      const leads = data.data || [];
      allLeads.push(...leads);

      // Check for pagination
      nextUrl = data.paging?.next || null;

      // Safety limit — if we have 1000+ leads in one poll, stop
      if (allLeads.length >= 1000) {
        console.warn(
          "[meta-poll] Hit 1000 lead limit in single poll, stopping pagination"
        );
        break;
      }
    }

    console.log(`[meta-poll] Fetched ${allLeads.length} leads from Meta`);

    // Process each lead
    for (const metaLead of allLeads) {
      const leadgenId = metaLead.id;
      if (!leadgenId) {
        errors.push("Lead missing id — skipping");
        continue;
      }

      // Check if we've already processed this lead
      const { data: existing } = await supabase
        .from("leads")
        .select("id")
        .eq("meta_leadgen_id", leadgenId)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue; // Already in DB
      }

      // Parse field_data array from Meta
      const fieldData: Array<{ name: string; values: string[] }> =
        metaLead.field_data || [];

      // DEBUG: Log raw field data to see exact field names from Meta
      console.log(`[meta-poll] Lead ${leadgenId} field_data:`, JSON.stringify(fieldData));

      const fields = new Map<string, string>();
      for (const f of fieldData) {
        if (!f?.name || !Array.isArray(f.values)) continue;
        const value = (f.values[0] || "").toString().trim();
        // Normalize field name: lowercase, strip apostrophes and underscores
        const normalizedName = f.name.toLowerCase().replace(/['_]/g, "");
        fields.set(normalizedName, value);
      }

      // Map Meta fields to our lead schema
      const parent_name = pick(fields, [
        "fullname",
        "name",
        "firstnamelastname",
      ]);
      const parent_email = pick(fields, ["email", "emailaddress"]);
      const parent_phone = pick(fields, [
        "whatsappnumber",
        "phonenumber",
        "phone",
      ]);
      const player_name = pick(fields, [
        "childsfullname",
        "childfullname",
        "playername",
        "childname",
      ]);
      const player_age_raw = pick(fields, [
        "childsage",
        "childage",
        "childsage",
        "playerage",
        "agegroup",
        "age",
      ]);

      // Skip if we don't have at minimum an email or phone
      if (!parent_email && !parent_phone) {
        errors.push(
          `Lead ${leadgenId} has no email or phone — skipping`
        );
        continue;
      }

      // Parse age - extract numeric value for player_age, keep raw text for age_group
      const { player_age, age_group } = parseAge(player_age_raw);

      console.log(`[meta-poll] Lead ${leadgenId} age mapping: raw="${player_age_raw}" → player_age=${player_age}, age_group="${age_group}"`);

      // Build insert row
      const insertRow: Record<string, unknown> = {
        parent_name: parent_name || "(unknown)",
        player_name: player_name || "(unknown)",
        player_age: player_age || 0, // Numeric age for sorting/filtering
        parent_phone: parent_phone || "",
        parent_email: parent_email || "",
        whatsapp_opt_in: true, // Lead Ads opt-in is implicit
        whatsapp_confirmed: false,
        status: "new",
        tryout_date: "2026-07-25", // anchor to Day 1
        tryout_day: "both", // default
        source: "meta_lead_ad",
        meta_leadgen_id: leadgenId,
        notes: `Source: Meta Lead Ad (polling) · leadgen_id=${leadgenId} · form_id=${formId} · created_time=${metaLead.created_time || ""}`,
      };
      // Store the raw age range text (e.g. "6-8 years old") in age_group
      if (age_group) insertRow.age_group = age_group;

      // Insert lead
      const { data: lead, error: insertError } = await supabase
        .from("leads")
        .insert(insertRow)
        .select()
        .single();

      if (insertError || !lead) {
        console.error(
          `[meta-poll] Failed to insert lead ${leadgenId}:`,
          insertError?.message
        );
        errors.push(
          `Insert failed for ${leadgenId}: ${insertError?.message || "unknown"}`
        );
        continue;
      }

      console.log(`[meta-poll] Inserted new lead ${lead.id} from ${leadgenId}`);
      newLeads++;

      // Fire welcome flow (email + admin notif + WhatsApp)
      // Run in parallel but don't block the poll response
      Promise.all([
        sendWelcomeEmail(lead),
        sendAdminNotification(lead),
        lead.whatsapp_opt_in
          ? sendWhatsAppTemplate(lead.parent_phone, WELCOME_TEMPLATE_NAME, [
              lead.parent_name,
              lead.player_name,
            ])
          : Promise.resolve({ ok: true }),
      ]).then(async ([emailResult, adminResult, waResult]) => {
        // Log activities
        await Promise.all([
          logActivity(
            lead.id,
            "system",
            "meta_lead_ad_poll",
            `leadgen_id=${leadgenId} form_id=${formId}`,
            true
          ),
          logActivity(
            lead.id,
            "email",
            "welcome",
            emailResult.ok ? null : emailResult.error || "unknown error",
            emailResult.ok
          ),
          logActivity(
            lead.id,
            "email",
            "admin_notification",
            adminResult.ok ? null : adminResult.error || "unknown error",
            adminResult.ok
          ),
          lead.whatsapp_opt_in
            ? logActivity(
                lead.id,
                "whatsapp",
                "welcome",
                waResult.ok ? null : (waResult as any).error || "unknown error",
                waResult.ok
              )
            : Promise.resolve(),
        ]);

        // Persist WhatsApp send status
        if (lead.whatsapp_opt_in) {
          await supabase
            .from("leads")
            .update({
              whatsapp_send_status: waResult.ok ? "sent" : "failed",
              whatsapp_send_error: waResult.ok
                ? null
                : (waResult as any).error || "unknown error",
            })
            .eq("id", lead.id);
        }
      });
    }

    return NextResponse.json({
      ok: true,
      newLeads,
      skipped,
      total: allLeads.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error("[meta-poll] Unexpected error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
        newLeads,
        skipped,
      },
      { status: 500 }
    );
  }
}

// ─── helpers ───────────────────────────────────────────────────────────────

function pick(fields: Map<string, string>, names: string[]): string {
  for (const n of names) {
    const v = fields.get(n.toLowerCase());
    if (v) return v;
  }
  return "";
}

function parseAge(raw: string): { player_age: number; age_group: string | null } {
  if (!raw) return { player_age: 0, age_group: null };
  const trimmed = raw.trim();
  // U-group label, e.g. "U10 (9-10 yrs)" / "U-12"
  const u = trimmed.match(/u\s*-?\s*(\d{1,2})/i);
  if (u) return { player_age: parseInt(u[1], 10), age_group: trimmed };
  // First number found
  const n = trimmed.match(/\d{1,2}/);
  if (n) return { player_age: parseInt(n[0], 10), age_group: trimmed };
  return { player_age: 0, age_group: trimmed };
}
