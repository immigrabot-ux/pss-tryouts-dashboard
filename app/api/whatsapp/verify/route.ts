import { NextRequest, NextResponse } from "next/server";
import { sendWhatsAppTemplate, normalizePhone } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function withCORS(res: NextResponse) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

export async function OPTIONS() {
  return withCORS(new NextResponse(null, { status: 204 }));
}

// In-memory rate limit — 1 send per phone per 60 seconds to prevent abuse.
// Survives within a single Vercel function instance; not perfect but blocks
// rapid retries on a single page.
const recentSends = new Map<string, number>();
const RATE_LIMIT_MS = 60_000;

/**
 * POST /api/whatsapp/verify
 *
 * Public, CORS-enabled. Fires the pss_welcome template to a phone number
 * BEFORE the parent submits the full form. Useful for verifying the number
 * is reachable on WhatsApp and giving the parent immediate feedback while
 * they're still on the form page.
 *
 * Body:
 *   {
 *     parent_name: "Sarah",      // shown in {{1}} of template
 *     player_name: "Lucas",      // shown in {{2}} of template
 *     parent_phone: "+1 508..."  // E.164 or US 10-digit
 *   }
 *
 * Returns: { ok: true, messageId } OR { ok: false, error }
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return withCORS(NextResponse.json({ error: "invalid_json" }, { status: 400 }));
  }

  const parent_name = str(body.parent_name) || "there";
  const player_name = str(body.player_name) || "your player";
  const parent_phone = str(body.parent_phone);

  if (!parent_phone) {
    return withCORS(
      NextResponse.json({ ok: false, error: "missing parent_phone" }, { status: 400 })
    );
  }

  const normalized = normalizePhone(parent_phone);
  if (!normalized || normalized.length < 10) {
    return withCORS(
      NextResponse.json(
        {
          ok: false,
          error: "phone_too_short",
          message: "Enter a full phone number with area code.",
        },
        { status: 400 }
      )
    );
  }

  // Rate limit
  const now = Date.now();
  const lastSent = recentSends.get(normalized) || 0;
  if (now - lastSent < RATE_LIMIT_MS) {
    const waitSec = Math.ceil((RATE_LIMIT_MS - (now - lastSent)) / 1000);
    return withCORS(
      NextResponse.json(
        {
          ok: false,
          error: "rate_limited",
          message: `Slow down — try again in ${waitSec}s.`,
        },
        { status: 429 }
      )
    );
  }
  recentSends.set(normalized, now);

  const result = await sendWhatsAppTemplate(parent_phone, "pss_welcome", [
    parent_name,
    player_name,
  ]);

  if (!result.ok) {
    console.warn("[verify] template send failed:", result.error);
    return withCORS(
      NextResponse.json(
        {
          ok: false,
          error: result.error,
          message:
            "We couldn't reach this number on WhatsApp. Double-check the number, or make sure it's a WhatsApp-enabled phone.",
        },
        { status: 200 }
      )
    );
  }

  return withCORS(
    NextResponse.json({
      ok: true,
      messageId: result.messageId,
      message: "WhatsApp sent! Check your phone in a few seconds.",
    })
  );
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
