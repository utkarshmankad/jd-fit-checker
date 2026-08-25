import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { normalizeJobUrl, isSafeJobUrl } from '@/lib/utils/url'
import { checkScreenLimit } from '@/lib/utils/screen-limits'
import { buildCandidateEvidence, type CandidateEvidenceInput } from '@/lib/rag/candidate-evidence'
import type { AnalysisResult, ScreeningResult, BatchIntelligence, UserProfile } from '@/types'

// Explicit rather than implicit-default — this route's crash/timeout safety
// (see prepareItem below) depends on knowing which serverless runtime
// it's on rather than assuming.
export const runtime = 'nodejs'

const MIN_BATCH_SIZE_FOR_INTELLIGENCE = 3
// Per-item cap on the FastAPI call (scrape + LLM scoring for one JD). Without
// this, one hung item stalls the whole request until the platform's own
// function timeout kills it — uncleanly, after any quota already reserved for
// remaining un-attempted items with no chance to give it back. Bounding each
// item keeps a bad item from taking down the rest of the batch with it.
// 60s gives headroom for the realistic worst case on the FastAPI side: a
// LinkedIn scrape needing its bot-block retry (~2 x 12s + 1s) plus one LLM
// call (bounded to 20s there) comes to ~45s: too close to the old 45s
// budget here, causing spurious "screening service timed out" failures on
// exactly the links that legitimately needed the retry to succeed at all.
const FASTAPI_TIMEOUT_MS = 60_000

type FastAPIResult = AnalysisResult & {
  job_title?: string
  company?: string
  jd_text?: string
}

export type FatalScreenError = {
  type: 'invalid_key' | 'rate_limit'
  message: string
  provider: string
  keySource: 'app' | 'own'
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

  const APP_GROQ_KEY = process.env.APP_GROQ_API_KEY || null
  if (!APP_GROQ_KEY) {
    return NextResponse.json({ batch_intelligence: null })
  }

  const apiUrl = process.env.NEXT_PUBLIC_SCREENING_API_URL!
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FASTAPI_TIMEOUT_MS)
  try {
    const res = await fetch(`${apiUrl}/analyze-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jd_texts: batchRows.map((r) => r.jd_text ?? ''),
        job_titles: batchRows.map((r) => r.job_title ?? ''),
        verdicts: batchRows.map((r) => r.verdict),
        api_key: APP_GROQ_KEY,
        api_provider: 'groq',
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      console.error('analyze-batch failed:', res.status, await res.text().catch(() => ''))
      return NextResponse.json({ batch_intelligence: null })
    }
    const batch_intelligence = (await res.json()) as BatchIntelligence
    return NextResponse.json({ batch_intelligence })
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      console.error(`analyze-batch timed out after ${FASTAPI_TIMEOUT_MS}ms`)
    } else {
      console.error('analyze-batch fetch failed:', e)
    }
    return NextResponse.json({ batch_intelligence: null })
  } finally {
    clearTimeout(timer)
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { finalize, batch_id: finalizeBatchId } = body as { finalize?: boolean; batch_id?: string }

  if (finalize) {
    if (!finalizeBatchId) return NextResponse.json({ error: 'batch_id is required' }, { status: 400 })
    return finalizeBatch(supabase, user.id, finalizeBatchId)
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select(
      'resume_text, preferences, hard_reject_filters, tier, is_beta_user, screens_used_total, screens_used_this_week, week_reset_at, referral_bonus_screens'
    )
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
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

  // Bound pasted-text field sizes — no legitimate JD or title/company name
  // approaches these lengths. Without a cap, a single item can pad jd_text
  // arbitrarily large, inflating cost against whichever key screens it
  // (including the app's own shared key during the beta free allotment,
  // where cost isn't reflected in quota at all — quota only counts scans,
  // not tokens) and increasing payload size to the screening backend.
  const MAX_JD_TEXT_CHARS = 20_000
  const MAX_NAME_CHARS = 300
  const oversizedField = (() => {
    if (jd_text && jd_text.length > MAX_JD_TEXT_CHARS) return 'jd_text'
    if (job_title && job_title.length > MAX_NAME_CHARS) return 'job_title'
    if (company && company.length > MAX_NAME_CHARS) return 'company'
    for (const entry of jd_entries ?? []) {
      if (entry.jd_text && entry.jd_text.length > MAX_JD_TEXT_CHARS) return 'jd_text'
      if (entry.job_title && entry.job_title.length > MAX_NAME_CHARS) return 'job_title'
      if (entry.company && entry.company.length > MAX_NAME_CHARS) return 'company'
    }
    return null
  })()
  if (oversizedField) {
    return NextResponse.json(
      { error: `${oversizedField === 'jd_text' ? 'JD text' : oversizedField === 'job_title' ? 'Job title' : 'Company name'} is too long.` },
      { status: 400 }
    )
  }

  const LAUNCH_MODE = process.env.LAUNCH_MODE === 'true'
  if (!profile.is_beta_user && !LAUNCH_MODE) {
    // Fire the reset without blocking on a re-fetch of the same row: the
    // RPC itself resets counts atomically server-side, and reserve_screens
    // (called per-item below) re-checks the limit fresh against the DB
    // regardless of what's cached in `profile` here. The only consumer of
    // profile.screens_used_this_week/week_reset_at is the fallback error
    // message text (checkScreenLimit, below) when a reservation is denied —
    // stale values there just mean a slightly stale message, not a wrong
    // enforcement decision, so it's safe to skip the round-trip on the
    // common (limit-not-hit) path.
    await supabase.rpc('reset_weekly_screens_if_needed', { user_id: user.id })
  }

  // No upfront hard-block here (deliberately) — a beta/launch user who has
  // exhausted the app-key allotment but has their own key configured is NOT
  // supposed to be blocked, just switched to their own key. Whether that's
  // possible depends on API-key availability, which prepareItem() below
  // checks per-item; only regular (non-beta) free-tier users can be blocked
  // purely by quota, and that's handled there too (weekly reserve_screens
  // failing produces the same checkScreenLimit-derived message).

  // Real enforcement happens per-item below via prepareItem(), not as one
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
  // isBetaOrLaunch users get BETA_LIMIT screens funded by the app's own key
  // (no key setup needed to start); once that's used up, they need their own
  // key but are otherwise unlimited from then on — the 25-cap only ever
  // gated the app-funded portion, not the user in general. Regular
  // (non-beta, post-launch) free users are unaffected by any of this: no
  // app-key freebie, always weekly-capped, own key required from screen 1,
  // same as before this feature existed.
  const isBetaOrLaunch = profile.tier !== 'paid' && (!!profile.is_beta_user || LAUNCH_MODE)
  const BETA_LIMIT = parseInt(process.env.BETA_TOTAL_LIMIT || '25')
  const WEEKLY_LIMIT = parseInt(process.env.FREE_WEEKLY_LIMIT || '3')
  const bonus = (profile.referral_bonus_screens as number) || 0
  // Referral bonus applies to whichever limit is actually in force for this
  // user — beta's flat allotment or the regular weekly cap — not just the
  // weekly one, otherwise referring a friend does nothing during beta/launch.
  const betaLimitValue = BETA_LIMIT + bonus
  const weeklyLimitValue = WEEKLY_LIMIT + bonus

  const APP_GROQ_KEY = process.env.APP_GROQ_API_KEY || null

  // Instant screening is local and does not need an API key. The app Groq key
  // is used only by optional background/deep analysis. Quota reservation is
  // still the real gate (reserve_screens, atomic per
  // item — see the crash-safety note above): beta/launch users draw against
  // the flat beta allotment, everyone else against the weekly cap. Paid
  // tier is unlimited (no reservation at all).
  type PreparedItem = { apiKey: string; provider: string; source: 'app'; reserved: boolean; useWeekly: boolean }

  async function prepareItem(): Promise<PreparedItem | { error: string; code?: 'no_api_key' }> {
    const fastModePlaceholderKey = APP_GROQ_KEY || 'not-used-in-fast-mode'

    if (profile!.tier === 'paid') {
      return { apiKey: fastModePlaceholderKey, provider: 'groq', source: 'app', reserved: false, useWeekly: false }
    }

    if (isBetaOrLaunch) {
      const { data: ok, error } = await supabase.rpc('reserve_screens', {
        p_user_id: user!.id,
        p_amount: 1,
        p_use_weekly: false,
        p_limit: betaLimitValue,
      })
      if (error) {
        console.error('reserve_screens (beta allotment) failed:', error)
        return { error: 'Failed to check screen limit' }
      }
      if (!ok) {
        return { error: `You've used your ${betaLimitValue} free judgments. More opens up next week — check back then.` }
      }
      return { apiKey: fastModePlaceholderKey, provider: 'groq', source: 'app', reserved: true, useWeekly: false }
    }

    // Regular free tier: always weekly-capped.
    const { data: ok, error } = await supabase.rpc('reserve_screens', {
      p_user_id: user!.id,
      p_amount: 1,
      p_use_weekly: true,
      p_limit: weeklyLimitValue,
    })
    if (error) {
      console.error('reserve_screens (weekly) failed:', error)
      return { error: 'Failed to check screen limit' }
    }
    if (!ok) {
      // Only refetch the fresh weekly counts here, on the rare denied path —
      // needed for accurate message text now that the reset above no longer
      // unconditionally re-fetches on every request.
      const { data: refreshed } = await supabase
        .from('profiles')
        .select('screens_used_this_week, week_reset_at')
        .eq('id', user!.id)
        .single()
      if (refreshed) {
        profile!.screens_used_this_week = refreshed.screens_used_this_week
        profile!.week_reset_at = refreshed.week_reset_at
      }
      const limitCheck = await checkScreenLimit(profile as unknown as UserProfile, 1)
      return { error: limitCheck.upgrade_prompt ?? "You've used this week's free judgments." }
    }
    return { apiKey: fastModePlaceholderKey, provider: 'groq', source: 'app', reserved: true, useWeekly: true }
  }

  // A scan that never produced a real result (scrape/LLM/service failure)
  // shouldn't count against the user's allotment — only reserved upfront so
  // a hung call can't strand quota (see prepareItem's crash-safety note);
  // once we know it failed, give it back immediately, same request.
  async function refundIfReserved(item: PreparedItem) {
    if (!item.reserved) return
    const { error } = await supabase.rpc('refund_screens', { p_user_id: user!.id, p_amount: 1, p_use_weekly: item.useWeekly })
    if (error) {
      console.error('refund_screens failed:', error)
    }
  }

  // Use stored resume_text if available; otherwise synthesize from saved preferences so
  // the FastAPI gets a non-null string and ATS matching has something to work with.
  const storedResume = (profile.resume_text as string | null) ?? ''
  const effectiveResumeText = storedResume.trim() || buildResumeFromPreferences(profile)

  // Phase 1/2 bridge: load the user's private evidence KB once per incoming
  // request, not once per JD. Existing profiles are indexed lazily so the
  // migration does not require an expensive one-shot backfill.
  let candidateEvidence: CandidateEvidenceInput[] = []
  const { data: evidenceRows, error: evidenceReadError } = await supabase
    .from('candidate_evidence')
    .select('id, evidence_type, content, skills, embedding, metadata')
    .eq('user_id', user.id)
    .order('chunk_index', { ascending: true })
    .limit(64)

  if (evidenceReadError) {
    console.warn('Candidate evidence unavailable; using legacy scoring:', evidenceReadError.message)
  } else if (evidenceRows?.length) {
    candidateEvidence = evidenceRows as CandidateEvidenceInput[]
  } else if (storedResume.trim()) {
    const preferences = (profile.preferences ?? {}) as Record<string, unknown>
    const filters = (profile.hard_reject_filters ?? {}) as Record<string, unknown>
    const generated = buildCandidateEvidence(user.id, storedResume, {
      preferred_tech_stack: (preferences.preferred_tech_stack as string[] | undefined) ?? [],
      target_industries: (preferences.target_industries as string[] | undefined) ?? [],
      title_floor: (filters.title_floor as string | undefined) ?? '',
      geography_allowed: (filters.geography_allowed as string[] | undefined) ?? [],
    })
    if (generated.length) {
      const service = createServiceClient()
      const { data: inserted, error: lazyIndexError } = await service
        .from('candidate_evidence')
        .insert(generated)
        .select('id, evidence_type, content, skills, embedding, metadata')
      if (lazyIndexError) {
        console.warn('Lazy candidate evidence indexing failed:', lazyIndexError.message)
        candidateEvidence = generated
      } else {
        candidateEvidence = (inserted ?? generated) as CandidateEvidenceInput[]
      }
    }
  }

  const apiUrl = process.env.NEXT_PUBLIC_SCREENING_API_URL!
  const results: ScreeningResult[] = []
  let fatalError: FatalScreenError | null = null

  async function callFastAPI(body: Record<string, unknown>, apiKey: string, apiProvider: string): Promise<FastAPIResult | { _error: string; _status: number }> {
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
          api_provider: apiProvider,
          analysis_mode: 'fast',
          user_id: user!.id,
          candidate_evidence: candidateEvidence,
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
      // special-case these statuses. The LinkedIn bot-block message is the
      // same kind of fixed, controlled string (not attacker/scraper-derived
      // free text) and is the single most common 400 by far — worth
      // surfacing directly since it tells the user exactly what to do
      // (paste the JD text instead) rather than the generic message below.
      // Everything else on a 400 could be a validation error, but could
      // also be a stack-trace fragment from an unhandled scraper exception —
      // collapse those to a generic, bounded message and keep the raw text
      // server-side only.
      const isLinkedInBlock = res.status === 400 && rawMsg?.startsWith('LinkedIn blocks automated access')
      const msg = res.status === 401 || res.status === 429 || isLinkedInBlock
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

  // Items within one request are independent (each does its own atomic
  // reserve -> call -> save/refund), so they can run concurrently instead of
  // strictly serially — serial execution meant a 100-item request could take
  // up to 100 x FASTAPI_TIMEOUT_MS (~75 minutes) worst case, well past any
  // serverless function time limit. A bounded chunk size keeps this from
  // hammering the screening backend all at once while still cutting
  // worst-case wall-clock by roughly the concurrency factor. `fatalError` is
  // safe to share across concurrently-running items — it only needs "some
  // item in this chunk hit one" semantics, not a specific ordering.
  const CONCURRENCY = 25
  async function processInChunks<T>(items: T[], worker: (item: T) => Promise<boolean>): Promise<void> {
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      const chunk = items.slice(i, i + CONCURRENCY)
      const shouldContinue = await Promise.all(chunk.map(worker))
      if (shouldContinue.some((cont) => !cont)) break
    }
  }

  if (urls && Array.isArray(urls) && urls.length > 0) {
    const urlList = [...new Set(urls.filter((u) => u.trim()).map(normalizeJobUrl))]
    await processInChunks(urlList, async (url): Promise<boolean> => {
      if (!isSafeJobUrl(url)) {
        // Defense-in-depth before this ever reaches the screening service's
        // own server-side fetch — doesn't consume quota, just rejected outright.
        results.push({ id: '', user_id: user.id, batch_id, job_url: url, job_title: null, company: null, jd_text: '', ats_score: 0, role_level_score: 0, composite_score: 0, verdict: 'REJECT', hard_reject_reasons: ['Unsupported or unsafe URL'], analysis_json: {} as AnalysisResult, created_at: new Date().toISOString() })
        return true
      }
      const keyChoice = await prepareItem()
      if ('error' in keyChoice) {
        // No usable key/quota for this or any further item — surface it as a
        // visible result row rather than silently truncating, then stop.
        results.push({ id: '', user_id: user.id, batch_id, job_url: url, job_title: null, company: null, jd_text: '', ats_score: 0, role_level_score: 0, composite_score: 0, verdict: 'REJECT', hard_reject_reasons: [keyChoice.error], analysis_json: {} as AnalysisResult, created_at: new Date().toISOString() })
        return false
      }

      const result = await callFastAPI({ job_url: url }, keyChoice.apiKey, keyChoice.provider)
      if ('_error' in result) {
        await refundIfReserved(keyChoice)
        if (result._status === 401) {
          fatalError = { type: 'invalid_key', message: result._error, provider: keyChoice.provider, keySource: keyChoice.source }
          return false
        }
        if (result._status === 429) {
          fatalError = { type: 'rate_limit', message: result._error, provider: keyChoice.provider, keySource: keyChoice.source }
          return false
        }
        results.push({ id: '', user_id: user.id, batch_id, job_url: url, job_title: null, company: null, jd_text: '', ats_score: 0, role_level_score: 0, composite_score: 0, verdict: 'REJECT', hard_reject_reasons: [result._error], analysis_json: {} as AnalysisResult, created_at: new Date().toISOString() })
        return true
      }
      const saved = await saveResult(result, { job_url: url })
      if (!saved) {
        results.push(saveFailedPlaceholder({ job_url: url, job_title: result.job_title, company: result.company }))
        return true
      }
      results.push(saved)
      return true
    })
  } else if (jd_entries && Array.isArray(jd_entries) && jd_entries.length > 0) {
    const entries = jd_entries.filter((e) => e.jd_text?.trim())
    await processInChunks(entries, async (entry): Promise<boolean> => {
      const keyChoice = await prepareItem()
      if ('error' in keyChoice) {
        results.push({ id: '', user_id: user.id, batch_id, job_url: null, job_title: entry.job_title ?? null, company: entry.company ?? null, jd_text: entry.jd_text, ats_score: 0, role_level_score: 0, composite_score: 0, verdict: 'REJECT', hard_reject_reasons: [keyChoice.error], analysis_json: {} as AnalysisResult, created_at: new Date().toISOString() })
        return false
      }

      const result = await callFastAPI({ jd_text: entry.jd_text, job_title: entry.job_title, company: entry.company }, keyChoice.apiKey, keyChoice.provider)
      if ('_error' in result) {
        await refundIfReserved(keyChoice)
        if (result._status === 401) {
          fatalError = { type: 'invalid_key', message: result._error, provider: keyChoice.provider, keySource: keyChoice.source }
          return false
        }
        if (result._status === 429) {
          fatalError = { type: 'rate_limit', message: result._error, provider: keyChoice.provider, keySource: keyChoice.source }
          return false
        }
        results.push({ id: '', user_id: user.id, batch_id, job_url: null, job_title: entry.job_title ?? null, company: entry.company ?? null, jd_text: entry.jd_text, ats_score: 0, role_level_score: 0, composite_score: 0, verdict: 'REJECT', hard_reject_reasons: [result._error], analysis_json: {} as AnalysisResult, created_at: new Date().toISOString() })
        return true
      }
      const saved = await saveResult(result, { jd_text: entry.jd_text, job_title: entry.job_title, company: entry.company })
      if (!saved) {
        results.push(saveFailedPlaceholder({ job_title: entry.job_title ?? result.job_title, company: entry.company ?? result.company }))
        return true
      }
      results.push(saved)
      return true
    })
  } else if (jd_text) {
    const keyChoice = await prepareItem()
    if ('error' in keyChoice) {
      return NextResponse.json({ error: keyChoice.error, code: keyChoice.code }, { status: 400 })
    }
    const result = await callFastAPI({ jd_text, job_title, company }, keyChoice.apiKey, keyChoice.provider)
    if ('_error' in result) {
      await refundIfReserved(keyChoice)
      if (result._status === 401) fatalError = { type: 'invalid_key', message: result._error, provider: keyChoice.provider, keySource: keyChoice.source }
      else if (result._status === 429) fatalError = { type: 'rate_limit', message: result._error, provider: keyChoice.provider, keySource: keyChoice.source }
      else return NextResponse.json({ error: result._error }, { status: result._status })
    } else {
      const saved = await saveResult(result, { jd_text, job_title, company })
      if (!saved) {
        results.push(saveFailedPlaceholder({ job_title: job_title ?? result.job_title, company: company ?? result.company }))
      } else {
        results.push(saved)
      }
    }
  } else {
    return NextResponse.json({ error: 'Provide urls or jd_text' }, { status: 400 })
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
