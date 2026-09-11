import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { data: deleted, error } = await supabase
    .from('job_tracker')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('job_tracker delete failed:', error)
    return NextResponse.json({ error: 'Failed to update application status' }, { status: 500 })
  }
  if (!deleted) return NextResponse.json({ error: 'Tracked job not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
