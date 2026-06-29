import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'
import type { ResponseCookie } from 'next/dist/compiled/@edge-runtime/cookies'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')

  if (code) {
    // Collect every cookie Supabase wants to set during the exchange
    const pendingCookies: Array<{ name: string; value: string; options: Partial<ResponseCookie> }> = []

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            pendingCookies.push(...cookiesToSet)
          },
        },
      }
    )

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.user) {
      const user = data.user
      const isOAuth = (user.app_metadata?.provider ?? 'email') !== 'email'
      const isRegistered = isOAuth || user.user_metadata?.registration_completed === true
      const destination = isRegistered ? '/dashboard' : '/auth/register'

      const response = NextResponse.redirect(new URL(destination, origin))
      // Attach auth cookies explicitly so they travel with the redirect
      pendingCookies.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options)
      })
      return response
    }
  }

  return NextResponse.redirect(new URL('/auth/login?error=Authentication+failed', origin))
}
