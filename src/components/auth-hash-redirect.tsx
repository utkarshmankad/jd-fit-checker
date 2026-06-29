'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Handles Supabase implicit-flow redirects that land on root with #access_token=...
// Built-in invite emails use /auth/v1/verify which redirects here with hash params.
export default function AuthHashRedirect() {
  const router = useRouter()

  useEffect(() => {
    const hash = window.location.hash
    if (!hash.includes('access_token')) return

    const params = new URLSearchParams(hash.slice(1))
    const type = params.get('type')

    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return
      const isOAuth = (session.user.app_metadata?.provider ?? 'email') !== 'email'
      const isRegistered = isOAuth || session.user.user_metadata?.registration_completed === true

      if (type === 'invite' || !isRegistered) {
        router.replace('/auth/register')
      } else {
        router.replace('/dashboard')
      }
    })
  }, [router])

  return null
}
