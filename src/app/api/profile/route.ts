import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
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

  // Upsert, not update: a plain .update() against a missing row matches zero
  // rows and returns no error — the client sees "saved" while nothing
  // persisted. Accounts can end up without a profiles row (signup trigger
  // gap, timing, etc.), and a silent no-op save here is exactly what put
  // users in a "saved, but still incomplete on reload" loop. `email` is
  // NOT NULL on the table, so it must be included for the insert branch of
  // the upsert; on the update branch it just re-sets the same value.
  //
  // Uses the service-role client rather than the request-scoped one: the
  // profiles_insert_own RLS policy (auth.uid() = id) is defined in the
  // migration files but isn't in effect against the live database, so an
  // upsert through the authenticated user's own client 42501s on the insert
  // branch. Service role bypasses RLS by design — id is still pinned to the
  // authenticated user's own id (never client-supplied), so this can't be
  // used to write another user's row.
  // id/email placed after the spread so they always win regardless of what
  // `updates` contains — defense in depth against a future change to the
  // whitelist above accidentally letting a client-supplied id/email through
  // to a service-role write that bypasses RLS.
  const service = createServiceClient()
  const { error } = await service
    .from('profiles')
    .upsert({ ...updates, id: user.id, email: user.email ?? '' }, { onConflict: 'id' })

  if (error) {
    console.error('Profile update failed:', error)
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
