import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { correctionTokens } from '@/lib/screening/fast-scorer'
import type { AnalysisResult } from '@/types'

const VERDICTS = new Set<AnalysisResult['verdict']>(['STRONG', 'DECENT', 'WEAK', 'REJECT'])

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as { screening_result_id?: string; corrected_verdict?: AnalysisResult['verdict']; reason?: string } | null
  const reason = body?.reason?.trim() ?? ''
  if (!body?.screening_result_id || !body.corrected_verdict || !VERDICTS.has(body.corrected_verdict) || reason.length < 3 || reason.length > 1000) {
    return NextResponse.json({ error: 'Choose the right recommendation and add a short reason.' }, { status: 400 })
  }

  const { data: result, error: readError } = await supabase.from('screening_results')
    .select('id, user_id, verdict, job_title, company, jd_text')
    .eq('id', body.screening_result_id).eq('user_id', user.id).single()
  if (readError || !result) return NextResponse.json({ error: 'Screening result not found' }, { status: 404 })
  if (result.verdict === body.corrected_verdict) return NextResponse.json({ error: 'Select a different recommendation.' }, { status: 400 })

  const { data, error } = await supabase.from('recommendation_corrections').upsert({
    user_id: user.id,
    screening_result_id: result.id,
    original_verdict: result.verdict,
    corrected_verdict: body.corrected_verdict,
    reason,
    job_title: result.job_title,
    company: result.company,
    jd_text: result.jd_text,
    feature_tokens: correctionTokens(`${result.job_title ?? ''} ${result.jd_text}`),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,screening_result_id' }).select('id, corrected_verdict, reason').single()

  if (error) {
    console.error('recommendation correction upsert failed:', error.message)
    return NextResponse.json({ error: 'Could not save the correction.' }, { status: 500 })
  }
  return NextResponse.json({ correction: data })
}
