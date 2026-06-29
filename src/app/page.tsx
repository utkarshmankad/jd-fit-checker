import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Link2, Cpu, LayoutList } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import AuthHashRedirect from '@/components/auth-hash-redirect'

export default async function LandingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/dashboard')

  return (
    <div className="min-h-screen flex flex-col bg-white text-gray-900">
      {/* Handles Supabase invite implicit-flow hash tokens client-side */}
      <AuthHashRedirect />

      {/* ── Nav ── */}
      <header className="sticky top-0 z-30 bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <span className="font-bold text-lg" style={{ color: '#1B3A5C' }}>
            JD Fit Checker
          </span>
          <Link
            href="/auth/login"
            className="px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
            style={{ backgroundColor: '#1B3A5C', color: '#fff' }}
          >
            Sign in →
          </Link>
        </div>
      </header>

      {/* ── Hero ── */}
      <section style={{ backgroundColor: '#1B3A5C' }} className="px-6 py-28">
        <div className="max-w-3xl mx-auto flex flex-col items-center text-center">
          <h1 className="text-5xl font-bold tracking-tight leading-tight text-white">
            Screen 20 JDs in 60 seconds.
          </h1>
          <p className="mt-6 text-xl text-blue-100 max-w-xl leading-relaxed">
            Paste job URLs or JD text. Get ATS score, role-level fit, and an instant verdict —
            before you waste time applying.
          </p>
          <div className="mt-10 flex flex-col items-center gap-3">
            <Link
              href="/auth/login"
              className="inline-block px-8 py-4 rounded-xl font-semibold text-lg bg-white hover:bg-gray-100 transition-colors"
              style={{ color: '#1B3A5C' }}
            >
              Start screening free →
            </Link>
            <span className="text-sm text-blue-200">Free tier — 5 screens/month. No credit card.</span>
          </div>
          <div className="mt-12 flex flex-wrap justify-center gap-3">
            {[
              '⚡ Under 10 sec per JD',
              '🎯 3-score verdict',
              '🚫 Auto-rejects .NET roles',
            ].map((stat) => (
              <span
                key={stat}
                className="px-4 py-2 rounded-full text-sm font-medium bg-white"
                style={{ color: '#1B3A5C' }}
              >
                {stat}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="bg-white px-6 py-24">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-14" style={{ color: '#1B3A5C' }}>
            From URL to verdict in three steps.
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                Icon: Link2,
                title: 'Paste job URLs',
                body: 'Drop in up to 20 URLs from LinkedIn, Naukri, Greenhouse, or any career page. Or paste raw JD text directly.',
              },
              {
                Icon: Cpu,
                title: 'AI screens against your profile',
                body: 'Your resume, tech stack dealbreakers, and seniority floor — all checked simultaneously against every JD.',
              },
              {
                Icon: LayoutList,
                title: 'Get a ranked verdict table',
                body: 'STRONG / DECENT / WEAK / REJECT with ATS score, role-level score, and gap analysis. Export to CSV or share with your coach.',
              },
            ].map(({ Icon, title, body }) => (
              <div key={title} className="rounded-xl p-8 border border-gray-200">
                <Icon className="mb-4" size={28} style={{ color: '#2E75B6' }} />
                <h3 className="font-semibold text-lg mb-2 text-gray-900">{title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Who it's for ── */}
      <section className="px-6 py-24" style={{ backgroundColor: '#F8FAFC' }}>
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-14" style={{ color: '#1B3A5C' }}>
            Built for senior engineers who value their time.
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {[
              {
                persona: 'Engineering managers',
                body: "Screening 10–20 JDs a week across LinkedIn and Naukri. Tired of reading 3 pages before discovering it's a .NET role.",
              },
              {
                persona: 'Staff+ engineers',
                body: 'Applying selectively, not spraying. Need a signal-to-noise filter that matches your actual seniority and domain.',
              },
            ].map(({ persona, body }) => (
              <div key={persona} className="bg-white rounded-xl p-8 border border-gray-200">
                <h3 className="font-semibold text-lg mb-3" style={{ color: '#1B3A5C' }}>
                  {persona}
                </h3>
                <p className="text-gray-500 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section className="bg-white px-6 py-24">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-14" style={{ color: '#1B3A5C' }}>
            Simple pricing.
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-2xl mx-auto">

            {/* Free */}
            <div className="bg-white rounded-xl p-8 border border-gray-200 flex flex-col">
              <div className="mb-2">
                <p className="text-3xl font-bold text-gray-900">Free</p>
                <p className="text-sm text-gray-400 mt-1">5 screens per month</p>
              </div>
              <ul className="mt-6 space-y-3 flex-1 mb-8">
                {[
                  'URL + JD text screening',
                  'ATS + role-level scores',
                  'Hard-reject auto-filter',
                  'CSV export',
                  'Shareable report links',
                ].map((f) => (
                  <li key={f} className="flex items-center gap-3 text-sm text-gray-600">
                    <CheckIcon />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/auth/login"
                className="block text-center py-3 rounded-lg border-2 font-semibold text-sm hover:bg-gray-50 transition-colors"
                style={{ borderColor: '#1B3A5C', color: '#1B3A5C' }}
              >
                Get started free →
              </Link>
            </div>

            {/* Paid */}
            <div
              className="bg-white rounded-xl p-8 flex flex-col border-2 shadow-md"
              style={{ borderColor: '#1B3A5C' }}
            >
              <div className="mb-2">
                <span
                  className="text-xs font-bold px-2.5 py-1 rounded-full text-white inline-block mb-3"
                  style={{ backgroundColor: '#1B3A5C' }}
                >
                  ONE-TIME
                </span>
                <p className="text-3xl font-bold text-gray-900">₹499</p>
                <p className="text-sm text-gray-400 mt-1">one-time payment</p>
                <p className="text-xs text-gray-400 mt-0.5">Unlimited screens, forever</p>
              </div>
              <ul className="mt-6 space-y-3 flex-1 mb-8">
                {[
                  'Everything in Free',
                  'Unlimited screens',
                  'LinkedIn bulk import (up to 20 URLs)',
                  'Full screening history',
                  'Priority support',
                ].map((f) => (
                  <li key={f} className="flex items-center gap-3 text-sm text-gray-600">
                    <CheckIcon />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/auth/login"
                className="block text-center py-3 rounded-lg font-semibold text-sm text-white hover:opacity-90 transition-opacity"
                style={{ backgroundColor: '#1B3A5C' }}
              >
                Upgrade to paid →
              </Link>
            </div>

          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="px-6 py-24" style={{ backgroundColor: '#1B3A5C' }}>
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-3">
            Your next role is in that list of JDs.
          </h2>
          <p className="text-blue-200 text-lg mb-10">Stop reading them one by one.</p>
          <Link
            href="/auth/login"
            className="inline-block px-8 py-4 rounded-xl font-semibold text-lg bg-white hover:bg-gray-100 transition-colors"
            style={{ color: '#1B3A5C' }}
          >
            Start screening free →
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-white border-t border-gray-200 px-6 py-5">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <span className="font-bold text-sm" style={{ color: '#1B3A5C' }}>
            JD Fit Checker
          </span>
          <span className="text-sm text-gray-400 hidden sm:block">
            Built by an EM, for EMs · Bangalore
          </span>
          <Link
            href="/auth/login"
            className="text-sm font-medium hover:underline"
            style={{ color: '#1B3A5C' }}
          >
            Sign in →
          </Link>
        </div>
      </footer>
    </div>
  )
}

function CheckIcon() {
  return (
    <svg className="w-4 h-4 shrink-0 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  )
}
