import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { invite_code } = (await request.json()) as { invite_code?: string }

  if (!invite_code || invite_code !== process.env.BETA_INVITE_CODE) {
    return NextResponse.json({ success: false, message: 'Invalid invite code' })
  }

  const { error } = await supabase
    .from('profiles')
    .update({ is_beta_user: true, invite_code_used: invite_code })
    .eq('id', user.id)

  if (error) {
    console.error('invite code apply failed:', error)
    return NextResponse.json({ success: false, message: 'Failed to apply invite code' }, { status: 500 })
  }

  return NextResponse.json({ success: true, message: 'Beta access unlocked! You have 25 free screens.' })
}
