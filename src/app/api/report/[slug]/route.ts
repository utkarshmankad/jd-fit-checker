import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const service = createServiceClient()

  const { data, error } = await service
    .from('shared_reports')
    .select('*')
    .eq('slug', slug)
    .gt('expires_at', new Date().toISOString())
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Not found or expired' }, { status: 404 })
  }

  return NextResponse.json(data)
}
