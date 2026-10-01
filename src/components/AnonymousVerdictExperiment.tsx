'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { track } from '@/lib/analytics'
import { calculateAnonymousVerdict, type AnonymousVerdictResult } from '@/lib/anonymous-verdict'

const verdictStyles = {
  STRONG: 'border-green-500 bg-green-50 text-green-900',
  DECENT: 'border-blue-500 bg-blue-50 text-blue-900',
  WEAK: 'border-amber-500 bg-amber-50 text-amber-950',
  REJECT: 'border-red-500 bg-red-50 text-red-900',
}

export default function AnonymousVerdictExperiment() {
  const started = useRef(false)
  const completionCount = useRef(0)
  const [result, setResult] = useState<AnonymousVerdictResult | null>(null)

  useEffect(() => {
    track.anonymousTryViewed()
  }, [])

  const markStarted = () => {
    if (started.current) return
    started.current = true
    track.anonymousTryStarted()
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const verdict = calculateAnonymousVerdict({
      currentRole: String(data.get('currentRole') || ''),
      yearsExperience: Number(data.get('yearsExperience') || 0),
      targetLevel: String(data.get('targetLevel') || ''),
      skills: String(data.get('skills') || ''),
      dealbreaker: String(data.get('dealbreaker') || ''),
      jobDescription: String(data.get('jobDescription') || ''),
    })
    setResult(verdict)
    completionCount.current += 1
    track.anonymousVerdictCompleted(verdict.verdict, completionCount.current)
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} onChange={markStarted} className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-7">
        <div>
          <label htmlFor="jobDescription" className="font-semibold">1. Paste one job description</label>
          <textarea id="jobDescription" name="jobDescription" required minLength={120} rows={9}
            placeholder="Paste the complete job description here…"
            className="mt-2 w-full rounded-xl border border-gray-300 p-3 text-sm focus:border-[#2E75B6] focus:outline-none focus:ring-2 focus:ring-blue-100" />
        </div>

        <fieldset className="space-y-4">
          <legend className="font-semibold">2. Tell us five things — no account required</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">Current role
              <input name="currentRole" required placeholder="Engineering Manager"
                className="mt-1 w-full rounded-lg border border-gray-300 p-3 font-normal" />
            </label>
            <label className="text-sm font-medium">Years of experience
              <input name="yearsExperience" required type="number" min="0" max="50" placeholder="10"
                className="mt-1 w-full rounded-lg border border-gray-300 p-3 font-normal" />
            </label>
            <label className="text-sm font-medium">Target role level
              <select name="targetLevel" required defaultValue=""
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white p-3 font-normal">
                <option value="" disabled>Select one</option>
                <option>Senior Engineer</option>
                <option>Staff Engineer</option>
                <option>Engineering Manager</option>
                <option>Senior Engineering Manager</option>
                <option>Director</option>
              </select>
            </label>
            <label className="text-sm font-medium">Strongest skills
              <input name="skills" required placeholder="Java, AWS, Kafka, leadership"
                className="mt-1 w-full rounded-lg border border-gray-300 p-3 font-normal" />
            </label>
          </div>
          <label className="block text-sm font-medium">One deal-breaker
            <input name="dealbreaker" required placeholder=".NET, 80% coding, relocation"
              className="mt-1 w-full rounded-lg border border-gray-300 p-3 font-normal" />
          </label>
        </fieldset>

        <p className="rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-600">
          Your answers stay in this browser for this calculation. This quick check does not create an account, upload a resume, consume screening quota or save the job.
        </p>

        <button type="submit" className="w-full rounded-xl bg-[#1B3A5C] px-6 py-3 font-semibold text-white hover:opacity-90">
          Get my provisional verdict
        </button>
      </form>

      {result && (
        <section aria-live="polite" className={`rounded-2xl border-l-4 p-6 ${verdictStyles[result.verdict]}`}>
          <p className="text-xs font-bold tracking-wide">PROVISIONAL VERDICT</p>
          <h2 className="mt-1 text-2xl font-bold">{result.verdict}: {result.headline}</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm">
            {result.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
          <p className="mt-4 font-medium">Next: {result.nextStep}</p>
          <div className="mt-5 border-t border-current/20 pt-5">
            <p className="text-sm">This quick verdict uses only five answers. Add your resume and full preferences for evidence-backed screening and batches.</p>
            <Link href="/auth/login" onClick={() => track.anonymousUpgradeClicked(result.verdict)}
              className="mt-3 inline-block rounded-lg bg-white px-5 py-3 font-semibold text-[#1B3A5C] shadow-sm">
              Improve this verdict with my profile →
            </Link>
          </div>
        </section>
      )}
    </div>
  )
}
