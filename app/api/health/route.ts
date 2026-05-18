import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — diagnostic endpoint.
 * Reports whether each env var is set, WITHOUT revealing the values.
 * Useful for confirming env vars made it to Vercel after deploy.
 */
export async function GET() {
  const checks = {
    NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    SMTP_HOST: !!process.env.SMTP_HOST,
    SMTP_USER: !!process.env.SMTP_USER,
    SMTP_PASS: !!process.env.SMTP_PASS,
    SMTP_FROM: !!process.env.SMTP_FROM,
    WHATSAPP_ACCESS_TOKEN: !!process.env.WHATSAPP_ACCESS_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID: !!process.env.WHATSAPP_PHONE_NUMBER_ID,
    WHATSAPP_VERIFY_TOKEN: !!process.env.WHATSAPP_VERIFY_TOKEN,
    ADMIN_PASSWORD: !!process.env.ADMIN_PASSWORD,
    ADMIN_PASSWORD_length: (process.env.ADMIN_PASSWORD || "").trim().length,
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    AI_AUTO_REPLY_ENABLED: process.env.AI_AUTO_REPLY_ENABLED || null,
    TRYOUT_DATE: process.env.TRYOUT_DATE || null,
  };

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    env: checks,
  });
}
