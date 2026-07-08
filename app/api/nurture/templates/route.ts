import { NextRequest, NextResponse } from "next/server";
import { isAdminPassword, unauthorized } from "@/lib/auth";
import { NURTURE_TEMPLATES } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/nurture/templates
 * Fetch WhatsApp template status from Meta Graph API
 */
export async function GET(req: NextRequest) {
  const password = req.headers.get("x-admin-password");
  if (!isAdminPassword(password)) return unauthorized();

  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

  if (!token || !wabaId) {
    return NextResponse.json(
      {
        error: "missing_credentials",
        message: "Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_BUSINESS_ACCOUNT_ID",
      },
      { status: 500 }
    );
  }

  const templateNames = Object.values(NURTURE_TEMPLATES);

  try {
    // Fetch all message templates from Meta
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${wabaId}/message_templates?fields=name,status,language`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      console.error("[templates] Meta API error:", errorData);
      return NextResponse.json(
        { error: "meta_api_failed", detail: errorData },
        { status: response.status }
      );
    }

    const data = await response.json();
    const allTemplates = data.data || [];

    // Filter to only our nurture templates
    const nurtureTemplateStatus = templateNames.map((name) => {
      const template = allTemplates.find(
        (t: any) => t.name === name && t.language === "en"
      );

      return {
        name,
        status: template?.status || "NOT_FOUND",
        exists: !!template,
      };
    });

    return NextResponse.json({
      templates: nurtureTemplateStatus,
      total_templates: allTemplates.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[templates] fetch failed:", message);
    return NextResponse.json(
      { error: "fetch_failed", detail: message },
      { status: 500 }
    );
  }
}
