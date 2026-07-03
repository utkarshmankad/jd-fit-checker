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
    .select('id, referral_bonus_screens')
    .eq('referral_code', code)
    .maybeSingle()

  if (referrerError || !referrer) return { success: false, message: 'Invalid referral code' }

  const { error: bonusError } = await service
    .from('profiles')
    .update({ referral_bonus_screens: (referrer.referral_bonus_screens ?? 0) + REFERRAL_BONUS })
    .eq('id', referrer.id)

  if (bonusError) {
    console.error('referral bonus update failed:', bonusError)
    return { success: false, message: 'Failed to apply referral code' }
  }

  const { error: referredByError } = await supabase
    .from('profiles')
    .update({ referred_by: code })
    .eq('id', userId)

  if (referredByError) {
    console.error('referred_by update failed:', referredByError)
    return { success: false, message: 'Failed to apply referral code' }
  }

  return { success: true, message: 'Referral code applied!' }
}
