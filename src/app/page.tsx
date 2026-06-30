import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Trash2, ShieldX, ListChecks } from 'lucide-react'
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
            The AI that rejects jobs before you waste your time.
          </h1>
          <p className="mt-6 text-lg md:text-xl text-blue-100 max-w-xl leading-relaxed">
            Paste 20 job descriptions. Get instant Reject, Maybe, or Apply calls based on your
            resume, seniority, and dealbreakers. No more reading three pages to discover
            it&apos;s a .NET shop.
          </p>
          <div className="mt-10 flex flex-col items-center gap-3 w-full sm:w-auto">
            <Link
              href="/auth/login"
              className="w-full sm:w-auto inline-block px-8 py-4 rounded-xl font-semibold text-lg bg-white hover:bg-gray-100 transition-colors text-center"
              style={{ color: '#1B3A5C' }}
            >
              Reject my jobs →
            </Link>
            <span className="text-sm text-blue-200">Free for your first 5 batches. No credit card.</span>
          </div>
          <div className="mt-12 flex flex-col sm:flex-row sm:flex-wrap justify-center gap-2 sm:gap-3 w-full sm:w-auto">
            {[
              '🗑️ Auto-rejects the bad ones',
              '⏱️ Saves hours per week',
              '🎯 Built for senior, selective searches',
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

      {/* ── Why rejection, not optimization ── */}
      <section className="bg-white px-6 py-20 border-b border-gray-100">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-bold mb-3" style={{ color: '#1B3A5C' }}>
            Every other tool helps you apply to more jobs.
          </h2>
          <p className="text-lg font-semibold text-gray-500 mb-8">
            We help you apply to fewer, better ones.
          </p>
          <p className="text-gray-600 leading-relaxed text-base md:text-lg max-w-2xl mx-auto">
            Resume optimizers like Jobscan and Rezi assume you&apos;ve already decided to apply —
            they just help you pass the bot. That&apos;s the wrong moment to help. The real cost in
            a senior job search isn&apos;t writing one more cover letter. It&apos;s the three hours you
            spend tailoring a resume for a role that was never going to work — wrong level, wrong
            stack, wrong everything — because nobody told you to skip it. We tell you to skip it.
            Before you waste the time, not after.
          </p>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="bg-white px-6 py-24">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-14" style={{ color: '#1B3A5C' }}>
            From job list to reject pile in under a minute.
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                Icon: Trash2,
                title: 'Paste your job list',
                body: 'Up to 20 URLs or job descriptions. LinkedIn, Naukri, Greenhouse, anywhere.',
              },
              {
                Icon: ShieldX,
                title: 'We reject what wastes your time',
                body: 'Your dealbreakers — wrong stack, wrong level, wrong geography — auto-rejected with the exact reason. No reading required.',
              },
              {
                Icon: ListChecks,
                title: 'You only look at what\'s left',
                body: 'The roles that survive get ranked. That\'s where your actual time goes.',
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
          <h2 className="text-3xl font-bold text-center mb-3" style={{ color: '#1B3A5C' }}>
            Built for people making expensive application decisions.
          </h2>
          <p className="text-center text-gray-500 mb-14">
            Staff engineers. EMs. Directors. Architects. Anyone senior enough that every wrong
            application costs real hours.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {[
              {
                persona: "You're selective, not desperate",
                body: "You're not spraying 100 applications hoping one lands. You want the right 5 — and you want to stop wasting time on the other 95 before you've even started.",
              },
              {
                persona: "You already know your dealbreakers",
                body: "You know the stack you won't touch, the title floor you won't go below, the geography that doesn't work. You just don't have time to check every JD against all of it.",
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
            No $50/month subscription. No editing-then-rescanning treadmill. Reject the noise,
            then move on with your day.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-2xl mx-auto">

            {/* Free */}
            <div className="bg-white rounded-xl p-8 border border-gray-200 flex flex-col">
              <div className="mb-2">
                <p className="text-3xl font-bold text-gray-900">Free</p>
                <p className="text-sm text-gray-400 mt-1">5 batches to start</p>
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
                Reject my jobs free →
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
            Stop reading job descriptions that were never going to work.
          </h2>
          <p className="text-blue-200 text-lg mb-8 md:mb-10">Your dealbreakers. Your time. Your call.</p>
          <Link
            href="/auth/login"
            className="w-full sm:w-auto inline-block px-8 py-4 rounded-xl font-semibold text-lg bg-white hover:bg-gray-100 transition-colors"
            style={{ color: '#1B3A5C' }}
          >
            Reject my jobs free →
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
