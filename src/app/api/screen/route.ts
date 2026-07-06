import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { decrypt } from '@/lib/utils/crypto'
import { normalizeJobUrl, isSafeJobUrl } from '@/lib/utils/url'
import { checkScreenLimit } from '@/lib/utils/screen-limits'
import type { AnalysisResult, ScreeningResult, BatchIntelligence, UserProfile } from '@/types'

// Explicit rather than implicit-default — this route's crash/timeout safety
// (see reserveOneScreen below) depends on knowing which serverless runtime
// it's on rather than assuming.
export const runtime = 'nodejs'

const MIN_BATCH_SIZE_FOR_INTELLIGENCE = 3
// Per-item cap on the FastAPI call (scrape + LLM scoring for one JD). Without
// this, one hung item stalls the whole request until the platform's own
// function timeout kills it — uncleanly, after any quota already reserved for
// remaining un-attempted items with no chance to give it back. Bounding each
// item keeps a bad item from taking down the rest of the batch with it.
const FASTAPI_TIMEOUT_MS = 45_000

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

// Called once by the client after its per-item screening loop finishes for a
// batch_id. Not a new screen — doesn't touch screens_used_this_month or the
// free-tier limit. Reuses already-persisted screening_results rows rather than
// requiring the client to accumulate jd_texts separately.
async function finalizeBatch(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  batchId: string
): Promise<NextResponse> {
  const { data: batchRows, error: batchError } = await supabase
    .from('screening_results')
    .select('jd_text, job_title, verdict')
    .eq('batch_id', batchId)
    .eq('user_id', userId)

  if (batchError || !batchRows || batchRows.length < MIN_BATCH_SIZE_FOR_INTELLIGENCE) {
    return NextResponse.json({ batch_intelligence: null })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('api_key_encrypted, api_provider')
    .eq('id', userId)
    .single()

  if (!profile?.api_key_encrypted) {
    return NextResponse.json({ batch_intelligence: null })
  }

  let apiKey: string
  try {
    apiKey = decrypt(profile.api_key_encrypted as string)
  } catch {
    return NextResponse.json({ batch_intelligence: null })
  }

  const apiUrl = process.env.NEXT_PUBLIC_SCREENING_API_URL!
  try {
    const res = await fetch(`${apiUrl}/analyze-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jd_texts: batchRows.map((r) => r.jd_text ?? ''),
        job_titles: batchRows.map((r) => r.job_title ?? ''),
        verdicts: batchRows.map((r) => r.verdict),
        api_key: apiKey,
        api_provider: profile.api_provider ?? 'anthropic',
      }),
    })
    if (!res.ok) {
      console.error('analyze-batch failed:', res.status, await res.text().catch(() => ''))
      return NextResponse.json({ batch_intelligence: null })
    }
    const batch_intelligence = (await res.json()) as BatchIntelligence
    return NextResponse.json({ batch_intelligence })
  } catch (e) {
    console.error('analyze-batch fetch failed:', e)
    return NextResponse.json({ batch_intelligence: null })
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { finalize, batch_id: finalizeBatchId } = body as { finalize?: boolean; batch_id?: string }

  if (finalize) {
    if (!finalizeBatchId) return NextResponse.json({ error: 'batch_id is required' }, { status: 400 })
    return finalizeBatch(supabase, user.id, finalizeBatchId)
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select(
      'resume_text, preferences, hard_reject_filters, api_key_encrypted, api_provider, tier, screens_used_this_month, is_beta_user, screens_used_total, screens_used_this_week, week_reset_at, referral_bonus_screens'
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

  // Bound how much work one request can trigger regardless of tier — paid
  // users have no screen-count limit, but an unbounded array length is a
  // separate resource-exhaustion axis (this function's own execution time,
  // and load against the shared screening backend) that a valid-but-hostile
  // session could otherwise exploit for free.
  const MAX_ITEMS_PER_REQUEST = 100
  const itemCount = urls?.length ?? jd_entries?.length ?? (jd_text ? 1 : 0)
  if (itemCount > MAX_ITEMS_PER_REQUEST) {
    return NextResponse.json(
      { error: `Too many items in one request (max ${MAX_ITEMS_PER_REQUEST}).` },
      { status: 400 }
    )
  }

  const LAUNCH_MODE = process.env.LAUNCH_MODE === 'true'
  if (!profile.is_beta_user && !LAUNCH_MODE) {
    await supabase.rpc('reset_weekly_screens_if_needed', { user_id: user.id })
    // Re-fetch after a possible reset so the limit check below sees fresh counts.
    const { data: refreshed } = await supabase
      .from('profiles')
      .select('screens_used_this_week, week_reset_at')
      .eq('id', user.id)
      .single()
    if (refreshed) {
      profile.screens_used_this_week = refreshed.screens_used_this_week
      profile.week_reset_at = refreshed.week_reset_at
    }
  }

  // Cheap upfront fast-fail (no mutation) — if the user already has zero
  // capacity, bail before decrypting the API key or doing any work at all.
  if (profile.tier !== 'paid') {
    const precheck = await checkScreenLimit(profile as unknown as UserProfile, 1)
    if (!precheck.allowed) {
      return NextResponse.json(
        { error: precheck.upgrade_prompt, limit_check: precheck },
        { status: 403 }
      )
    }
  }

  // Real enforcement happens per-item below via reserveOneScreen(), not as one
  // upfront reservation for the whole batch. Reserving the whole batch's worth
  // up front and refunding the unused portion afterward (the previous design)
  // has a crash-safety hole: if this invocation is killed mid-batch — a slow
  // FastAPI call blowing the platform's function timeout, most likely — the
  // refund never runs and the user permanently loses quota they never got to
  // use. Reserving exactly 1 unit right before each item is attempted means
  // there is never an over-reservation to strand or refund: at any point of
  // failure, exactly the number of items actually attempted have been charged,
  // and an item that was genuinely attempted (a real LLM call went out against
  // the user's own key) is fair to charge for even if something fails after.
  const useWeekly = !profile.is_beta_user && !LAUNCH_MODE
  const BETA_LIMIT = parseInt(process.env.BETA_TOTAL_LIMIT || '25')
  const WEEKLY_LIMIT = parseInt(process.env.FREE_WEEKLY_LIMIT || '3')
  const bonus = (profile.referral_bonus_screens as number) || 0
  const limitValue = useWeekly ? WEEKLY_LIMIT + bonus : BETA_LIMIT

  async function reserveOneScreen(): Promise<boolean> {
    if (profile!.tier === 'paid') return true
    const { data: ok, error } = await supabase.rpc('reserve_screens', {
      p_user_id: user!.id,
      p_amount: 1,
      p_use_weekly: useWeekly,
      p_limit: limitValue,
    })
    if (error) {
      console.error('reserve_screens failed:', error)
      return false
    }
    return !!ok
  }

  let apiKey: string
  try {
    apiKey = decrypt(profile.api_key_encrypted as string)
  } catch {
    return NextResponse.json({ error: 'Failed to decrypt API key' }, { status: 500 })
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
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FASTAPI_TIMEOUT_MS)
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
          user_id: user!.id,
        }),
        signal: controller.signal,
      })
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        console.error(`Screening service timed out after ${FASTAPI_TIMEOUT_MS}ms`)
        return { _error: 'Screening service timed out. Try this one again.', _status: 504 }
      }
      console.error('Screening service fetch failed:', e)
      return { _error: 'Screening service unreachable', _status: 503 }
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({})) as Record<string, unknown>
      const detail = errBody.detail
      const rawMsg = Array.isArray(detail)
        ? (detail as Array<{ msg: string; loc: string[] }>).map((e) => `${e.loc?.slice(-1)[0]}: ${e.msg}`).join(', ')
        : (detail as string | undefined) ?? (errBody.error as string | undefined) ?? res.statusText
      console.error('FastAPI /screen returned error:', res.status, rawMsg)
      // 401/429 are our own FastAPI service's fixed, controlled strings (see
      // _raise_for_provider_error there) — safe to show as-is, and callers
      // special-case these statuses. Anything else is this route forwarding
      // a message it doesn't control (could be a validation error, but could
      // also be a stack-trace fragment from an unhandled exception in the
      // scraper) — collapse to a generic, bounded client-facing message and
      // keep the raw text server-side only.
      const msg = res.status === 401 || res.status === 429
        ? rawMsg
        : res.status === 400
          ? 'Could not process this job — check the URL or text and try again.'
          : 'Screening service error. Try this one again.'
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

  function saveFailedPlaceholder(overrides: { job_url?: string | null; job_title?: string | null; company?: string | null }): ScreeningResult {
    // The FastAPI/LLM call succeeded (a real attempt was made and charged
    // against quota) but persisting the row failed — surface this as a visible
    // error rather than a fabricated "success" the user can't find in history
    // later.
    return {
      id: '',
      user_id: user!.id,
      batch_id,
      job_url: overrides.job_url ?? null,
      job_title: overrides.job_title ?? null,
      company: overrides.company ?? null,
      jd_text: '',
      ats_score: 0,
      role_level_score: 0,
      composite_score: 0,
      verdict: 'REJECT',
      hard_reject_reasons: ['Failed to save this result — please retry'],
      analysis_json: {} as AnalysisResult,
      created_at: new Date().toISOString(),
    }
  }

  if (urls && Array.isArray(urls) && urls.length > 0) {
    const urlList = [...new Set(urls.filter((u) => u.trim()).map(normalizeJobUrl))]
    for (const url of urlList) {
      if (!isSafeJobUrl(url)) {
        // Defense-in-depth before this ever reaches the screening service's
        // own server-side fetch — doesn't consume quota, just rejected outright.
        results.push({ id: '', user_id: user.id, batch_id, job_url: url, job_title: null, company: null, jd_text: '', ats_score: 0, role_level_score: 0, composite_score: 0, verdict: 'REJECT', hard_reject_reasons: ['Unsupported or unsafe URL'], analysis_json: {} as AnalysisResult, created_at: new Date().toISOString() })
        continue
      }
      if (!(await reserveOneScreen())) break

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
      if (!saved) {
        results.push(saveFailedPlaceholder({ job_url: url, job_title: result.job_title, company: result.company }))
        continue
      }
      results.push(saved)
      count++
    }
  } else if (jd_entries && Array.isArray(jd_entries) && jd_entries.length > 0) {
    const entries = jd_entries.filter((e) => e.jd_text?.trim())
    for (const entry of entries) {
      if (!(await reserveOneScreen())) break

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
      if (!saved) {
        results.push(saveFailedPlaceholder({ job_title: entry.job_title ?? result.job_title, company: entry.company ?? result.company }))
        continue
      }
      results.push(saved)
      count++
    }
  } else if (jd_text) {
    if (!(await reserveOneScreen())) {
      return NextResponse.json({ results: [] })
    }
    const result = await callFastAPI({ jd_text })
    if ('_error' in result) {
      if (result._status === 401) fatalError = { type: 'invalid_key', message: result._error, provider }
      else if (result._status === 429) fatalError = { type: 'rate_limit', message: result._error, provider }
      else return NextResponse.json({ error: result._error }, { status: result._status })
    } else {
      const saved = await saveResult(result, { jd_text, job_title, company })
      if (!saved) {
        results.push(saveFailedPlaceholder({ job_title: job_title ?? result.job_title, company: company ?? result.company }))
      } else {
        results.push(saved)
        count++
      }
    }
  } else {
    return NextResponse.json({ error: 'Provide urls or jd_text' }, { status: 400 })
  }

  if (count > 0) {
    // Legacy display-only field (profile page "screens used"), not
    // limit-enforcing — fine as a plain increment, no atomicity needed.
    const service = createServiceClient()
    await service
      .from('profiles')
      .update({ screens_used_this_month: (profile.screens_used_this_month as number) + count })
      .eq('id', user.id)
  }

  return NextResponse.json({ results, ...(fatalError ? { fatalError } : {}) })
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
