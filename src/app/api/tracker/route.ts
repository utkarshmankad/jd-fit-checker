import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('job_tracker')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })

  if (error) {
    console.error('job_tracker list failed:', error)
    return NextResponse.json({ error: 'Failed to load tracked jobs' }, { status: 500 })
  }

  return NextResponse.json({ items: data ?? [] })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    screening_result_id?: string | null
    job_title?: string | null
    company?: string | null
    job_url?: string | null
  }

  if (body.screening_result_id) {
    const { data: existing, error: existingError } = await supabase
      .from('job_tracker')
      .select('*')
      .eq('user_id', user.id)
      .eq('screening_result_id', body.screening_result_id)
      .maybeSingle()

    if (existingError) {
      console.error('job_tracker lookup failed:', existingError)
      return NextResponse.json({ error: 'Failed to track job' }, { status: 500 })
    }
    if (existing) {
      return NextResponse.json({ item: existing })
    }
  }

  const { data: inserted, error: insertError } = await supabase
    .from('job_tracker')
    .insert({
      user_id: user.id,
      screening_result_id: body.screening_result_id ?? null,
      job_title: body.job_title ?? null,
      company: body.company ?? null,
      job_url: body.job_url ?? null,
      status: 'Applied',
    })
    .select()
    .single()

  if (insertError || !inserted) {
    console.error('job_tracker insert failed:', insertError)
    return NextResponse.json({ error: 'Failed to track job' }, { status: 500 })
  }

  return NextResponse.json({ item: inserted }, { status: 201 })
}
