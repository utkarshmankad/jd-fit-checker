'use client'

import { useState, useEffect, useRef } from 'react'
import { Upload, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import type { HardRejectFilters, UserPreferences } from '@/types'

interface ProfileData {
  full_name: string | null
  hard_reject_filters: HardRejectFilters
  preferences: UserPreferences
  api_provider: 'openai' | 'anthropic' | null
  tier: 'free' | 'paid'
  screens_used_this_month: number
}

const DEFAULT_HARD_REJECT: HardRejectFilters = {
  tech_stack_dealbreakers: [],
  title_floor: '',
  geography_allowed: [],
  company_type_excluded: [],
  role_type_excluded: [],
}

const DEFAULT_PREFS: UserPreferences = {
  preferred_tech_stack: [],
  target_industries: [],
  min_company_size: null,
  max_company_size: null,
}

function parseList(val: string): string[] {
  return val.split(',').map((s) => s.trim()).filter(Boolean)
}

function joinList(arr: string[]): string {
  return arr.join(', ')
}

type ParsedProfile = {
  preferred_tech_stack?: string[]
  target_industries?: string[]
  title_floor?: string
  geography_allowed?: string[]
  tech_stack_dealbreakers?: string[]
  company_type_excluded?: string[]
  role_type_excluded?: string[]
  min_company_size?: number | null
  max_company_size?: number | null
}

type UploadStatus = 'idle' | 'parsing' | 'done' | 'error'

function ResumeUploader({ onParsed }: { onParsed: (p: ParsedProfile) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [fileName, setFileName] = useState('')

  async function handleFile(file: File) {
    const MAX_MB = 5
    if (file.size > MAX_MB * 1024 * 1024) {
      setStatus('error')
      setErrorMsg(`File too large — max ${MAX_MB} MB (got ${(file.size / 1024 / 1024).toFixed(1)} MB)`)
      return
    }

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext !== 'pdf' && ext !== 'txt') {
      setStatus('error')
      setErrorMsg('Only PDF and TXT files are supported')
      return
    }

    setFileName(file.name)
    setStatus('parsing')
    setErrorMsg('')

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/parse-resume', { method: 'POST', body: formData })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? 'Parse failed')
      }
      const { parsed } = (await res.json()) as { parsed: ParsedProfile }
      onParsed(parsed)
      setStatus('done')
      toast.success('Preferences autofilled from resume')
    } catch (err) {
      setStatus('error')
      // #8: specific inline error — keep upload area visible so they can retry
      const msg = err instanceof Error ? err.message : 'Parse failed'
      setErrorMsg(msg)
    }
  }

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.txt"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ''
        }}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={status === 'parsing'}
        className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border-2 border-dashed border-gray-300 text-sm font-medium text-gray-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors w-full justify-center"
      >
        {status === 'parsing' ? (
          <>
            <Loader2 size={15} className="animate-spin" />
            Parsing resume…
          </>
        ) : (
          <>
            <Upload size={15} />
            Upload resume (PDF or TXT)
          </>
        )}
      </button>

      {status === 'done' && (
        <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2">
          <CheckCircle2 size={13} />
          <span>Preferences autofilled from <strong>{fileName}</strong>. Resume not stored.</span>
        </div>
      )}

      {status === 'error' && (
        <div className="space-y-2">
          <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2.5">
            <AlertCircle size={13} className="shrink-0 mt-0.5" />
            <span>
              {errorMsg
                ? `${errorMsg} — try a different PDF, or paste your resume text manually.`
                : 'Could not parse this resume. Try a different PDF, or paste your resume text manually.'}
            </span>
          </div>
        </div>
      )}

      {(status === 'idle' || status === 'error') && (
        <p className="text-xs text-gray-400">
          Your resume is used only to autofill preferences below — it is never stored.
        </p>
      )}
    </div>
  )
}

export default function ProfilePage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isOnboarding, setIsOnboarding] = useState(false)
  const [onboardingCompleted, setOnboardingCompleted] = useState(false)

  const [fullName, setFullName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiProvider, setApiProvider] = useState<'openai' | 'anthropic'>('anthropic')

  const [techDealbreakers, setTechDealbreakers] = useState('')
  const [titleFloor, setTitleFloor] = useState('')
  const [geoAllowed, setGeoAllowed] = useState('')
  const [companyExcluded, setCompanyExcluded] = useState('')
  const [roleExcluded, setRoleExcluded] = useState('')

  const [prefTech, setPrefTech] = useState('')
  const [prefIndustries, setPrefIndustries] = useState('')
  const [minSize, setMinSize] = useState('')
  const [maxSize, setMaxSize] = useState('')

  const [tier, setTier] = useState<'free' | 'paid'>('free')
  const [screensUsed, setScreensUsed] = useState(0)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setIsOnboarding(params.get('onboarding') === 'true')

    async function load() {
      const res = await fetch('/api/profile')
      if (!res.ok) { setLoading(false); return }
      const { profile } = (await res.json()) as { profile: ProfileData }

      setFullName(profile.full_name ?? '')
      setApiProvider(profile.api_provider ?? 'anthropic')
      setTier(profile.tier)
      setScreensUsed(profile.screens_used_this_month)

      const hrf: HardRejectFilters = profile.hard_reject_filters ?? DEFAULT_HARD_REJECT
      setTechDealbreakers(joinList(hrf.tech_stack_dealbreakers))
      setTitleFloor(hrf.title_floor)
      setGeoAllowed(joinList(hrf.geography_allowed))
      setCompanyExcluded(joinList(hrf.company_type_excluded))
      setRoleExcluded(joinList(hrf.role_type_excluded))

      const prefs: UserPreferences = profile.preferences ?? DEFAULT_PREFS
      setPrefTech(joinList(prefs.preferred_tech_stack))
      setPrefIndustries(joinList(prefs.target_industries))
      setMinSize(prefs.min_company_size != null ? String(prefs.min_company_size) : '')
      setMaxSize(prefs.max_company_size != null ? String(prefs.max_company_size) : '')

      if (prefs.onboarding_completed) setOnboardingCompleted(true)

      setLoading(false)
    }
    load()
  }, [])

  function applyParsed(parsed: ParsedProfile) {
    if (parsed.preferred_tech_stack?.length) setPrefTech(joinList(parsed.preferred_tech_stack))
    if (parsed.target_industries?.length) setPrefIndustries(joinList(parsed.target_industries))
    if (parsed.title_floor) setTitleFloor(parsed.title_floor)
    if (parsed.geography_allowed?.length) setGeoAllowed(joinList(parsed.geography_allowed))
    if (parsed.tech_stack_dealbreakers?.length) setTechDealbreakers(joinList(parsed.tech_stack_dealbreakers))
    if (parsed.company_type_excluded?.length) setCompanyExcluded(joinList(parsed.company_type_excluded))
    if (parsed.role_type_excluded?.length) setRoleExcluded(joinList(parsed.role_type_excluded))
    if (parsed.min_company_size != null) setMinSize(String(parsed.min_company_size))
    if (parsed.max_company_size != null) setMaxSize(String(parsed.max_company_size))
  }

  function clearPrefs() {
    setTechDealbreakers('')
    setTitleFloor('')
    setGeoAllowed('')
    setCompanyExcluded('')
    setRoleExcluded('')
    setPrefTech('')
    setPrefIndustries('')
    setMinSize('')
    setMaxSize('')
    toast.success('Preferences cleared')
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName,
          ...(apiKey ? { api_key: apiKey, api_provider: apiProvider } : { api_provider: apiProvider }),
          hard_reject_filters: {
            tech_stack_dealbreakers: parseList(techDealbreakers),
            title_floor: titleFloor,
            geography_allowed: parseList(geoAllowed),
            company_type_excluded: parseList(companyExcluded),
            role_type_excluded: parseList(roleExcluded),
          } satisfies HardRejectFilters,
          preferences: {
            preferred_tech_stack: parseList(prefTech),
            target_industries: parseList(prefIndustries),
            min_company_size: minSize ? parseInt(minSize, 10) : null,
            max_company_size: maxSize ? parseInt(maxSize, 10) : null,
            ...(isOnboarding ? { onboarding_completed: true } : {}),
          } satisfies UserPreferences,
        }),
      })

      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        // #10: inline save error — form stays filled so user doesn't retype
        setSaveError(json.error ?? `Save failed (${res.status}). Try again.`)
        return
      }

      toast.success('Profile saved')
      if (apiKey) setApiKey('')
      if (isOnboarding) setOnboardingCompleted(true)
    } catch {
      setSaveError('Save failed — could not reach the server. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  const step1Done = !!(prefTech.trim() || prefIndustries.trim() || minSize || maxSize)
  const step2Done = !!(techDealbreakers.trim() || titleFloor.trim() || geoAllowed.trim() || companyExcluded.trim() || roleExcluded.trim())
  const step3Done = !!apiKey.trim()
  const allStepsDone = step1Done && step2Done && step3Done

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl w-full space-y-8 overflow-x-hidden">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
        <div className="flex items-center gap-2">
          <span
            className="px-3 py-1 rounded-full text-xs font-bold tracking-wide text-white"
            style={{ backgroundColor: '#1B3A5C' }}
          >
            {tier === 'paid' ? 'PAID' : 'FREE'}
          </span>
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
            {tier === 'paid' ? 'Unlimited' : `${screensUsed} / 5 screens used`}
          </span>
        </div>
      </div>

      {/* Onboarding welcome banner */}
      {isOnboarding && !onboardingCompleted && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-6 py-5 space-y-4">
          <div>
            <h2 className="font-semibold text-blue-900">Welcome to JD Fit Checker!</h2>
            <p className="text-sm text-blue-700 mt-1">Complete these 3 steps for accurate job screening.</p>
          </div>
          <ol className="space-y-2.5">
            {([
              { done: step1Done, label: 'Set preferences — tech stack, industries, company size' },
              { done: step2Done, label: 'Set hard-reject filters — auto-rejects bad fits' },
              { done: step3Done, label: 'Add your API key — powers AI screening' },
            ] as { done: boolean; label: string }[]).map((step, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm">
                <span
                  className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold mt-0.5 ${
                    step.done ? 'bg-green-500 text-white' : 'bg-blue-200 text-blue-700'
                  }`}
                >
                  {step.done ? '✓' : i + 1}
                </span>
                <span className={step.done ? 'line-through text-gray-400' : 'text-blue-800'}>
                  {step.label}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Completion banner — appears once all steps filled, before saving */}
      {isOnboarding && !onboardingCompleted && allStepsDone && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-6 py-4 flex items-center gap-3">
          <CheckCircle2 size={20} className="text-green-600 shrink-0" />
          <div>
            <p className="font-medium text-green-900 text-sm">Profile complete!</p>
            <p className="text-xs text-green-700 mt-0.5">Save your profile to start screening jobs.</p>
          </div>
        </div>
      )}

      {/* Basic info */}
      <Section title="Basic info">
        <Field label="Full name">
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Your name"
            className={inputCls}
          />
        </Field>
      </Section>

      {/* Resume upload */}
      <Section title="Resume">
        <ResumeUploader onParsed={applyParsed} />
      </Section>

      {/* API key */}
      <Section title="AI provider">
        <Field label="Provider">
          <select
            value={apiProvider}
            onChange={(e) => setApiProvider(e.target.value as 'openai' | 'anthropic')}
            className={inputCls}
          >
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI (GPT)</option>
          </select>
        </Field>
        <Field label="API key">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Leave blank to keep existing key"
            className={inputCls}
            autoComplete="new-password"
          />
          <p className="text-xs text-gray-400 mt-1">Stored encrypted. Leave blank to keep current key.</p>
        </Field>
      </Section>

      {/* Hard reject filters */}
      <Section
        title="Auto-reject rules"
        action={
          <button
            type="button"
            onClick={clearPrefs}
            className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
          >
            Clear prefs
          </button>
        }
      >
        <p className="text-sm text-gray-500 -mt-1 mb-3">
          Any job matching these gets instantly rejected — no score calculated.
        </p>
        <Field label="Tech I won't work with (comma-separated)">
          <input
            type="text"
            value={techDealbreakers}
            onChange={(e) => setTechDealbreakers(e.target.value)}
            placeholder="e.g. PHP, Cobol, .NET"
            className={inputCls}
          />
        </Field>
        <Field label="Minimum seniority level">
          <input
            type="text"
            value={titleFloor}
            onChange={(e) => setTitleFloor(e.target.value)}
            placeholder="e.g. Senior, Lead, Staff"
            className={inputCls}
          />
        </Field>
        <Field label="Locations I'm open to (comma-separated)">
          <input
            type="text"
            value={geoAllowed}
            onChange={(e) => setGeoAllowed(e.target.value)}
            placeholder="e.g. India, Remote, USA"
            className={inputCls}
          />
        </Field>
        <Field label="Company types to avoid (comma-separated)">
          <input
            type="text"
            value={companyExcluded}
            onChange={(e) => setCompanyExcluded(e.target.value)}
            placeholder="e.g. staffing, outsourcing, consulting"
            className={inputCls}
          />
        </Field>
        <Field label="Job types to avoid (comma-separated)">
          <input
            type="text"
            value={roleExcluded}
            onChange={(e) => setRoleExcluded(e.target.value)}
            placeholder="e.g. internship, contract, part-time"
            className={inputCls}
          />
        </Field>
      </Section>

      {/* Preferences */}
      <Section title="Preferences">
        <Field label="Tech stack I enjoy (comma-separated)">
          <input
            type="text"
            value={prefTech}
            onChange={(e) => setPrefTech(e.target.value)}
            placeholder="e.g. TypeScript, React, Node.js"
            className={inputCls}
          />
        </Field>
        <Field label="Industries I'm targeting (comma-separated)">
          <input
            type="text"
            value={prefIndustries}
            onChange={(e) => setPrefIndustries(e.target.value)}
            placeholder="e.g. fintech, SaaS, healthtech"
            className={inputCls}
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Min company size">
            <input
              type="number"
              value={minSize}
              onChange={(e) => setMinSize(e.target.value)}
              placeholder="e.g. 50"
              className={inputCls}
              min={0}
            />
          </Field>
          <Field label="Max company size">
            <input
              type="number"
              value={maxSize}
              onChange={(e) => setMaxSize(e.target.value)}
              placeholder="e.g. 5000"
              className={inputCls}
              min={0}
            />
          </Field>
        </div>
      </Section>

      {/* #10: inline save error */}
      {saveError && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          <span>Save failed — {saveError}</span>
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-3 rounded-lg font-medium text-sm text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ backgroundColor: '#1B3A5C' }}
      >
        {saving ? 'Saving...' : 'Save profile'}
      </button>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'

function Section({
  title,
  children,
  action,
}: {
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 sm:px-6 py-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-gray-500">{label}</label>
      {children}
    </div>
  )
}
