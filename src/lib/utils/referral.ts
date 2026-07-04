import type { SupabaseClient } from '@supabase/supabase-js'

const REFERRAL_BONUS = 10

export async function applyReferralCode(
  supabase: SupabaseClient,
  service: SupabaseClient,
  userId: string,
  rawCode: string
): Promise<{ success: boolean; message: string }> {
  const code = rawCode.trim().toUpperCase()
  if (!code) return { success: false, message: 'Referral code is required' }

  const { data: current, error: currentError } = await supabase
    .from('profiles')
    .select('referred_by, referral_code')
    .eq('id', userId)
    .single()

  if (currentError || !current) return { success: false, message: 'Profile not found' }
  if (current.referred_by) return { success: false, message: 'A referral code has already been applied to your account' }
  if (current.referral_code === code) return { success: false, message: 'You can’t use your own referral code' }

  const { data: referrer, error: referrerError } = await service
    .from('profiles')
    .select('id')
    .eq('referral_code', code)
    .maybeSingle()

  if (referrerError || !referrer) return { success: false, message: 'Invalid referral code' }

  // Atomic, conditional on referred_by still being null — if two requests for
  // this same user race (e.g. a double-click or a retried request), only one
  // can win this UPDATE, so the referrer is never credited twice for one signup.
  const { data: claimed, error: claimError } = await supabase
    .from('profiles')
    .update({ referred_by: code })
    .eq('id', userId)
    .is('referred_by', null)
    .select('id')
    .maybeSingle()

  if (claimError) {
    console.error('referred_by update failed:', claimError)
    return { success: false, message: 'Failed to apply referral code' }
  }
  if (!claimed) {
    // Someone else won the race (or applied it moments ago) — don't double-credit.
    return { success: false, message: 'A referral code has already been applied to your account' }
  }

  // Atomic increment via RPC — avoids the read-then-write race where two
  // referrals landing on the same referrer at once could lose an increment.
  const { error: bonusError } = await service.rpc('increment_referral_bonus', {
    target_user_id: referrer.id,
    amount: REFERRAL_BONUS,
  })

  if (bonusError) {
    console.error('referral bonus increment failed:', bonusError)
    return { success: false, message: 'Failed to apply referral code' }
  }

  return { success: true, message: 'Referral code applied!' }
}
