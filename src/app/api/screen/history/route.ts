import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { inferJobMetadataFromUrl } from '@/lib/jobs/fetch-job'
import type { ScreeningResult } from '@/types'

// Lightweight row — omits jd_text (full JD text not needed for the history view)
type HistoryRow = Omit<ScreeningResult, 'jd_text'>

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('screening_results')
    .select('id, batch_id, user_id, job_url, job_title, company, ats_score, role_level_score, composite_score, verdict, hard_reject_reasons, analysis_json, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('screen history fetch failed:', error)
    return NextResponse.json({ error: 'Failed to load history' }, { status: 500 })
  }

  // Older rows may predate metadata extraction. Prefer the shared job cache,
  // then fall back to conservative URL-derived labels so History never shows
  // an unexplained empty dash when the source URL contains useful metadata.
  const rows = (data ?? []) as HistoryRow[]
  const missingUrls = [...new Set(rows
    .filter((row) => row.job_url && (!row.job_title || !row.company))
    .map((row) => row.job_url as string))]
  const cachedByUrl = new Map<string, { job_title: string | null; company: string | null }>()
  if (missingUrls.length) {
    const service = createServiceClient()
    const { data: cachedRows, error: cacheError } = await service
      .from('job_description_cache')
      .select('canonical_url, job_title, company')
      .in('canonical_url', missingUrls)
    if (cacheError) console.warn('History metadata cache lookup failed:', cacheError.message)
    for (const cached of cachedRows ?? []) cachedByUrl.set(cached.canonical_url, cached)
  }

  for (const row of rows) {
    if (!row.job_url || (row.job_title && row.company)) continue
    const cached = cachedByUrl.get(row.job_url)
    const inferred = inferJobMetadataFromUrl(row.job_url)
    row.job_title ||= cached?.job_title ?? inferred.jobTitle ?? null
    row.company ||= cached?.company ?? inferred.company ?? null
  }

  const batchMap = new Map<
    string,
    { batch_id: string; created_at: string; results: HistoryRow[] }
  >()

  for (const row of rows) {
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

  return NextResponse.json({ batches })
}
