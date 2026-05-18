import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendWhatsAppTemplate, normalizePhone } from "@/lib/whatsapp";
import { isAdminPassword, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/debug?password=...&phone=...&template=pss_welcome
 *
 * Diagnostic endpoint. Runs three checks and returns the full result:
 *   1. Can we query the `leads` table?
 *   2. Can we query AND insert into `lead_activities`?
 *   3. Can we send a WhatsApp template to the provided phone?
 *
 * The WhatsApp test will actually send a message. Use a phone you own.
 */
export async function GET(req: NextRequest) {
  const password = req.nextUrl.searchParams.get("password");
  if (!isAdminPassword(password)) return unauthorized();

  const phone = req.nextUrl.searchParams.get("phone");
  const template = req.nextUrl.searchParams.get("template") || "pss_welcome";

  const supabase = getSupabaseAdmin();
  const out: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
  };

  // 1) leads table read
  try {
    const { count, error } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true });
    out.leads_table = error
      ? { ok: false, error: error.message }
      : { ok: true, count };
  } catch (e) {
    out.leads_table = { ok: false, error: String(e) };
  }

  // 2) lead_activities table — read + write
  try {
    const { error: readErr } = await supabase
      .from("lead_activities")
      .select("id", { count: "exact", head: true });

    if (readErr) {
      out.lead_activities_table = {
        ok: false,
        stage: "read",
        error: readErr.message,
        hint:
          readErr.message.includes("does not exist") ||
          readErr.code === "42P01"
            ? "Table doesn't exist — re-run the SQL in Supabase to create it."
            : null,
      };
    } else {
      // try a write — use a fake lead_id that won't violate FK if leads is empty
      // We'll fetch a real lead_id first.
      const { data: leads } = await supabase
        .from("leads")
        .select("id")
        .limit(1);
      const realLeadId = leads?.[0]?.id;
      if (!realLeadId) {
        out.lead_activities_table = {
          ok: true,
          stage: "read_ok",
          note: "No leads to test insert against — skipping write check.",
        };
      } else {
        const { error: writeErr } = await supabase
          .from("lead_activities")
          .insert({
            lead_id: realLeadId,
            channel: "system",
            kind: "debug_ping",
            detail: "Inserted by /api/debug",
            success: true,
          });
        out.lead_activities_table = writeErr
          ? { ok: false, stage: "write", error: writeErr.message }
          : { ok: true, stage: "write_ok" };
      }
    }
  } catch (e) {
    out.lead_activities_table = { ok: false, error: String(e) };
  }

  // 3) WhatsApp template send (only if ?phone= provided)
  if (phone) {
    const normalized = normalizePhone(phone);
    out.whatsapp_test = {
      input_phone: phone,
      normalized,
    };

    const result = await sendWhatsAppTemplate(phone, template, [
      "Test Parent",
      "Test Player",
      "Bliss Fields, Rehoboth MA",
      "9:00 AM",
    ]);

    (out.whatsapp_test as any).result = result;
  } else {
    out.whatsapp_test =
      "Skipped — pass ?phone=NUMBER to test a real send. E.g. ?phone=15085551234";
  }

  return NextResponse.json(out, { status: 200 });
}
