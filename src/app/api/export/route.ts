import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Papa from 'papaparse'
import { sanitizeCsvField } from '@/lib/utils/csv'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const batch_id = request.nextUrl.searchParams.get('batch_id')
  if (!batch_id) return NextResponse.json({ error: 'batch_id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('screening_results')
    .select('*')
    .eq('batch_id', batch_id)
    .eq('user_id', user.id)
    .order('composite_score', { ascending: false })

  if (error) {
    console.error('export query failed:', error.message)
    return NextResponse.json({ error: 'Failed to load results for export' }, { status: 500 })
  }

  const resultIds = (data ?? []).map((row) => row.id)
  const { data: tracked, error: trackerError } = resultIds.length === 0
    ? { data: [], error: null }
    : await supabase
        .from('job_tracker')
        .select('screening_result_id')
        .eq('user_id', user.id)
        .in('screening_result_id', resultIds)

  if (trackerError) {
    console.error('export tracker query failed:', trackerError.message)
    return NextResponse.json({ error: 'Failed to load application statuses for export' }, { status: 500 })
  }
  const appliedIds = new Set((tracked ?? []).map((item) => item.screening_result_id))

  const rows = (data ?? []).map((r) => ({
    'Job Title': sanitizeCsvField(r.job_title ?? ''),
    Company: sanitizeCsvField(r.company ?? ''),
    URL: sanitizeCsvField(r.job_url ?? ''),
    'ATS Score': r.ats_score,
    'Role Level Score': r.role_level_score,
    'Composite Score': r.composite_score,
    Verdict: r.verdict,
    'Application Status': appliedIds.has(r.id) ? 'Applied' : 'Not Applied',
    'Hard Reject Reasons': sanitizeCsvField(((r.hard_reject_reasons as string[]) ?? []).join('; ')),
    'Screened At': r.created_at,
  }))

  const csv = Papa.unparse(rows)
  const date = new Date().toISOString().split('T')[0]

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="jd-screening-${date}.csv"`,
    },
  })
}
