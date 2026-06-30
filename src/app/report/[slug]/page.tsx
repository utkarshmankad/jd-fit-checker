import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/service'
import type { SharedReport, ScreeningResult } from '@/types'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://jdfit.in'

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
    ? `JD Screening Report — ${result.report.results_snapshot.length} roles ranked`
    : 'JD Screening Report'
  const description = result
    ? `${result.userName ? `${result.userName} screened` : 'Screened'} ${result.report.results_snapshot.length} job descriptions with AI. See fit scores, gap analysis, and auto-rejected roles.`
    : 'View this shared job screening report from JD Fit Checker.'

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${APP_URL}/report/${slug}`,
      siteName: 'JD Fit Checker',
      images: [{ url: `${APP_URL}/og-report.png`, width: 1200, height: 630, alt: 'JD Fit Checker shared report' }],
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
  if (n >= 70) return 'text-green-700 font-semibold'
  if (n >= 50) return 'text-amber-600 font-semibold'
  return 'text-red-600 font-semibold'
}

function scoreBarColor(n: number) {
  if (n >= 70) return 'bg-green-500'
  if (n >= 50) return 'bg-amber-500'
  return 'bg-red-500'
}

const VERDICT_CONFIG: Record<string, { cls: string; label: string }> = {
  STRONG: { cls: 'bg-green-100 text-green-800 border border-green-300', label: '✦ Strong match' },
  DECENT: { cls: 'bg-amber-100 text-amber-800 border border-amber-300', label: '◉ Decent match' },
  WEAK:   { cls: 'bg-gray-100 text-gray-600 border border-gray-300',   label: '○ Weak match' },
  REJECT: { cls: 'bg-red-100 text-red-800 border border-red-300',      label: '✕ Rejected' },
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex flex-col items-center gap-1.5 min-w-[3rem]">
      <span className={`font-bold text-sm ${scoreTextClass(score)}`}>{score}</span>
      <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden">
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-4 px-4">
          <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center mx-auto mb-2">
            <span className="text-2xl">🔍</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Report not found</h1>
          <p className="text-gray-500 text-sm">This report has expired or the link is invalid.</p>
          <a href={APP_URL}
            className="inline-block mt-2 px-5 py-2 rounded-lg text-white font-medium text-sm"
            style={{ backgroundColor: '#1B3A5C' }}>
            Screen your own JDs →
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

  const mainResults = results.filter((r) => r.verdict !== 'REJECT')
  const rejectResults = results.filter((r) => r.verdict === 'REJECT')
  const counts = {
    STRONG: results.filter((r) => r.verdict === 'STRONG').length,
    DECENT: results.filter((r) => r.verdict === 'DECENT').length,
    WEAK: results.filter((r) => r.verdict === 'WEAK').length,
    REJECT: rejectResults.length,
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#F8FAFC' }}>

      {/* ── CTA header ── */}
      <header style={{ backgroundColor: '#1B3A5C' }} className="px-6 py-4">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="text-blue-200 text-xs font-medium uppercase tracking-wide mb-1">
              {userName ? `${userName}'s screening report` : 'Job screening report'}
            </p>
            <h1 className="text-white font-bold text-xl leading-tight">
              {results.length} role{results.length !== 1 ? 's' : ''} ranked by AI fit analysis
            </h1>
            {counts.REJECT > 0 && (
              <p className="text-blue-300 text-sm mt-1">
                {counts.REJECT} role{counts.REJECT !== 1 ? 's' : ''} auto-rejected before scoring
              </p>
            )}
          </div>
          <a href={`${APP_URL}/auth/login`}
            className="shrink-0 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm bg-white hover:bg-gray-100 transition-colors"
            style={{ color: '#1B3A5C' }}>
            Screen your own job list free →
          </a>
        </div>
      </header>

      {/* ── Summary pills ── */}
      <div className="px-6 py-4" style={{ backgroundColor: '#EEF2F7', borderBottom: '1px solid #D1DDE9' }}>
        <div className="max-w-5xl mx-auto flex flex-wrap gap-2 items-center">
          <span className="text-xs font-medium text-gray-500 mr-1">Summary:</span>
          {counts.STRONG > 0 && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800 border border-green-200">
              ✦ {counts.STRONG} Strong
            </span>
          )}
          {counts.DECENT > 0 && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
              ◉ {counts.DECENT} Decent
            </span>
          )}
          {counts.WEAK > 0 && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 border border-gray-200">
              ○ {counts.WEAK} Weak
            </span>
          )}
          {counts.REJECT > 0 && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200">
              ✕ {counts.REJECT} Auto-rejected
            </span>
          )}
          <span className="ml-auto text-xs text-gray-400">Expires {expiryDate}</span>
        </div>
      </div>

      {/* ── Main content ── */}
      <main className="flex-1 px-6 py-8">
        <div className="max-w-5xl mx-auto space-y-6">

          {/* Results table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-6 py-3 font-medium text-gray-500">Company</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Job title</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-500 hidden md:table-cell">ATS</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-500 hidden md:table-cell">Role fit</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-500">Composite</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-500">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {mainResults.map((r) => (
                    <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">
                        {r.company ?? '—'}
                      </td>
                      <td className="px-4 py-4 text-gray-700 max-w-xs">
                        {r.analysis_json?.headline && (
                          <p className="text-xs font-semibold text-gray-800 mb-0.5 line-clamp-1">{r.analysis_json.headline}</p>
                        )}
                        <span className="text-xs text-gray-500 line-clamp-1">{r.job_title ?? '—'}</span>
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
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${VERDICT_CONFIG[r.verdict]?.cls ?? 'bg-gray-100 text-gray-600 border border-gray-300'}`}>
                          {VERDICT_CONFIG[r.verdict]?.label ?? r.verdict}
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
                <div className="border-t border-gray-200 px-6 py-3 bg-red-50">
                  <p className="text-xs font-semibold text-red-600 uppercase tracking-wide">Auto-rejected by hard-reject rules</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {rejectResults.map((r) => (
                        <tr key={r.id} className="border-b border-gray-100 border-l-4 border-l-red-400">
                          <td className="px-6 py-3 font-medium text-gray-700 whitespace-nowrap">
                            {r.company ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-gray-500 max-w-xs">
                            <span className="line-clamp-1 text-xs">{r.job_title ?? '—'}</span>
                            {r.hard_reject_reasons?.[0] && (
                              <span className="block text-red-500 text-xs mt-0.5">✕ {r.hard_reject_reasons[0]}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center hidden md:table-cell text-gray-300">—</td>
                          <td className="px-4 py-3 text-center hidden md:table-cell text-gray-300">—</td>
                          <td className="px-4 py-3 text-center text-gray-300">—</td>
                          <td className="px-4 py-3 text-center">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800 border border-red-300">✕ Rejected</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* Watermark footer row */}
            <div className="border-t border-gray-100 px-6 py-3 bg-gray-50 flex items-center justify-between">
              <span className="text-xs text-gray-400">
                Scored by AI against resume + hard-reject rules · Not a guarantee of interview success
              </span>
              <a href={APP_URL} className="text-xs font-semibold" style={{ color: '#1B3A5C' }}>
                Powered by JD Fit Checker
              </a>
            </div>
          </div>

          {/* CTA acquisition block */}
          <div className="rounded-xl overflow-hidden border border-gray-200 shadow-sm">
            <div style={{ backgroundColor: '#1B3A5C' }} className="px-6 py-6 text-center">
              <p className="text-white font-bold text-xl mb-2">Screen your own job list free</p>
              <p className="text-blue-200 text-sm mb-5 max-w-md mx-auto leading-relaxed">
                Paste up to 20 job URLs. Get AI-ranked fit scores, auto-rejection for dealbreakers,
                and gap analysis — in under 60 seconds.
              </p>
              <a href={`${APP_URL}/auth/login`}
                className="inline-block px-8 py-3 rounded-xl font-semibold text-sm bg-white hover:bg-gray-100 transition-colors"
                style={{ color: '#1B3A5C' }}>
                Get started free — no credit card →
              </a>
              <p className="text-blue-300 text-xs mt-3">5 free screens. Bring your own AI key.</p>
            </div>
            <div className="bg-white px-6 py-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                {[
                  { stat: '20 JDs', label: 'at once' },
                  { stat: '<60 sec', label: 'per batch' },
                  { stat: '₹499', label: 'one-time unlock' },
                ].map(({ stat, label }) => (
                  <div key={stat}>
                    <p className="font-bold text-gray-900" style={{ color: '#1B3A5C' }}>{stat}</p>
                    <p className="text-xs text-gray-500">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-gray-200 bg-white px-6 py-5">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="font-bold text-sm" style={{ color: '#1B3A5C' }}>JD Fit Checker</span>
          <span className="text-sm text-gray-400 hidden sm:block">
            Resume-to-JD fit analysis for senior engineers and EMs
          </span>
          <a href={`${APP_URL}/auth/login`} className="text-sm font-medium hover:underline" style={{ color: '#1B3A5C' }}>
            Start screening free →
          </a>
        </div>
      </footer>
    </div>
  )
}
