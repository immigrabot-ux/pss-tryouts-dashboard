import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  sendWhatsAppTemplate,
  sendWhatsAppText,
  normalizePhone,
} from "@/lib/whatsapp";
import { logActivity } from "@/lib/activity";
import { generateAIReply } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/whatsapp/webhook — Meta webhook verification handshake.
 * Meta sends ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  const expected = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && token && expected && token === expected) {
    console.log("[whatsapp] webhook verified");
    return new NextResponse(challenge || "ok", { status: 200 });
  }

  console.warn("[whatsapp] webhook verification failed", { mode, tokenSet: !!token });
  return new NextResponse("forbidden", { status: 403 });
}

/**
 * POST /api/whatsapp/webhook — incoming events from Meta.
 *
 * When a parent replies to a marketing template, we mark their lead row as
 * confirmed and fire back the welcome WhatsApp template.
 */
export async function POST(req: NextRequest) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: true }); // ack even on bad JSON
  }

  // Always 200 quickly — Meta will retry otherwise.
  try {
    await handleEvent(payload);
  } catch (err) {
    console.error("[whatsapp] handleEvent error:", err);
  }

  return NextResponse.json({ ok: true });
}

async function handleEvent(payload: unknown) {
  // Shape: { entry: [{ changes: [{ value: { messages: [...], contacts: [...] } }] }] }
  const entries = (payload as any)?.entry || [];
  for (const entry of entries) {
    const changes = entry.changes || [];
    for (const change of changes) {
      const value = change.value || {};
      const messages: any[] = value.messages || [];

      for (const msg of messages) {
        const fromRaw: string = msg.from || "";
        const from = normalizePhone(fromRaw);
        if (!from) continue;

        const textBody: string =
          msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title || "";

        console.log(`[whatsapp] inbound from ${from}: ${textBody}`);

        await handleInbound(from, textBody);
      }
    }
  }
}

/**
 * Handle an inbound WhatsApp message:
 *   1. Match the sender to a lead by phone (last 10 digits)
 *   2. If they're a first-time replier, mark them as whatsapp_confirmed
 *   3. Always log the inbound message
 *   4. If AI auto-reply is enabled, generate a contextual reply via Claude
 *      and send it back as a free-form text (we're inside the 24h window)
 *   5. Log the outbound reply
 */
async function handleInbound(fromDigits: string, text: string) {
  const supabase = getSupabaseAdmin();

  // Match on the last 10 digits — tolerant of country code formatting.
  const last10 = fromDigits.slice(-10);

  const { data: candidates, error } = await supabase
    .from("leads")
    .select("*");

  if (error) {
    console.error("[whatsapp] lead lookup failed:", error.message);
    return;
  }

  let lead = (candidates || []).find((row: any) => {
    const digits = normalizePhone(row.parent_phone || "");
    return digits && digits.slice(-10) === last10;
  });

  if (!lead) {
    console.warn(`[whatsapp] no lead matched ${fromDigits}`);
    // No matching lead — we still try to reply politely so the parent isn't ignored.
    if (process.env.AI_AUTO_REPLY_ENABLED === "true") {
      await sendWhatsAppText(
        fromDigits,
        "Hi! Thanks for reaching out to Peace Soccer School. I don't have your tryout signup on file yet — could you reply with your child's name so Coach Mina can take a look? ⚽"
      );
    }
    return;
  }

  // First-time replier → confirm them.
  if (!lead.whatsapp_confirmed) {
    const { error: updErr } = await supabase
      .from("leads")
      .update({
        whatsapp_confirmed: true,
        whatsapp_confirmed_at: new Date().toISOString(),
        whatsapp_opt_in: true,
        whatsapp_send_status: "confirmed",
      })
      .eq("id", lead.id);

    if (updErr) {
      console.error("[whatsapp] confirm update failed:", updErr.message);
    } else {
      // Refetch so our in-memory copy has the updated confirmation flag.
      lead = { ...lead, whatsapp_confirmed: true };
      await logActivity(
        lead.id,
        "whatsapp",
        "confirmed",
        text || "(reply received)",
        true
      );
    }
  }

  // Log the inbound message itself.
  await logActivity(lead.id, "whatsapp", "inbound", text || null, true);

  // AI auto-reply — only if enabled and we have a real message to react to.
  if (process.env.AI_AUTO_REPLY_ENABLED !== "true") return;
  if (!text || text.trim().length === 0) return;

  const ai = await generateAIReply(lead, text);
  if (!ai.ok || !ai.reply) {
    await logActivity(
      lead.id,
      "whatsapp",
      "ai_reply_failed",
      ai.error || "no reply generated",
      false
    );
    return;
  }

  const sent = await sendWhatsAppText(lead.parent_phone, ai.reply);
  await logActivity(
    lead.id,
    "whatsapp",
    "ai_reply",
    sent.ok ? ai.reply : `${ai.reply}\n\n[send error: ${sent.error}]`,
    sent.ok
  );
}
