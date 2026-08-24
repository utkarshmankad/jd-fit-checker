import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
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
  const profileResult = await service
    .from('profiles')
    .select('referral_code, referral_bonus_screens')
    .eq('id', user.id)
    .single()
  let profile = profileResult.data
  const error = profileResult.error

  if (error || !profile) {
    return NextResponse.json({ error: 'Failed to load referral info' }, { status: 500 })
  }

  // Older profiles created before the referral migration can still have a
  // null code if the one-time SQL backfill was not applied in that database.
  // Use the same deterministic code as the migration and auth trigger, then
  // re-read the row so concurrent requests converge on the stored value.
  if (!profile.referral_code) {
    const generatedCode = createHash('md5').update(user.id).digest('hex').slice(0, 8).toUpperCase()
    const { error: repairError } = await service
      .from('profiles')
      .update({ referral_code: generatedCode })
      .eq('id', user.id)
      .is('referral_code', null)

    if (repairError) {
      console.error('Failed to repair missing referral code', repairError)
      return NextResponse.json({ error: 'Failed to load referral info' }, { status: 500 })
    }

    const repaired = await service
      .from('profiles')
      .select('referral_code, referral_bonus_screens')
      .eq('id', user.id)
      .single()

    if (repaired.error || !repaired.data?.referral_code) {
      return NextResponse.json({ error: 'Failed to load referral info' }, { status: 500 })
    }
    profile = repaired.data
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
