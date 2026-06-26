import { createServiceClient } from '@/lib/supabase/service'
import type { SharedReport, ScreeningResult } from '@/types'

function scoreClass(n: number) {
  if (n >= 70) return 'text-green-700 font-semibold'
  if (n >= 50) return 'text-amber-600 font-semibold'
  return 'text-red-600 font-semibold'
}

function verdictClass(v: string) {
  const map: Record<string, string> = {
    STRONG: 'bg-green-100 text-green-800',
    DECENT: 'bg-amber-100 text-amber-800',
    WEAK: 'bg-gray-100 text-gray-700',
    REJECT: 'bg-red-100 text-red-800',
  }
  return map[v] ?? 'bg-gray-100 text-gray-700'
}

async function getReport(slug: string): Promise<SharedReport | null> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('shared_reports')
    .select('*')
    .eq('slug', slug)
    .gt('expires_at', new Date().toISOString())
    .single()

  if (error || !data) return null
  return data as SharedReport
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const report = await getReport(slug)

  if (!report) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-4 px-4">
          <h1 className="text-2xl font-bold text-gray-800">Report not found</h1>
          <p className="text-gray-500">This report has expired or doesn&apos;t exist.</p>
          <a href="/" className="text-blue-600 underline text-sm">
            ← Back to home
          </a>
        </div>
      </div>
    )
  }

  const results = report.results_snapshot as ScreeningResult[]
  const expiryDate = new Date(report.expires_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">JD Screening Report</h1>
            <p className="text-gray-500 mt-1 text-sm">
              Shared via JD Fit Checker &middot; Expires {expiryDate}
            </p>
          </div>
          <span className="text-sm text-gray-400">{results.length} role{results.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Results table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-6 py-3 font-medium text-gray-500 whitespace-nowrap">
                    Company
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 whitespace-nowrap">
                    Job title
                  </th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500 whitespace-nowrap">
                    ATS %
                  </th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500 whitespace-nowrap">
                    Role fit %
                  </th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500 whitespace-nowrap">
                    Composite %
                  </th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500 whitespace-nowrap">
                    Verdict
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100">
                    <td className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">
                      {r.company ?? '—'}
                    </td>
                    <td className="px-4 py-4 text-gray-700 max-w-xs">
                      <span className="line-clamp-2">{r.job_title ?? '—'}</span>
                    </td>
                    <td className={`px-4 py-4 text-center whitespace-nowrap ${scoreClass(r.ats_score)}`}>
                      {r.ats_score}%
                    </td>
                    <td className={`px-4 py-4 text-center whitespace-nowrap ${scoreClass(r.role_level_score)}`}>
                      {r.role_level_score}%
                    </td>
                    <td className={`px-4 py-4 text-center whitespace-nowrap ${scoreClass(r.composite_score)}`}>
                      {r.composite_score}%
                    </td>
                    <td className="px-4 py-4 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${verdictClass(r.verdict)}`}
                      >
                        {r.verdict}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Acquisition CTA */}
        <div className="rounded-xl bg-blue-50 border border-blue-100 p-6 text-center">
          <p className="text-blue-900 font-semibold text-lg">Screen your own JDs free</p>
          <p className="text-blue-700 text-sm mt-1">
            Paste job URLs and get instant fit scores against your resume.
          </p>
          <a
            href={process.env.NEXT_PUBLIC_APP_URL ?? '/'}
            className="inline-block mt-4 px-6 py-2 rounded-lg text-white font-medium text-sm transition-colors"
            style={{ backgroundColor: '#1B3A5C' }}
          >
            Get started free →
          </a>
        </div>
      </div>
    </div>
  )
}
