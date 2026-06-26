import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

const PROTECTED_ROUTES = [
  /^\/dashboard(\/.*)?$/,
  /^\/api\/screen(\/.*)?$/,
  /^\/api\/profile(\/.*)?$/,
  /^\/api\/export(\/.*)?$/,
  /^\/api\/share(\/.*)?$/,
]

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const isProtected = PROTECTED_ROUTES.some((pattern) => pattern.test(pathname))

  if (!isProtected) {
    return NextResponse.next()
  }

  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
