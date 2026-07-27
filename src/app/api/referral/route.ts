import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Service-role read, not the request-scoped client — same reason as
  // /api/profile: profiles_select_own RLS is defined but not actually in
  // effect against the live database, so a request-scoped SELECT here can
  // silently miss the row. auth.getUser() above still gates this on a
  // valid session.
  const service = createServiceClient()
  const { data: profile, error } = await service
    .from('profiles')
    .select('referral_code, referral_bonus_screens')
    .eq('id', user.id)
    .single()

  if (error || !profile) {
    return NextResponse.json({ error: 'Failed to load referral info' }, { status: 500 })
  }

  // This count query genuinely depends on profile.referral_code, so it
  // can't run in parallel with the lookup above — the real fix for the
  // slow card is on the client (ReferralCard fires this fetch only after
  // mount, on top of the dashboard's own /api/profile round trip; see
  // DashboardPage) and here (skip a broken RLS path by using service-role
  // above, avoiding any silent retry/failure delay on that first query).
  const { count } = await service
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('referred_by', profile.referral_code)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  return NextResponse.json({
    code: profile.referral_code,
    referral_link: `${appUrl}/auth/login?ref=${profile.referral_code}`,
    referrals_count: count ?? 0,
    bonus_screens_earned: profile.referral_bonus_screens ?? 0,
  })
}
