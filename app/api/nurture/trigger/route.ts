import { NextRequest, NextResponse } from "next/server";
import { isAdminPassword, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/nurture/trigger
 * Manually trigger the nurture sequence to run immediately
 */
export async function POST(req: NextRequest) {
  const password = req.headers.get("x-admin-password");
  if (!isAdminPassword(password)) return unauthorized();

  // Get the base URL from the request
  const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`;

  try {
    // Call the nurture-sequence endpoint directly
    const response = await fetch(`${baseUrl}/api/whatsapp/nurture-sequence?password=${encodeURIComponent(process.env.ADMIN_PASSWORD || "")}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: "nurture_trigger_failed", detail: data },
        { status: response.status }
      );
    }

    console.log("[nurture-trigger] manual run completed:", data);

    return NextResponse.json({
      success: true,
      ...data,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[nurture-trigger] failed:", message);
    return NextResponse.json(
      { error: "nurture_trigger_failed", detail: message },
      { status: 500 }
    );
  }
}
