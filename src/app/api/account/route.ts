import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

// Deleting the auth.users row cascades to profiles (profiles.id references
// auth.users(id) on delete cascade) which in turn cascades to
// screening_results, shared_reports, and job_tracker (all reference
// profiles(id) on delete cascade) — one delete, no manual cleanup needed.
// Requires the service-role client since deleting an auth user isn't
// possible with the RLS-scoped session client.
export async function DELETE() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()
  const { error } = await service.auth.admin.deleteUser(user.id)

  if (error) {
    console.error('Account deletion failed:', error)
    return NextResponse.json({ error: 'Failed to delete account. Try again or contact support.' }, { status: 500 })
  }

  await supabase.auth.signOut()
  return NextResponse.json({ success: true })
}
