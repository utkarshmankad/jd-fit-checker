'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  FileSearch, Download, Share2, Plus, X,
  AlertTriangle, WifiOff,
} from 'lucide-react'
import toast from 'react-hot-toast'
import type { ScreeningResult, HardRejectFilters, BatchIntelligence } from '@/types'
import type { FatalScreenError } from '@/app/api/screen/route'
import BatchIntelligencePanel from '@/components/analysis/BatchIntelligencePanel'
import WhyNotChatGptModal from '@/components/dashboard/WhyNotChatGptModal'
import UsageWidget from '@/components/dashboard/UsageWidget'
import ReferralCard from '@/components/dashboard/ReferralCard'
import PaymentModal from '@/components/payment/PaymentModal'
// Job Tracker — feature disabled, kept for later.
// import TrackButton from '@/components/tracker/TrackButton'
import { SAMPLE_RESULTS } from '@/lib/sample-data'
import { calculateTimeSaved } from '@/lib/utils/time-saved'
import { VerdictCard, DismissedCard, ErrorCard, LoadingCard } from '@/components/analysis/VerdictCard'
import { normalizeJobUrl } from '@/lib/utils/url'
import { sanitizeCsvField } from '@/lib/utils/csv'
import Papa from 'papaparse'

type InputTab = 'urls' | 'text'

interface JdEntry {
  id: string
  jd_text: string
  job_title: string
  company: string
}

type ScreenError =
  | { type: 'no_api_key' }
  | { type: 'invalid_key'; provider: string }
  | { type: 'rate_limit'; keySource: 'app' | 'own' }
  | { type: 'network'; message?: string }
  | { type: 'service_error'; message?: string }

const PROFILE_BANNER_KEY = 'jobsnob-profile-banner-dismissed'
const PRICING_ENABLED = process.env.NEXT_PUBLIC_PRICING_ENABLED === 'true'

const LOADING_MESSAGES = [
  "Reading the fine print you'd skip…",
  'Checking if this is actually EM or just tech lead…',
  'Seeing if .NET is buried in requirements…',
  'Applying your standards…',
  'Almost done judging…',
]


const VERDICT_ORDER: Record<'STRONG' | 'DECENT' | 'WEAK' | 'REJECT', number> = {
  STRONG: 0, DECENT: 1, WEAK: 2, REJECT: 3,
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  return `${Math.floor(h / 24)} days ago`
}

function countValidUrls(text: string) {
  return text.split('\n').filter((l) => {
    const t = l.trim()
    return t.length > 0 && (t.startsWith('http') || /^[\w-]+\.\w+/.test(t))
  }).length
}

function getActiveRules(hrf: HardRejectFilters | null): string[] {
  if (!hrf) return []
  const rules: string[] = []
  const tech = hrf.tech_stack_dealbreakers ?? []
  if (tech.length) {
    rules.push(...tech.slice(0, 4))
    if (tech.length > 4) rules.push(`+${tech.length - 4} more`)
  }
  if (hrf.title_floor?.trim()) rules.push(`Below ${hrf.title_floor}`)
  if (hrf.geography_allowed?.length) rules.push(`Outside ${hrf.geography_allowed.slice(0, 2).join('/')}`)
  if (hrf.company_type_excluded?.length) rules.push(...hrf.company_type_excluded.slice(0, 2))
  if (hrf.role_type_excluded?.length) rules.push(...hrf.role_type_excluded.slice(0, 2))
  return rules
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [tab, setTab] = useState<InputTab>('urls')
  const [urlInput, setUrlInput] = useState('')
  const [jdEntries, setJdEntries] = useState<JdEntry[]>([
    { id: crypto.randomUUID(), jd_text: '', job_title: '', company: '' },
  ])
  const [screening, setScreening] = useState(false)
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0)
  const [skeletonCount, setSkeletonCount] = useState(0)
  // Submission-order labels for the current batch — drives the single
  // ordered scan list below (each row is either still-loading or resolved
  // to its own card, never both a placeholder and a separate result row).
  const [scanLabels, setScanLabels] = useState<string[]>([])
  const [scanBaseline, setScanBaseline] = useState(0)
  const [results, setResults] = useState<ScreeningResult[]>([])
  const [batchTime, setBatchTime] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [shareLoading, setShareLoading] = useState(false)
  const [rejectedCollapsed, setRejectedCollapsed] = useState(true)
  const [isSampleData, setIsSampleData] = useState(false)
  const [lifetimeRejectCount, setLifetimeRejectCount] = useState<number | null>(null)

  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null)
  const [hasPreferences, setHasPreferences] = useState(false)
  const [apiProvider, setApiProvider] = useState<string>('anthropic')
  const [usage, setUsage] = useState<{
    tier: 'free' | 'paid'
    effective_is_beta: boolean
    screens_used_total: number
    screens_used_this_week: number
    week_reset_at: string
    referral_bonus_screens: number
    beta_limit: number
    weekly_limit: number
  } | null>(null)
  const [hardRejectFilters, setHardRejectFilters] = useState<HardRejectFilters | null>(null)

  const [screenError, setScreenError] = useState<ScreenError | null>(null)
  // const [trackedIds, setTrackedIds] = useState<Set<string>>(new Set())
  const [batchIntelligence, setBatchIntelligence] = useState<BatchIntelligence | null>(null)
  const [showChatGptModal, setShowChatGptModal] = useState(false)
  const [showTierModal, setShowTierModal] = useState(false)
  const [tierModalMessage, setTierModalMessage] = useState('')
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Tracks an interrupted batch (rate limit, network drop, tab backgrounded) so
  // retrying continues from where it stopped instead of re-screening everything —
  // and re-burning API calls against the very rate limit that interrupted it.
  const inProgressBatchRef = useRef<{ batchId: string; allKeys: string[]; screenedKeys: Set<string> } | null>(null)
  const lastRequestAtRef = useRef(0)

  const [profileBannerDismissed, setProfileBannerDismissed] = useState(true)

  useEffect(() => {
    setProfileBannerDismissed(localStorage.getItem(PROFILE_BANNER_KEY) === '1')
  }, [])

  useEffect(() => {
    return () => { if (countdownRef.current) clearInterval(countdownRef.current) }
  }, [])

  useEffect(() => {
    if (!screening) return
    setLoadingMsgIndex(0)
    const interval = setInterval(() => {
      setLoadingMsgIndex((i) => (i + 1) % LOADING_MESSAGES.length)
    }, 2000)
    return () => clearInterval(interval)
  }, [screening])

  // Job Tracker — feature disabled, kept for later.
  // useEffect(() => {
  //   fetch('/api/tracker')
  //     .then((r) => r.json())
  //     .then((data: { items?: TrackedJob[] }) => {
  //       setTrackedIds(new Set((data.items ?? []).filter((i) => i.screening_result_id).map((i) => i.screening_result_id as string)))
  //     })
  //     .catch(() => {})
  // }, [])

  async function fetchLifetimeCount(userId: string) {
    const supabase = createClient()
    const { count } = await supabase
      .from('screening_results')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('verdict', 'REJECT')
    if (count !== null) setLifetimeRejectCount(count)
  }

  function refreshUsage() {
    return fetch('/api/profile')
      .then((r) => r.json())
      .then((data: { profile?: typeof usage }) => {
        if (data.profile) setUsage(data.profile)
      })
      .catch(() => {})
  }

  useEffect(() => {
    // Fired immediately, in parallel with the profile/lifetime-count query
    // below instead of after it — the beta badge shouldn't wait on unrelated
    // queries to finish before it can show a number.
    refreshUsage()

    async function loadProfile() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: profile } = await supabase
        .from('profiles')
        .select('tier, api_key_encrypted, api_provider, preferences, hard_reject_filters')
        .eq('id', user.id)
        .single()
      if (!profile) { setHasApiKey(false); return }
      setApiProvider((profile.api_provider as string) ?? 'anthropic')
      setHasApiKey(!!(profile.api_key_encrypted as string | null))
      const prefs = (profile.preferences ?? {}) as { preferred_tech_stack?: string[]; target_industries?: string[] }
      const hrf = (profile.hard_reject_filters ?? {}) as HardRejectFilters
      setHardRejectFilters(hrf)
      setHasPreferences(!!(prefs.preferred_tech_stack?.length || prefs.target_industries?.length || hrf.title_floor?.trim() || hrf.geography_allowed?.length))
      await fetchLifetimeCount(user.id)
    }
    loadProfile()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mirrors the key-building in handleScreen's resume detection, minus the
  // duplicate-toast — used to check staleness before an unattended auto-retry.
  function computeCurrentKeys(): string[] {
    const raw = tab === 'urls'
      ? urlInput.split('\n').map((u) => u.trim()).filter(Boolean).map((u) => `url:${normalizeJobUrl(u)}`)
      : jdEntries.filter((e) => e.jd_text.trim()).map((e) => `jd:${e.jd_text.trim()}`)
    return Array.from(new Set(raw))
  }

  function startCountdown() {
    const snapshotKeys = inProgressBatchRef.current?.allKeys ?? []
    setRateLimitCountdown(30)
    countdownRef.current = setInterval(() => {
      setRateLimitCountdown((v) => {
        if (v <= 1) {
          clearInterval(countdownRef.current!)
          countdownRef.current = null
          // If the user edited the input while waiting, auto-resuming would
          // silently start an unrelated batch with no confirmation — bail
          // instead and let them resubmit deliberately.
          const currentKeys = computeCurrentKeys()
          const stillMatches = snapshotKeys.length === currentKeys.length
            && snapshotKeys.every((k, i) => k === currentKeys[i])
          if (!stillMatches) {
            inProgressBatchRef.current = null
            setScreenError(null)
            toast('Input changed while waiting — auto-retry cancelled. Press Judge these jobs to continue.', { icon: '✋' })
            return 0
          }
          // Auto-resume once the cooldown clears — handleScreen picks up from
          // where it stopped (inProgressBatchRef), so this doesn't re-screen
          // anything already completed. No need to make the user click back in.
          setScreenError(null)
          handleScreen()
          return 0
        }
        return v - 1
      })
    }, 1000)
  }

  function dismissProfileBanner() {
    setProfileBannerDismissed(true)
    localStorage.setItem(PROFILE_BANNER_KEY, '1')
  }

  function addJdEntry() {
    if (jdEntries.length >= 10) return
    setJdEntries((prev) => [...prev, { id: crypto.randomUUID(), jd_text: '', job_title: '', company: '' }])
  }
  function removeJdEntry(id: string) {
    setJdEntries((prev) => prev.filter((e) => e.id !== id))
  }
  function updateJdEntry(id: string, field: keyof Omit<JdEntry, 'id'>, value: string) {
    setJdEntries((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)))
  }

  function handlePasteManually(url: string) {
    setTab('text')
    setResults([])
    setBatchTime(null)
    setIsSampleData(false)
    setJdEntries([{ id: crypto.randomUUID(), jd_text: '[Company name]\n[Paste JD text here]', job_title: '', company: url.slice(0, 40) }])
  }

  function loadSampleData() {
    setResults(SAMPLE_RESULTS)
    setBatchTime(new Date().toISOString())
    setIsSampleData(true)
    setRejectedCollapsed(false)
  }

  const inputEmpty = tab === 'urls' ? !urlInput.trim() : jdEntries.every((e) => !e.jd_text.trim())
  const urlCount = countValidUrls(urlInput)

  async function handleScreen() {
    setScreenError(null)
    setIsSampleData(false)
    // No client-side "must have a key" gate — beta users get BETA_LIMIT
    // screens on the app's own key with no key setup needed, and the server
    // is the single source of truth for whether that's still true. It
    // returns a clear error itself once a key actually is required.

    type Item = { kind: 'url'; value: string } | { kind: 'jd'; entry: JdEntry }
    let items: Item[] =
      tab === 'urls'
        ? urlInput.split('\n').map((u) => u.trim()).filter(Boolean).map((u) => ({ kind: 'url' as const, value: u }))
        : jdEntries.filter((e) => e.jd_text.trim()).map((e) => ({ kind: 'jd' as const, entry: e }))

    // Dedupe before screening — the same job can appear twice in a paste (LinkedIn's
    // recommended and search-results pages link the same posting with different URL
    // forms; users sometimes paste the same JD text twice). Screening a duplicate
    // burns an LLM call and produces a confusing duplicate row in the results table.
    const itemKey = (item: Item) => item.kind === 'url' ? `url:${normalizeJobUrl(item.value)}` : `jd:${item.entry.jd_text.trim()}`
    const seenKeys = new Set<string>()
    const dedupedItems = items.filter((item) => {
      const key = itemKey(item)
      if (seenKeys.has(key)) return false
      seenKeys.add(key)
      return true
    })
    const duplicateCount = items.length - dedupedItems.length
    items = dedupedItems
    if (duplicateCount > 0) {
      toast(`Removed ${duplicateCount} duplicate${duplicateCount !== 1 ? 's' : ''} before judging`, { icon: '🧹' })
    }

    if (items.length === 0) return

    // Resume detection: same input as an interrupted batch → continue with the
    // same batch_id, screening only what hasn't been screened yet. Any change to
    // the input (different URLs/JD text) is treated as a fresh batch.
    const currentKeys = items.map(itemKey)
    const prevBatch = inProgressBatchRef.current
    const isResume = !!prevBatch
      && prevBatch.allKeys.length === currentKeys.length
      && prevBatch.allKeys.every((k, i) => k === currentKeys[i])

    let batch_id: string
    let itemsToScreen: Item[]

    if (isResume) {
      batch_id = prevBatch!.batchId
      itemsToScreen = items.filter((item) => !prevBatch!.screenedKeys.has(itemKey(item)))
      if (itemsToScreen.length === 0) { inProgressBatchRef.current = null; return }
      toast(`Resuming — ${itemsToScreen.length} left to screen`, { icon: '↻' })
    } else {
      batch_id = crypto.randomUUID()
      inProgressBatchRef.current = { batchId: batch_id, allKeys: currentKeys, screenedKeys: new Set() }
      itemsToScreen = items
      setResults([])
      setBatchTime(null)
      setBatchIntelligence(null)
    }

    setScreening(true)
    setSkeletonCount(itemsToScreen.length)
    // On resume, `results` still holds the prior partial batch's completed
    // rows — offset the scan list past those so it lines up with the newly
    // appended results instead of reading stale indices as loading rows.
    setScanBaseline(isResume ? results.length : 0)
    setScanLabels(itemsToScreen.map((item) =>
      item.kind === 'url' ? item.value : (item.entry.job_title || item.entry.company || 'Pasted JD')
    ))
    setRejectedCollapsed(true)

    // OpenAI's default tier caps at 20 requests/minute — space calls out to stay
    // under that instead of firing as fast as possible and hitting 429s. Anthropic
    // isn't subject to this specific cap, so only pace OpenAI keys.
    const MIN_INTERVAL_MS = apiProvider === 'openai' ? 3100 : 0

    let completedFully = true

    try {
      for (const item of itemsToScreen) {
        if (MIN_INTERVAL_MS > 0) {
          const elapsed = Date.now() - lastRequestAtRef.current
          if (elapsed < MIN_INTERVAL_MS) await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed))
        }
        lastRequestAtRef.current = Date.now()

        const payload =
          item.kind === 'url'
            ? { urls: [item.value], batch_id }
            : { jd_entries: [{ jd_text: item.entry.jd_text, job_title: item.entry.job_title || undefined, company: item.entry.company || undefined }], batch_id }

        let res: Response
        try {
          res = await fetch('/api/screen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        } catch {
          setScreenError({ type: 'network', message: 'Connection error — check your internet connection and try again.' })
          completedFully = false
          break
        }

        if (res.status === 403) {
          const json = (await res.json().catch(() => ({}))) as {
            error?: string
            upgrade_required?: boolean
            limit_check?: { upgrade_prompt: string | null }
          }
          if (json.upgrade_required || json.limit_check) {
            setTierModalMessage(json.limit_check?.upgrade_prompt ?? json.error ?? "You've used your free judgments.")
            setShowTierModal(true)
            completedFully = false
            break
          }
        }

        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
          if (json.code === 'no_api_key') {
            setScreenError({ type: 'no_api_key' })
          } else {
            // Server responded (this isn't a connectivity problem on the
            // user's end) but with an error — distinct from the fetch-throw
            // 'network' case above, which really is the user's own connection.
            setScreenError({ type: 'service_error', message: json.error ?? `Screening failed (${res.status})` })
          }
          completedFully = false
          break
        }

        const data = (await res.json()) as { results: ScreeningResult[]; fatalError?: FatalScreenError }
        setResults((prev) => [...prev, ...data.results])
        setSkeletonCount((prev) => Math.max(0, prev - 1))
        inProgressBatchRef.current?.screenedKeys.add(itemKey(item))
        // Re-pull real usage from the server (not a local +1 guess) after
        // every completed item — quota reservation/refund happens server-side
        // per item, so the badge should reflect that immediately, not just
        // once the whole batch finishes.
        refreshUsage()

        if (data.fatalError) {
          if (data.fatalError.type === 'invalid_key') setScreenError({ type: 'invalid_key', provider: data.fatalError.provider })
          else if (data.fatalError.type === 'rate_limit') { setScreenError({ type: 'rate_limit', keySource: data.fatalError.keySource }); startCountdown() }
          completedFully = false
          break
        }
      }
    } finally {
      setBatchTime(new Date().toISOString())
      setSkeletonCount(0)
      setScreening(false)
      // Refresh lifetime count after batch
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) fetchLifetimeCount(user.id)

      if (completedFully) {
        inProgressBatchRef.current = null
        // Ask for market intelligence across the batch just screened — cheap no-op
        // server-side if fewer than 3 results were actually saved. Only do this once
        // the batch is actually done, not on every interrupted partial attempt.
        fetch('/api/screen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ finalize: true, batch_id }),
        })
          .then((r) => r.json())
          .then((data: { batch_intelligence?: BatchIntelligence | null }) => {
            if (data.batch_intelligence) setBatchIntelligence(data.batch_intelligence)
          })
          .catch(() => {})
      }
    }
  }

  function exportCSV() {
    const rows = results.map((r) => ({
      Company: sanitizeCsvField(r.company ?? ''),
      'Job Title': sanitizeCsvField(r.job_title ?? ''),
      'ATS %': r.ats_score,
      'Role Fit %': r.role_level_score,
      'Composite %': r.composite_score,
      Verdict: r.verdict,
    }))
    const rejectCount = results.filter((r) => r.verdict === 'REJECT').length
    const timeSavedComment = rejectCount > 0 ? `# ${calculateTimeSaved(rejectCount)} saved across this batch\n` : ''
    const csv = timeSavedComment + Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'jd-fit-results.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  async function handleShare() {
    setShareLoading(true)
    try {
      const res = await fetch('/api/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batch_id: results.find((r) => r.id)?.batch_id }) })
      if (!res.ok) throw new Error('Share failed')
      const { url } = (await res.json()) as { url: string }
      await navigator.clipboard.writeText(url)
      toast.success("Link copied. Go show someone how many jobs you didn't apply to.")
    } catch {
      toast.error('Could not create share link')
    } finally {
      setShareLoading(false)
    }
  }

  const goodResults = results.filter((r) => r.id !== '')
  const errorResults = results.filter((r) => r.id === '')

  // Ordered by verdict strength (Excellent -> Worth -> Low Priority) — not
  // sortable by score anymore, since scores are no longer the headline; they're
  // proof for the curious, tucked behind a per-card toggle.
  const sortedGood = [...goodResults].sort((a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict])
  const mainResults = [...sortedGood.filter((r) => r.verdict !== 'REJECT'), ...errorResults]
  const rejectResults = sortedGood.filter((r) => r.verdict === 'REJECT')

  const verdictCounts = {
    STRONG: goodResults.filter((r) => r.verdict === 'STRONG').length,
    DECENT: goodResults.filter((r) => r.verdict === 'DECENT').length,
    WEAK:   goodResults.filter((r) => r.verdict === 'WEAK').length,
    REJECT: rejectResults.length,
  }

  const worthALook = goodResults.length - verdictCounts.REJECT
  const providerLabel = { openai: 'OpenAI', anthropic: 'Anthropic', groq: 'Groq', deepseek: 'DeepSeek' }[apiProvider] ?? apiProvider
  const hasAnyResults = results.length > 0 || skeletonCount > 0
  const batchDone = !screening && skeletonCount === 0 && goodResults.length > 0
  const activeRules = getActiveRules(hardRejectFilters)
  const lifetimeSaved = lifetimeRejectCount !== null && lifetimeRejectCount > 0
    ? calculateTimeSaved(lifetimeRejectCount)
    : null

  return (
    <div className="space-y-6 max-w-6xl">
      {!profileBannerDismissed && hasApiKey === true && !hasPreferences && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-sm">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span className="flex-1">
            Jobsnob doesn&apos;t know your standards yet. Add your resume or set your dealbreakers.{' '}
            <a href="/profile" className="font-semibold underline">→</a> Otherwise we&apos;re judging blind.
          </span>
          <button onClick={dismissProfileBanner} className="shrink-0 text-amber-500 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-400 transition-colors" title="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Judge the list.</h1>
          {lifetimeSaved && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Lifetime: {lifetimeSaved} back in your life, across every batch</p>
          )}
        </div>
        {usage && (
          <UsageWidget
            tier={usage.tier}
            effective_is_beta={usage.effective_is_beta}
            screens_used_total={usage.screens_used_total}
            screens_used_this_week={usage.screens_used_this_week}
            week_reset_at={usage.week_reset_at}
            referral_bonus_screens={usage.referral_bonus_screens}
            beta_limit={usage.beta_limit}
            weekly_limit={usage.weekly_limit}
            pricingEnabled={PRICING_ENABLED}
            onUpgradeClick={() => setShowTierModal(true)}
          />
        )}
      </div>

      {usage && usage.tier !== 'paid' && <ReferralCard />}

      {/* Input card */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-6 pt-6 pb-0">
          <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700">
            <div className="flex">
              {(['urls', 'text'] as InputTab[]).map((t) => (
                <button key={t} onClick={() => { setTab(t); setResults([]); setBatchTime(null); setScreenError(null); setIsSampleData(false) }}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? 'border-blue-600 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
                  {t === 'urls' ? 'Job URLs' : 'Paste JD text'}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowChatGptModal(true)}
              className="mb-2 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 underline underline-offset-2 transition-colors shrink-0"
            >
              How is this different from ChatGPT?
            </button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-3">
          {tab === 'urls' ? (
            <>
              <textarea value={urlInput} onChange={(e) => { setUrlInput(e.target.value); setScreenError(null) }} rows={5}
                placeholder="Paste job URLs here. One per line. LinkedIn, Naukri, Greenhouse — anywhere. We'll read them so you don't have to."
                className="w-full resize-none rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-3 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              {urlInput.trim() && <p className="text-xs text-gray-400 dark:text-gray-500">{urlCount} URL{urlCount !== 1 ? 's' : ''} detected</p>}

              <p className="text-xs text-gray-400 dark:text-gray-500">
                Bulk import from LinkedIn? <a href="/dashboard/guide" className="text-blue-600 dark:text-blue-400 hover:underline font-medium">See the guide →</a>
              </p>
            </>
          ) : (
            <div className="space-y-3">
              {jdEntries.map((entry, idx) => (
                <div key={entry.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-400 dark:text-gray-500">JD {jdEntries.length > 1 ? `#${idx + 1}` : ''}</span>
                    {jdEntries.length > 1 && <button onClick={() => removeJdEntry(entry.id)} className="text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors" title="Remove"><X size={14} /></button>}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input type="text" placeholder="Job title (optional)" value={entry.job_title} onChange={(e) => updateJdEntry(entry.id, 'job_title', e.target.value)}
                      className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <input type="text" placeholder="Company (optional)" value={entry.company} onChange={(e) => updateJdEntry(entry.id, 'company', e.target.value)}
                      className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <textarea value={entry.jd_text} onChange={(e) => { updateJdEntry(entry.id, 'jd_text', e.target.value); setScreenError(null) }} rows={6}
                    placeholder="Paste the full job description here..."
                    className="w-full resize-none rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-3 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                </div>
              ))}
              {jdEntries.length < 10 && (
                <button onClick={addJdEntry} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 text-sm text-gray-500 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
                  <Plus size={14} /> Add another JD
                </button>
              )}
              <p className="text-xs text-gray-400 dark:text-gray-500">Use this tab when the URL scraper can&apos;t reach the page</p>
            </div>
          )}

          {screenError && (
            <div className={`rounded-lg px-4 py-3 text-sm flex items-start gap-3 ${screenError.type === 'invalid_key' ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300' : 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'}`}>
              {screenError.type === 'network' ? <WifiOff size={15} className="shrink-0 mt-0.5" /> : <AlertTriangle size={15} className="shrink-0 mt-0.5" />}
              <div className="flex-1 space-y-2">
                {screenError.type === 'no_api_key' && (<><p>⚠️ No API key saved. Add your Anthropic or OpenAI key in Profile settings.</p><a href="/profile" className="inline-block font-semibold underline text-xs">→ Go to Profile</a></>)}
                {screenError.type === 'invalid_key' && (<><p>✕ API key rejected by {({ openai: 'OpenAI', anthropic: 'Anthropic', groq: 'Groq', deepseek: 'DeepSeek' } as Record<string, string>)[screenError.provider] ?? screenError.provider}.</p><a href="/profile" className="inline-block font-semibold underline text-xs">→ Update your API key</a></>)}
                {screenError.type === 'rate_limit' && (
                  <div className="flex items-center justify-between gap-4">
                    <p>
                      {screenError.keySource === 'app'
                        ? "We're hitting high demand on the free scanning key right now"
                        : `Your ${providerLabel} key hit a rate limit${apiProvider === 'openai' ? " (OpenAI's default tier caps at 20 requests/minute)" : ''}`}
                      .{' '}
                      {rateLimitCountdown > 0
                        ? results.length > 0
                          ? `Continuing automatically in ${rateLimitCountdown}s — nothing already screened will be redone.`
                          : `Retrying automatically in ${rateLimitCountdown}s.`
                        : results.length > 0 ? 'Continuing where it left off.' : 'Retrying now.'}
                    </p>
                    <button onClick={() => { setScreenError(null); handleScreen() }} disabled={rateLimitCountdown > 0}
                      className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 dark:bg-amber-700 text-white hover:bg-amber-700 disabled:opacity-40 transition-colors">
                      {rateLimitCountdown > 0 ? `Retry in ${rateLimitCountdown}s` : 'Retry now'}
                    </button>
                  </div>
                )}
                {screenError.type === 'network' && (
                  <div className="flex items-center justify-between gap-4">
                    <p>{screenError.message ?? 'Connection error — check your internet connection.'}</p>
                    <button onClick={() => { setScreenError(null); handleScreen() }} className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-700 dark:bg-gray-300 text-white hover:bg-gray-800 transition-colors">Retry</button>
                  </div>
                )}
                {screenError.type === 'service_error' && (
                  <div className="flex items-center justify-between gap-4">
                    <p>{screenError.message ?? 'Screening service error.'} This isn&apos;t a problem with your connection.</p>
                    <button onClick={() => { setScreenError(null); handleScreen() }} className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-700 dark:bg-gray-300 text-white hover:bg-gray-800 transition-colors">Retry</button>
                  </div>
                )}
              </div>
              {screenError.type !== 'rate_limit' && screenError.type !== 'network' && screenError.type !== 'service_error' && (
                <button onClick={() => setScreenError(null)} className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"><X size={14} /></button>
              )}
            </div>
          )}

          <button onClick={handleScreen} disabled={screening || inputEmpty || (screenError?.type === 'rate_limit' && rateLimitCountdown > 0)}
            className="w-full py-3 rounded-lg font-medium text-sm text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: '#1B3A5C' }}>
            {screening ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                {LOADING_MESSAGES[loadingMsgIndex]}
              </span>
            ) : 'Judge these jobs'}
          </button>
        </div>
      </div>

      {/* Active dealbreakers strip */}
      {activeRules.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500 dark:text-gray-400 px-1">
          <span className="font-medium text-gray-600 dark:text-gray-300">Active dealbreakers:</span>
          {activeRules.map((rule) => (
            <span key={rule} className="px-2 py-0.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-full font-medium">{rule}</span>
          ))}
          <a href="/profile" className="text-blue-500 dark:text-blue-400 hover:underline ml-1">Edit →</a>
        </div>
      )}

      {/* Empty state */}
      {!hasAnyResults ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileSearch size={48} className="text-gray-300 dark:text-gray-600 mb-4" />
          <p className="text-gray-700 dark:text-gray-300 font-semibold text-lg">Nothing judged yet.</p>
          <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">Paste your job list below. We&apos;ll tell you which ones aren&apos;t worth your morning.</p>
          <div className="mt-6 flex flex-col items-center gap-2">
            <button onClick={loadSampleData}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors hover:opacity-90"
              style={{ backgroundColor: '#1B3A5C' }}>
              See a sample batch →
            </button>
            <p className="text-xs text-gray-400 dark:text-gray-500">No API key needed — see how auto-reject works</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Sample data banner */}
          {isSampleData && (
            <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-sm">
              <p className="text-blue-800 dark:text-blue-300">👆 Sample batch — showing how auto-reject and verdicts work.</p>
              <a href="/profile?onboarding=true" className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors hover:opacity-90" style={{ backgroundColor: '#1B3A5C' }}>
                Set up your dealbreakers →
              </a>
            </div>
          )}

          {/* TIME-SAVED HERO CARD */}
          {batchDone && !isSampleData && verdictCounts.REJECT > 0 && (
            <div style={{ backgroundColor: '#1B3A5C' }} className="rounded-xl px-6 py-6 text-white">
              <p className="text-5xl font-bold tracking-tight leading-none">{calculateTimeSaved(verdictCounts.REJECT)}</p>
              <p className="text-blue-200 dark:text-blue-300 mt-3 text-base">
                back in your life. {verdictCounts.REJECT} job{verdictCounts.REJECT !== 1 ? 's' : ''} judged not worth it.
              </p>
            </div>
          )}

          {/* Batch completion line */}
          {goodResults.length > 0 && skeletonCount === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400 px-1">
              {verdictCounts.REJECT === goodResults.length ? (
                <>Judged {goodResults.length}. None cleared your standards. Try a different search. Or lower one filter.</>
              ) : verdictCounts.REJECT === 0 ? (
                <>Judged {goodResults.length}. All {goodResults.length} cleared your standards. Rare. Pick the best one.</>
              ) : (
                <>Judged {goodResults.length}. {worthALook} worth your time. {verdictCounts.REJECT} dismissed. {calculateTimeSaved(verdictCounts.REJECT)} back in your life.</>
              )}
              {errorResults.length > 0 && <span className="ml-1 text-amber-600 dark:text-amber-400">({errorResults.length} failed to scrape)</span>}
            </p>
          )}
          {batchTime && skeletonCount === 0 && goodResults.length > 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 px-1 -mt-2">Judged {timeAgo(batchTime)}</p>
          )}

          {/* Scanning phase — one row per submitted job, in submission order.
              Each row starts as a loading placeholder and resolves into its
              own card in place, instead of a separate skeleton strip that's
              disconnected from where the finished card ends up. */}
          {screening ? (
            <div className="space-y-3">
              {scanLabels.map((label, i) => {
                const result = results[scanBaseline + i]
                if (!result) {
                  return <LoadingCard key={`scan-${i}`} label={label} message={LOADING_MESSAGES[loadingMsgIndex]} />
                }
                return result.id === '' ? (
                  <ErrorCard
                    key={result.job_url || result.created_at}
                    result={result}
                    onOpen={result.job_url ? () => window.open(result.job_url!, '_blank', 'noopener,noreferrer') : undefined}
                    onEdit={result.job_url ? () => handlePasteManually(result.job_url!) : undefined}
                  />
                ) : (
                  <VerdictCard
                    key={result.id}
                    result={result}
                    isExpanded={expandedId === result.id}
                    onToggle={() => setExpandedId(expandedId === result.id ? null : result.id)}
                  />
                )
              })}
            </div>
          ) : (
            /* Zone 1 — everything that isn't dismissed, plus scrape failures */
            <div className="space-y-3">
              {mainResults.map((result) => (
                result.id === '' ? (
                  <ErrorCard
                    key={result.job_url || result.created_at}
                    result={result}
                    onOpen={result.job_url ? () => window.open(result.job_url!, '_blank', 'noopener,noreferrer') : undefined}
                    onEdit={result.job_url ? () => handlePasteManually(result.job_url!) : undefined}
                  />
                ) : (
                  <VerdictCard
                    key={result.id}
                    result={result}
                    isExpanded={expandedId === result.id}
                    onToggle={() => setExpandedId(expandedId === result.id ? null : result.id)}
                  />
                )
              ))}
            </div>
          )}

          {/* Zone 2 — dismissed, grouped under a divider, smaller cards */}
          {rejectResults.length > 0 && (
            <div className="pt-2">
              <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                <span className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                <span>— Dismissed ({rejectResults.length}) —</span>
                <span className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
              </div>
              <div className="mt-3 space-y-2">
                {(rejectedCollapsed ? rejectResults.slice(0, 3) : rejectResults).map((result) => (
                  <DismissedCard key={result.id} result={result} />
                ))}
              </div>
              {rejectResults.length > 3 && (
                <button
                  onClick={() => setRejectedCollapsed((v) => !v)}
                  className="mt-2 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 underline"
                >
                  {rejectedCollapsed ? `Show all dismissed (${rejectResults.length}) →` : 'Show fewer'}
                </button>
              )}
            </div>
          )}

          {goodResults.length > 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed px-1">
              Scores reflect resume-to-JD fit, not a guarantee of callbacks. Use them to prioritize, not to predict.
            </p>
          )}

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
            <button onClick={exportCSV} className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors bg-white dark:bg-gray-900">
              <Download size={15} /> Export CSV
            </button>
            {!isSampleData && (
              <button onClick={handleShare} disabled={shareLoading} className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors disabled:opacity-50 bg-white dark:bg-gray-900">
                <Share2 size={15} /> {shareLoading ? 'Sharing...' : 'Share results'}
              </button>
            )}
          </div>

          {batchIntelligence && (
            <BatchIntelligencePanel
              intelligence={batchIntelligence}
              matchingSkills={Array.from(new Set(goodResults.flatMap((r) => r.analysis_json?.matching_skills ?? [])))}
            />
          )}
        </div>
      )}

      {/* Tier limit modal */}
      {PRICING_ENABLED && showTierModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowTierModal(false)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">You&apos;ve used your free judgments.</h2>
            <p className="text-gray-500 dark:text-gray-400 text-sm">{tierModalMessage || 'Upgrade once. Judge unlimited jobs. No monthly subscription — your search will end.'}</p>
            <div className="flex flex-col gap-2 pt-1">
              <button onClick={() => { setShowTierModal(false); setShowPaymentModal(true) }}
                className="w-full py-3 rounded-xl font-semibold text-sm text-white hover:opacity-90 transition-opacity" style={{ backgroundColor: '#1B3A5C' }}>
                Unlock unlimited judgments — ₹499 one-time
              </button>
              <button onClick={() => setShowTierModal(false)} className="w-full text-center text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors py-2">Maybe later</button>
            </div>
          </div>
        </div>
      )}

      {PRICING_ENABLED && (
        <PaymentModal isOpen={showPaymentModal} onClose={() => setShowPaymentModal(false)}
          onSuccess={() => { setShowPaymentModal(false); toast.success('Unlocked. Judge unlimited jobs, forever.') }} />
      )}

      <WhyNotChatGptModal open={showChatGptModal} onClose={() => setShowChatGptModal(false)} />
    </div>
  )
}
