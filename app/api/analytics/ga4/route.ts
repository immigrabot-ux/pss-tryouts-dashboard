import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Deprecated. GA4 service-account integration was replaced by the
 * self-hosted /api/analytics/event endpoint that peacesoccerschool.com
 * posts to directly. See /api/analytics/summary for the new dashboard data.
 */
export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: "deprecated",
      message: "Use /api/analytics/summary instead.",
    },
    { status: 410 }
  );
}
