import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'
import type { ResponseCookie } from 'next/dist/compiled/@edge-runtime/cookies'
import type { EmailOtpType } from '@supabase/supabase-js'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = searchParams.get('next') ?? '/dashboard'

  if (!token_hash || !type) {
    return NextResponse.redirect(new URL('/auth/login?error=Invalid+confirmation+link', origin))
  }

  const pendingCookies: Array<{ name: string; value: string; options: Partial<ResponseCookie> }> = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) { pendingCookies.push(...cookiesToSet) },
      },
    }
  )

  const { data, error } = await supabase.auth.verifyOtp({ token_hash, type })

  if (error || !data.user) {
    return NextResponse.redirect(
      new URL(`/auth/login?error=${encodeURIComponent(error?.message ?? 'Verification failed')}`, origin)
    )
  }

  const user = data.user
  const isOAuth = (user.app_metadata?.provider ?? 'email') !== 'email'
  const isRegistered = isOAuth || user.user_metadata?.registration_completed === true
  const destination = isRegistered ? next : '/auth/register'

  const response = NextResponse.redirect(new URL(destination, origin))
  pendingCookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
  return response
}
