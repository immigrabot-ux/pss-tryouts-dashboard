import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isAdminPassword, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authed(req: NextRequest): boolean {
  const password =
    req.headers.get("x-admin-password") ||
    req.nextUrl.searchParams.get("password");
  return isAdminPassword(password);
}

/**
 * GET /api/leads/:id  — fetch a single lead + its activity log
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!authed(req)) return unauthorized();
  const supabase = getSupabaseAdmin();

  const { data: lead, error } = await supabase
    .from("leads")
    .select("*")
    .eq("id", params.id)
    .single();

  if (error || !lead) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: activities, error: activitiesError } = await supabase
    .from("lead_activities")
    .select("*")
    .eq("lead_id", params.id)
    .order("created_at", { ascending: false });

  return NextResponse.json({
    lead,
    activities: activities || [],
    activitiesError: activitiesError ? activitiesError.message : null,
  });
}

/**
 * PATCH /api/leads/:id — admin updates status / notes / any column
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!authed(req)) return unauthorized();
  const supabase = getSupabaseAdmin();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Whitelist of mutable columns from the admin UI.
  const allowed = [
    "status",
    "notes",
    "tryout_date",
    "whatsapp_opt_in",
    "whatsapp_confirmed",
    "parent_name",
    "player_name",
    "player_age",
    "parent_phone",
    "parent_email",
    "hidden",
    "hidden_reason",
  ];
  const update: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) update[key] = body[key];
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no_fields" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("leads")
    .update(update)
    .eq("id", params.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: "db_update_failed", detail: error.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ lead: data });
}

/**
 * DELETE /api/leads/:id
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!authed(req)) return unauthorized();
  const supabase = getSupabaseAdmin();

  const { error } = await supabase.from("leads").delete().eq("id", params.id);
  if (error) {
    return NextResponse.json(
      { error: "db_delete_failed", detail: error.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ success: true });
}
