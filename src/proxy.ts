import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

type AppUser = {
  app_metadata?: Record<string, unknown>
  user_metadata?: Record<string, unknown>
}

function userIsRegistered(user: AppUser): boolean {
  const isOAuth = (user.app_metadata?.provider as string | undefined ?? 'email') !== 'email'
  return isOAuth || user.user_metadata?.registration_completed === true
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session — must run before any auth checks
  const { data: { user } } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname
  const sp = request.nextUrl.searchParams

  // Always allow: auth routes and public share pages
  if (
    path.startsWith('/auth/callback') ||
    path.startsWith('/auth/confirm') ||
    path.startsWith('/share/')
  ) {
    return response
  }

  // Forward Supabase auth params that land on root (when Site URL is not /auth/callback).
  // Invite links: ?token_hash=xxx&type=invite  → /auth/confirm
  // Magic/OAuth:  ?code=xxx                    → /auth/callback
  if (path === '/') {
    const token_hash = sp.get('token_hash')
    const code = sp.get('code')
    if (token_hash) {
      const url = new URL('/auth/confirm', request.url)
      url.search = request.nextUrl.search
      return NextResponse.redirect(url)
    }
    if (code) {
      const url = new URL('/auth/callback', request.url)
      url.search = request.nextUrl.search
      return NextResponse.redirect(url)
    }
  }

  // /auth/register: only for authenticated users who haven't completed registration
  if (path.startsWith('/auth/register')) {
    if (!user) {
      return NextResponse.redirect(new URL('/auth/login', request.url))
    }
    if (userIsRegistered(user)) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
    return response
  }

  // /auth/login and root: redirect away if already signed in
  if (path.startsWith('/auth/login') || path === '/') {
    if (user) {
      const dest = userIsRegistered(user) ? '/dashboard' : '/auth/register'
      return NextResponse.redirect(new URL(dest, request.url))
    }
    return response
  }

  // Protected app and API routes
  const isProtected =
    path.startsWith('/dashboard') ||
    path.startsWith('/profile') ||
    path.startsWith('/api/screen') ||
    path.startsWith('/api/profile') ||
    path.startsWith('/api/parse-resume') ||
    path.startsWith('/api/export') ||
    path.startsWith('/api/share')

  if (isProtected) {
    if (!user) {
      return NextResponse.redirect(new URL('/auth/login', request.url))
    }
    if (!userIsRegistered(user)) {
      return NextResponse.redirect(new URL('/auth/register', request.url))
    }
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
