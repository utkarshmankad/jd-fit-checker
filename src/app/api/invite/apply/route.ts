import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000 // 15 minutes

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // BETA_INVITE_CODE is a static shared secret — without a rate limit it's
  // brute-forceable. DB-backed and atomic (row-locked in the RPC) rather than
  // an in-memory counter, so it holds up across serverless instances and
  // concurrent requests from the same account.
  const { data: allowed, error: rpcError } = await supabase.rpc('check_and_increment_invite_attempts', {
    p_user_id: user.id,
    p_max_attempts: MAX_ATTEMPTS,
    p_window_ms: WINDOW_MS,
  })

  if (rpcError) {
    console.error('invite attempt check failed:', rpcError)
    return NextResponse.json({ success: false, message: 'Failed to apply invite code' }, { status: 500 })
  }
  if (!allowed) {
    return NextResponse.json(
      { success: false, message: 'Too many attempts. Try again in a few minutes.' },
      { status: 429 }
    )
  }

  const { invite_code } = (await request.json()) as { invite_code?: string }

  if (!invite_code || invite_code !== process.env.BETA_INVITE_CODE) {
    return NextResponse.json({ success: false, message: 'Invalid invite code' })
  }

  const { error } = await supabase
    .from('profiles')
    .update({ is_beta_user: true, invite_code_used: invite_code, invite_attempt_count: 0 })
    .eq('id', user.id)

  if (error) {
    console.error('invite code apply failed:', error)
    return NextResponse.json({ success: false, message: 'Failed to apply invite code' }, { status: 500 })
  }

  return NextResponse.json({ success: true, message: 'Beta access unlocked! You have 25 free screens.' })
}
