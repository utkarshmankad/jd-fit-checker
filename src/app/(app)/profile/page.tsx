'use client'

import { useState, useEffect, useRef } from 'react'
import { Upload, CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react'
import type { HardRejectFilters, UserPreferences } from '@/types'

interface ProfileData {
  full_name: string | null
  resume_text: string | null
  hard_reject_filters: HardRejectFilters
  preferences: UserPreferences
  api_provider: 'openai' | 'anthropic' | null
  has_api_key: boolean
  tier: 'free' | 'paid'
  screens_used_this_month: number
  updated_at: string
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

const DEALBREAKER_SUGGESTIONS = ['C#', '.NET', 'PHP', 'Ruby', 'COBOL', 'VB.NET', 'Perl', 'Delphi']

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

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function parseList(val: string): string[] {
  return val.split(',').map((s) => s.trim()).filter(Boolean)
}

function joinList(arr: string[]): string {
  return arr.join(', ')
}

// ── TagInput ──────────────────────────────────────────────────────────────────
function TagInput({
  tags,
  onChange,
  placeholder,
  suggestions,
  onDirty,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  suggestions?: string[]
  onDirty?: () => void
}) {
  const [inputVal, setInputVal] = useState('')

  function addTag(tag: string) {
    const t = tag.trim()
    if (t && !tags.includes(t)) { onChange([...tags, t]); onDirty?.() }
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag))
    onDirty?.()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === ',' || e.key === 'Enter') && inputVal.trim()) {
      e.preventDefault()
      addTag(inputVal)
      setInputVal('')
    } else if (e.key === 'Backspace' && !inputVal && tags.length > 0) {
      removeTag(tags[tags.length - 1])
    }
  }

  return (
    <div className="space-y-2">
      <div
        className="flex flex-wrap gap-1.5 px-3 py-2 border border-gray-300 rounded-lg min-h-[42px] focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent cursor-text"
        onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}
      >
        {tags.map((t) => (
          <span key={t} className="flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs font-medium">
            {t}
            <button type="button" onClick={() => removeTag(t)} className="hover:text-blue-600 leading-none">
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => { if (inputVal.trim()) { addTag(inputVal); setInputVal('') } }}
          placeholder={tags.length === 0 ? placeholder : 'Add more…'}
          className="flex-1 min-w-[100px] text-sm outline-none bg-transparent placeholder-gray-400"
        />
      </div>

      {suggestions && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.filter((s) => !tags.includes(s)).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => addTag(s)}
              className="px-2 py-0.5 text-xs border border-gray-200 rounded text-gray-500 hover:bg-gray-100 hover:border-gray-300 transition-colors"
            >
              + {s}
            </button>
          ))}
        </div>
      )}

      {tags.length > 0 && (
        <p className="text-xs text-gray-400">{tags.length} technolog{tags.length === 1 ? 'y' : 'ies'} added</p>
      )}
      {tags.length === 0 && (
        <p className="text-xs text-amber-500">No dealbreakers set — all tech stacks will be considered</p>
      )}
    </div>
  )
}

// ── SectionSaveButton ─────────────────────────────────────────────────────────
function SectionSaveButton({ state, onClick }: { state: SaveState; onClick: () => void }) {
  const isIdle = state === 'idle'
  const bgStyle = isIdle ? { backgroundColor: '#1B3A5C', color: '#fff' } : {}
  const bgClass =
    state === 'saving' ? 'bg-gray-400 text-white cursor-not-allowed' :
    state === 'saved'  ? 'bg-green-600 text-white' :
    state === 'error'  ? 'bg-red-600 text-white' : ''

  return (
    <button
      onClick={onClick}
      disabled={state === 'saving'}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed ${bgClass}`}
      style={isIdle ? bgStyle : {}}
    >
      {state === 'saving' ? (
        <span className="flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Saving…</span>
      ) : state === 'saved' ? 'Saved ✓' :
         state === 'error' ? 'Save failed — try again' : 'Save changes'}
    </button>
  )
}

// ── ResumeUploader ────────────────────────────────────────────────────────────
type UploadStatus = 'idle' | 'parsing' | 'done' | 'error'

function ResumeUploader({
  onParsed,
  existingResumeDate,
}: {
  onParsed: (p: ParsedProfile, wordCount: number) => void
  existingResumeDate: string | null
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [fileName, setFileName] = useState('')
  const [showUploader, setShowUploader] = useState(!existingResumeDate)

  async function handleFile(file: File) {
    const MAX_MB = 5
    if (file.size > MAX_MB * 1024 * 1024) {
      setStatus('error')
      setErrorMsg(`File too large. Max size is 5 MB (got ${(file.size / 1024 / 1024).toFixed(1)} MB).`)
      return
    }
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext !== 'pdf' && ext !== 'txt') {
      setStatus('error')
      setErrorMsg('Only PDF and .txt files are supported.')
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
      const { parsed, word_count } = (await res.json()) as { parsed: ParsedProfile; word_count: number }
      onParsed(parsed, word_count)
      setStatus('done')
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'Could not parse resume. Try a different file or paste text manually.')
    }
  }

  if (!showUploader && existingResumeDate) {
    const d = new Date(existingResumeDate)
    const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    return (
      <div className="flex items-center justify-between gap-4 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
        <div className="flex items-center gap-2 text-sm text-green-800">
          <CheckCircle2 size={14} />
          <span>Resume on file — uploaded {dateStr}</span>
        </div>
        <button
          type="button"
          onClick={() => setShowUploader(true)}
          className="text-xs text-blue-600 hover:underline font-medium"
        >
          Replace resume
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.txt"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={status === 'parsing'}
        className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border-2 border-dashed border-gray-300 text-sm font-medium text-gray-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors w-full justify-center"
      >
        {status === 'parsing' ? <><Loader2 size={15} className="animate-spin" /> Parsing resume…</> : <><Upload size={15} /> Upload resume (PDF or TXT)</>}
      </button>

      {status === 'done' && (
        <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2">
          <CheckCircle2 size={13} />
          <span>Preferences autofilled from <strong>{fileName}</strong>. Resume not stored.</span>
        </div>
      )}

      {status === 'error' && (
        <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2.5">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <span>{errorMsg || 'Could not parse this resume. Try a different PDF, or paste your resume text manually.'}</span>
        </div>
      )}

      {(status === 'idle' || status === 'error') && (
        <p className="text-xs text-gray-400">Your resume is used only to autofill preferences — it is never stored.</p>
      )}
    </div>
  )
}

// ── ProfilePage ───────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const [loading, setLoading] = useState(true)

  // Basic
  const [fullName, setFullName] = useState('')
  const [basicSave, setBasicSave] = useState<SaveState>('idle')

  // API key
  const [apiKey, setApiKey] = useState('')
  const [apiProvider, setApiProvider] = useState<'openai' | 'anthropic'>('anthropic')
  const [hasExistingApiKey, setHasExistingApiKey] = useState(false)
  const [apiSave, setApiSave] = useState<SaveState>('idle')

  // Hard reject filters
  const [techDealbreakerTags, setTechDealbreakerTags] = useState<string[]>([])
  const [titleFloor, setTitleFloor] = useState('')
  const [geoAllowed, setGeoAllowed] = useState('')
  const [companyExcluded, setCompanyExcluded] = useState('')
  const [roleExcluded, setRoleExcluded] = useState('')
  const [filterSave, setFilterSave] = useState<SaveState>('idle')

  // Preferences
  const [prefTech, setPrefTech] = useState('')
  const [prefIndustries, setPrefIndustries] = useState('')
  const [minSize, setMinSize] = useState('')
  const [maxSize, setMaxSize] = useState('')
  const [prefsSave, setPrefsSave] = useState<SaveState>('idle')

  // Tier / meta
  const [tier, setTier] = useState<'free' | 'paid'>('free')
  const [screensUsed, setScreensUsed] = useState(0)
  const [resumeDate, setResumeDate] = useState<string | null>(null)

  // Resume parse result feedback
  const [detectedSkills, setDetectedSkills] = useState<string[]>([])
  const [resumeWordCount, setResumeWordCount] = useState<number | null>(null)

  // Onboarding
  const [isOnboarding, setIsOnboarding] = useState(false)
  const [onboardingCompleted, setOnboardingCompleted] = useState(false)

  // Dirty tracking
  const [isDirty, setIsDirty] = useState(false)

  function markDirty() { setIsDirty(true) }

  // Warn before navigate away if dirty
  useEffect(() => {
    if (!isDirty) return
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      return (e.returnValue = 'You have unsaved changes. Leave anyway?')
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setIsOnboarding(params.get('onboarding') === 'true')

    async function load() {
      const res = await fetch('/api/profile')
      if (!res.ok) { setLoading(false); return }
      const { profile } = (await res.json()) as { profile: ProfileData }

      setFullName(profile.full_name ?? '')
      setApiProvider(profile.api_provider ?? 'anthropic')
      setHasExistingApiKey(profile.has_api_key)
      setTier(profile.tier)
      setScreensUsed(profile.screens_used_this_month)

      if (profile.resume_text) setResumeDate(profile.updated_at)

      const hrf: HardRejectFilters = profile.hard_reject_filters ?? DEFAULT_HARD_REJECT
      setTechDealbreakerTags(hrf.tech_stack_dealbreakers ?? [])
      setTitleFloor(hrf.title_floor ?? '')
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

  function applyParsed(parsed: ParsedProfile, wordCount: number) {
    if (parsed.preferred_tech_stack?.length) setPrefTech(joinList(parsed.preferred_tech_stack))
    if (parsed.target_industries?.length) setPrefIndustries(joinList(parsed.target_industries))
    if (parsed.title_floor) setTitleFloor(parsed.title_floor)
    if (parsed.geography_allowed?.length) setGeoAllowed(joinList(parsed.geography_allowed))
    if (parsed.tech_stack_dealbreakers?.length) setTechDealbreakerTags(parsed.tech_stack_dealbreakers)
    if (parsed.company_type_excluded?.length) setCompanyExcluded(joinList(parsed.company_type_excluded))
    if (parsed.role_type_excluded?.length) setRoleExcluded(joinList(parsed.role_type_excluded))
    if (parsed.min_company_size != null) setMinSize(String(parsed.min_company_size))
    if (parsed.max_company_size != null) setMaxSize(String(parsed.max_company_size))
    setDetectedSkills((parsed.preferred_tech_stack ?? []).slice(0, 3))
    setResumeWordCount(wordCount)
    markDirty()
  }

  function useSaveTimer(setState: (s: SaveState) => void) {
    return function setSavedWithReset() {
      setState('saved')
      setTimeout(() => setState('idle'), 2000)
    }
  }

  const setBasicSaved = useSaveTimer(setBasicSave)
  const setApiSaved = useSaveTimer(setApiSave)
  const setFiltersSaved = useSaveTimer(setFilterSave)
  const setPrefsSaved = useSaveTimer(setPrefsSave)

  async function savePatch(
    body: Record<string, unknown>,
    setState: (s: SaveState) => void,
    setSaved: () => void,
  ) {
    setState('saving')
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) { setState('error'); return }
      setSaved()
      setIsDirty(false)
      if (isOnboarding) setOnboardingCompleted(true)
    } catch {
      setState('error')
    }
  }

  async function handleSaveBasic() {
    await savePatch({ full_name: fullName }, setBasicSave, setBasicSaved)
  }

  async function handleSaveApi() {
    await savePatch(
      { api_provider: apiProvider, ...(apiKey ? { api_key: apiKey } : {}) },
      setApiSave,
      () => { setApiSaved(); if (apiKey) { setApiKey(''); setHasExistingApiKey(true) } },
    )
  }

  async function handleSaveFilters() {
    await savePatch(
      {
        hard_reject_filters: {
          tech_stack_dealbreakers: techDealbreakerTags,
          title_floor: titleFloor,
          geography_allowed: parseList(geoAllowed),
          company_type_excluded: parseList(companyExcluded),
          role_type_excluded: parseList(roleExcluded),
        } satisfies HardRejectFilters,
      },
      setFilterSave,
      setFiltersSaved,
    )
  }

  async function handleSavePrefs() {
    await savePatch(
      {
        preferences: {
          preferred_tech_stack: parseList(prefTech),
          target_industries: parseList(prefIndustries),
          min_company_size: minSize ? parseInt(minSize, 10) : null,
          max_company_size: maxSize ? parseInt(maxSize, 10) : null,
          ...(isOnboarding ? { onboarding_completed: true } : {}),
        } satisfies UserPreferences,
      },
      setPrefsSave,
      setPrefsSaved,
    )
  }

  // Completion scoring
  const prefFilled = !!(prefTech.trim() || prefIndustries.trim() || minSize || maxSize)
  const filtersFilled = !!(techDealbreakerTags.length || titleFloor.trim() || geoAllowed.trim() || companyExcluded.trim() || roleExcluded.trim())
  const apiKeyFilled = hasExistingApiKey || !!apiKey.trim()
  const completionScore = (prefFilled ? 40 : 0) + (filtersFilled ? 30 : 0) + (apiKeyFilled ? 30 : 0)
  const completionColor = completionScore >= 80 ? 'bg-green-500' : completionScore >= 50 ? 'bg-amber-500' : 'bg-red-500'
  const completionTextColor = completionScore >= 80 ? 'text-green-700' : completionScore >= 50 ? 'text-amber-600' : 'text-red-600'
  const nextAction =
    completionScore === 100 ? null :
    !prefFilled ? 'Set your preferences or upload a resume to improve scoring' :
    !filtersFilled ? 'Set your hard-reject rules to filter bad fits' :
    !apiKeyFilled ? 'Add your API key to unlock AI screening' : null

  // Onboarding checklist
  const step1Done = prefFilled
  const step2Done = filtersFilled
  const step3Done = apiKeyFilled
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
      {/* Tier badge row */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 rounded-full text-xs font-bold tracking-wide text-white" style={{ backgroundColor: '#1B3A5C' }}>
            {tier === 'paid' ? 'PAID' : 'FREE'}
          </span>
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
            {tier === 'paid'
              ? 'Unlimited'
              : process.env.NEXT_PUBLIC_FEATURE_SCREEN_LIMIT === 'false'
                ? `${screensUsed} screens used`
                : `${screensUsed} / 5 screens used`}
          </span>
        </div>
      </div>

      {/* Profile completion indicator */}
      <div className="bg-white rounded-xl border border-gray-200 px-4 sm:px-6 py-5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Profile completeness</span>
          <span className={`text-sm font-bold ${completionTextColor}`}>{completionScore}%</span>
        </div>
        <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-2 rounded-full transition-all duration-500 ${completionColor}`}
            style={{ width: `${completionScore}%` }}
          />
        </div>
        {completionScore === 100 ? (
          <p className="text-xs text-green-700 flex items-center gap-1.5">
            <CheckCircle2 size={13} /> Profile complete — ready to screen JDs
          </p>
        ) : nextAction ? (
          <p className="text-xs text-gray-500">→ {nextAction}</p>
        ) : null}
      </div>

      {/* Onboarding welcome banner */}
      {isOnboarding && !onboardingCompleted && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 sm:px-6 py-5 space-y-4">
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
                <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold mt-0.5 ${step.done ? 'bg-green-500 text-white' : 'bg-blue-200 text-blue-700'}`}>
                  {step.done ? '✓' : i + 1}
                </span>
                <span className={step.done ? 'line-through text-gray-400' : 'text-blue-800'}>{step.label}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Completion banner */}
      {isOnboarding && !onboardingCompleted && allStepsDone && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 sm:px-6 py-4 flex items-center gap-3">
          <CheckCircle2 size={20} className="text-green-600 shrink-0" />
          <div>
            <p className="font-medium text-green-900 text-sm">Profile complete!</p>
            <p className="text-xs text-green-700 mt-0.5">Save your profile to start screening jobs.</p>
          </div>
        </div>
      )}

      {/* Basic info */}
      <Section title="Basic info" action={<SectionSaveButton state={basicSave} onClick={handleSaveBasic} />}>
        <Field label="Full name">
          <input
            type="text"
            value={fullName}
            onChange={(e) => { setFullName(e.target.value); markDirty() }}
            placeholder="Your name"
            className={inputCls}
          />
        </Field>
      </Section>

      {/* Resume */}
      <Section title="Resume">
        <ResumeUploader onParsed={applyParsed} existingResumeDate={resumeDate} />
        {detectedSkills.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 rounded-lg px-3 py-2 mt-2">
            <span className="font-medium">Detected:</span>
            <span>{detectedSkills.join(', ')}</span>
            {resumeWordCount != null && <span className="text-blue-400 ml-1">· {resumeWordCount.toLocaleString()} words</span>}
          </div>
        )}
      </Section>

      {/* AI provider */}
      <Section title="AI provider" action={<SectionSaveButton state={apiSave} onClick={handleSaveApi} />}>
        <Field label="Provider">
          <select
            value={apiProvider}
            onChange={(e) => { setApiProvider(e.target.value as 'openai' | 'anthropic'); markDirty() }}
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
            onChange={(e) => { setApiKey(e.target.value); markDirty() }}
            placeholder={hasExistingApiKey ? 'Key saved — paste new key to replace' : 'Paste your API key'}
            className={inputCls}
            autoComplete="new-password"
          />
          <p className="text-xs text-gray-400 mt-1">
            {hasExistingApiKey ? '✓ Key on file. Leave blank to keep it.' : 'Stored encrypted. Never shown again.'}
          </p>
        </Field>
      </Section>

      {/* Auto-reject rules */}
      <Section
        title="Auto-reject rules"
        action={<SectionSaveButton state={filterSave} onClick={handleSaveFilters} />}
      >
        <p className="text-sm text-gray-500 -mt-1 mb-3">
          Any job matching these gets instantly rejected — no score calculated.
        </p>
        <Field label="Tech I won't work with">
          <TagInput
            tags={techDealbreakerTags}
            onChange={(tags) => { setTechDealbreakerTags(tags); markDirty() }}
            onDirty={markDirty}
            placeholder="Type tech name, press Enter or comma"
            suggestions={DEALBREAKER_SUGGESTIONS}
          />
        </Field>
        <Field label="Minimum seniority level">
          <input
            type="text"
            value={titleFloor}
            onChange={(e) => { setTitleFloor(e.target.value); markDirty() }}
            placeholder="e.g. Senior, Lead, Staff"
            className={inputCls}
          />
        </Field>
        <Field label="Locations I'm open to (comma-separated)">
          <input
            type="text"
            value={geoAllowed}
            onChange={(e) => { setGeoAllowed(e.target.value); markDirty() }}
            placeholder="e.g. India, Remote, USA"
            className={inputCls}
          />
        </Field>
        <Field label="Company types to avoid (comma-separated)">
          <input
            type="text"
            value={companyExcluded}
            onChange={(e) => { setCompanyExcluded(e.target.value); markDirty() }}
            placeholder="e.g. staffing, outsourcing, consulting"
            className={inputCls}
          />
        </Field>
        <Field label="Job types to avoid (comma-separated)">
          <input
            type="text"
            value={roleExcluded}
            onChange={(e) => { setRoleExcluded(e.target.value); markDirty() }}
            placeholder="e.g. internship, contract, part-time"
            className={inputCls}
          />
        </Field>
      </Section>

      {/* Preferences */}
      <Section title="Preferences" action={<SectionSaveButton state={prefsSave} onClick={handleSavePrefs} />}>
        <Field label="Tech stack I enjoy (comma-separated)">
          <input
            type="text"
            value={prefTech}
            onChange={(e) => { setPrefTech(e.target.value); markDirty() }}
            placeholder="e.g. TypeScript, React, Node.js"
            className={inputCls}
          />
        </Field>
        <Field label="Industries I'm targeting (comma-separated)">
          <input
            type="text"
            value={prefIndustries}
            onChange={(e) => { setPrefIndustries(e.target.value); markDirty() }}
            placeholder="e.g. fintech, SaaS, healthtech"
            className={inputCls}
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Min company size">
            <input
              type="number"
              value={minSize}
              onChange={(e) => { setMinSize(e.target.value); markDirty() }}
              placeholder="e.g. 50"
              className={inputCls}
              min={0}
            />
          </Field>
          <Field label="Max company size">
            <input
              type="number"
              value={maxSize}
              onChange={(e) => { setMaxSize(e.target.value); markDirty() }}
              placeholder="e.g. 5000"
              className={inputCls}
              min={0}
            />
          </Field>
        </div>
      </Section>
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
