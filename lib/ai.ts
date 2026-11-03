import Anthropic from "@anthropic-ai/sdk";
import type { Lead } from "./supabase";
import { getSupabaseAdmin } from "./supabase";
import { getPssBrain, pssClaude } from "./pss-brain";

/**
 * WhatsApp auto-reply. Uses the shared PSS brain (same facts + voice as the
 * Facebook/Instagram AI in the Command Center), plus this parent's details
 * and their recent WhatsApp conversation.
 *
 * The old Fall-2026-tryout prompt is kept in lib/ai.old-fall2026.ts.txt for reference.
 */
export async function generateAIReply(
  lead: Lead,
  incomingMessage: string
): Promise<{ ok: boolean; reply?: string; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY not set" };
  const client = new Anthropic({ apiKey });

  const brain = await getPssBrain();
  const { recent: history, lastOlder } = await loadHistory(lead.id);

  // A child name equal to the parent's name (or empty) is a form mistake — don't use it.
  const childName =
    lead.player_name && lead.player_name.trim().toLowerCase() !== (lead.parent_name || "").trim().toLowerCase()
      ? lead.player_name
      : null;

  const channel = `
THIS CONVERSATION: WhatsApp.
- Parent: ${lead.parent_name || "unknown"}
- Child: ${childName ? `${childName}${lead.player_age ? ` (age ${lead.player_age})` : ""}` : "not known yet (ask their child's name and age naturally)"}
- How they found us: ${lead.source === "meta_lead_ad" ? "a Facebook/Instagram ad form" : "the website form"}, ${new Date(lead.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "America/New_York" })}
${lastOlder ? `- Earlier history: this parent last messaged us on ${lastOlder}. That older conversation is NOT shown and may mention events that are now over. Treat this as a fresh conversation.` : ""}
- If they originally signed up for something that is now over (like the July 2026 Fall tryouts), only mention it if it helps, kindly, and point them to what's next.
- Never apologize for or "correct" earlier messages unless the parent brings them up.
- If our last message was the Winter registration announcement, they are probably replying to it: help them pick Winter and register, answer questions, and keep it short.
- Plain text only: this is a WhatsApp message, no markdown.

Reply with only the message text.`;

  const messages = [...history];
  // The webhook logs the inbound message before calling us; avoid sending it twice.
  const last = messages[messages.length - 1];
  if (!(last && last.role === "user" && last.content === incomingMessage)) {
    messages.push({ role: "user", content: incomingMessage });
  }

  try {
    const reply = await pssClaude(client, { system: brain.prompt + "\n" + channel, messages, max_tokens: 300 });
    if (!reply) return { ok: false, error: "Empty response from Claude" };
    return { ok: true, reply };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ai] generateAIReply failed:", message);
    return { ok: false, error: message };
  }
}

/** WhatsApp messages with this parent from the last 7 days (max 12), oldest first.
 *  Older messages are left out on purpose: they're usually about past events. */
async function loadHistory(
  leadId: string
): Promise<{ recent: { role: "user" | "assistant"; content: string }[]; lastOlder: string | null }> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb
      .from("lead_activities")
      .select("kind, detail, created_at")
      .eq("lead_id", leadId)
      .eq("channel", "whatsapp")
      .in("kind", ["inbound", "ai_reply", "manual_reply", "winter_open"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(12);
    const { data: older } = await sb
      .from("lead_activities")
      .select("created_at")
      .eq("lead_id", leadId)
      .eq("channel", "whatsapp")
      .in("kind", ["inbound", "ai_reply"])
      .lt("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1);
    const lastOlder = older?.[0]?.created_at
      ? new Date(older[0].created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" })
      : null;

    const rows = (data || []).reverse().filter((r: any) => r.detail).map((r: any) => ({ ...r, detail: String(r.detail).replace(/\s*phone:\d+$/, "") }));
    const out: { role: "user" | "assistant"; content: string }[] = [];
    for (const r of rows as any[]) {
      const role = r.kind === "inbound" ? "user" : "assistant";
      const prev = out[out.length - 1];
      if (prev && prev.role === role) prev.content += "\n" + r.detail;
      else out.push({ role, content: r.detail });
    }
    // Claude needs to start with the parent. If we messaged first (e.g. the Winter announcement), keep it as context.
    if (out.length && out[0].role === "assistant") out.unshift({ role: "user", content: "(We messaged this parent first. Their reply follows.)" });
    return { recent: out, lastOlder };
  } catch {
    return { recent: [], lastOlder: null };
  }
}
