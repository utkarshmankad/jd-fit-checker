import type { Metadata } from 'next'
import Link from 'next/link'
import DemoActions from '@/components/dashboard/DemoActions'
import { SAMPLE_RESULTS } from '@/lib/sample-data'
import { getVerdictDisplay } from '@/lib/utils/verdicts'

export const metadata: Metadata = {
  title: 'Sample job verdicts | JobSnob',
  description: 'Explore fictional JobSnob verdicts before signing in. No resume or API key needed.',
}

export default function DemoPage() {
  return (
    <main className="min-h-screen bg-[#F8FAFC] px-4 py-8 text-gray-900 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <Link href="/" className="text-sm font-semibold text-[#1B3A5C] underline underline-offset-4">← JobSnob home</Link>
        <header className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-wide text-[#1B3A5C]">Fictional sample batch</p>
          <h1 className="text-3xl font-bold tracking-tight">See which jobs deserve your time.</h1>
          <p className="text-gray-600">These are illustrative verdicts, not live vacancies or hiring decisions. They are not based on your profile.</p>
        </header>
        <aside className="rounded-xl border border-blue-200 bg-blue-50 p-5">
          <h2 className="font-semibold">Example candidate and standards</h2>
          <p className="mt-2 text-sm leading-relaxed">An engineering manager with 10+ years of experience, teams of 8 people, Java, Kafka, AWS, SQL and some Kotlin. Product and payments experience; no Spark, Go, iOS or logistics experience. Wants a management role reporting to a Director, and excludes .NET roles.</p>
          <p className="mt-2 text-sm text-gray-600">Your own resume and dealbreakers will produce different results. Reading this demo uses no screening quota.</p>
        </aside>
        <section aria-label="Sample verdicts" className="space-y-3">
          {SAMPLE_RESULTS.map((result, index) => {
            const display = getVerdictDisplay(result.verdict)
            return (
              <article key={result.id} className="rounded-xl border border-gray-200 bg-white p-5"
                style={{ borderLeft: `4px solid ${display.barColor}` }}>
                <p className="text-xs text-gray-500">Example employer {index + 1}</p>
                <h2 className="mt-1 font-semibold">{result.job_title}</h2>
                <p className="mt-2 text-lg font-bold" style={{ color: display.barColor }}>{result.verdict} — {display.verdictLine}</p>
                <p className="mt-1 text-sm text-gray-600">{result.analysis_json?.headline}</p>
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer rounded py-1 font-semibold text-[#1B3A5C] focus-visible:outline-2 focus-visible:outline-offset-2">Why this verdict</summary>
                  <div className="mt-3 space-y-3 text-gray-700">
                    {result.hard_reject_reasons.length > 0 && (
                      <ul className="list-disc space-y-1 pl-5">{result.hard_reject_reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                    )}
                    {result.analysis_json?.gap_analysis && <p>{result.analysis_json.gap_analysis}</p>}
                    <p className="font-medium">{result.analysis_json?.recommendation}</p>
                  </div>
                </details>
              </article>
            )
          })}
        </section>
        <footer className="space-y-3 rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-semibold">Try it with your own standards</h2>
          <p className="text-sm text-gray-600">Sign in, add your resume and preferences, then paste a job URL or description to get your first real verdict.</p>
          <DemoActions />
        </footer>
      </div>
    </main>
  )
}
