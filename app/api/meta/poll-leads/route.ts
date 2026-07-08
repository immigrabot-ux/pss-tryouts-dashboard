import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendWelcomeEmail, sendAdminNotification } from "@/lib/email";
import { sendWhatsAppTemplate, WELCOME_TEMPLATE_NAME } from "@/lib/whatsapp";
import { logActivity } from "@/lib/activity";
import {
  claimWelcomeEmail,
  claimWelcomeWhatsApp,
} from "@/lib/idempotency";

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
  const pageId = process.env.META_PAGE_ID;
  // Accept EITHER:
  //   - META_FORM_ID (single id)         e.g. "1030153356473226"
  //   - META_FORM_IDS (comma-separated)  e.g. "1030153356473226,9876543210"
  const formIdEnvSingle = process.env.META_FORM_ID || "";
  const formIdEnvList = process.env.META_FORM_IDS || "";
  const envFormIds = Array.from(
    new Set(
      [...formIdEnvSingle.split(","), ...formIdEnvList.split(",")]
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );

  if (!accessToken) {
    return NextResponse.json(
      { ok: false, error: "META_ACCESS_TOKEN not configured" },
      { status: 500 }
    );
  }

  if (!pageId && envFormIds.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Configure META_PAGE_ID (auto-polls all forms on the page) or META_FORM_IDS (comma-separated list).",
      },
      { status: 500 }
    );
  }

  const supabase = getSupabaseAdmin();
  let newLeads = 0;
  let skipped = 0;
  const errors: string[] = [];
  const formsPolled: { id: string; name: string; leadCount: number }[] = [];

  try {
    // Step A — figure out which forms to poll.
    //
    // Preference order:
    //   1. META_PAGE_ID is set → list all forms on that page.
    //   2. META_FORM_ID is set → ask Meta which page owns that form,
    //      then list all forms on that page (auto-discovery, no env change needed).
    //   3. Fall back to just the single META_FORM_ID if discovery fails.
    const formsToPoll: { id: string; name: string }[] = [];
    let effectivePageId: string | null = pageId || null;

    // Auto-derive the page ID from the first configured form if not provided.
    if (!effectivePageId && envFormIds.length > 0) {
      try {
        const formMetaUrl = `https://graph.facebook.com/v18.0/${encodeURIComponent(
          envFormIds[0]
        )}?fields=page&access_token=${encodeURIComponent(accessToken)}`;
        const res = await fetch(formMetaUrl);
        const data = await res.json();
        if (res.ok && data?.page?.id) {
          effectivePageId = data.page.id;
          console.log(
            `[meta-poll] Auto-derived page ID ${effectivePageId} from form ${envFormIds[0]}`
          );
        } else {
          console.warn(
            "[meta-poll] Could not derive page from form:",
            data?.error?.message || res.statusText
          );
        }
      } catch (err) {
        console.warn("[meta-poll] Form→page lookup failed:", err);
      }
    }

    if (effectivePageId) {
      let nextFormsUrl: string | null = `https://graph.facebook.com/v18.0/${encodeURIComponent(
        effectivePageId
      )}/leadgen_forms?fields=id,name,status&access_token=${encodeURIComponent(
        accessToken
      )}`;
      while (nextFormsUrl) {
        const res: Response = await fetch(nextFormsUrl);
        const data = await res.json();
        if (!res.ok) {
          errors.push(
            `Page forms fetch failed: ${data.error?.message || res.statusText}`
          );
          break;
        }
        for (const f of data.data || []) {
          if (!f.status || f.status === "ACTIVE") {
            formsToPoll.push({ id: f.id, name: f.name || "(unnamed)" });
          }
        }
        nextFormsUrl = data.paging?.next || null;
      }
    }

    // Last-resort fallback: if page discovery failed (or returned an incomplete
    // list — common when the access token isn't a Page token), make sure every
    // env-configured form ID still gets polled.
    const alreadyPolling = new Set(formsToPoll.map((f) => f.id));
    for (const fid of envFormIds) {
      if (!alreadyPolling.has(fid)) {
        formsToPoll.push({ id: fid, name: "(env-configured)" });
      }
    }

    console.log(
      `[meta-poll] Discovered ${formsToPoll.length} form(s) to poll (page=${effectivePageId || "n/a"})`
    );

    // Step B — fetch leads from each form (paginated, capped per form).
    const allLeads: any[] = [];
    for (const form of formsToPoll) {
      let formLeadCount = 0;
      let nextUrl: string | null = `https://graph.facebook.com/v18.0/${encodeURIComponent(
        form.id
      )}/leads?access_token=${encodeURIComponent(accessToken)}`;
      while (nextUrl) {
        const res: Response = await fetch(nextUrl);
        const data = await res.json();
        if (!res.ok) {
          errors.push(
            `Form ${form.id} (${form.name}) fetch failed: ${
              data.error?.message || res.statusText
            }`
          );
          break;
        }
        const leads = (data.data || []).map((l: any) => ({
          ...l,
          _formId: form.id,
          _formName: form.name,
        }));
        allLeads.push(...leads);
        formLeadCount += leads.length;
        nextUrl = data.paging?.next || null;

        // Per-form safety cap so one big form doesn't starve the cron budget.
        if (formLeadCount >= 200) {
          console.warn(
            `[meta-poll] form ${form.id} hit 200-lead per-poll cap`
          );
          break;
        }
      }
      formsPolled.push({
        id: form.id,
        name: form.name,
        leadCount: formLeadCount,
      });
    }

    console.log(
      `[meta-poll] Fetched ${allLeads.length} leads across ${formsToPoll.length} form(s)`
    );

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

      // Pull form metadata that we attached in step B.
      const formId = metaLead._formId || "(unknown)";
      const formName = metaLead._formName || "";

      // Build insert row
      const insertRow: Record<string, unknown> = {
        parent_name: parent_name || "(unknown)",
        player_name: player_name || "(unknown)",
        player_age: player_age || 0,
        parent_phone: parent_phone || "",
        parent_email: parent_email || "",
        whatsapp_opt_in: true,
        whatsapp_confirmed: false,
        status: "new",
        tryout_date: "2026-07-25",
        tryout_day: "both",
        source: "meta_lead_ad",
        meta_leadgen_id: leadgenId,
        notes: `Source: Meta Lead Ad${
          formName ? ` "${formName}"` : ""
        } (polling) · leadgen_id=${leadgenId} · form_id=${formId} · created_time=${
          metaLead.created_time || ""
        }`,
      };
      if (age_group) insertRow.age_group = age_group;

      // Insert lead — gracefully handle the case where another invocation
      // (or the webhook) inserted this same leadgen_id between our
      // dedupe-check and now.
      const { data: lead, error: insertError } = await supabase
        .from("leads")
        .insert(insertRow)
        .select()
        .single();

      if (insertError || !lead) {
        const msg = insertError?.message || "";
        if (/duplicate key/i.test(msg) || /unique constraint/i.test(msg)) {
          // Race condition — another path inserted it. Treat as skipped.
          skipped++;
          continue;
        }
        console.error(
          `[meta-poll] Failed to insert lead ${leadgenId}:`,
          msg
        );
        errors.push(`Insert failed for ${leadgenId}: ${msg || "unknown"}`);
        continue;
      }

      console.log(`[meta-poll] Inserted new lead ${lead.id} from ${leadgenId}`);
      newLeads++;

      // IDEMPOTENCY — claim the welcome-email and welcome-whatsapp slots
      // atomically before sending. If either is already claimed (another
      // poll run, the webhook, or a manual send) we skip and log.
      const [emailClaimed, waClaimed] = await Promise.all([
        claimWelcomeEmail(lead.id),
        lead.whatsapp_opt_in
          ? claimWelcomeWhatsApp(lead.id)
          : Promise.resolve(false),
      ]);

      // Vercel kills serverless functions the moment the response is sent,
      // so we must AWAIT all side effects here (no fire-and-forget).
      const [emailResult, adminResult, waResult] = await Promise.all([
        emailClaimed
          ? sendWelcomeEmail(lead)
          : Promise.resolve({ ok: true, skipped: true } as {
              ok: boolean;
              error?: string;
              skipped?: boolean;
            }),
        sendAdminNotification(lead),
        waClaimed
          ? sendWhatsAppTemplate(lead.parent_phone, WELCOME_TEMPLATE_NAME, [
              lead.parent_name,
              lead.player_name,
            ])
          : Promise.resolve({ ok: true, skipped: true } as {
              ok: boolean;
              error?: string;
              skipped?: boolean;
            }),
      ]);

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
          emailClaimed ? "welcome" : "welcome_skipped_already_sent",
          emailClaimed
            ? emailResult.ok
              ? null
              : emailResult.error || "unknown error"
            : null,
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
              waClaimed ? "welcome" : "welcome_skipped_already_sent",
              waClaimed
                ? waResult.ok
                  ? null
                  : (waResult as any).error || "unknown error"
                : null,
              waResult.ok
            )
          : Promise.resolve(),
      ]);

      // Persist WhatsApp send status only when WE actually sent it. If we
      // skipped (already sent earlier), leave the existing status alone.
      if (waClaimed && lead.whatsapp_opt_in) {
        const updateData: Record<string, any> = {
          whatsapp_send_status: waResult.ok ? "sent" : "failed",
          whatsapp_send_error: waResult.ok
            ? null
            : (waResult as any).error || "unknown error",
        };

        // If welcome send succeeded, initialize nurture sequence
        if (waResult.ok) {
          updateData.nurture_stage = "welcomed";
          updateData.last_nurture_sent_at = new Date().toISOString();
        }

        await supabase
          .from("leads")
          .update(updateData)
          .eq("id", lead.id);
      }

      console.log(
        `[meta-poll] lead ${lead.id} processed — emailSent:${emailClaimed} waSent:${waClaimed} admin:${adminResult.ok}`
      );
    }

    return NextResponse.json({
      ok: true,
      formsPolled,
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
