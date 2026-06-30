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
      <section style={{ backgroundColor: '#1B3A5C' }} className="px-6 py-16 md:py-28">
        <div className="max-w-3xl mx-auto flex flex-col items-center text-center">
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight leading-tight text-white">
            Stop applying to jobs that were never going to work.
          </h1>
          <p className="mt-6 text-lg md:text-xl text-blue-100 max-w-xl leading-relaxed">
            Jobscan tells you how to apply to one job. JD Fit Checker tells you which twenty are
            even worth your time. Paste your job URLs — get a ranked verdict in 60 seconds.
          </p>
          <div className="mt-10 flex flex-col items-center gap-3 w-full sm:w-auto">
            <Link
              href="/auth/login"
              className="w-full sm:w-auto inline-block px-8 py-4 rounded-xl font-semibold text-lg bg-white hover:bg-gray-100 transition-colors text-center"
              style={{ color: '#1B3A5C' }}
            >
              Screen my first 20 JDs free →
            </Link>
            <span className="text-sm text-blue-200">5 free screens. No credit card. Bring your own AI key.</span>
          </div>
          <div className="mt-12 flex flex-col sm:flex-row sm:flex-wrap justify-center gap-2 sm:gap-3 w-full sm:w-auto">
            {[
              '⚡ Under 10 sec per JD',
              '🎯 Ranked verdict table',
              '🚫 Auto-rejects bad fits',
            ].map((stat) => (
              <span
                key={stat}
                className="px-4 py-2 rounded-full text-sm font-medium bg-white text-center"
                style={{ color: '#1B3A5C' }}
              >
                {stat}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Positioning contrast ── */}
      <section className="bg-white px-6 py-20 border-b border-gray-100">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-3" style={{ color: '#1B3A5C' }}>
            Built for a different moment in your search.
          </h2>
          <p className="text-center text-gray-500 mb-12 text-sm">
            Resume optimizers are great — just not for this problem.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left: competitors */}
            <div className="rounded-xl border border-gray-200 p-7">
              <p className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-5">
                Resume optimizers (Jobscan, Rezi, Enhancv)
              </p>
              <ul className="space-y-3.5">
                {[
                  'Screen one job at a time',
                  "Assume you've already decided to apply",
                  'Optimize keywords to pass the bot',
                  'Built for volume applying',
                  '$30–50/month subscription',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-gray-500">
                    <span className="mt-0.5 shrink-0 text-gray-300">—</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Right: JD Fit Checker */}
            <div
              className="rounded-xl p-7"
              style={{ border: '2px solid #1B3A5C', backgroundColor: '#F0F4F8' }}
            >
              <p className="text-sm font-semibold uppercase tracking-wide mb-5" style={{ color: '#1B3A5C' }}>
                JD Fit Checker
              </p>
              <ul className="space-y-3.5">
                {[
                  'Screen up to 20 jobs at once, ranked',
                  'Decide which jobs deserve an application',
                  'Auto-reject roles that fail your hard rules',
                  'Built for selective, senior job seekers',
                  '₹499 one-time, or bring your own AI key',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm" style={{ color: '#1B3A5C' }}>
                    <span className="mt-0.5 shrink-0 text-green-500 font-bold">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
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
                persona: 'Senior engineering managers',
                body: "You're screening 15–20 roles a week. Half are .NET shops or IC roles in disguise. You don't need help applying — you need help deciding what's worth applying to.",
              },
              {
                persona: 'Staff+ engineers who apply selectively',
                body: "You're not spraying 100 applications. You want the right 5. You need a fast signal on seniority match and dealbreakers before you invest time in any single role.",
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
          <h2 className="text-3xl font-bold text-center mb-3" style={{ color: '#1B3A5C' }}>
            Simple pricing.
          </h2>
          <p className="text-center text-gray-500 text-sm mb-14">
            No $50/month subscription. No editing-then-rescanning treadmill. Screen, decide, move on.
          </p>
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
      <section className="px-6 py-16 md:py-24" style={{ backgroundColor: '#1B3A5C' }}>
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">
            Your next role is in that list of JDs.
          </h2>
          <p className="text-blue-200 text-lg mb-8 md:mb-10">Stop reading them one by one.</p>
          <Link
            href="/auth/login"
            className="w-full sm:w-auto inline-block px-8 py-4 rounded-xl font-semibold text-lg bg-white hover:bg-gray-100 transition-colors"
            style={{ color: '#1B3A5C' }}
          >
            Start screening free →
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-white border-t border-gray-200 px-6 py-5">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
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
