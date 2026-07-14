import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { HardRejectFilters, UserPreferences } from '@/types'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, email, full_name, resume_text, hard_reject_filters, preferences, tier, screens_used_this_month, is_beta_user, screens_used_total, screens_used_this_week, week_reset_at, referral_code, referred_by, referral_bonus_screens, invite_code_used, created_at, updated_at'
    )
    .eq('id', user.id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const LAUNCH_MODE = process.env.LAUNCH_MODE === 'true'
  const BETA_LIMIT = parseInt(process.env.BETA_TOTAL_LIMIT || '25')
  const WEEKLY_LIMIT = parseInt(process.env.FREE_WEEKLY_LIMIT || '3')

  return NextResponse.json({
    profile: {
      ...data,
      // Effective beta status for display — LAUNCH_MODE grants beta-level
      // limits to everyone even if the is_beta_user column itself is false
      // (e.g. accounts created before this column existed).
      effective_is_beta: data.is_beta_user || LAUNCH_MODE,
      beta_limit: BETA_LIMIT,
      weekly_limit: WEEKLY_LIMIT,
    },
  })
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    full_name?: string
    resume_text?: string
    hard_reject_filters?: HardRejectFilters
    preferences?: UserPreferences
  }

  const updates: Record<string, unknown> = {}

  if (body.full_name !== undefined) updates.full_name = body.full_name
  if (body.resume_text !== undefined) updates.resume_text = body.resume_text
  if (body.hard_reject_filters !== undefined) updates.hard_reject_filters = body.hard_reject_filters
  if (body.preferences !== undefined) updates.preferences = body.preferences

  updates.updated_at = new Date().toISOString()

  const { error } = await supabase.from('profiles').update(updates).eq('id', user.id)

  if (error) {
    console.error('Profile update failed:', error)
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
