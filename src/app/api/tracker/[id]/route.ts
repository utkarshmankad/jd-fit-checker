import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { TrackedJobStatus } from '@/types'

const VALID_STATUSES: TrackedJobStatus[] = ['Applied', 'Interviewing', 'Offer', 'Rejected', 'Withdrawn']

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json() as { status?: string; notes?: string }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status as TrackedJobStatus)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    updates.status = body.status
  }
  if (body.notes !== undefined) {
    updates.notes = body.notes
  }

  const { data: updated, error } = await supabase
    .from('job_tracker')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error || !updated) {
    console.error('job_tracker update failed:', error)
    return NextResponse.json({ error: 'Failed to update tracked job' }, { status: 500 })
  }

  return NextResponse.json({ item: updated })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { error } = await supabase
    .from('job_tracker')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    console.error('job_tracker delete failed:', error)
    return NextResponse.json({ error: 'Failed to untrack job' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
