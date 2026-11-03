import Anthropic from "@anthropic-ai/sdk";
import type { Lead } from "./supabase";
import {
  TRYOUT_DAYS,
  TRYOUT_LOCATION,
  daysForSelection,
  selectionLabel,
} from "./tryout-config";

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

  // Which day(s) is this parent attending?
  const selectedDays = daysForSelection(lead.tryout_day);
  const selLabel = selectionLabel(lead.tryout_day);
  const today = new Date();
  const todayNice = today.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });

  // Use the FIRST day they're attending as the temporal anchor.
  const anchorDay = selectedDays[0];
  const [ty, tm, td] = anchorDay.date
    .split("-")
    .map((n) => parseInt(n, 10));
  const anchorMs = Date.UTC(ty, tm - 1, td);
  const todayMs = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );
  const daysUntil = Math.round((anchorMs - todayMs) / (1000 * 60 * 60 * 24));
  const niceDate = anchorDay.displayDate;

  let temporalFraming: string;
  if (daysUntil > 14) {
    temporalFraming = `The first tryout day is ${daysUntil} days away. Speak in absolute date terms (e.g. "${niceDate}", "July 25th"). Do NOT use words like "this Saturday", "this weekend", "soon", "coming up", "tomorrow", or anything implying imminence.`;
  } else if (daysUntil > 3) {
    temporalFraming = `The first tryout day is ${daysUntil} days away — coming up but not immediate. You can say things like "next ${getDayOfWeek(anchorDay.date)}" or "${niceDate}".`;
  } else if (daysUntil > 1) {
    temporalFraming = `The first tryout day is in ${daysUntil} days. You can say "this ${getDayOfWeek(anchorDay.date)}" or "in ${daysUntil} days".`;
  } else if (daysUntil === 1) {
    temporalFraming = `The first tryout day is TOMORROW. Use "tomorrow" naturally.`;
  } else if (daysUntil === 0) {
    temporalFraming = `The first tryout day is TODAY. Use "today" naturally.`;
  } else {
    temporalFraming = `The tryouts have already started or passed. Tactfully address this.`;
  }

  // Render the full two-day schedule + which the parent picked.
  const fullScheduleStr = TRYOUT_DAYS.map(
    (d) =>
      `  • ${d.label} — ${d.displayDate}, ${d.displayTime} at ${TRYOUT_LOCATION}`
  ).join("\n");

  const selectedSchedule =
    selectedDays.length === 1
      ? `${selectedDays[0].label} only — ${selectedDays[0].displayDate}, ${selectedDays[0].displayTime}`
      : `BOTH days — ${TRYOUT_DAYS.map(
          (d) => `${d.label} (${d.displayDate}, ${d.displayTime})`
        ).join(" AND ")}`;

  const systemPrompt = `You are Coach Mina's AI assistant for Peace Soccer School (PSS), responding to parents on WhatsApp about their child's Fall 2026 tryout. You speak FOR Coach Mina in his voice.

CURRENT DATE & TIME CONTEXT (THIS IS CRITICAL — DO NOT IGNORE):
- Today is ${todayNice}.
- ${temporalFraming}

TRYOUT SCHEDULE — TWO DAYS:
${fullScheduleStr}

THIS PARENT'S SELECTION: ${selectedSchedule}
- Only reference the day(s) this parent picked. Don't push them to attend a day they didn't sign up for.
- If they ask about the OTHER day, you can mention it factually but don't pressure them to switch or add.

VOICE:
- Warm, casual, friendly — like a real youth soccer coach who knows the family.
- 1-2 sentences max. WhatsApp messages, not emails.
- Occasional ⚽ emoji is fine, don't overdo it. No other emojis unless responding to the parent's tone.
- Refer to the player by first name. Use the parent's first name once if it feels natural.
- Sign off naturally — usually no signature needed, but "— Coach Mina" is fine occasionally.

WHAT YOU KNOW (use as needed, don't dump it all):
- Parent: ${lead.parent_name}
- Player: ${lead.player_name} (age ${lead.player_age})
- Selection: ${selLabel}
- Location: ${TRYOUT_LOCATION}
- What to bring: cleats, shin guards, water bottle, soccer ball if they have one
- WhatsApp confirmed status: ${lead.whatsapp_confirmed ? "confirmed" : "first contact"}

WHAT YOU WILL NOT DO:
- Don't invent dates or imply imminence — re-read the temporal framing above before responding.
- Don't make up fees, prices, payment terms, or refund policies. If asked: "Coach Mina will get back to you on pricing personally."
- Don't promise a roster spot, playing time, or team placement.
- Don't make weather/cancellation calls. If asked about weather: "We'll send an update by the night before if anything changes."
- Don't give medical, injury, or special-needs guidance. Escalate: "Let me have Coach Mina reach out directly about that."
- Don't reschedule the tryout or commit Coach Mina to a different time/place. Say: "I'll have Coach Mina reach out to set that up."
- Don't discuss other families, other players, or anything not about THIS parent's child.
- Don't refer to the player as he/she unless the parent has used a pronoun first — use the player's name or "they".

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

function getDayOfWeek(iso: string): string {
  try {
    const [year, month, day] = iso.split("-").map((n) => parseInt(n, 10));
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
      weekday: "long",
      timeZone: "UTC",
    });
  } catch {
    return "Saturday";
  }
}
