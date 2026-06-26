import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { ScreeningResult } from '@/types'

export async function GET(_request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('screening_results')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const batchMap = new Map<
    string,
    { batch_id: string; created_at: string; results: ScreeningResult[] }
  >()

  for (const row of data ?? []) {
    const r = row as ScreeningResult
    if (!batchMap.has(r.batch_id)) {
      batchMap.set(r.batch_id, { batch_id: r.batch_id, created_at: r.created_at, results: [] })
    }
    batchMap.get(r.batch_id)!.results.push(r)
  }

  const batches = Array.from(batchMap.values()).map((b) => ({
    batch_id: b.batch_id,
    created_at: b.created_at,
    count: b.results.length,
    results: b.results,
  }))

  return NextResponse.json({ batches })
}
