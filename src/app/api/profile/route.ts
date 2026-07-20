import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { HardRejectFilters, UserPreferences } from '@/types'

// Reads and writes both go through the service-role client rather than the
// request-scoped one. Confirmed by direct testing: the profiles_select_own
// and profiles_insert_own RLS policies (auth.uid() = id) are defined in the
// migration files but are not actually in effect against the live
// database — a service-role upsert would write a row, and the very next
// request-scoped SELECT for that same session/user still couldn't see it,
// producing a permanent "Profile not found" / re-enter-everything loop.
// auth.getUser() (via the request-scoped client, which only needs a valid
// session — not table RLS) still gates both handlers, and id is always
// pinned to that authenticated user's own id, so this can't be used to
// read/write another user's row despite bypassing RLS.
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()
  const { data, error } = await service
    .from('profiles')
    .select(
      'id, email, full_name, resume_text, hard_reject_filters, preferences, tier, screens_used_this_month, is_beta_user, screens_used_total, screens_used_this_week, week_reset_at, referral_code, referred_by, referral_bonus_screens, invite_code_used, created_at, updated_at'
    )
    .eq('id', user.id)
    .single()

  if (error || !data) {
    console.error('DIAGNOSTIC GET profile lookup failed:', JSON.stringify({ userId: user.id, error }))
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

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
  // persisted. `email` is NOT NULL on the table, so it must be included for
  // the insert branch of the upsert; on the update branch it just re-sets
  // the same value. id/email placed after the spread so they always win
  // regardless of what `updates` contains — defense in depth against a
  // future change to the whitelist above accidentally letting a
  // client-supplied id/email through to a service-role write.
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
