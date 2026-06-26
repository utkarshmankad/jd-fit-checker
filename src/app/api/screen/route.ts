import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/utils/crypto'
import type { AnalysisResult, ScreeningResult } from '@/types'

type FastAPIResult = AnalysisResult & {
  job_title?: string
  company?: string
  jd_text?: string
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
      'resume_text, hard_reject_filters, api_key_encrypted, api_provider, tier, screens_used_this_month'
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

  const apiUrl = process.env.NEXT_PUBLIC_SCREENING_API_URL!
  const results: ScreeningResult[] = []
  let count = 0

  async function callFastAPI(body: Record<string, unknown>): Promise<FastAPIResult | { _error: string; _status: number }> {
    const res = await fetch(`${apiUrl}/screen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jd_text: '',
        ...body,
        resume_text: profile!.resume_text,
        hard_reject_filters: profile!.hard_reject_filters,
        api_key: apiKey,
        api_provider: profile!.api_provider,
      }),
    })
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
    const urlList = urls.slice(0, 20).filter((u) => u.trim())
    for (const url of urlList) {
      const result = await callFastAPI({ job_url: url })
      if ('_error' in result) {
        // Forward the error but continue processing other URLs
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
      return NextResponse.json({ error: result._error }, { status: result._status })
    }
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
  } else {
    return NextResponse.json({ error: 'Provide urls or jd_text' }, { status: 400 })
  }

  if (count > 0) {
    await supabase
      .from('profiles')
      .update({ screens_used_this_month: (profile.screens_used_this_month as number) + count })
      .eq('id', user.id)
  }

  return NextResponse.json({ results })
}
