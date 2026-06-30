import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/utils/crypto'
import type { AnalysisResult, ScreeningResult } from '@/types'

const FREE_TIER_LIMIT = 5
const SCREEN_LIMIT_ENABLED = process.env.NEXT_PUBLIC_FEATURE_SCREEN_LIMIT !== 'false'

type FastAPIResult = AnalysisResult & {
  job_title?: string
  company?: string
  jd_text?: string
}

export type FatalScreenError = {
  type: 'invalid_key' | 'rate_limit'
  message: string
  provider: string
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select(
      'resume_text, preferences, hard_reject_filters, api_key_encrypted, api_provider, tier, screens_used_this_month'
    )
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  if (!profile.api_key_encrypted) {
    return NextResponse.json(
      { error: 'No API key configured. Set up your profile first.' },
      { status: 400 }
    )
  }

  if (SCREEN_LIMIT_ENABLED && profile.tier === 'free' && (profile.screens_used_this_month as number) >= FREE_TIER_LIMIT) {
    return NextResponse.json(
      { error: 'Monthly screen limit reached. Upgrade to continue.', upgrade_required: true },
      { status: 403 }
    )
  }

  let apiKey: string
  try {
    apiKey = decrypt(profile.api_key_encrypted as string)
  } catch {
    return NextResponse.json({ error: 'Failed to decrypt API key' }, { status: 500 })
  }

  const body = await request.json()
  const { urls, jd_text, jd_entries, job_title, company, batch_id } = body as {
    urls?: string[]
    jd_text?: string
    jd_entries?: Array<{ jd_text: string; job_title?: string; company?: string }>
    job_title?: string
    company?: string
    batch_id: string
  }

  if (!batch_id) {
    return NextResponse.json({ error: 'batch_id is required' }, { status: 400 })
  }

  // Use stored resume_text if available; otherwise synthesize from saved preferences so
  // the FastAPI gets a non-null string and ATS matching has something to work with.
  const storedResume = (profile.resume_text as string | null) ?? ''
  const effectiveResumeText = storedResume.trim() || buildResumeFromPreferences(profile)

  const apiUrl = process.env.NEXT_PUBLIC_SCREENING_API_URL!
  const results: ScreeningResult[] = []
  let count = 0
  let fatalError: FatalScreenError | null = null
  const provider = (profile.api_provider as string) ?? 'anthropic'

  async function callFastAPI(body: Record<string, unknown>): Promise<FastAPIResult | { _error: string; _status: number }> {
    let res: Response
    try {
      res = await fetch(`${apiUrl}/screen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jd_text: '',
          ...body,
          resume_text: effectiveResumeText,
          hard_reject_filters: profile!.hard_reject_filters,
          api_key: apiKey,
          api_provider: profile!.api_provider,
        }),
      })
    } catch (e) {
      return { _error: `Screening service unreachable: ${e instanceof Error ? e.message : String(e)}`, _status: 503 }
    }
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({})) as Record<string, unknown>
      const detail = errBody.detail
      const msg = Array.isArray(detail)
        ? (detail as Array<{ msg: string; loc: string[] }>).map((e) => `${e.loc?.slice(-1)[0]}: ${e.msg}`).join(', ')
        : (detail as string | undefined) ?? (errBody.error as string | undefined) ?? res.statusText
      return { _error: msg, _status: res.status }
    }
    return res.json() as Promise<FastAPIResult>
  }

  async function saveResult(
    analysis: FastAPIResult,
    overrides: { job_url?: string; job_title?: string; company?: string; jd_text?: string }
  ): Promise<ScreeningResult | null> {
    const { data: saved, error } = await supabase
      .from('screening_results')
      .insert({
        user_id: user!.id,
        batch_id,
        job_url: overrides.job_url ?? null,
        job_title: overrides.job_title ?? analysis.job_title ?? null,
        company: overrides.company ?? analysis.company ?? null,
        jd_text: overrides.jd_text ?? analysis.jd_text ?? '',
        ats_score: analysis.ats_score,
        role_level_score: analysis.role_level_score,
        composite_score: analysis.composite_score,
        verdict: analysis.verdict,
        hard_reject_reasons: analysis.hard_reject_reasons,
        analysis_json: analysis,
      })
      .select()
      .single()

    if (error) {
      console.error('screening_results insert failed:', error.message)
      return null
    }
    return saved as ScreeningResult
  }

  if (urls && Array.isArray(urls) && urls.length > 0) {
    const urlList = urls.slice(0, 20).filter((u) => u.trim()).map(normalizeJobUrl)
    for (const url of urlList) {
      const result = await callFastAPI({ job_url: url })
      if ('_error' in result) {
        if (result._status === 401) {
          fatalError = { type: 'invalid_key', message: result._error, provider }
          break
        }
        if (result._status === 429) {
          fatalError = { type: 'rate_limit', message: result._error, provider }
          break
        }
        results.push({ id: '', user_id: user.id, batch_id, job_url: url, job_title: null, company: null, jd_text: '', ats_score: 0, role_level_score: 0, composite_score: 0, verdict: 'REJECT', hard_reject_reasons: [result._error], analysis_json: {} as AnalysisResult, created_at: new Date().toISOString() })
        continue
      }
      const saved = await saveResult(result, { job_url: url })
      results.push(saved ?? {
        id: crypto.randomUUID(),
        user_id: user.id,
        batch_id,
        job_url: url,
        job_title: result.job_title ?? null,
        company: result.company ?? null,
        jd_text: result.jd_text ?? '',
        ats_score: result.ats_score,
        role_level_score: result.role_level_score,
        composite_score: result.composite_score,
        verdict: result.verdict,
        hard_reject_reasons: result.hard_reject_reasons,
        analysis_json: result as AnalysisResult,
        created_at: new Date().toISOString(),
      })
      if (saved) count++
    }
  } else if (jd_entries && Array.isArray(jd_entries) && jd_entries.length > 0) {
    const entries = jd_entries.filter((e) => e.jd_text?.trim())
    for (const entry of entries) {
      const result = await callFastAPI({ jd_text: entry.jd_text })
      if ('_error' in result) {
        if (result._status === 401) {
          fatalError = { type: 'invalid_key', message: result._error, provider }
          break
        }
        if (result._status === 429) {
          fatalError = { type: 'rate_limit', message: result._error, provider }
          break
        }
        results.push({ id: '', user_id: user.id, batch_id, job_url: null, job_title: entry.job_title ?? null, company: entry.company ?? null, jd_text: entry.jd_text, ats_score: 0, role_level_score: 0, composite_score: 0, verdict: 'REJECT', hard_reject_reasons: [result._error], analysis_json: {} as AnalysisResult, created_at: new Date().toISOString() })
        continue
      }
      const saved = await saveResult(result, { jd_text: entry.jd_text, job_title: entry.job_title, company: entry.company })
      results.push(saved ?? {
        id: crypto.randomUUID(),
        user_id: user.id,
        batch_id,
        job_url: null,
        job_title: entry.job_title ?? result.job_title ?? null,
        company: entry.company ?? result.company ?? null,
        jd_text: entry.jd_text,
        ats_score: result.ats_score,
        role_level_score: result.role_level_score,
        composite_score: result.composite_score,
        verdict: result.verdict,
        hard_reject_reasons: result.hard_reject_reasons,
        analysis_json: result as AnalysisResult,
        created_at: new Date().toISOString(),
      })
      if (saved) count++
    }
  } else if (jd_text) {
    const result = await callFastAPI({ jd_text })
    if ('_error' in result) {
      if (result._status === 401) fatalError = { type: 'invalid_key', message: result._error, provider }
      else if (result._status === 429) fatalError = { type: 'rate_limit', message: result._error, provider }
      else return NextResponse.json({ error: result._error }, { status: result._status })
    } else {
      const saved = await saveResult(result, { jd_text, job_title, company })
      results.push(saved ?? {
        id: crypto.randomUUID(),
        user_id: user.id,
        batch_id,
        job_url: null,
        job_title: job_title ?? result.job_title ?? null,
        company: company ?? result.company ?? null,
        jd_text: jd_text ?? result.jd_text ?? '',
        ats_score: result.ats_score,
        role_level_score: result.role_level_score,
        composite_score: result.composite_score,
        verdict: result.verdict,
        hard_reject_reasons: result.hard_reject_reasons,
        analysis_json: result as AnalysisResult,
        created_at: new Date().toISOString(),
      })
      if (saved) count++
    }
  } else {
    return NextResponse.json({ error: 'Provide urls or jd_text' }, { status: 400 })
  }

  if (count > 0) {
    await supabase
      .from('profiles')
      .update({ screens_used_this_month: (profile.screens_used_this_month as number) + count })
      .eq('id', user.id)
  }

  return NextResponse.json({ results, ...(fatalError ? { fatalError } : {}) })
}

// LinkedIn collection/recommended URLs include ?currentJobId=XXX but redirect to an
// auth wall when fetched server-side (protocol-relative redirect → httpx error).
// Map them to the direct public job view URL which is scrapeable without auth.
function normalizeJobUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (
      parsed.hostname.includes('linkedin.com') &&
      parsed.searchParams.has('currentJobId')
    ) {
      const jobId = parsed.searchParams.get('currentJobId')!
      return `https://www.linkedin.com/jobs/view/${jobId}/`
    }
  } catch {
    // not a valid URL, pass through as-is
  }
  return url
}

function buildResumeFromPreferences(profile: Record<string, unknown>): string {
  const prefs = (profile.preferences ?? {}) as Record<string, unknown>
  const hrf = (profile.hard_reject_filters ?? {}) as Record<string, unknown>
  const lines: string[] = []

  const tech = prefs.preferred_tech_stack as string[] | undefined
  if (tech?.length) lines.push(`Technical skills: ${tech.join(', ')}`)

  const industries = prefs.target_industries as string[] | undefined
  if (industries?.length) lines.push(`Industries: ${industries.join(', ')}`)

  const titleFloor = hrf.title_floor as string | undefined
  if (titleFloor) lines.push(`Seniority: ${titleFloor}`)

  const geo = hrf.geography_allowed as string[] | undefined
  if (geo?.length) lines.push(`Preferred locations: ${geo.join(', ')}`)

  return lines.join('\n')
}
