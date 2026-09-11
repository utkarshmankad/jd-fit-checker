import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { ScreeningResult } from '@/types'

// Lightweight row — omits jd_text (full JD text not needed for the history view)
type HistoryRow = Omit<ScreeningResult, 'jd_text'>

const PAGE_SIZE = 200

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const requestedOffset = Number.parseInt(request.nextUrl.searchParams.get('offset') ?? '0', 10)
  const offset = Number.isFinite(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0

  const { data, error } = await supabase
    .from('screening_results')
    .select('id, batch_id, user_id, job_url, job_title, company, ats_score, role_level_score, composite_score, verdict, hard_reject_reasons, analysis_json, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    // Fetch one extra row so the client knows whether an older page exists.
    .range(offset, offset + PAGE_SIZE)

  if (error) {
    console.error('screen history fetch failed:', error)
    return NextResponse.json({ error: 'Failed to load history' }, { status: 500 })
  }

  const batchMap = new Map<
    string,
    { batch_id: string; created_at: string; results: HistoryRow[] }
  >()

  const pageRows = (data ?? []).slice(0, PAGE_SIZE)
  for (const row of pageRows) {
    const r = row as HistoryRow
    if (!batchMap.has(r.batch_id)) {
      batchMap.set(r.batch_id, { batch_id: r.batch_id, created_at: r.created_at, results: [] })
    }
    batchMap.get(r.batch_id)!.results.push(r)
  }

  const batches = Array.from(batchMap.values())
    .map((b) => ({
      batch_id: b.batch_id,
      created_at: b.created_at,
      count: b.results.length,
      results: b.results,
    }))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  const has_more = (data?.length ?? 0) > PAGE_SIZE
  return NextResponse.json({
    batches,
    has_more,
    next_offset: has_more ? offset + PAGE_SIZE : null,
  })
}
