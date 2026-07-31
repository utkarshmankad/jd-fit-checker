import { createServiceClient } from '@/lib/supabase/service'
import { cookies } from 'next/headers'
import { timingSafeEqual } from 'node:crypto'
import type { HardRejectFilters } from '@/types'
import { sessionToken } from '@/lib/auth/admin-session'

const COOKIE_NAME = 'admin_session'

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

async function isAuthed(): Promise<boolean> {
  const validKey = process.env.ADMIN_SECRET
  if (!validKey) return false
  const cookieStore = await cookies()
  const session = cookieStore.get(COOKIE_NAME)?.value
  if (!session) return false
  return safeEqual(session, sessionToken(validKey))
}

function LoginForm({ error }: { error?: boolean }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Admin Access</h1>
        {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">Incorrect password.</p>}
        {/* POST, not a GET with the key in the query string — a GET would put
            the admin secret in the browser's history, the server's access
            logs, and any Referer header sent from this page, all of which
            defeats the point of having a secret at all. */}
        <form method="POST" action="/api/admin/login">
          <input
            name="key"
            type="password"
            placeholder="Admin password"
            autoFocus
            className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 mr-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          />
          <button
            type="submit"
            className="text-white px-4 py-2 rounded text-sm font-medium"
            style={{ backgroundColor: '#1B3A5C' }}
          >
            Enter
          </button>
        </form>
      </div>
    </div>
  )
}

export default async function AdminPage({
  searchParams,
}: {
  // Next.js 16: searchParams is a Promise on server components, not a
  // plain object — see node_modules/next/dist/docs — must be awaited.
  searchParams: Promise<{ error?: string }>
}) {
  if (!(await isAuthed())) {
    const { error } = await searchParams
    return <LoginForm error={error === '1'} />
  }

  const supabase = createServiceClient()

  const { data: users } = await supabase
    .from('profiles')
    .select('id, email, full_name, tier, is_beta_user, screens_used_total, created_at, resume_text, hard_reject_filters')
    .order('created_at', { ascending: false })

  const { data: recentScreenings } = await supabase
    .from('screening_results')
    .select('id, user_id, company, job_title, verdict, created_at')
    .order('created_at', { ascending: false })
    .limit(50)

  // Per-user lifetime scan counts — deliberately NOT derived from
  // recentScreenings (capped at the 50 most recent across ALL users), which
  // would under-count anyone whose scans fell outside that window. This RPC
  // aggregates the full screening_results table server-side instead.
  const { data: screeningCounts } = await supabase.rpc('get_screening_counts_per_user')
  const countByUser = new Map<string, number>(
    (screeningCounts ?? []).map((row: { user_id: string; count: number }) => [row.user_id, row.count])
  )

  const totalUsers = users?.length ?? 0
  const usersWhoScanned = countByUser.size
  const totalScreenings = Array.from(countByUser.values()).reduce((sum, n) => sum + n, 0)
  const activationRate = totalUsers > 0 ? Math.round((usersWhoScanned / totalUsers) * 100) : 0

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Jobsnob Admin</h1>
      <p className="text-gray-500 dark:text-gray-400 text-sm mb-8">{new Date().toLocaleString('en-IN')}</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total users', value: totalUsers },
          { label: 'Users who scanned', value: usersWhoScanned },
          { label: 'Activation rate', value: activationRate + '%' },
          { label: 'Total screenings', value: totalScreenings },
        ].map((stat) => (
          <div key={stat.label} className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">{stat.value}</p>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 mb-8 overflow-x-auto">
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">All users</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/50">
            <tr>
              <th className="text-left p-3 text-gray-600 dark:text-gray-400 font-medium">Name</th>
              <th className="text-left p-3 text-gray-600 dark:text-gray-400 font-medium">Email</th>
              <th className="text-left p-3 text-gray-600 dark:text-gray-400 font-medium">Joined</th>
              <th className="text-left p-3 text-gray-600 dark:text-gray-400 font-medium">Tier</th>
              <th className="text-left p-3 text-gray-600 dark:text-gray-400 font-medium">Resume</th>
              <th className="text-left p-3 text-gray-600 dark:text-gray-400 font-medium">Filters</th>
              <th className="text-left p-3 text-gray-600 dark:text-gray-400 font-medium">Scans</th>
              <th className="text-left p-3 text-gray-600 dark:text-gray-400 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {users?.map((user) => {
              const userScreenings = countByUser.get(user.id) ?? 0
              const hasResume = !!user.resume_text
              const hrf = user.hard_reject_filters as HardRejectFilters | null
              const hasFilters = !!hrf?.tech_stack_dealbreakers?.length
              const activated = userScreenings > 0

              return (
                <tr key={user.id} className="border-t border-gray-50 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                  <td className="p-3 font-medium text-gray-900 dark:text-gray-100">{user.full_name || '—'}</td>
                  <td className="p-3 text-gray-600 dark:text-gray-400">{user.email}</td>
                  <td className="p-3 text-gray-500 dark:text-gray-400">{new Date(user.created_at).toLocaleDateString('en-IN')}</td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        user.tier === 'paid'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      {user.tier}
                    </span>
                  </td>
                  <td className="p-3">{hasResume ? '✓' : '✗'}</td>
                  <td className="p-3">{hasFilters ? '✓' : '✗'}</td>
                  <td className="p-3 font-medium text-gray-900 dark:text-gray-100">{userScreenings}</td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        activated
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                          : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                      }`}
                    >
                      {activated ? 'Activated' : 'Not activated'}
                    </span>
                  </td>
                </tr>
              )
            })}
            {(!users || users.length === 0) && (
              <tr>
                <td colSpan={8} className="p-8 text-center text-gray-400 dark:text-gray-500">
                  No users yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-x-auto">
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Recent screenings (last 50)</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/50">
            <tr>
              <th className="text-left p-3 text-gray-600 dark:text-gray-400 font-medium">Company</th>
              <th className="text-left p-3 text-gray-600 dark:text-gray-400 font-medium">Role</th>
              <th className="text-left p-3 text-gray-600 dark:text-gray-400 font-medium">Verdict</th>
              <th className="text-left p-3 text-gray-600 dark:text-gray-400 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {recentScreenings?.map((s) => (
              <tr key={s.id} className="border-t border-gray-50 dark:border-gray-800">
                <td className="p-3 font-medium text-gray-900 dark:text-gray-100">{s.company || '—'}</td>
                <td className="p-3 text-gray-600 dark:text-gray-400">{s.job_title || '—'}</td>
                <td className="p-3">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      s.verdict === 'STRONG'
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                        : s.verdict === 'REJECT'
                          ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                    }`}
                  >
                    {s.verdict}
                  </span>
                </td>
                <td className="p-3 text-gray-500 dark:text-gray-400">{new Date(s.created_at).toLocaleString('en-IN')}</td>
              </tr>
            ))}
            {(!recentScreenings || recentScreenings.length === 0) && (
              <tr>
                <td colSpan={4} className="p-8 text-center text-gray-400 dark:text-gray-500">
                  No screenings yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
