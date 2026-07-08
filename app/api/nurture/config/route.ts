import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isAdminPassword, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/nurture/config
 * Fetch current nurture system configuration
 */
export async function GET(req: NextRequest) {
  const password = req.headers.get("x-admin-password");
  if (!isAdminPassword(password)) return unauthorized();

  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("nurture_config")
    .select("*")
    .eq("id", 1)
    .single();

  if (error) {
    return NextResponse.json(
      { error: "config_read_failed", detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data);
}

/**
 * PATCH /api/nurture/config
 * Update nurture system configuration
 */
export async function PATCH(req: NextRequest) {
  const password = req.headers.get("x-admin-password");
  if (!isAdminPassword(password)) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Only allow updating specific fields
  const allowedFields = ["dry_run", "paused", "rate_limit_per_hour", "tryout_info"];
  const updates: Record<string, unknown> = {};

  for (const field of allowedFields) {
    if (field in body) {
      updates[field] = body[field];
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "no_valid_fields", message: "No valid fields to update" },
      { status: 400 }
    );
  }

  // Validate rate_limit_per_hour
  if ("rate_limit_per_hour" in updates) {
    const rate = Number(updates.rate_limit_per_hour);
    if (isNaN(rate) || rate < 5 || rate > 50) {
      return NextResponse.json(
        { error: "invalid_rate_limit", message: "Rate limit must be between 5 and 50" },
        { status: 400 }
      );
    }
  }

  const { data, error } = await supabase
    .from("nurture_config")
    .update(updates)
    .eq("id", 1)
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: "config_update_failed", detail: error.message },
      { status: 500 }
    );
  }

  console.log("[nurture-config] updated:", updates);

  return NextResponse.json(data);
}
