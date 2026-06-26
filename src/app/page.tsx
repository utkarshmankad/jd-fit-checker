import Link from 'next/link'
import { Upload, Cpu, CheckSquare } from 'lucide-react'

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-white text-gray-900">
      {/* Nav */}
      <header className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-white border-b border-gray-100">
        <span className="font-bold text-lg" style={{ color: '#1B3A5C' }}>
          JD Fit Checker
        </span>
        <Link
          href="/auth/login"
          className="px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-opacity"
          style={{ backgroundColor: '#1B3A5C' }}
        >
          Sign In
        </Link>
      </header>

      {/* Hero */}
      <section className="flex flex-col items-center text-center px-6 py-24 w-full max-w-3xl mx-auto">
        <h1 className="text-5xl font-bold tracking-tight leading-tight" style={{ color: '#1B3A5C' }}>
          Stop reading JDs that aren&apos;t for you.
        </h1>
        <p className="mt-6 text-xl text-gray-500 max-w-xl leading-relaxed">
          Paste any job URL. Get an ATS score, role-level fit, and an instant verdict — in under 10
          seconds.
        </p>
        <div className="mt-10 flex flex-col items-center gap-3">
          <Link
            href="/auth/login"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-xl text-white font-semibold text-lg hover:opacity-90 transition-opacity"
            style={{ backgroundColor: '#1B3A5C' }}
          >
            Start screening free →
          </Link>
          <span className="text-sm text-gray-400">No credit card. 5 free screens.</span>
        </div>
        <div className="mt-12 flex flex-wrap justify-center gap-3">
          {['⚡ <10 sec per JD', '🎯 3-score verdict', '🚫 Auto-rejects .NET'].map((stat) => (
            <span
              key={stat}
              className="px-4 py-2 rounded-full text-sm font-medium bg-gray-100 text-gray-700"
            >
              {stat}
            </span>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-gray-50 px-6 py-24">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-14" style={{ color: '#1B3A5C' }}>
            From URL to verdict in three steps
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                Icon: Upload,
                title: 'Paste job URLs',
                body: 'Drop in one or twenty. LinkedIn, Naukri, Greenhouse, any career page.',
              },
              {
                Icon: Cpu,
                title: 'AI screens against your resume',
                body: 'ATS keyword match, role-level fit, and your hard-reject rules — all checked simultaneously.',
              },
              {
                Icon: CheckSquare,
                title: 'Get a ranked verdict table',
                body: 'STRONG / DECENT / WEAK / REJECT. Export to CSV or share with your coach.',
              },
            ].map(({ Icon, title, body }) => (
              <div key={title} className="bg-white rounded-xl p-8 border border-gray-200">
                <Icon className="mb-4" size={28} style={{ color: '#2E75B6' }} />
                <h3 className="font-semibold text-lg mb-2 text-gray-900">{title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section className="px-6 py-24">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-14" style={{ color: '#1B3A5C' }}>
            Built for senior engineers who value their time
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {[
              {
                persona: 'Engineering managers',
                body: "Screening 15+ JDs a week across LinkedIn and Naukri. Tired of reading to page 3 before discovering it's a .NET role.",
              },
              {
                persona: 'Staff+ engineers',
                body: 'Selective, not desperate. Want to apply to the right 5 roles, not spray 50 applications. Needs a signal-to-noise filter.',
              },
            ].map(({ persona, body }) => (
              <div key={persona} className="rounded-xl p-8 border border-gray-200">
                <h3 className="font-semibold text-lg mb-3" style={{ color: '#1B3A5C' }}>
                  {persona}
                </h3>
                <p className="text-gray-500 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="bg-gray-50 px-6 py-24">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-14" style={{ color: '#1B3A5C' }}>
            Simple pricing. No surprises.
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-2xl mx-auto">
            {/* Free */}
            <div className="bg-white rounded-xl p-8 border border-gray-200 flex flex-col">
              <p className="text-2xl font-bold text-gray-900 mb-6">Free forever</p>
              <ul className="space-y-3 flex-1 mb-8">
                {['5 screens / month', 'Manual paste only', 'CSV export', '3 sessions history'].map(
                  (f) => (
                    <li key={f} className="flex items-center gap-3 text-sm text-gray-600">
                      <SmallCheck />
                      {f}
                    </li>
                  )
                )}
              </ul>
              <Link
                href="/auth/login"
                className="block text-center py-3 rounded-lg border-2 font-medium text-sm hover:bg-gray-50 transition-colors"
                style={{ borderColor: '#1B3A5C', color: '#1B3A5C' }}
              >
                Get started free
              </Link>
            </div>

            {/* Paid */}
            <div
              className="bg-white rounded-xl p-8 border-2 flex flex-col"
              style={{ borderColor: '#1B3A5C' }}
            >
              <div className="mb-6">
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full text-white mb-3 inline-block"
                  style={{ backgroundColor: '#1B3A5C' }}
                >
                  MOST POPULAR
                </span>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-bold text-gray-900">₹499 / month</p>
                  <span className="text-sm text-gray-400">~$6</span>
                </div>
              </div>
              <ul className="space-y-3 flex-1 mb-8">
                {[
                  'Everything in Free',
                  'Unlimited screens',
                  'URL scraping (LinkedIn, Naukri, 50+ sites)',
                  'Shareable report links',
                  'Unlimited history',
                  'Priority support',
                ].map((f) => (
                  <li key={f} className="flex items-center gap-3 text-sm text-gray-600">
                    <SmallCheck />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/auth/login"
                className="block text-center py-3 rounded-lg font-medium text-sm text-white hover:opacity-90 transition-opacity"
                style={{ backgroundColor: '#1B3A5C' }}
              >
                Start paid plan →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="px-6 py-24" style={{ backgroundColor: '#1B3A5C' }}>
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-6">
            Your next role is in that list of 20 JDs. Let&apos;s find it.
          </h2>
          <Link
            href="/auth/login"
            className="inline-block px-8 py-4 rounded-xl font-semibold text-lg bg-white hover:bg-gray-100 transition-colors"
            style={{ color: '#1B3A5C' }}
          >
            Start screening now →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-8 bg-white border-t border-gray-200">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-sm text-gray-500">
            <span className="font-bold" style={{ color: '#1B3A5C' }}>
              JD Fit Checker
            </span>
            <span>Built by an EM, for EMs</span>
            <span>Made in Bangalore</span>
          </div>
          <div className="flex gap-4 text-sm text-gray-400">
            <Link href="/privacy" className="hover:text-gray-600 transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-gray-600 transition-colors">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

function SmallCheck() {
  return (
    <svg
      className="w-4 h-4 text-green-500 shrink-0"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  )
}
