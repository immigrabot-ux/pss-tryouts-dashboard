import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendWelcomeEmail, sendAdminNotification } from "@/lib/email";
import { sendWhatsAppTemplate, WELCOME_TEMPLATE_NAME } from "@/lib/whatsapp";
import { logActivity } from "@/lib/activity";
import { isAdminPassword, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-password",
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

/**
 * POST /api/leads
 * Public endpoint — receives signups from peacesoccerschool.com/tryouts.
 * CORS enabled so the static landing page can POST from any origin.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return withCORS(
      NextResponse.json({ error: "invalid_json" }, { status: 400 })
    );
  }

  // Debug log for Vercel — see what's coming in
  console.log("[/api/leads POST] Incoming body:", JSON.stringify(body, null, 2));

  const parent_name = str(body.parent_name);
  const player_name = str(body.player_name);
  const player_age_raw = body.player_age;
  const parent_phone = str(body.parent_phone);
  const parent_email = str(body.parent_email);
  const whatsapp_opt_in = Boolean(body.whatsapp_opt_in);
  // Day selection — "day1" | "day2" | "both". Default to "both".
  let tryout_day = str(body.tryout_day).toLowerCase();
  if (!["day1", "day2", "both"].includes(tryout_day)) tryout_day = "both";
  // Source tracking — "website", "meta_lead_ad", etc. Default to "website".
  const source = str(body.source) || "website";

  // validation
  const missing: string[] = [];
  if (!parent_name) missing.push("parent_name");
  if (!player_name) missing.push("player_name");
  if (player_age_raw === undefined || player_age_raw === null || player_age_raw === "")
    missing.push("player_age");
  if (!parent_phone) missing.push("parent_phone");
  if (!parent_email) missing.push("parent_email");

  if (missing.length) {
    return withCORS(
      NextResponse.json(
        { error: "missing_fields", fields: missing },
        { status: 400 }
      )
    );
  }

  // Accept either a numeric age (9, 13) or an age-group label like
  // "U10 (9-10 yrs)" / "U10" / "U-12". Extract the U-number as upper bound.
  let player_age: number = NaN;
  if (typeof player_age_raw === "number") {
    player_age = player_age_raw;
  } else {
    const raw = String(player_age_raw || "").trim();
    // Match "U" + number, prioritized — that's the age-group convention
    const uMatch = raw.match(/u\s*-?\s*(\d{1,2})/i);
    if (uMatch) {
      player_age = parseInt(uMatch[1], 10);
    } else {
      // Fallback — just grab the first integer in the string
      const numMatch = raw.match(/\d{1,2}/);
      if (numMatch) player_age = parseInt(numMatch[0], 10);
    }
  }

  // Capture the original age-group label (e.g. "U10 (9-10 yrs)") if present
  const age_group =
    typeof player_age_raw === "string" ? player_age_raw.trim() : null;

  if (Number.isNaN(player_age) || player_age < 3 || player_age > 25) {
    return withCORS(
      NextResponse.json(
        {
          error: "invalid_player_age",
          message: "Age must be between 3 and 25 (or an age group like U10).",
          received: player_age_raw,
        },
        { status: 400 }
      )
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parent_email)) {
    return withCORS(
      NextResponse.json({ error: "invalid_email" }, { status: 400 })
    );
  }

  const supabase = getSupabaseAdmin();

  // Anchor lead's tryout_date on the first day they're attending — used by
  // the reminder cron to bucket T-3 / T-1 / today.
  const anchorDate =
    tryout_day === "day2" ? "2026-07-26" : "2026-07-25";

  const insertRow: Record<string, unknown> = {
    parent_name,
    player_name,
    player_age,
    parent_phone,
    parent_email,
    whatsapp_opt_in,
    whatsapp_confirmed: false,
    status: "new",
    tryout_date: anchorDate,
    tryout_day,
    source,
  };
  if (age_group) insertRow.age_group = age_group;

  const { data, error } = await supabase
    .from("leads")
    .insert(insertRow)
    .select()
    .single();

  if (error || !data) {
    console.error("[/api/leads] insert error:", error);
    return withCORS(
      NextResponse.json(
        { error: "db_insert_failed", detail: error?.message },
        { status: 500 }
      )
    );
  }

  // IMPORTANT: Vercel kills serverless functions the moment the response is sent,
  // so any `Promise.resolve().then(...)` background work would be silently dropped.
  // We AWAIT everything here. Form submission takes ~3–5 seconds — acceptable
  // tradeoff for reliable email + WhatsApp delivery.
  //
  // Run the three side-effects in parallel for speed.
  const [emailResult, adminResult, waResult] = await Promise.all([
    sendWelcomeEmail(data),
    sendAdminNotification(data),
    data.whatsapp_opt_in
      ? sendWhatsAppTemplate(data.parent_phone, WELCOME_TEMPLATE_NAME, [
          data.parent_name,
          data.player_name,
        ])
      : Promise.resolve({ ok: true } as { ok: boolean; error?: string }),
  ]);

  // Log each result (also awaited — but soft-fails so it won't throw).
  await Promise.all([
    logActivity(
      data.id,
      "email",
      "welcome",
      emailResult.ok ? null : emailResult.error || "unknown error",
      emailResult.ok
    ),
    logActivity(
      data.id,
      "email",
      "admin_notification",
      adminResult.ok ? null : adminResult.error || "unknown error",
      adminResult.ok
    ),
    data.whatsapp_opt_in
      ? logActivity(
          data.id,
          "whatsapp",
          "welcome",
          waResult.ok ? null : (waResult as any).error || "unknown error",
          waResult.ok
        )
      : Promise.resolve(),
  ]);

  // Persist the WhatsApp send outcome on the lead itself so the dashboard
  // can show a clear delivery-status badge per row.
  if (data.whatsapp_opt_in) {
    const status = waResult.ok ? "sent" : "failed";
    const error = waResult.ok ? null : (waResult as any).error || "unknown error";
    await supabase
      .from("leads")
      .update({
        whatsapp_send_status: status,
        whatsapp_send_error: error,
      })
      .eq("id", data.id);
  }

  console.log(
    `[/api/leads] lead ${data.id} created — email:${emailResult.ok} admin:${adminResult.ok} wa:${waResult.ok}`
  );

  return withCORS(
    NextResponse.json(
      { success: true, leadId: data.id },
      { status: 201 }
    )
  );
}

/**
 * GET /api/leads
 * Admin-only — returns all leads. Auth via `x-admin-password` header or `?password=` query.
 */
export async function GET(req: NextRequest) {
  const password =
    req.headers.get("x-admin-password") ||
    req.nextUrl.searchParams.get("password");

  if (!isAdminPassword(password)) {
    return unauthorized();
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "db_read_failed", detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ leads: data || [] });
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
