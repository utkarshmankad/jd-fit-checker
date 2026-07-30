import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Trash2, ShieldX, ListChecks, Flag } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import AuthHashRedirect from '@/components/auth-hash-redirect'
import { LogoMark } from '@/components/Logo'

export default async function LandingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/dashboard')

  const LAUNCH_MODE = process.env.LAUNCH_MODE === 'true'
  const BETA_LIMIT = parseInt(process.env.BETA_TOTAL_LIMIT || '25')
  const WEEKLY_LIMIT = parseInt(process.env.FREE_WEEKLY_LIMIT || '3')
  const freeSubtitle = LAUNCH_MODE ? `${BETA_LIMIT} free screens to start` : `${WEEKLY_LIMIT} free screens every week`
  const PRICING_ENABLED = process.env.NEXT_PUBLIC_PRICING_ENABLED === 'true'

  return (
    <div className="min-h-screen flex flex-col bg-white text-gray-900">
      {/* Handles Supabase invite implicit-flow hash tokens client-side */}
      <AuthHashRedirect />

      {/* ── Nav ── */}
      <header className="sticky top-0 z-30 bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <span className="flex items-center gap-2 font-bold text-lg" style={{ color: '#1B3A5C' }}>
            <LogoMark size={26} />
            JobSnob
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
            Most jobs aren&apos;t for you. We&apos;ll tell you which ones are.
          </h1>
          <p className="mt-6 text-lg md:text-xl text-blue-100 max-w-xl leading-relaxed">
            Paste your job list. Jobsnob reads every one, applies your standards, and tells you
            which to skip and which deserve your time. No scores. No percentages. Just a verdict.
          </p>
          <div className="mt-10 flex flex-col items-center gap-3 w-full sm:w-auto">
            <Link
              href="/auth/login"
              className="w-full sm:w-auto inline-block px-8 py-4 rounded-xl font-semibold text-lg bg-white hover:bg-gray-100 transition-colors text-center"
              style={{ color: '#1B3A5C' }}
            >
              Judge my jobs →
            </Link>
            <span className="text-sm text-blue-200">{freeSubtitle}. No credit card. No API key setup.</span>
          </div>
          <div className="mt-12 flex flex-col sm:flex-row sm:flex-wrap justify-center gap-2 sm:gap-3 w-full sm:w-auto">
            {[
              '🗑️ Dismisses the bad ones for you',
              '⏱️ Hours back, every week',
              '🎯 Built for people with standards',
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

      {/* ── vs ChatGPT ── */}
      <section className="px-6 py-20 border-b border-gray-100 bg-[#F8FAFC]">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-bold mb-6" style={{ color: '#1B3A5C' }}>
            Isn&apos;t this just ChatGPT?
          </h2>
          <p className="text-gray-600 leading-relaxed text-lg md:text-xl max-w-xl mx-auto">
            ChatGPT will politely summarize a job description.
            <br />
            Jobsnob will tell you it&apos;s beneath you.
            <br />
            There&apos;s a difference.
          </p>
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
            Resume optimizers assume you&apos;ve already decided to apply. They just help you pass
            the bot. That&apos;s the wrong moment to help. The real cost in a senior job search isn&apos;t
            writing one more cover letter. It&apos;s the three hours you spend tailoring a resume for
            a role that was never going to work. Wrong level. Wrong stack. Wrong everything.
            Nobody told you to skip it. We tell you to skip it. Before you waste the time, not after.
          </p>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="bg-white px-6 py-24">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-14" style={{ color: '#1B3A5C' }}>
            From list to verdict in under a minute.
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                Icon: Trash2,
                title: 'Dump your list',
                body: 'Up to 20 at once. LinkedIn, Naukri, Greenhouse — doesn\'t matter where.',
              },
              {
                Icon: ShieldX,
                title: 'Jobsnob applies your standards',
                body: 'Wrong stack. Wrong level. Wrong geography. Dismissed on sight, with the reason why. You don\'t read a word.',
              },
              {
                Icon: ListChecks,
                title: 'You only see what\'s worth it',
                body: 'What\'s left gets ranked. That\'s the only list worth your time.',
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

      {/* ── Smarter after every batch ── */}
      <section className="bg-white px-6 py-24 border-b border-gray-100">
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-3xl font-bold mb-4" style={{ color: '#1B3A5C' }}>
              Smarter after every batch.
            </h2>
            <p className="text-gray-600 leading-relaxed text-base">
              Judge 10 jobs and we&apos;ll tell you which two skills are blocking 70% of your
              pipeline. A resume optimizer will never tell you that.
            </p>
          </div>

          {/* Static mockup of the skills bar chart */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <p className="text-xs font-semibold text-gray-500 mb-4">What this market is asking for</p>
            <div className="space-y-3">
              {[
                { skill: 'Kubernetes', pct: 70, hot: true, inProfile: false },
                { skill: 'AWS', pct: 58, hot: false, inProfile: true },
                { skill: 'Go', pct: 40, hot: false, inProfile: false },
              ].map(({ skill, pct, hot, inProfile }) => (
                <div key={skill} className="flex items-center gap-3">
                  <span className="text-xs font-medium text-gray-700 w-20 shrink-0">{skill}</span>
                  <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-2.5 rounded-full ${inProfile ? 'bg-green-500' : 'bg-red-400'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-gray-600 w-8 text-right shrink-0">{pct}%</span>
                  {hot && <span className="text-xs shrink-0">🔥</span>}
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-4 pt-4 border-t border-gray-100">
              💡 73% of these roles need Kubernetes. You don&apos;t have it. Look at platform or
              SRE-adjacent EM roles instead.
            </p>
          </div>
        </div>
      </section>

      {/* ── What we catch ── */}
      <section className="px-6 py-24 bg-[#F8FAFC]">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Flag size={20} style={{ color: '#DC2626' }} />
            <span className="text-xs font-bold uppercase tracking-wide" style={{ color: '#DC2626' }}>
              Fake EM Detection
            </span>
          </div>
          <h2 className="text-3xl font-bold text-center mb-3" style={{ color: '#1B3A5C' }}>
            We caught this so you didn&apos;t have to read it.
          </h2>
          <p className="text-center text-gray-500 mb-12 max-w-xl mx-auto">
            &quot;Engineering Manager&quot; titles that are really senior IC roles wearing a costume.
            No reports. No hiring say. 70% coding. ChatGPT will miss it if you don&apos;t ask the
            right question. We flag it automatically. Every batch. No prompting required.
          </p>

          {/* Mock result card */}
          <div className="max-w-md mx-auto bg-white rounded-xl border-2 border-red-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-gray-900 text-sm">Engineering Manager</p>
                  <p className="text-xs text-gray-500 mt-0.5">TechCorp</p>
                </div>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-600 text-white shrink-0">
                  🚩 Fake EM Detected
                </span>
              </div>
            </div>
            <div className="px-5 py-4 bg-red-50 space-y-2">
              <p className="text-xs font-bold text-red-700 uppercase tracking-wide">Why:</p>
              <p className="text-sm text-red-800">
                70% coding time · 0 current reports · reports to EM
              </p>
              <p className="text-sm font-semibold text-gray-700 pt-1">
                Actual level: <span className="text-red-700">Senior Software Engineer</span>
              </p>
            </div>
            <div className="px-5 py-3 bg-gray-50 flex items-center justify-between">
              <span className="text-xs text-gray-400">Time saved</span>
              <span className="text-sm font-bold" style={{ color: '#1B3A5C' }}>12 minutes</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Who it's for ── */}
      <section className="px-6 py-24 bg-[#F8FAFC]">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-3" style={{ color: '#1B3A5C' }}>
            Built for people with standards, not people with time to burn.
          </h2>
          <p className="text-center text-gray-500 mb-14">
            Staff engineers. EMs. Directors. Architects. Anyone senior enough that a wrong
            application actually costs something.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {[
              {
                persona: 'You have standards.',
                body: "You're not applying to 50 jobs hoping something sticks. You want the right five. And you're tired of reading three pages to discover it's a .NET shop.",
              },
              {
                persona: "You've been burned before.",
                body: 'A role that looked great on paper turned out to be a player-coach IC job with zero budget ownership. Jobsnob catches those. Before you spend a Sunday customizing your resume.',
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
      {PRICING_ENABLED && (
        <section className="bg-white px-6 py-24">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl font-bold text-center mb-3" style={{ color: '#1B3A5C' }}>
              One price. That&apos;s it.
            </h2>
            <p className="text-center text-gray-500 text-sm mb-14">
              One price. No subscription. Because your job search will end. And you deserve a
              tool that knows that.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-2xl mx-auto">

              {/* Free */}
              <div className="bg-white rounded-xl p-8 border border-gray-200 flex flex-col">
                <div className="mb-2">
                  <p className="text-3xl font-bold text-gray-900">Free</p>
                  <p className="text-sm text-gray-400 mt-1">{freeSubtitle}</p>
                </div>
                <ul className="mt-6 space-y-3 flex-1 mb-8">
                  {[
                    'Paste URLs or text — either works',
                    'A fit read on every role',
                    'Your hard nos, applied automatically',
                    'CSV export',
                    'Shareable report links',
                    '+10 free judgments per friend you refer',
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
                  Judge my jobs free →
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
                  <p className="text-xs text-gray-400 mt-0.5">Unlimited judgments, forever</p>
                </div>
                <ul className="mt-6 space-y-3 flex-1 mb-8">
                  {[
                    'Everything in Free',
                    'Unlimited judgments',
                    'LinkedIn bulk import (up to 20 URLs)',
                    'Your full judgment history',
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
                  className="block text-center py-3 rounded-lg font-semibold text-sm text-white hover:opacity-90 transition-colors"
                  style={{ backgroundColor: '#1B3A5C' }}
                >
                  Unlock unlimited judgments →
                </Link>
              </div>

            </div>
          </div>
        </section>
      )}

      {/* ── Final CTA ── */}
      <section className="px-6 py-16 md:py-24" style={{ backgroundColor: '#1B3A5C' }}>
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">
            Your next role is in that list somewhere. Stop reading the other ones.
          </h2>
          <p className="text-blue-200 text-lg mb-8 md:mb-10">Your dealbreakers. Your time. Your call.</p>
          <Link
            href="/auth/login"
            className="w-full sm:w-auto inline-block px-8 py-4 rounded-xl font-semibold text-lg bg-white hover:bg-gray-100 transition-colors"
            style={{ color: '#1B3A5C' }}
          >
            Judge my jobs free →
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-white border-t border-gray-200 px-6 py-5">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 font-bold text-sm" style={{ color: '#1B3A5C' }}>
            <LogoMark size={18} />
            JobSnob
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
