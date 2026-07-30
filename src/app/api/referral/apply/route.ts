import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { applyReferralCode } from '@/lib/utils/referral'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { referral_code } = (await request.json()) as { referral_code?: string }
  if (!referral_code?.trim()) {
    return NextResponse.json({ success: false, message: 'Referral code is required' }, { status: 400 })
  }

  const result = await applyReferralCode(createServiceClient(), user.id, referral_code)
  return NextResponse.json(result)
}
