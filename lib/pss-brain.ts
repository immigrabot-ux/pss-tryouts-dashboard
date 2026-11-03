/**
 * Shared PSS AI brain client. The SAME file lives in pss-tryouts-system (WhatsApp AI)
 * and pss-command-center (Facebook/Instagram AI), so both AIs know the same facts
 * and talk the same way.
 *
 * The brain itself is written on the website: peace-soccer-school/src/lib/site/ai-brain.ts
 * and served at https://www.peacesoccerschool.com/api/ai-brain
 */
import Anthropic from "@anthropic-ai/sdk";

const BRAIN_URL = process.env.PSS_BRAIN_URL || "https://www.peacesoccerschool.com/api/ai-brain";
const CACHE_MS = 5 * 60 * 1000;

/** One model for every PSS AI. Override with PSS_AI_MODEL if needed. */
export const PSS_AI_MODEL = process.env.PSS_AI_MODEL || "claude-sonnet-5-5";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";

const OFFLINE_BRAIN = `You are the assistant for Peace Soccer School (PSS), a Christian competitive youth soccer club for boys and girls ages 5–13 in Rehoboth, MA, replying to parents for Coach Mina. Be warm, casual and short (1–3 sentences), reply in the parent's language. Winter indoor training (Dec–Jan, Teamworks Seekonk) and Spring 2027 are coming up; registration details are on https://www.peacesoccerschool.com. Never invent dates, prices or policies: if you aren't sure, say Coach Mina will get back to them personally.`;

let cached: { prompt: string; version: string; at: number } | null = null;

export async function getPssBrain(): Promise<{ prompt: string; version: string }> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(BRAIN_URL, { cache: "no-store", signal: ctrl.signal });
    clearTimeout(t);
    const j = await res.json();
    if (res.ok && typeof j?.prompt === "string" && j.prompt.length > 200) {
      cached = { prompt: j.prompt, version: String(j.version || "?"), at: Date.now() };
      return cached;
    }
    console.warn("[pss-brain] bad response", res.status);
  } catch (err) {
    console.warn("[pss-brain] fetch failed:", err instanceof Error ? err.message : err);
  }
  // Use the last good brain if we have one, otherwise a safe minimal one.
  return cached ?? { prompt: OFFLINE_BRAIN, version: "offline" };
}

/** Calls Claude with the shared model. Falls back to an older model if the new one
 *  isn't available or returns no text. Never returns an empty string silently. */
export async function pssClaude(
  client: Anthropic,
  args: { system: string; messages: { role: "user" | "assistant"; content: string }[]; max_tokens?: number }
): Promise<string> {
  // Newer models may spend tokens reasoning before they answer, so leave plenty of room.
  const maxTokens = Math.max(args.max_tokens ?? 0, 2000);
  const run = async (model: string) => {
    const res: any = await client.messages.create({ model, max_tokens: maxTokens, system: args.system, messages: args.messages });
    const text = (res.content || [])
      .map((b: any) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    if (!text) console.warn(`[pss-brain] ${model} returned no text (stop_reason=${res.stop_reason}, blocks=${(res.content || []).map((b: any) => b.type).join(",")})`);
    return text;
  };
  let text = "";
  try {
    text = await run(PSS_AI_MODEL);
  } catch (err: any) {
    console.warn(`[pss-brain] ${PSS_AI_MODEL} failed (${err?.status ?? "?"}): ${String(err?.message ?? err).slice(0, 200)}`);
  }
  if (!text && PSS_AI_MODEL !== FALLBACK_MODEL) {
    text = await run(FALLBACK_MODEL);
  }
  return text;
}
