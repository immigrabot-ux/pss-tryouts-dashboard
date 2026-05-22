import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function withCORS(res: NextResponse) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

export async function OPTIONS() {
  return withCORS(new NextResponse(null, { status: 204 }));
}

/**
 * POST /api/analytics/event
 *
 * Public endpoint. peacesoccerschool.com posts visitor events here.
 *
 * Accepts EITHER:
 *   1. A single event object: { event_type, page_path, ... }
 *   2. An array of events:    [{event_type, ...}, {event_type, ...}]
 *   3. A wrapped batch:       { events: [...] }
 *
 * Each event needs at least `event_type`. Everything else is optional.
 * Unknown fields get stored in `properties` as JSON.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return withCORS(NextResponse.json({ error: "invalid_json" }, { status: 400 }));
  }

  // Normalize to an array of events
  let rawEvents: any[];
  if (Array.isArray(body)) {
    rawEvents = body;
  } else if (body && typeof body === "object" && Array.isArray((body as any).events)) {
    rawEvents = (body as any).events;
  } else if (body && typeof body === "object") {
    rawEvents = [body];
  } else {
    return withCORS(
      NextResponse.json({ error: "expected event object or array" }, { status: 400 })
    );
  }

  if (rawEvents.length === 0) {
    return withCORS(NextResponse.json({ ok: true, accepted: 0 }));
  }

  if (rawEvents.length > 100) {
    return withCORS(
      NextResponse.json(
        { error: "too many events in one request (max 100)" },
        { status: 413 }
      )
    );
  }

  // IP extraction — Vercel sets x-forwarded-for / x-real-ip
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;

  // Pull these from the incoming request as fallbacks
  const fallbackUA = req.headers.get("user-agent") || null;
  const fallbackReferrer = req.headers.get("referer") || null;

  const rows = rawEvents.map((e) => normalizeEvent(e, { ip, fallbackUA, fallbackReferrer }));

  // Filter out events with no event_type — they're invalid
  const validRows = rows.filter((r) => !!r.event_type);
  if (validRows.length === 0) {
    return withCORS(
      NextResponse.json(
        { error: "no_valid_events", message: "Every event needs event_type." },
        { status: 400 }
      )
    );
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("analytics_events").insert(validRows);

  if (error) {
    console.error("[/api/analytics/event] insert failed:", error.message);
    return withCORS(
      NextResponse.json(
        { error: "db_insert_failed", detail: error.message },
        { status: 500 }
      )
    );
  }

  return withCORS(
    NextResponse.json({ ok: true, accepted: validRows.length })
  );
}

// Map a raw incoming event to our column shape.
function normalizeEvent(
  e: any,
  ctx: { ip: string | null; fallbackUA: string | null; fallbackReferrer: string | null }
) {
  // Pull known fields off
  const known = {
    event_type: str(e.event_type || e.type || e.eventType || e.name),
    event_name: str(e.event_name || e.label || e.eventName),

    session_id: str(e.session_id || e.sessionId),
    visitor_id: str(e.visitor_id || e.visitorId || e.user_id || e.userId || e.anon_id || e.anonId),

    page_path: str(e.page_path || e.path || e.pathname),
    page_url: str(e.page_url || e.url || e.href),
    page_title: str(e.page_title || e.title),
    referrer: str(e.referrer || ctx.fallbackReferrer),

    utm_source: str(e.utm_source || e.utmSource),
    utm_medium: str(e.utm_medium || e.utmMedium),
    utm_campaign: str(e.utm_campaign || e.utmCampaign),
    utm_term: str(e.utm_term || e.utmTerm),
    utm_content: str(e.utm_content || e.utmContent),

    user_agent: str(e.user_agent || e.userAgent || ctx.fallbackUA),
    device_type: str(e.device_type || e.deviceType),
    country: str(e.country),
    region: str(e.region || e.state),
    city: str(e.city),
    ip: ctx.ip,
  };

  // Anything left over (not in our known column set) goes into `properties`.
  const knownKeys = new Set([
    "event_type", "type", "eventType", "name",
    "event_name", "label", "eventName",
    "session_id", "sessionId",
    "visitor_id", "visitorId", "user_id", "userId", "anon_id", "anonId",
    "page_path", "path", "pathname",
    "page_url", "url", "href",
    "page_title", "title",
    "referrer",
    "utm_source", "utmSource",
    "utm_medium", "utmMedium",
    "utm_campaign", "utmCampaign",
    "utm_term", "utmTerm",
    "utm_content", "utmContent",
    "user_agent", "userAgent",
    "device_type", "deviceType",
    "country", "region", "state", "city",
  ]);
  const properties: Record<string, unknown> = {};
  if (e && typeof e === "object") {
    for (const [k, v] of Object.entries(e)) {
      if (!knownKeys.has(k)) properties[k] = v;
    }
  }

  // Strip empty strings from known fields so they're null in DB
  for (const [k, v] of Object.entries(known)) {
    if (v === "") (known as any)[k] = null;
  }

  return { ...known, properties };
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  return String(v);
}
