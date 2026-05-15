import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendWelcomeEmail } from "@/lib/email";
import { sendWhatsAppTemplate } from "@/lib/whatsapp";
import { logActivity } from "@/lib/activity";
import { isAdminPassword, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads/:id/send
 * Body: { action: "welcome_email" | "welcome_whatsapp" | "reminder_whatsapp" }
 *
 * Fires a manual send from the lead detail page.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const password =
    req.headers.get("x-admin-password") ||
    req.nextUrl.searchParams.get("password");
  if (!isAdminPassword(password)) return unauthorized();

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const action = body.action;
  if (!action) {
    return NextResponse.json({ error: "missing_action" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: lead, error } = await supabase
    .from("leads")
    .select("*")
    .eq("id", params.id)
    .single();

  if (error || !lead) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (action === "welcome_email") {
    const r = await sendWelcomeEmail(lead);
    await logActivity(lead.id, "email", "welcome_manual", r.error || null, r.ok);
    return NextResponse.json(r);
  }

  if (action === "welcome_whatsapp") {
    const r = await sendWhatsAppTemplate(
      lead.parent_phone,
      "pss_welcome",
      [lead.parent_name, lead.player_name]
    );
    await logActivity(
      lead.id,
      "whatsapp",
      "welcome_manual",
      r.error || null,
      r.ok
    );
    return NextResponse.json(r);
  }

  if (action === "reminder_whatsapp") {
    const r = await sendWhatsAppTemplate(
      lead.parent_phone,
      "pss_reminder",
      [
        lead.parent_name,
        lead.player_name,
        process.env.TRYOUT_LOCATION || "Bliss Fields, Rehoboth MA",
      ]
    );
    await logActivity(
      lead.id,
      "whatsapp",
      "reminder_manual",
      r.error || null,
      r.ok
    );
    return NextResponse.json(r);
  }

  return NextResponse.json({ error: "unknown_action", action }, { status: 400 });
}
