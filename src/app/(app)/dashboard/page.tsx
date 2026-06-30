'use client'

import { useState, useEffect, useRef, Fragment } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  FileSearch, Eye, ExternalLink, Download, Share2, Plus, X,
  ChevronDown, ChevronUp, Copy, Check, AlertTriangle, WifiOff, Pencil, Info,
} from 'lucide-react'
import toast from 'react-hot-toast'
import type { ScreeningResult, HardRejectFilters } from '@/types'
import type { FatalScreenError } from '@/app/api/screen/route'
import PaymentModal from '@/components/payment/PaymentModal'
import { SAMPLE_RESULTS } from '@/lib/sample-data'
import { calculateTimeSaved } from '@/lib/utils/time-saved'

type SortKey = 'composite_score' | 'ats_score' | 'role_level_score' | 'verdict'
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
  | { type: 'rate_limit' }
  | { type: 'network'; message?: string }

const PROFILE_BANNER_KEY = 'jdfit-profile-banner-dismissed'

const SORT_LABELS: Record<SortKey, string> = {
  composite_score: 'Composite',
  ats_score: 'ATS',
  role_level_score: 'Role fit',
  verdict: 'Verdict',
}

const VERDICT_ORDER: Record<'STRONG' | 'DECENT' | 'WEAK' | 'REJECT', number> = {
  STRONG: 0, DECENT: 1, WEAK: 2, REJECT: 3,
}

const VERDICT_CONFIG: Record<string, { cls: string; label: string }> = {
  STRONG: { cls: 'bg-green-100 text-green-800 border border-green-300', label: '✦ Strong match' },
  DECENT: { cls: 'bg-amber-100 text-amber-800 border border-amber-300', label: '◉ Decent match' },
  WEAK:   { cls: 'bg-gray-100 text-gray-600 border border-gray-300',   label: '○ Weak match' },
  REJECT: { cls: 'bg-red-100 text-red-800 border border-red-300',      label: '✕ Rejected' },
}

const SCORE_TOOLTIPS = {
  ats: "How many of the JD's required skills appear in your resume, weighted by importance.",
  role: 'How well your seniority, scope, and team-size experience matches what this role needs.',
  composite: 'Weighted blend: 45% ATS keyword match, 55% role-level fit.',
}

function scoreTextClass(n: number) {
  if (n >= 70) return 'text-green-600'
  if (n >= 50) return 'text-amber-500'
  return 'text-red-500'
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

function whyVerdict(r: ScreeningResult): string {
  const { verdict, ats_score: ats, role_level_score: role } = r
  const missing = r.analysis_json?.missing_skills ?? []
  if (verdict === 'STRONG') return `STRONG because both ATS match (${ats}) and role-level fit (${role}) clear the threshold.`
  if (verdict === 'DECENT') {
    if (ats < role) return `DECENT because role-fit is solid (${role}) but ${missing.length > 0 ? `you're missing ${missing.length} required skill${missing.length !== 1 ? 's' : ''}, pulling ATS down to ${ats}` : `ATS match is moderate at ${ats}`}.`
    return `DECENT because keyword match is reasonable (${ats}) but role-level fit (${role}) shows some mismatch.`
  }
  if (verdict === 'WEAK') {
    if (ats < 50 && role < 50) return `WEAK because both ATS match (${ats}) and role-level fit (${role}) are below threshold.`
    if (ats < role) return `WEAK because ATS match (${ats}) is significantly below threshold despite reasonable role-fit (${role}).`
    return `WEAK because role-level fit (${role}) indicates significant mismatch.`
  }
  if (verdict === 'REJECT') {
    const reasons = r.hard_reject_reasons ?? []
    return `REJECT triggered before scoring — ${reasons.length > 0 ? `failed hard-reject rule: ${reasons[0]}` : 'failed your hard-reject filters'}.`
  }
  return ''
}

function getReasonLine(r: ScreeningResult): string {
  if (r.verdict === 'REJECT') return r.hard_reject_reasons?.[0] ?? 'Hard-reject rule triggered'
  if (r.analysis_json?.headline) {
    const h = r.analysis_json.headline
    return h.length > 90 ? h.slice(0, 90) + '…' : h
  }
  if (r.analysis_json?.recommendation) {
    const rec = r.analysis_json.recommendation.replace(/^(APPLY IF|APPLY|SKIP)\s*/i, '')
    return rec.length > 90 ? rec.slice(0, 90) + '…' : rec
  }
  return ''
}

const LINKEDIN_CONSOLE_SCRIPT = `(async () => {
  const ids = new Set();
  function collect() {
    document.querySelectorAll('[data-job-id],[data-occludable-job-id]').forEach(el => {
      const id = el.getAttribute('data-job-id') || el.getAttribute('data-occludable-job-id');
      if (id && /^\\d{5,}$/.test(id)) ids.add(id);
    });
    document.querySelectorAll('a[href*="/jobs/view/"]').forEach(el => {
      const m = (el.getAttribute('href') || '').match(/\\/jobs\\/view\\/(\\d+)/);
      if (m) ids.add(m[1]);
    });
  }
  collect();
  for (let i = 0; i < 10; i++) {
    window.scrollBy(0, 800);
    await new Promise(r => setTimeout(r, 800));
    collect();
  }
  const urls = [...ids].slice(0, 20).map(id => 'https://www.linkedin.com/jobs/view/' + id + '/').join('\\n');
  try { await navigator.clipboard.writeText(urls); } catch (e) { prompt('Copy URLs:', urls); }
  alert('Copied ' + ids.size + ' job URLs! Paste into JD Fit Checker.');
})();`

// ── Sub-components ────────────────────────────────────────────────────────────

function ScoreTooltip({ tip, children }: { tip: string; children: React.ReactNode }) {
  return (
    <span className="relative group inline-flex items-center gap-1 cursor-default">
      {children}
      <Info size={10} className="text-gray-300 opacity-60 shrink-0" />
      <span className="absolute bottom-full right-0 mb-2 w-52 bg-gray-900 text-white text-xs rounded-lg px-2.5 py-2 leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none whitespace-normal text-left shadow-lg">
        {tip}
        <span className="absolute top-full right-2 border-4 border-transparent border-t-gray-900" />
      </span>
    </span>
  )
}

function ScorePill({ label, score, tip }: { label: string; score: number; tip: string }) {
  return (
    <ScoreTooltip tip={tip}>
      <span className="text-xs text-gray-400">{label}</span>
      <span className={`text-xs font-semibold ${scoreTextClass(score)}`}>{score}</span>
    </ScoreTooltip>
  )
}

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-100">
      <td className="px-4 sm:px-6 py-4"><div className="h-4 bg-gray-200 rounded animate-pulse w-24" /></td>
      <td className="px-4 py-4"><div className="h-4 bg-gray-200 rounded animate-pulse w-32" /></td>
      <td className="px-4 py-4"><div className="h-6 bg-gray-200 rounded-full animate-pulse w-28" /></td>
      <td className="px-4 py-4 hidden md:table-cell"><div className="h-3 bg-gray-200 rounded animate-pulse w-16 ml-auto" /></td>
      <td className="px-4 py-4"><div className="h-4 bg-gray-200 rounded animate-pulse w-6 ml-auto" /></td>
    </tr>
  )
}

function RequirementsChecklist({ items }: { items: import('@/types').RequirementCheck[] }) {
  if (!items?.length) return null
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 mb-2">Requirements check</p>
      <ul className="space-y-2">
        {items.map((item, i) => {
          const icon = item.status === 'met' ? '✓' : item.status === 'partial' ? '◐' : '✗'
          const cls = item.status === 'met' ? 'text-green-600' : item.status === 'partial' ? 'text-amber-600' : 'text-red-600'
          return (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className={`shrink-0 font-bold mt-0.5 ${cls}`}>{icon}</span>
              <span>
                <span className="text-gray-800">{item.requirement}</span>
                {item.evidence && <span className="text-gray-400 text-xs ml-1">— {item.evidence}</span>}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function SoftConcernsCallout({ concerns }: { concerns?: string[] }) {
  if (!concerns?.length) return null
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-3">
      <p className="text-xs font-semibold text-amber-700 mb-1.5">Worth checking:</p>
      <ul className="space-y-1">
        {concerns.map((c, i) => (
          <li key={i} className="text-sm text-amber-800 flex items-start gap-1.5">
            <span className="text-amber-500 mt-0.5 shrink-0">•</span>{c}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ColoredRecommendation({ text }: { text: string }) {
  if (!text) return null
  const match = text.match(/^(APPLY IF|APPLY|SKIP)([\s\S]*)/)
  if (!match) return <p className="text-sm text-blue-900 leading-relaxed">{text}</p>
  const keyword = match[1]
  const rest = match[2]
  const color = keyword === 'SKIP' ? 'text-red-600' : keyword === 'APPLY IF' ? 'text-amber-600' : 'text-green-600'
  return (
    <p className="text-sm text-blue-900 leading-relaxed">
      <span className={`font-bold ${color}`}>{keyword}</span>{rest}
    </p>
  )
}

function SkillPills({ label, skills, variant }: { label: string; skills: string[]; variant: 'match' | 'miss' }) {
  const pillCls = variant === 'match' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
  const prefix = variant === 'match' ? '✓ ' : '✗ '
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 mb-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {skills.length === 0 ? <span className="text-xs text-gray-400">None</span> : skills.map((s) => (
          <span key={s} className={`px-2 py-0.5 rounded-full text-xs font-medium ${pillCls}`}>{prefix}{s}</span>
        ))}
      </div>
    </div>
  )
}

function AnalysisBlock({ label, text }: { label: string; text: string }) {
  if (!text) return null
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 mb-1">{label}</p>
      <p className="text-sm text-gray-700 leading-relaxed">{text}</p>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [tab, setTab] = useState<InputTab>('urls')
  const [urlInput, setUrlInput] = useState('')
  const [jdEntries, setJdEntries] = useState<JdEntry[]>([
    { id: crypto.randomUUID(), jd_text: '', job_title: '', company: '' },
  ])
  const [screening, setScreening] = useState(false)
  const [skeletonCount, setSkeletonCount] = useState(0)
  const [results, setResults] = useState<ScreeningResult[]>([])
  const [batchTime, setBatchTime] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('composite_score')
  const [shareLoading, setShareLoading] = useState(false)
  const [rejectedCollapsed, setRejectedCollapsed] = useState(true)
  const [isSampleData, setIsSampleData] = useState(false)
  const [lifetimeRejectCount, setLifetimeRejectCount] = useState<number | null>(null)

  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null)
  const [hasPreferences, setHasPreferences] = useState(false)
  const [apiProvider, setApiProvider] = useState<string>('anthropic')
  const [hardRejectFilters, setHardRejectFilters] = useState<HardRejectFilters | null>(null)

  const [screenError, setScreenError] = useState<ScreenError | null>(null)
  const [showTierModal, setShowTierModal] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [profileBannerDismissed, setProfileBannerDismissed] = useState(true)
  const [showLinkedInHelper, setShowLinkedInHelper] = useState(false)
  const [scriptCopied, setScriptCopied] = useState(false)

  useEffect(() => {
    setProfileBannerDismissed(localStorage.getItem(PROFILE_BANNER_KEY) === '1')
  }, [])

  useEffect(() => {
    return () => { if (countdownRef.current) clearInterval(countdownRef.current) }
  }, [])

  async function fetchLifetimeCount(userId: string) {
    const supabase = createClient()
    const { count } = await supabase
      .from('screening_results')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('verdict', 'REJECT')
    if (count !== null) setLifetimeRejectCount(count)
  }

  useEffect(() => {
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

  function startCountdown() {
    setRateLimitCountdown(30)
    countdownRef.current = setInterval(() => {
      setRateLimitCountdown((v) => {
        if (v <= 1) { clearInterval(countdownRef.current!); countdownRef.current = null; return 0 }
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
    if (hasApiKey === false) { setScreenError({ type: 'no_api_key' }); return }

    type Item = { kind: 'url'; value: string } | { kind: 'jd'; entry: JdEntry }
    const items: Item[] =
      tab === 'urls'
        ? urlInput.split('\n').map((u) => u.trim()).filter(Boolean).slice(0, 20).map((u) => ({ kind: 'url' as const, value: u }))
        : jdEntries.filter((e) => e.jd_text.trim()).map((e) => ({ kind: 'jd' as const, entry: e }))

    if (items.length === 0) return

    setScreening(true)
    setResults([])
    setBatchTime(null)
    setSkeletonCount(items.length)
    setRejectedCollapsed(true)

    const batch_id = crypto.randomUUID()

    try {
      for (const item of items) {
        const payload =
          item.kind === 'url'
            ? { urls: [item.value], batch_id }
            : { jd_entries: [{ jd_text: item.entry.jd_text, job_title: item.entry.job_title || undefined, company: item.entry.company || undefined }], batch_id }

        let res: Response
        try {
          res = await fetch('/api/screen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        } catch {
          setScreenError({ type: 'network', message: 'Connection error — check your internet connection and try again.' })
          break
        }

        if (res.status === 403) {
          const json = (await res.json().catch(() => ({}))) as { upgrade_required?: boolean }
          if (json.upgrade_required) { setShowTierModal(true); break }
        }

        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string }
          setScreenError({ type: 'network', message: json.error ?? `Screening failed (${res.status})` })
          break
        }

        const data = (await res.json()) as { results: ScreeningResult[]; fatalError?: FatalScreenError }
        setResults((prev) => [...prev, ...data.results])
        setSkeletonCount((prev) => Math.max(0, prev - 1))

        if (data.fatalError) {
          if (data.fatalError.type === 'invalid_key') setScreenError({ type: 'invalid_key', provider: data.fatalError.provider })
          else if (data.fatalError.type === 'rate_limit') { setScreenError({ type: 'rate_limit' }); startCountdown() }
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
    }
  }

  function exportCSV() {
    const header = 'Company,Job Title,ATS %,Role Fit %,Composite %,Verdict'
    const rows = results.map((r) => `"${r.company ?? ''}","${r.job_title ?? ''}",${r.ats_score},${r.role_level_score},${r.composite_score},${r.verdict}`)
    const rejectCount = results.filter((r) => r.verdict === 'REJECT').length
    const timeSavedComment = rejectCount > 0 ? `# ${calculateTimeSaved(rejectCount)} saved across this batch\n` : ''
    const csv = timeSavedComment + [header, ...rows].join('\n')
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
      toast.success('Link copied — go brag about how much time you saved.')
    } catch {
      toast.error('Could not create share link')
    } finally {
      setShareLoading(false)
    }
  }

  const goodResults = results.filter((r) => r.id !== '')
  const errorResults = results.filter((r) => r.id === '')

  const sortedGood = [...goodResults].sort((a, b) => {
    if (sortKey === 'verdict') return VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict]
    return b[sortKey] - a[sortKey]
  })
  const mainResults = [...sortedGood.filter((r) => r.verdict !== 'REJECT'), ...errorResults]
  const rejectResults = sortedGood.filter((r) => r.verdict === 'REJECT')

  const verdictCounts = {
    STRONG: goodResults.filter((r) => r.verdict === 'STRONG').length,
    DECENT: goodResults.filter((r) => r.verdict === 'DECENT').length,
    WEAK:   goodResults.filter((r) => r.verdict === 'WEAK').length,
    REJECT: rejectResults.length,
  }

  const worthALook = goodResults.length - verdictCounts.REJECT
  const providerLabel = apiProvider === 'openai' ? 'OpenAI' : 'Anthropic'
  const hasAnyResults = results.length > 0 || skeletonCount > 0
  const batchDone = !screening && skeletonCount === 0 && goodResults.length > 0
  const activeRules = getActiveRules(hardRejectFilters)
  const lifetimeSaved = lifetimeRejectCount !== null && lifetimeRejectCount > 0
    ? calculateTimeSaved(lifetimeRejectCount)
    : null

  function renderResultRow(result: ScreeningResult) {
    const isErrorRow = result.id === ''
    const errorMsg = isErrorRow ? (result.hard_reject_reasons?.[0] ?? 'Could not scrape this URL') : null
    const isReject = !isErrorRow && result.verdict === 'REJECT'
    const rowKey = result.id || result.job_url || result.created_at
    const isExpanded = expandedId === rowKey
    const reasonLine = !isErrorRow ? getReasonLine(result) : null

    return (
      <Fragment key={rowKey}>
        <tr className={[
          'border-b border-gray-100 transition-colors',
          isErrorRow ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-gray-50',
          isReject ? 'border-l-4 border-red-400' : '',
        ].filter(Boolean).join(' ')}>
          {/* Company */}
          <td className="px-4 sm:px-6 py-4 font-medium text-gray-900 whitespace-nowrap align-top">
            {isErrorRow ? <span className="text-amber-700">Unknown</span> : (result.company ?? '—')}
          </td>
          {/* Job title */}
          <td className="px-4 py-4 text-gray-500 max-w-[10rem] align-top">
            {isErrorRow ? (
              <span className="text-amber-700 text-xs truncate block" title={result.job_url ?? ''}>
                {(result.job_url ?? '').slice(0, 36)}{(result.job_url ?? '').length > 36 ? '…' : ''}
              </span>
            ) : (
              <span className="text-xs line-clamp-2">{result.job_title ?? '—'}</span>
            )}
          </td>
          {/* Verdict (PRIMARY) + reason line */}
          <td className="px-4 py-4 align-top max-w-xs">
            {isErrorRow ? (
              <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-bold bg-amber-100 text-amber-800 border border-amber-300">⚠ Scrape failed</span>
            ) : (
              <div>
                <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-bold ${VERDICT_CONFIG[result.verdict]?.cls ?? 'bg-gray-100 text-gray-600 border border-gray-300'}`}>
                  {VERDICT_CONFIG[result.verdict]?.label ?? result.verdict}
                </span>
                {reasonLine && (
                  <p className={`text-xs mt-1.5 leading-snug ${isReject ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                    {reasonLine}
                  </p>
                )}
              </div>
            )}
          </td>
          {/* Scores (SECONDARY — small, muted, right-aligned, hidden on mobile) */}
          <td className="px-4 py-4 text-right align-top hidden md:table-cell">
            {!isErrorRow && (
              <div className="flex flex-col items-end gap-1.5">
                <ScorePill label="ATS " score={result.ats_score} tip={SCORE_TOOLTIPS.ats} />
                <ScorePill label="Role " score={result.role_level_score} tip={SCORE_TOOLTIPS.role} />
                <ScorePill label="⊕ " score={result.composite_score} tip={SCORE_TOOLTIPS.composite} />
              </div>
            )}
          </td>
          {/* Actions */}
          <td className="px-4 py-4 align-top">
            <div className="flex items-center gap-2 justify-end">
              <button onClick={() => setExpandedId(isExpanded ? null : rowKey)}
                className={`p-1.5 rounded transition-colors ${isExpanded ? 'text-blue-600 bg-blue-50 hover:bg-blue-100' : 'text-gray-500 hover:bg-gray-200'}`}
                title={isErrorRow ? 'View error' : 'View analysis'}>
                <Eye size={15} />
              </button>
              {result.job_url && !isErrorRow && (
                <a href={result.job_url} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded hover:bg-gray-200 text-gray-500 transition-colors" title="Open URL">
                  <ExternalLink size={15} />
                </a>
              )}
            </div>
          </td>
        </tr>

        {/* Expanded detail row */}
        <tr className={isErrorRow ? 'bg-amber-50' : 'bg-slate-50'}>
          <td colSpan={5} className="p-0">
            <div className={`overflow-hidden transition-all duration-200 ease-in-out ${isExpanded ? 'max-h-[900px]' : 'max-h-0'}`}>
              <div className="px-6 py-5">
                {isErrorRow ? (
                  <div className="space-y-3 max-w-xl">
                    <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-100 rounded-lg px-3 py-2.5">
                      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                      <span>{errorMsg}</span>
                    </div>
                    {result.job_url && (
                      <button onClick={() => handlePasteManually(result.job_url!)}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors">
                        <Pencil size={12} /> Paste manually
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4 max-w-3xl">
                    {/* a. Headline + why verdict */}
                    {result.analysis_json?.headline && (
                      <p className="text-sm font-medium text-gray-700">{result.analysis_json.headline}</p>
                    )}
                    <p className="text-xs text-gray-400 italic">{whyVerdict(result)}</p>

                    {/* Hard reject */}
                    {result.hard_reject_reasons?.length > 0 && result.verdict === 'REJECT' && (
                      <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200">
                        <p className="text-xs font-semibold text-red-600 mb-0.5">Hard reject</p>
                        <p className="text-sm text-red-700">{result.hard_reject_reasons[0]}</p>
                      </div>
                    )}

                    {/* b. Requirements + skills */}
                    <RequirementsChecklist items={result.analysis_json?.requirements_met ?? []} />
                    <SkillPills label="Matching skills" skills={result.analysis_json?.matching_skills ?? []} variant="match" />
                    <SkillPills label="Missing skills" skills={result.analysis_json?.missing_skills ?? []} variant="miss" />
                    <SoftConcernsCallout concerns={result.analysis_json?.soft_concerns} />
                    <AnalysisBlock label="Role level assessment" text={result.analysis_json?.role_level_assessment ?? ''} />
                    <AnalysisBlock label="Gap analysis" text={result.analysis_json?.gap_analysis ?? ''} />

                    {/* c. Score breakdown (supplementary) */}
                    {result.verdict !== 'REJECT' && (
                      <p className="text-xs font-mono text-gray-400 bg-gray-100 rounded px-2 py-1 inline-block">
                        Composite {result.composite_score} = (ATS {result.ats_score} × 0.45) + (Role {result.role_level_score} × 0.55) = {(result.ats_score * 0.45 + result.role_level_score * 0.55).toFixed(1)}
                      </p>
                    )}

                    {/* d. Recommendation */}
                    {result.analysis_json?.recommendation && (
                      <div>
                        <p className="text-xs font-semibold text-blue-500 uppercase tracking-wide mb-1.5">Recommendation</p>
                        <div className="bg-blue-50 border-l-4 border-blue-500 p-3 rounded-r-md">
                          <ColoredRecommendation text={result.analysis_json.recommendation} />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      </Fragment>
    )
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {!profileBannerDismissed && hasApiKey === true && !hasPreferences && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span className="flex-1">
            No dealbreakers set — any job could slip through.{' '}
            <a href="/profile" className="font-semibold underline">Tell us what to reject →</a>
          </span>
          <button onClick={dismissProfileBanner} className="shrink-0 text-amber-500 hover:text-amber-700 transition-colors" title="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reject the bad ones</h1>
          {lifetimeSaved && (
            <p className="text-xs text-gray-400 mt-0.5">Lifetime: {lifetimeSaved} saved across your screening history</p>
          )}
        </div>
      </div>

      {/* Input card */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 pt-6 pb-0">
          <div className="flex border-b border-gray-200">
            {(['urls', 'text'] as InputTab[]).map((t) => (
              <button key={t} onClick={() => { setTab(t); setResults([]); setBatchTime(null); setScreenError(null); setIsSampleData(false) }}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                {t === 'urls' ? 'Job URLs' : 'Paste JD text'}
              </button>
            ))}
          </div>
        </div>

        <div className="px-6 py-5 space-y-3">
          {tab === 'urls' ? (
            <>
              <textarea value={urlInput} onChange={(e) => { setUrlInput(e.target.value); setScreenError(null) }} rows={5}
                placeholder="Paste job URLs here, one per line. We'll tell you which ones aren't worth your time."
                className="w-full resize-none rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              {urlInput.trim() && <p className="text-xs text-gray-400">{urlCount} URL{urlCount !== 1 ? 's' : ''} detected</p>}

              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <button type="button" onClick={() => setShowLinkedInHelper((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                  <span className="font-medium">Bulk import from LinkedIn Recommended →</span>
                  {showLinkedInHelper ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {showLinkedInHelper && (
                  <div className="border-t border-gray-100 px-4 py-4 space-y-4 bg-gray-50 text-sm text-gray-700">
                    <p className="text-xs text-gray-500">Run this in your browser console on the LinkedIn recommended jobs page.</p>
                    <ol className="space-y-3 text-sm">
                      <li className="flex gap-2"><span className="font-bold text-gray-400 shrink-0">1.</span><span>Go to <a href="https://www.linkedin.com/jobs/collections/recommended/" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">LinkedIn Recommended Jobs</a> while logged in.</span></li>
                      <li className="flex gap-2"><span className="font-bold text-gray-400 shrink-0">2.</span><span>Open DevTools — <kbd className="px-1.5 py-0.5 rounded bg-gray-200 text-gray-700 font-mono text-xs">F12</kbd> or <kbd className="px-1.5 py-0.5 rounded bg-gray-200 text-gray-700 font-mono text-xs">Cmd ⌥ J</kbd> — Console tab.</span></li>
                      <li className="flex gap-2"><span className="font-bold text-gray-400 shrink-0">3.</span><span>Copy the script below, paste into the console, press Enter. Wait ~10 seconds.</span></li>
                    </ol>
                    <div className="relative">
                      <pre className="bg-gray-900 text-green-300 rounded-lg px-4 py-3 text-xs overflow-x-auto leading-relaxed whitespace-pre-wrap break-all">{LINKEDIN_CONSOLE_SCRIPT}</pre>
                      <button type="button" onClick={async () => { await navigator.clipboard.writeText(LINKEDIN_CONSOLE_SCRIPT); setScriptCopied(true); setTimeout(() => setScriptCopied(false), 2000) }}
                        className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs text-gray-200 transition-colors">
                        {scriptCopied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-3">
              {jdEntries.map((entry, idx) => (
                <div key={entry.id} className="rounded-lg border border-gray-200 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-400">JD {jdEntries.length > 1 ? `#${idx + 1}` : ''}</span>
                    {jdEntries.length > 1 && <button onClick={() => removeJdEntry(entry.id)} className="text-gray-400 hover:text-red-500 transition-colors" title="Remove"><X size={14} /></button>}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input type="text" placeholder="Job title (optional)" value={entry.job_title} onChange={(e) => updateJdEntry(entry.id, 'job_title', e.target.value)}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <input type="text" placeholder="Company (optional)" value={entry.company} onChange={(e) => updateJdEntry(entry.id, 'company', e.target.value)}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <textarea value={entry.jd_text} onChange={(e) => { updateJdEntry(entry.id, 'jd_text', e.target.value); setScreenError(null) }} rows={6}
                    placeholder="Paste the full job description here..."
                    className="w-full resize-none rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                </div>
              ))}
              {jdEntries.length < 10 && (
                <button onClick={addJdEntry} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors">
                  <Plus size={14} /> Add another JD
                </button>
              )}
              <p className="text-xs text-gray-400">Use this tab when the URL scraper can&apos;t reach the page</p>
            </div>
          )}

          {screenError && (
            <div className={`rounded-lg px-4 py-3 text-sm flex items-start gap-3 ${screenError.type === 'invalid_key' ? 'bg-red-50 border border-red-200 text-red-800' : 'bg-amber-50 border border-amber-200 text-amber-800'}`}>
              {screenError.type === 'network' ? <WifiOff size={15} className="shrink-0 mt-0.5" /> : <AlertTriangle size={15} className="shrink-0 mt-0.5" />}
              <div className="flex-1 space-y-2">
                {screenError.type === 'no_api_key' && (<><p>⚠️ No API key saved. Add your Anthropic or OpenAI key in Profile settings.</p><a href="/profile" className="inline-block font-semibold underline text-xs">→ Go to Profile</a></>)}
                {screenError.type === 'invalid_key' && (<><p>✕ API key rejected by {screenError.provider === 'openai' ? 'OpenAI' : 'Anthropic'}.</p><a href="/profile" className="inline-block font-semibold underline text-xs">→ Update your API key</a></>)}
                {screenError.type === 'rate_limit' && (
                  <div className="flex items-center justify-between gap-4">
                    <p>Your {providerLabel} key hit a rate limit.{rateLimitCountdown > 0 ? ` Retry in ${rateLimitCountdown}s.` : ' Ready to retry.'}</p>
                    <button onClick={() => { setScreenError(null); handleScreen() }} disabled={rateLimitCountdown > 0}
                      className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40 transition-colors">
                      {rateLimitCountdown > 0 ? `Retry in ${rateLimitCountdown}s` : 'Retry'}
                    </button>
                  </div>
                )}
                {screenError.type === 'network' && (
                  <div className="flex items-center justify-between gap-4">
                    <p>{screenError.message ?? 'Connection error.'}</p>
                    <button onClick={() => { setScreenError(null); handleScreen() }} className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-700 text-white hover:bg-gray-800 transition-colors">Retry</button>
                  </div>
                )}
              </div>
              {screenError.type !== 'rate_limit' && screenError.type !== 'network' && (
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
                Working on it…
              </span>
            ) : 'Reject the bad ones →'}
          </button>
        </div>
      </div>

      {/* Active dealbreakers strip */}
      {activeRules.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500 px-1">
          <span className="font-medium text-gray-600">Active dealbreakers:</span>
          {activeRules.map((rule) => (
            <span key={rule} className="px-2 py-0.5 bg-red-50 text-red-600 border border-red-200 rounded-full font-medium">{rule}</span>
          ))}
          <a href="/profile" className="text-blue-500 hover:underline ml-1">Edit →</a>
        </div>
      )}

      {/* Empty state */}
      {!hasAnyResults ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileSearch size={48} className="text-gray-300 mb-4" />
          <p className="text-gray-700 font-semibold text-lg">Nothing rejected yet.</p>
          <p className="text-gray-400 text-sm mt-1">Paste your job list below — we&apos;ll tell you which ones to skip.</p>
          <div className="mt-6 flex flex-col items-center gap-2">
            <button onClick={loadSampleData}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors hover:opacity-90"
              style={{ backgroundColor: '#1B3A5C' }}>
              See a sample batch →
            </button>
            <p className="text-xs text-gray-400">No API key needed — see how auto-reject works</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Sample data banner */}
          {isSampleData && (
            <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg bg-blue-50 border border-blue-200 text-sm">
              <p className="text-blue-800">👆 Sample batch — showing how auto-reject and verdicts work.</p>
              <a href="/profile?onboarding=true" className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors hover:opacity-90" style={{ backgroundColor: '#1B3A5C' }}>
                Set up your dealbreakers →
              </a>
            </div>
          )}

          {/* TIME-SAVED HERO CARD */}
          {batchDone && !isSampleData && verdictCounts.REJECT > 0 && (
            <div style={{ backgroundColor: '#1B3A5C' }} className="rounded-xl px-6 py-6 text-white">
              <p className="text-5xl font-bold tracking-tight leading-none">{calculateTimeSaved(verdictCounts.REJECT)}</p>
              <p className="text-blue-200 mt-3 text-base">
                saved — by skipping {verdictCounts.REJECT} job{verdictCounts.REJECT !== 1 ? 's' : ''} that weren&apos;t worth your time
              </p>
            </div>
          )}
          {batchDone && !isSampleData && verdictCounts.REJECT === 0 && goodResults.length > 0 && (
            <div style={{ backgroundColor: '#1B3A5C' }} className="rounded-xl px-6 py-4 text-white flex items-center gap-3">
              <span className="text-green-400 text-xl font-bold">✓</span>
              <p>All {goodResults.length} jobs cleared your dealbreakers — no time-wasters in this batch.</p>
            </div>
          )}

          {/* Results table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="font-semibold text-gray-900">
                  Results
                  {errorResults.length > 0 && <span className="ml-2 text-xs font-normal text-amber-600">({errorResults.length} failed to scrape)</span>}
                </h2>
                {goodResults.length > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    <span className="font-medium text-gray-700">{goodResults.length} JD{goodResults.length !== 1 ? 's' : ''} screened</span>
                    {verdictCounts.REJECT > 0 && (
                      <span className="ml-1">— <span className="text-red-600 font-medium">{verdictCounts.REJECT} rejected</span>, {worthALook} worth a look</span>
                    )}
                    {verdictCounts.REJECT === 0 && worthALook > 0 && (
                      <span className="ml-1">— <span className="text-green-600 font-medium">{worthALook} worth a look</span></span>
                    )}
                    {skeletonCount > 0 && <span className="text-gray-400 italic ml-1">{skeletonCount} in progress…</span>}
                  </p>
                )}
                {batchTime && skeletonCount === 0 && goodResults.length > 0 && (
                  <p className="text-xs text-gray-400 mt-0.5">Screened {timeAgo(batchTime)}</p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-gray-400 mr-1">Sort:</span>
                {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                  <button key={k} onClick={() => setSortKey(k)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${sortKey === k ? 'bg-gray-900 text-white' : 'hover:bg-gray-100 text-gray-500'}`}>
                    {SORT_LABELS[k]}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 sm:px-6 py-3 font-medium text-gray-500 whitespace-nowrap">Company</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500 whitespace-nowrap">Job title</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500 whitespace-nowrap">Verdict</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-400 whitespace-nowrap text-xs hidden md:table-cell">Scores</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {mainResults.map(renderResultRow)}
                  {Array.from({ length: skeletonCount }).map((_, i) => (
                    <SkeletonRow key={`skel-${i}`} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Collapsible reject section */}
            {rejectResults.length > 0 && (
              <div className="border-t border-gray-100">
                <button
                  onClick={() => setRejectedCollapsed((v) => !v)}
                  className="w-full flex items-center justify-between px-4 sm:px-6 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
                    Rejected ({rejectResults.length}) — click to see why
                  </span>
                  {rejectedCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                </button>
                {!rejectedCollapsed && (
                  <div className="overflow-x-auto border-t border-gray-100">
                    <table className="w-full text-sm">
                      <tbody>
                        {rejectResults.map(renderResultRow)}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Confidence disclaimer */}
            {goodResults.length > 0 && (
              <div className="px-4 sm:px-6 py-3 border-t border-gray-100 bg-gray-50">
                <p className="text-xs text-gray-400 leading-relaxed">
                  Scores reflect resume-to-JD fit, not a guarantee of callbacks. Use them to prioritize, not to predict.
                </p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 px-4 sm:px-6 py-4 border-t border-gray-100">
              <button onClick={exportCSV} className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                <Download size={15} /> Export CSV
              </button>
              {!isSampleData && (
                <button onClick={handleShare} disabled={shareLoading} className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50">
                  <Share2 size={15} /> {shareLoading ? 'Sharing...' : 'Share results'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tier limit modal */}
      {showTierModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowTierModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-xl font-bold text-gray-900">Free batches used up</h2>
            <p className="text-gray-500 text-sm">You&apos;ve used your 5 free batches. Upgrade once for unlimited rejections — no monthly subscription.</p>
            <div className="flex flex-col gap-2 pt-1">
              <button onClick={() => { setShowTierModal(false); setShowPaymentModal(true) }}
                className="w-full py-3 rounded-xl font-semibold text-sm text-white hover:opacity-90 transition-opacity" style={{ backgroundColor: '#1B3A5C' }}>
                Unlock unlimited rejections — ₹499 one-time
              </button>
              <button onClick={() => setShowTierModal(false)} className="w-full text-center text-xs text-gray-400 hover:text-gray-600 transition-colors py-2">Maybe later</button>
            </div>
          </div>
        </div>
      )}

      <PaymentModal isOpen={showPaymentModal} onClose={() => setShowPaymentModal(false)}
        onSuccess={() => { setShowPaymentModal(false); toast.success('Upgraded! Unlimited rejections unlocked.') }} />
    </div>
  )
}
