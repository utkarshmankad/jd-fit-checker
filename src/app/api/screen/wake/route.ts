import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 10

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const apiUrl = process.env.NEXT_PUBLIC_SCREENING_API_URL
  if (!apiUrl) return NextResponse.json({ awake: false }, { status: 503 })
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8_000)
  try {
    const started = performance.now()
    const response = await fetch(`${apiUrl}/ping`, { cache: 'no-store', signal: controller.signal })
    return NextResponse.json({ awake: response.ok, wake_ms: Math.round(performance.now() - started) }, { status: response.ok ? 200 : 503 })
  } catch {
    return NextResponse.json({ awake: false }, { status: 202 })
  } finally { clearTimeout(timer) }
}
