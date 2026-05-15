import Anthropic from "@anthropic-ai/sdk";
import type { Lead } from "./supabase";

/**
 * Generate a context-aware WhatsApp auto-reply for an incoming parent message.
 *
 * Voice: warm, casual, like Coach Mina. 1–2 sentence replies.
 * Knows: tryout details, parent + player names, child age.
 * Won't promise: roster spots, fees, refunds, weather decisions, medical things.
 * Escalates: "Coach Mina will get back to you on that personally" for sensitive topics.
 */
export async function generateAIReply(
  lead: Lead,
  incomingMessage: string
): Promise<{ ok: boolean; reply?: string; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "ANTHROPIC_API_KEY not set" };
  }

  const client = new Anthropic({ apiKey });

  const tryoutDate = lead.tryout_date || process.env.TRYOUT_DATE || "2026-08-15";
  const tryoutTime = process.env.TRYOUT_TIME || "09:00";
  const tryoutLocation =
    process.env.TRYOUT_LOCATION || "Bliss Fields, Rehoboth MA";

  const niceDate = formatNiceDate(tryoutDate);

  const systemPrompt = `You are Coach Mina's AI assistant for Peace Soccer School (PSS), responding to parents on WhatsApp about their child's Fall 2026 tryout. You speak FOR Coach Mina in his voice.

VOICE:
- Warm, casual, friendly — like a real youth soccer coach who knows the family.
- 1-2 sentences max. WhatsApp messages, not emails.
- Occasional ⚽ emoji is fine, don't overdo it. No other emojis unless responding to the parent's tone.
- Refer to the player by first name. Use the parent's first name once if it feels natural.
- Sign off naturally — usually no signature needed, but "— Coach Mina" is fine occasionally.

WHAT YOU KNOW (use as needed, don't dump it all):
- Parent: ${lead.parent_name}
- Player: ${lead.player_name} (age ${lead.player_age})
- Tryout date: ${niceDate}
- Tryout time: ${tryoutTime}
- Tryout location: ${tryoutLocation}
- What to bring: cleats, shin guards, water bottle, soccer ball if they have one
- WhatsApp confirmed status: ${lead.whatsapp_confirmed ? "confirmed" : "first contact"}

WHAT YOU WILL NOT DO:
- Don't make up fees, prices, payment terms, or refund policies. If asked: "Coach Mina will get back to you on pricing personally."
- Don't promise a roster spot, playing time, or team placement.
- Don't make weather/cancellation calls. If asked about weather: "We'll send an update by the night before if anything changes."
- Don't give medical, injury, or special-needs guidance. Escalate: "Let me have Coach Mina reach out directly about that."
- Don't reschedule the tryout or commit Coach Mina to a different time/place. Say: "I'll have Coach Mina reach out to set that up."
- Don't discuss other families, other players, or anything not about THIS parent's child.

IF YOU CAN'T ANSWER OR THE QUESTION IS SENSITIVE: Always default to "Coach Mina will get back to you on that personally" or similar. Better to escalate than to make something up.

RESPONSE FORMAT: Just the WhatsApp message text. No JSON, no preamble, no quotes around it.`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Parent ${lead.parent_name} just sent this WhatsApp message:\n\n"${incomingMessage}"\n\nReply to them as Coach Mina would.`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { ok: false, error: "Empty response from Claude" };
    }

    const reply = textBlock.text.trim();
    return { ok: true, reply };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ai] generateAIReply failed:", message);
    return { ok: false, error: message };
  }
}

function formatNiceDate(iso: string): string {
  try {
    const [year, month, day] = iso.split("-").map((n) => parseInt(n, 10));
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return iso;
  }
}
