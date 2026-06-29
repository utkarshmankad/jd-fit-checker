import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { encrypt } from '@/lib/utils/crypto'
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
      'id, email, full_name, resume_text, hard_reject_filters, preferences, api_provider, api_key_encrypted, tier, screens_used_this_month, created_at, updated_at'
    )
    .eq('id', user.id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { api_key_encrypted, ...safeProfile } = data as typeof data & { api_key_encrypted: string | null }
  return NextResponse.json({ profile: { ...safeProfile, has_api_key: !!api_key_encrypted } })
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
    api_key?: string
    api_provider?: 'openai' | 'anthropic'
  }

  const updates: Record<string, unknown> = {}

  if (body.full_name !== undefined) updates.full_name = body.full_name
  if (body.resume_text !== undefined) updates.resume_text = body.resume_text
  if (body.hard_reject_filters !== undefined) updates.hard_reject_filters = body.hard_reject_filters
  if (body.preferences !== undefined) updates.preferences = body.preferences
  if (body.api_provider !== undefined) updates.api_provider = body.api_provider
  if (body.api_key) {
    try {
      updates.api_key_encrypted = encrypt(body.api_key)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: `Failed to encrypt API key: ${msg}` }, { status: 500 })
    }
  }

  updates.updated_at = new Date().toISOString()

  const { error } = await supabase.from('profiles').update(updates).eq('id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
