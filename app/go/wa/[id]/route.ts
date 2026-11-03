import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { WINTER_WHATSAPP_URL } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tracked WhatsApp-group link used in Winter emails: records the tap, then opens the group. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id;
  const ua = req.headers.get("user-agent") || "";
  const isBot = /bot|crawl|spider|preview|facebookexternalhit|googleimageproxy|proofpoint|mimecast|barracuda|safelinks/i.test(ua);
  if (!isBot && /^[0-9a-f-]{36}$/i.test(id)) {
    try {
      const db = getSupabaseAdmin();
      const { data } = await db.from("winter_2026_registrations").select("guardian1_email, whatsapp_link_clicked_at").eq("id", id).maybeSingle();
      if (data) {
        const now = new Date().toISOString();
        // Credit every sibling row of this family (same parent email).
        const { data: fam } = await db.from("winter_2026_registrations").select("id, whatsapp_link_clicks, whatsapp_link_clicked_at").ilike("guardian1_email", data.guardian1_email || "__none__");
        for (const r of fam && fam.length ? fam : [{ id, whatsapp_link_clicks: 0, whatsapp_link_clicked_at: null }]) {
          await db.from("winter_2026_registrations").update({
            whatsapp_link_clicks: (r.whatsapp_link_clicks || 0) + 1,
            whatsapp_link_clicked_at: r.whatsapp_link_clicked_at || now,
          }).eq("id", r.id);
        }
      }
    } catch { /* never block the redirect */ }
  }
  return NextResponse.redirect(WINTER_WHATSAPP_URL, 302);
}
