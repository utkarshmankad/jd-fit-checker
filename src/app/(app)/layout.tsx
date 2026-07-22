import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import DashboardShell from '@/components/layout/DashboardShell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  // Service-role read, not the request-scoped client — same reason as
  // /api/profile: the profiles_select_own RLS policy is broken on the live
  // DB, so a request-scoped SELECT here always comes back empty. That was
  // silently forcing isNewUser to true on every load, sending "Judge jobs"
  // clicks straight back to /profile?onboarding=true regardless of whether
  // onboarding had actually been completed.
  const service = createServiceClient()
  const { data: profile } = await service
    .from('profiles')
    .select('preferences')
    .eq('id', user.id)
    .single()

  // `resume_text` is intentionally never persisted (see profile page — resume
  // is parsed client-side then discarded), so it can't be used as a
  // completeness signal. `onboarding_completed` is the single flag the
  // profile page sets once autosave has run at least once; use it as the
  // only source of truth here to avoid a second, inconsistent "is done" check.
  const prefs = (profile?.preferences ?? {}) as Record<string, unknown>
  const isNewUser = !prefs.onboarding_completed

  return (
    <DashboardShell userEmail={user.email ?? ''} isNewUser={isNewUser}>
      {children}
    </DashboardShell>
  )
}
