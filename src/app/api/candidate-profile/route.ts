import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isProfileFresh, CANDIDATE_PROFILE_COLUMNS } from '@/lib/candidate-profile/store'
import { resumeSha256 } from '@/lib/candidate-profile/extract'

// Returns the signed-in user's own Candidate Intelligence Profile. Read-only:
// profiles are derived server-side at resume upload (or lazily on screening),
// never written from here. The request-scoped client means RLS
// (candidate_profiles_select_own) is the access control, not this filter.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ data: row, error }, { data: account }] = await Promise.all([
    supabase.from('candidate_profiles').select(CANDIDATE_PROFILE_COLUMNS).eq('user_id', user.id).maybeSingle(),
    supabase.from('profiles').select('resume_text').eq('id', user.id).maybeSingle(),
  ])
  const headers = { 'Cache-Control': 'private, no-store' }
  if (error) {
    console.warn('Candidate profile read failed:', error.code ?? 'error', error.message)
    return NextResponse.json({ error: 'Candidate profile unavailable' }, { status: 503, headers })
  }
  if (!row) return NextResponse.json({ error: 'No candidate profile yet. Upload a resume to build one.' }, { status: 404, headers })

  const resume = (account?.resume_text as string | null) ?? ''
  return NextResponse.json({
    profile: row.profile,
    schema_version: row.schema_version,
    extractor_version: row.extractor_version,
    updated_at: row.updated_at,
    fresh: resume ? isProfileFresh(row, resumeSha256(resume)) : null,
  }, { headers })
}
