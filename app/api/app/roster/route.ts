import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * Paid Winter 2026 players, for the PSS mobile app's roster sync.
 * Server-to-server only: requires the x-app-key header to match APP_SYNC_SECRET.
 * Returns only what the app needs (names, birthdate, guardian names/emails) — no addresses, phones or medical info.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.APP_SYNC_SECRET;
  if (!secret || req.headers.get('x-app-key') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { data, error } = await getSupabaseAdmin()
    .from('winter_2026_registrations')
    .select('id, player_first_name, player_last_name, player_dob, guardian1_first_name, guardian1_last_name, guardian1_email, guardian2_first_name, guardian2_last_name, guardian2_email')
    .eq('payment_status', 'paid')
    .is('duplicate_of', null)
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: 'unavailable' }, { status: 500 });

  const norm = (e: string | null) => (e || '').trim().toLowerCase();
  const players = (data || []).map((r) => ({
    registrationId: r.id,
    firstName: (r.player_first_name || '').trim(),
    lastName: (r.player_last_name || '').trim(),
    dob: r.player_dob,
    guardians: [
      { name: `${r.guardian1_first_name || ''} ${r.guardian1_last_name || ''}`.trim(), email: norm(r.guardian1_email) },
      { name: `${r.guardian2_first_name || ''} ${r.guardian2_last_name || ''}`.trim(), email: norm(r.guardian2_email) },
    ].filter((g) => g.email),
  }));
  return NextResponse.json({ program: 'winter-2026', players });
}
