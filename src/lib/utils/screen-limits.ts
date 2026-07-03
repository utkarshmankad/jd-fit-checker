import type { UserProfile } from '@/types'

export interface LimitCheck {
  allowed: boolean
  reason: 'ok' | 'weekly_limit' | 'beta_limit' | 'upgrade_required'
  screens_used: number
  screens_limit: number
  screens_remaining: number
  is_beta: boolean
  is_paid: boolean
  reset_message: string | null
  upgrade_prompt: string | null
}

export async function checkScreenLimit(
  profile: UserProfile,
  requested_count: number = 1
): Promise<LimitCheck> {
  const LAUNCH_MODE = process.env.LAUNCH_MODE === 'true'
  const BETA_LIMIT = parseInt(process.env.BETA_TOTAL_LIMIT || '25')
  const WEEKLY_LIMIT = parseInt(process.env.FREE_WEEKLY_LIMIT || '3')

  // Paid users: always allowed
  if (profile.tier === 'paid') {
    return {
      allowed: true,
      reason: 'ok',
      screens_used: profile.screens_used_total,
      screens_limit: -1, // unlimited
      screens_remaining: -1,
      is_beta: profile.is_beta_user,
      is_paid: true,
      reset_message: null,
      upgrade_prompt: null,
    }
  }

  // Beta users OR launch mode: check total limit
  if (profile.is_beta_user || LAUNCH_MODE) {
    const used = profile.screens_used_total
    const remaining = BETA_LIMIT - used

    if (used + requested_count > BETA_LIMIT) {
      return {
        allowed: false,
        reason: 'beta_limit',
        screens_used: used,
        screens_limit: BETA_LIMIT,
        screens_remaining: Math.max(0, remaining),
        is_beta: true,
        is_paid: false,
        reset_message: null,
        upgrade_prompt: `You've used all ${BETA_LIMIT} beta screens. Upgrade to Active Search (₹599/month) for unlimited screening.`,
      }
    }

    return {
      allowed: true,
      reason: 'ok',
      screens_used: used,
      screens_limit: BETA_LIMIT,
      screens_remaining: remaining - requested_count,
      is_beta: true,
      is_paid: false,
      reset_message: null,
      upgrade_prompt: null,
    }
  }

  // Standard free tier: weekly limit
  // Note: weekly reset is handled by the DB function
  // called before this check in the API route
  const used = profile.screens_used_this_week
  const bonus = profile.referral_bonus_screens || 0
  const effective_limit = WEEKLY_LIMIT + bonus
  const remaining = effective_limit - used

  if (used + requested_count > effective_limit) {
    const reset_date = new Date(profile.week_reset_at)
    reset_date.setDate(reset_date.getDate() + 7)

    return {
      allowed: false,
      reason: 'weekly_limit',
      screens_used: used,
      screens_limit: effective_limit,
      screens_remaining: 0,
      is_beta: false,
      is_paid: false,
      reset_message: `Your ${WEEKLY_LIMIT} free screens reset on ${reset_date.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}.`,
      upgrade_prompt: bonus > 0
        ? `You've used your ${effective_limit} weekly screens (${WEEKLY_LIMIT} base + ${bonus} referral bonus). Upgrade to Active Search for unlimited screening.`
        : `You've used your ${WEEKLY_LIMIT} free weekly screens. Refer a friend for +10 bonus screens, or upgrade to Active Search (₹599/month) for unlimited screening.`,
    }
  }

  return {
    allowed: true,
    reason: 'ok',
    screens_used: used,
    screens_limit: effective_limit,
    screens_remaining: remaining - requested_count,
    is_beta: false,
    is_paid: false,
    reset_message: null,
    upgrade_prompt: null,
  }
}

export function formatScreensRemaining(check: LimitCheck): string {
  if (check.is_paid) return 'Unlimited'
  if (check.screens_remaining === -1) return 'Unlimited'
  return `${check.screens_remaining} remaining`
}
