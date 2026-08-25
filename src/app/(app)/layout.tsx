import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import DashboardShell from '@/components/layout/DashboardShell'
import RenderWakeManager from '@/components/RenderWakeManager'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  // Service-role read, not the request-scoped client — same reason as
  // /api/profile: a request-scoped SELECT run immediately after a
  // service-role write can hit a lagging read replica and miss the row.
  // That was intermittently forcing isNewUser to true right after a save,
  // sending "Judge jobs" clicks straight back to /profile?onboarding=true
  // even though onboarding had actually been completed.
  const service = createServiceClient()
  const { data: profile } = await service
    .from('profiles')
    .select('preferences, hard_reject_filters, tier, is_beta_user, created_at')
    .eq('id', user.id)
    .single()

  // `resume_text` is intentionally never persisted (see profile page — resume
  // is parsed client-side then discarded), so it can't be used as a
  // completeness signal. `onboarding_completed` is the flag the profile page
  // sets once autosave has run at least once, but pre-existing users whose
  // profile was filled out before that flag existed never trigger an
  // autosave (nothing to edit, nothing dirty) — leaving them isNewUser=true
  // forever and stuck bouncing /dashboard -> /profile -> /dashboard even
  // though their profile already has real data. Treat a profile with actual
  // preferences/dealbreakers saved as equivalent to onboarding_completed,
  // mirroring the same completeness check the profile page itself uses
  // (prefFilled / filtersFilled) so legacy data counts.
  const prefs = (profile?.preferences ?? {}) as Record<string, unknown> & {
    preferred_tech_stack?: string[]
    target_industries?: string[]
  }
  const hrf = (profile?.hard_reject_filters ?? {}) as Record<string, unknown> & {
    title_floor?: string
    geography_allowed?: string[]
    tech_stack_dealbreakers?: string[]
    company_type_excluded?: string[]
    role_type_excluded?: string[]
  }
  const hasLegacyProfileData = !!(
    prefs.preferred_tech_stack?.length ||
    prefs.target_industries?.length ||
    hrf.title_floor?.trim() ||
    hrf.geography_allowed?.length ||
    hrf.tech_stack_dealbreakers?.length ||
    hrf.company_type_excluded?.length ||
    hrf.role_type_excluded?.length
  )
  const isNewUser = !prefs.onboarding_completed && !hasLegacyProfileData

  return (
    <DashboardShell
      userEmail={user.email ?? ''}
      isNewUser={isNewUser}
      identity={{
        userId: user.id,
        fullName: (user.user_metadata?.full_name as string | undefined) ?? null,
        tier: (profile?.tier as 'free' | 'paid' | undefined) ?? 'free',
        isBetaUser: !!profile?.is_beta_user,
        createdAt: profile?.created_at ?? null,
      }}
    >
      <RenderWakeManager />
      {children}
    </DashboardShell>
  )
}
