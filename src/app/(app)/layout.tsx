import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DashboardShell from '@/components/layout/DashboardShell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('resume_text, api_key_encrypted, preferences')
    .eq('id', user.id)
    .single()

  const prefs = (profile?.preferences ?? {}) as Record<string, unknown>
  const isNewUser =
    !profile?.resume_text &&
    !profile?.api_key_encrypted &&
    (!profile?.preferences ||
      Object.values(prefs).every((v) => !v || (Array.isArray(v) && v.length === 0)))

  return (
    <DashboardShell userEmail={user.email ?? ''} isNewUser={isNewUser}>
      {children}
    </DashboardShell>
  )
}
