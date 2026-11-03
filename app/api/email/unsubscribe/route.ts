import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function unsubscribe(rid: string | null, leadId: string | null = null) {
  const db = getSupabaseAdmin();
  let email: string | null = null;
  if (leadId && /^[0-9a-f-]{36}$/i.test(leadId)) {
    // Lead follow-up emails link with ?l=<lead id>
    const { data: lead } = await db.from("leads").select("parent_email").eq("id", leadId).maybeSingle();
    email = lead?.parent_email?.trim().toLowerCase() || null;
  } else if (rid && /^[0-9a-f-]{36}$/i.test(rid)) {
    const { data: rec } = await db.from("email_recipients").select("email").eq("id", rid).maybeSingle();
    email = rec?.email || null;
  }
  if (!email) return false;
  const data = { email };
  await db.from("email_unsubscribes").upsert({ email: data.email, source: "email_link" }, { onConflict: "email" });
  await db.from("email_recipients").update({ status: "skipped", error: "unsubscribed" }).eq("email", data.email).eq("status", "queued");
  return true;
}

/** Link in the email footer: unsubscribes and shows a short confirmation page. */
export async function GET(req: NextRequest) {
  const ok = await unsubscribe(req.nextUrl.searchParams.get("r"), req.nextUrl.searchParams.get("l"));
  const msg = ok ? "You're unsubscribed. You won't get any more emails from Peace Soccer School." : "This link didn't work. Reply to any of our emails and we'll take you off the list.";
  return new NextResponse(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title><body style="font-family:Arial,sans-serif;max-width:480px;margin:60px auto;padding:0 16px;color:#0B1636"><h2>Peace Soccer School</h2><p>${msg}</p></body>`, { headers: { "content-type": "text/html; charset=utf-8" } });
}

/** One-click unsubscribe from Gmail / Apple Mail (List-Unsubscribe-Post). */
export async function POST(req: NextRequest) {
  await unsubscribe(req.nextUrl.searchParams.get("r"), req.nextUrl.searchParams.get("l"));
  return NextResponse.json({ ok: true });
}
