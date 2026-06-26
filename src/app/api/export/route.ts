import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Papa from 'papaparse'

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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []).map((r) => ({
    'Job Title': r.job_title ?? '',
    Company: r.company ?? '',
    URL: r.job_url ?? '',
    'ATS Score': r.ats_score,
    'Role Level Score': r.role_level_score,
    'Composite Score': r.composite_score,
    Verdict: r.verdict,
    'Hard Reject Reasons': ((r.hard_reject_reasons as string[]) ?? []).join('; '),
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
