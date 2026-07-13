import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/service'
import type { SharedReport, ScreeningResult } from '@/types'
import { calculateTimeSaved } from '@/lib/utils/time-saved'
import { getVerdictDisplay } from '@/lib/utils/verdicts'
import { LogoMark } from '@/components/Logo'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://jobsnob.fyi'

async function getReport(slug: string): Promise<{ report: SharedReport; userName: string | null } | null> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('shared_reports')
    .select('*')
    .eq('slug', slug)
    .gt('expires_at', new Date().toISOString())
    .single()

  if (error || !data) return null

  const report = data as SharedReport

  const { data: profile } = await service
    .from('profiles')
    .select('full_name')
    .eq('id', report.user_id)
    .single()

  return { report, userName: profile?.full_name ?? null }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const result = await getReport(slug)

  const title = result
    ? `${result.userName ? `${result.userName}'s` : 'A'} job list, judged.`
    : 'A job list, judged.'
  const description = result
    ? `Jobsnob applied ${result.userName ? 'their' : 'the'} standards to ${result.report.results_snapshot.length} jobs. Here's the verdict.`
    : 'View this shared job list from JobSnob.'

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${APP_URL}/report/${slug}`,
      siteName: 'JobSnob',
      images: [{ url: `${APP_URL}/og-report.png`, width: 1200, height: 630, alt: 'JobSnob shared report' }],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`${APP_URL}/og-report.png`],
    },
  }
}

function scoreTextClass(n: number) {
  if (n >= 70) return 'text-green-700 dark:text-green-400 font-semibold'
  if (n >= 50) return 'text-amber-600 dark:text-amber-400 font-semibold'
  return 'text-red-600 dark:text-red-400 font-semibold'
}

function scoreBarColor(n: number) {
  if (n >= 70) return 'bg-green-500 dark:bg-green-600'
  if (n >= 50) return 'bg-amber-500 dark:bg-amber-600'
  return 'bg-red-500 dark:bg-red-600'
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex flex-col items-center gap-1.5 min-w-[3rem]">
      <span className={`font-bold text-sm ${scoreTextClass(score)}`}>{score}</span>
      <div className="w-12 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-1.5 rounded-full ${scoreBarColor(score)}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  )
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const result = await getReport(slug)

  if (!result) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-800/50">
        <div className="text-center space-y-4 px-4">
          <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center mx-auto mb-2">
            <span className="text-2xl">🔍</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-200">This one&apos;s gone.</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">The link expired, or it never existed.</p>
          <a href={APP_URL}
            className="inline-block mt-2 px-5 py-2 rounded-lg text-white font-medium text-sm"
            style={{ backgroundColor: '#1B3A5C' }}>
            Want Jobsnob to judge your list? →
          </a>
        </div>
      </div>
    )
  }

  const { report, userName } = result
  const results = report.results_snapshot as ScreeningResult[]
  const expiryDate = new Date(report.expires_at).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  const LAUNCH_MODE = process.env.LAUNCH_MODE === 'true'
  const BETA_LIMIT = parseInt(process.env.BETA_TOTAL_LIMIT || '25')
  const WEEKLY_LIMIT = parseInt(process.env.FREE_WEEKLY_LIMIT || '3')
  const freeSubtitle = LAUNCH_MODE ? `${BETA_LIMIT} free screens` : `${WEEKLY_LIMIT} free screens/week`
  const PRICING_ENABLED = process.env.NEXT_PUBLIC_PRICING_ENABLED === 'true'

  const mainResults = results.filter((r) => r.verdict !== 'REJECT')
  const rejectResults = results.filter((r) => r.verdict === 'REJECT')
  const counts = {
    STRONG: results.filter((r) => r.verdict === 'STRONG').length,
    DECENT: results.filter((r) => r.verdict === 'DECENT').length,
    WEAK: results.filter((r) => r.verdict === 'WEAK').length,
    REJECT: rejectResults.length,
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] dark:bg-gray-950">

      {/* ── CTA header ── */}
      <header style={{ backgroundColor: '#1B3A5C' }} className="px-6 py-4">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="text-blue-200 dark:text-blue-300 text-xs font-medium uppercase tracking-wide mb-1">
              {userName ? `${userName}'s job list, judged.` : 'A job list, judged.'}
            </p>
            <h1 className="text-white font-bold text-xl leading-tight">
              Jobsnob applied {userName ? 'their' : 'the'} standards to {results.length} job{results.length !== 1 ? 's' : ''}. Here&apos;s the verdict.
            </h1>
            {counts.REJECT > 0 && (
              <p className="text-blue-300 dark:text-blue-400 text-sm mt-1">
                {counts.REJECT} dismissed before you&apos;d have finished reading them
              </p>
            )}
          </div>
          <a href={`${APP_URL}/auth/login`}
            className="shrink-0 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            style={{ color: '#1B3A5C' }}>
            Want Jobsnob to judge your list? →
          </a>
        </div>
      </header>

      {/* ── Summary pills ── */}
      <div className="px-6 py-4 bg-[#EEF2F7] dark:bg-gray-900 border-b border-[#D1DDE9] dark:border-gray-700">
        <div className="max-w-5xl mx-auto flex flex-wrap gap-2 items-center">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 mr-1">Summary:</span>
          {counts.STRONG > 0 && (
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getVerdictDisplay('STRONG').bg} ${getVerdictDisplay('STRONG').color} border ${getVerdictDisplay('STRONG').border}`}>
              {getVerdictDisplay('STRONG').icon} {counts.STRONG} {getVerdictDisplay('STRONG').label}
            </span>
          )}
          {counts.DECENT > 0 && (
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getVerdictDisplay('DECENT').bg} ${getVerdictDisplay('DECENT').color} border ${getVerdictDisplay('DECENT').border}`}>
              {getVerdictDisplay('DECENT').icon} {counts.DECENT} {getVerdictDisplay('DECENT').label}
            </span>
          )}
          {counts.WEAK > 0 && (
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getVerdictDisplay('WEAK').bg} ${getVerdictDisplay('WEAK').color} border ${getVerdictDisplay('WEAK').border}`}>
              {getVerdictDisplay('WEAK').icon} {counts.WEAK} {getVerdictDisplay('WEAK').label}
            </span>
          )}
          {counts.REJECT > 0 && (
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getVerdictDisplay('REJECT').bg} ${getVerdictDisplay('REJECT').color} border ${getVerdictDisplay('REJECT').border}`}>
              {getVerdictDisplay('REJECT').icon} {counts.REJECT} {getVerdictDisplay('REJECT').label}
            </span>
          )}
          <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">Expires {expiryDate}</span>
        </div>
      </div>

      {/* ── Main content ── */}
      <main className="flex-1 px-6 py-8">
        <div className="max-w-5xl mx-auto space-y-6">

          {/* Time-saved hero card */}
          {counts.REJECT > 0 ? (
            <div style={{ backgroundColor: '#1B3A5C' }} className="rounded-xl px-6 py-6 text-white">
              <p className="text-5xl font-bold tracking-tight leading-none">{calculateTimeSaved(counts.REJECT)}</p>
              <p className="text-blue-200 dark:text-blue-300 mt-3 text-base">
                saved — by skipping {counts.REJECT} job{counts.REJECT !== 1 ? 's' : ''} that weren&apos;t worth the time
              </p>
            </div>
          ) : results.length > 0 ? (
            <div style={{ backgroundColor: '#1B3A5C' }} className="rounded-xl px-6 py-4 text-white flex items-center gap-3">
              <span className="text-green-400 dark:text-green-500 text-xl font-bold">✓</span>
              <p>All {results.length} jobs cleared the dealbreaker filters — none were obvious time-wasters.</p>
            </div>
          ) : null}

          {/* Results table */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                    <th className="text-left px-6 py-3 font-medium text-gray-500 dark:text-gray-400">Company</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Job title</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-500 dark:text-gray-400 hidden md:table-cell">ATS</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-500 dark:text-gray-400 hidden md:table-cell">Role fit</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Composite</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {mainResults.map((r) => (
                    <tr key={r.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <td className="px-6 py-4 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">
                        {r.company ?? '—'}
                      </td>
                      <td className="px-4 py-4 text-gray-700 dark:text-gray-300 max-w-xs">
                        {r.analysis_json?.headline && (
                          <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 mb-0.5 line-clamp-1">{r.analysis_json.headline}</p>
                        )}
                        <span className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">{r.job_title ?? '—'}</span>
                      </td>
                      <td className="px-4 py-4 text-center hidden md:table-cell">
                        <ScoreBar score={r.ats_score} />
                      </td>
                      <td className="px-4 py-4 text-center hidden md:table-cell">
                        <ScoreBar score={r.role_level_score} />
                      </td>
                      <td className="px-4 py-4 text-center">
                        <ScoreBar score={r.composite_score} />
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${getVerdictDisplay(r.verdict).bg} ${getVerdictDisplay(r.verdict).color} border ${getVerdictDisplay(r.verdict).border}`}>
                          {getVerdictDisplay(r.verdict).icon} {getVerdictDisplay(r.verdict).label}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Rejected roles section */}
            {rejectResults.length > 0 && (
              <>
                <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-3 bg-red-50 dark:bg-red-900/20">
                  <p className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide">Auto-rejected by hard-reject rules</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {rejectResults.map((r) => (
                        <tr key={r.id} className="border-b border-gray-100 dark:border-gray-800 border-l-4 border-l-red-400">
                          <td className="px-6 py-3 font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                            {r.company ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400 max-w-xs">
                            <span className="line-clamp-1 text-xs">{r.job_title ?? '—'}</span>
                            {r.hard_reject_reasons?.[0] && (
                              <span className="block text-red-500 dark:text-red-400 text-xs mt-0.5">✕ {r.hard_reject_reasons[0]}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center hidden md:table-cell text-gray-300 dark:text-gray-600">—</td>
                          <td className="px-4 py-3 text-center hidden md:table-cell text-gray-300 dark:text-gray-600">—</td>
                          <td className="px-4 py-3 text-center text-gray-300 dark:text-gray-600">—</td>
                          <td className="px-4 py-3 text-center">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 border border-red-300 dark:border-red-700">✕ Skip This One</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* Watermark footer row */}
            <div className="border-t border-gray-100 dark:border-gray-800 px-6 py-3 bg-gray-50 dark:bg-gray-800/50 flex items-center justify-between">
              <span className="text-xs text-gray-400 dark:text-gray-500">
                Scored by AI against resume + hard-reject rules · Not a guarantee of interview success
              </span>
              <a href={APP_URL} className="text-xs font-semibold" style={{ color: '#1B3A5C' }}>
                <span className="inline-flex items-center gap-1.5"><LogoMark size={14} />Powered by JobSnob</span>
              </a>
            </div>
          </div>

          {/* CTA acquisition block */}
          <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm">
            <div style={{ backgroundColor: '#1B3A5C' }} className="px-6 py-6 text-center">
              <p className="text-white font-bold text-xl mb-2">Want Jobsnob to judge your list?</p>
              <p className="text-blue-200 dark:text-blue-300 text-sm mb-5 max-w-md mx-auto leading-relaxed">
                It&apos;s free to start. No promises it&apos;ll be kind.
              </p>
              <a href={`${APP_URL}/auth/login`}
                className="inline-block px-8 py-3 rounded-xl font-semibold text-sm bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                style={{ color: '#1B3A5C' }}>
                Judge my jobs free — no credit card →
              </a>
              <p className="text-blue-300 dark:text-blue-400 text-xs mt-3">{freeSubtitle}, no key setup needed to start.</p>
            </div>
            <div className="bg-white dark:bg-gray-900 px-6 py-4">
              <div className={`grid ${PRICING_ENABLED ? 'grid-cols-3' : 'grid-cols-2'} gap-4 text-center`}>
                {[
                  { stat: '20 JDs', label: 'at once' },
                  { stat: '<60 sec', label: 'per batch' },
                  ...(PRICING_ENABLED ? [{ stat: '₹499', label: 'one-time unlock' }] : []),
                ].map(({ stat, label }) => (
                  <div key={stat}>
                    <p className="font-bold text-gray-900 dark:text-gray-100" style={{ color: '#1B3A5C' }}>{stat}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-6 py-5">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 font-bold text-sm" style={{ color: '#1B3A5C' }}><LogoMark size={16} />JobSnob</span>
          <span className="text-sm text-gray-400 dark:text-gray-500 hidden sm:block">
            For senior engineers and EMs with standards
          </span>
          <a href={`${APP_URL}/auth/login`} className="text-sm font-medium hover:underline" style={{ color: '#1B3A5C' }}>
            Judge my jobs free →
          </a>
        </div>
      </footer>
    </div>
  )
}
