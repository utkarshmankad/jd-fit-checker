import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('referral_code, referral_bonus_screens')
    .eq('id', user.id)
    .single()

  if (error || !profile) {
    return NextResponse.json({ error: 'Failed to load referral info' }, { status: 500 })
  }

  const { count } = await supabase
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
