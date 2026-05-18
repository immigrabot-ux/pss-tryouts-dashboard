import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendWelcomeEmail } from "@/lib/email";
import { sendWhatsAppTemplate } from "@/lib/whatsapp";
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

  const parent_name = str(body.parent_name);
  const player_name = str(body.player_name);
  const player_age_raw = body.player_age;
  const parent_phone = str(body.parent_phone);
  const parent_email = str(body.parent_email);
  const whatsapp_opt_in = Boolean(body.whatsapp_opt_in);

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

  const player_age =
    typeof player_age_raw === "number"
      ? player_age_raw
      : parseInt(String(player_age_raw), 10);

  if (Number.isNaN(player_age) || player_age < 3 || player_age > 25) {
    return withCORS(
      NextResponse.json(
        { error: "invalid_player_age", message: "Age must be between 3 and 25." },
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

  const insertRow = {
    parent_name,
    player_name,
    player_age,
    parent_phone,
    parent_email,
    whatsapp_opt_in,
    whatsapp_confirmed: false,
    status: "new",
    tryout_date: process.env.TRYOUT_DATE || null,
  };

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

  // Fire-and-forget welcome email + WhatsApp template — do NOT block the response.
  Promise.resolve().then(async () => {
    // 1) Welcome email with .ics invite
    const emailResult = await sendWelcomeEmail(data);
    await logActivity(
      data.id,
      "email",
      "welcome",
      emailResult.ok ? null : emailResult.error || "unknown error",
      emailResult.ok
    );

    // 2) Welcome WhatsApp template (only if parent opted in)
    //    This template kickstarts the WhatsApp conversation. Once the parent
    //    replies, we're inside the 24-hour service window and AI auto-reply
    //    takes over.
    if (data.whatsapp_opt_in) {
      const waResult = await sendWhatsAppTemplate(
        data.parent_phone,
        "pss_welcome",
        [data.parent_name, data.player_name]
      );
      await logActivity(
        data.id,
        "whatsapp",
        "welcome",
        waResult.ok ? null : waResult.error || "unknown error",
        waResult.ok
      );
    }
  });

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
