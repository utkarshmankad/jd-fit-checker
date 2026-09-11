import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('job_tracker')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })

  if (error) {
    console.error('job_tracker list failed:', error)
    return NextResponse.json({ error: 'Failed to load application statuses' }, { status: 500 })
  }
  return NextResponse.json({ items: data ?? [] })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as { screening_result_id?: string }
  if (!body.screening_result_id) {
    return NextResponse.json({ error: 'screening_result_id required' }, { status: 400 })
  }

  // Authorize the reference and copy canonical metadata on the server rather
  // than trusting title/company/URL values supplied by the browser.
  const { data: result, error: resultError } = await supabase
    .from('screening_results')
    .select('id, job_title, company, job_url')
    .eq('id', body.screening_result_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (resultError) {
    console.error('screening result lookup failed:', resultError)
    return NextResponse.json({ error: 'Failed to update application status' }, { status: 500 })
  }
  if (!result) return NextResponse.json({ error: 'Screening result not found' }, { status: 404 })

  const { data: existing, error: existingError } = await supabase
    .from('job_tracker')
    .select('*')
    .eq('user_id', user.id)
    .eq('screening_result_id', result.id)
    .maybeSingle()

  if (existingError) {
    console.error('job_tracker lookup failed:', existingError)
    return NextResponse.json({ error: 'Failed to update application status' }, { status: 500 })
  }
  if (existing) return NextResponse.json({ item: existing })

  const { data: inserted, error: insertError } = await supabase
    .from('job_tracker')
    .insert({
      user_id: user.id,
      screening_result_id: result.id,
      job_title: result.job_title,
      company: result.company,
      job_url: result.job_url,
      status: 'Applied',
    })
    .select()
    .single()

  if (insertError || !inserted) {
    console.error('job_tracker insert failed:', insertError)
    return NextResponse.json({ error: 'Failed to update application status' }, { status: 500 })
  }
  return NextResponse.json({ item: inserted }, { status: 201 })
}
