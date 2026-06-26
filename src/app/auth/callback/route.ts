import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { redirect } from 'next/navigation'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.user) {
      const user = data.user
      // Google / OAuth users already have a name — skip registration
      const isOAuth = (user.app_metadata?.provider ?? 'email') !== 'email'
      const isRegistered = isOAuth || user.user_metadata?.registration_completed === true
      redirect(isRegistered ? '/dashboard' : '/auth/register')
    }
  }

  redirect('/auth/login?error=Authentication failed')
}
