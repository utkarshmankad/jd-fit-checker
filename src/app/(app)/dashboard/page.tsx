'use client'

import { useState, useEffect, useRef, Fragment } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  FileSearch, Eye, ExternalLink, Download, Share2, Plus, X,
  ChevronDown, ChevronUp, Copy, Check, AlertTriangle, WifiOff, Pencil,
} from 'lucide-react'
import toast from 'react-hot-toast'
import type { ScreeningResult } from '@/types'
import type { FatalScreenError } from '@/app/api/screen/route'
import PaymentModal from '@/components/payment/PaymentModal'

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
  composite_score: 'Composite score',
  ats_score: 'ATS score',
  role_level_score: 'Role fit',
  verdict: 'Verdict',
}

const VERDICT_ORDER: Record<'STRONG' | 'DECENT' | 'WEAK' | 'REJECT', number> = {
  STRONG: 0, DECENT: 1, WEAK: 2, REJECT: 3,
}

function scoreClass(n: number) {
  if (n >= 70) return 'text-green-700 font-semibold'
  if (n >= 50) return 'text-amber-600 font-semibold'
  return 'text-red-600 font-semibold'
}

function verdictClass(v: string) {
  const map: Record<string, string> = {
    STRONG: 'bg-green-100 text-green-800',
    DECENT: 'bg-amber-100 text-amber-800',
    WEAK: 'bg-gray-100 text-gray-700',
    REJECT: 'bg-red-100 text-red-800',
  }
  return map[v] ?? 'bg-gray-100 text-gray-700'
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

export default function DashboardPage() {
  const [tab, setTab] = useState<InputTab>('urls')
  const [urlInput, setUrlInput] = useState('')
  const [jdEntries, setJdEntries] = useState<JdEntry[]>([
    { id: crypto.randomUUID(), jd_text: '', job_title: '', company: '' },
  ])
  const [screening, setScreening] = useState(false)
  const [results, setResults] = useState<ScreeningResult[]>([])
  const [batchTime, setBatchTime] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('composite_score')
  const [shareLoading, setShareLoading] = useState(false)
  const [showAllColumns, setShowAllColumns] = useState(false)

  // profile state
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null)
  const [hasPreferences, setHasPreferences] = useState(false)
  const [apiProvider, setApiProvider] = useState<string>('anthropic')
  const [userTier, setUserTier] = useState<'free' | 'paid'>('free')

  // error states
  const [screenError, setScreenError] = useState<ScreenError | null>(null)
  const [showTierModal, setShowTierModal] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // profile accuracy banner
  const [profileBannerDismissed, setProfileBannerDismissed] = useState(true) // start hidden to avoid flash

  // LinkedIn helper
  const [showLinkedInHelper, setShowLinkedInHelper] = useState(false)
  const [scriptCopied, setScriptCopied] = useState(false)

  useEffect(() => {
    setProfileBannerDismissed(localStorage.getItem(PROFILE_BANNER_KEY) === '1')
  }, [])

  useEffect(() => {
    return () => { if (countdownRef.current) clearInterval(countdownRef.current) }
  }, [])

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

      setUserTier((profile.tier as 'free' | 'paid') ?? 'free')
      setApiProvider((profile.api_provider as string) ?? 'anthropic')
      setHasApiKey(!!(profile.api_key_encrypted as string | null))

      const prefs = (profile.preferences ?? {}) as { preferred_tech_stack?: string[]; target_industries?: string[] }
      const hrf = (profile.hard_reject_filters ?? {}) as { title_floor?: string; geography_allowed?: string[] }
      const hasPref = !!(
        prefs.preferred_tech_stack?.length ||
        prefs.target_industries?.length ||
        hrf.title_floor?.trim() ||
        hrf.geography_allowed?.length
      )
      setHasPreferences(hasPref)
    }
    loadProfile()
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
    setJdEntries([{
      id: crypto.randomUUID(),
      jd_text: '[Company name]\n[Paste JD text here]',
      job_title: '',
      company: url.slice(0, 40),
    }])
  }

  const inputEmpty =
    tab === 'urls' ? !urlInput.trim() : jdEntries.every((e) => !e.jd_text.trim())
  const urlCount = countValidUrls(urlInput)

  async function handleScreen() {
    setScreenError(null)

    // #1: no API key — pre-flight block
    if (hasApiKey === false) {
      setScreenError({ type: 'no_api_key' })
      return
    }

    setScreening(true)
    setResults([])
    setBatchTime(null)

    const batch_id = crypto.randomUUID()
    const payload =
      tab === 'urls'
        ? { urls: urlInput.split('\n').map((u) => u.trim()).filter(Boolean), batch_id }
        : {
            jd_entries: jdEntries
              .filter((e) => e.jd_text.trim())
              .map((e) => ({
                jd_text: e.jd_text,
                job_title: e.job_title || undefined,
                company: e.company || undefined,
              })),
            batch_id,
          }

    try {
      let res: Response
      try {
        res = await fetch('/api/screen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } catch {
        // #7: network error
        setScreenError({ type: 'network', message: 'Connection error — check your internet connection and try again.' })
        return
      }

      if (res.status === 403) {
        const json = (await res.json().catch(() => ({}))) as { upgrade_required?: boolean }
        if (json.upgrade_required) {
          // #6: free tier limit
          setShowTierModal(true)
          return
        }
      }

      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        setScreenError({ type: 'network', message: json.error ?? `Screening failed (${res.status})` })
        return
      }

      const data = (await res.json()) as {
        results: ScreeningResult[]
        fatalError?: FatalScreenError
      }

      setResults(data.results)
      setBatchTime(new Date().toISOString())

      if (data.fatalError) {
        // #4 / #5: key rejected or rate limited mid-batch
        if (data.fatalError.type === 'invalid_key') {
          setScreenError({ type: 'invalid_key', provider: data.fatalError.provider })
        } else if (data.fatalError.type === 'rate_limit') {
          setScreenError({ type: 'rate_limit' })
          startCountdown()
        }
      }
    } finally {
      setScreening(false)
    }
  }

  function exportCSV() {
    const header = 'Company,Job Title,ATS %,Role Fit %,Composite %,Verdict'
    const rows = results.map(
      (r) =>
        `"${r.company ?? ''}","${r.job_title ?? ''}",${r.ats_score},${r.role_level_score},${r.composite_score},${r.verdict}`
    )
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'jd-fit-results.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  async function handleShare() {
    setShareLoading(true)
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: results.find((r) => r.id)?.batch_id }),
      })
      if (!res.ok) throw new Error('Share failed')
      const { url } = (await res.json()) as { url: string }
      await navigator.clipboard.writeText(url)
      toast.success('Link copied!')
    } catch {
      toast.error('Could not create share link')
    } finally {
      setShareLoading(false)
    }
  }

  const goodResults = results.filter((r) => r.id !== '')
  const errorResults = results.filter((r) => r.id === '')

  const sortedResults = [
    ...[...goodResults].sort((a, b) => {
      if (sortKey === 'verdict') return VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict]
      return b[sortKey] - a[sortKey]
    }),
    ...errorResults,
  ]

  const providerLabel = apiProvider === 'openai' ? 'OpenAI' : 'Anthropic'

  return (
    <div className="space-y-6 max-w-6xl">
      {/* #2: Profile accuracy banner — no preferences set, dismissable, localStorage-backed */}
      {!profileBannerDismissed && hasApiKey === true && !hasPreferences && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span className="flex-1">
            Your profile is empty — screening accuracy will be low.{' '}
            <a href="/profile" className="font-semibold underline">Add your resume or set preferences for accurate results. → Set up profile</a>
          </span>
          <button
            onClick={dismissProfileBanner}
            className="shrink-0 text-amber-500 hover:text-amber-700 transition-colors"
            title="Dismiss"
          >
            <X size={15} />
          </button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Screen JDs</h1>
      </div>

      {/* Input section */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 pt-6 pb-0">
          <h2 className="font-semibold text-gray-900 mb-4">Paste job URLs to screen</h2>

          <div className="flex border-b border-gray-200">
            {(['urls', 'text'] as InputTab[]).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setResults([]); setBatchTime(null); setScreenError(null) }}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t === 'urls' ? 'URLs' : 'Paste JD text'}
              </button>
            ))}
          </div>
        </div>

        <div className="px-6 py-5 space-y-3">
          {tab === 'urls' ? (
            <>
              <textarea
                value={urlInput}
                onChange={(e) => { setUrlInput(e.target.value); setScreenError(null) }}
                rows={5}
                placeholder={'Paste one or more job URLs, one per line.\n\nWorks with LinkedIn, Naukri, Greenhouse, Lever, Workday, and most company career pages.'}
                className="w-full resize-none rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              {urlInput.trim() && (
                <p className="text-xs text-gray-400">{urlCount} URL{urlCount !== 1 ? 's' : ''} detected</p>
              )}

              {/* LinkedIn bulk importer */}
              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowLinkedInHelper((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  <span className="font-medium">Bulk import from LinkedIn Recommended →</span>
                  {showLinkedInHelper ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>

                {showLinkedInHelper && (
                  <div className="border-t border-gray-100 px-4 py-4 space-y-4 bg-gray-50 text-sm text-gray-700">
                    <p className="text-xs text-gray-500">
                      Run this script in your browser console while on the LinkedIn recommended jobs
                      page. It auto-scrolls, collects up to 20 jobs, and copies the URLs — then
                      paste them into the URL input above.
                    </p>
                    <ol className="space-y-3 text-sm">
                      <li className="flex gap-2">
                        <span className="font-bold text-gray-400 shrink-0">1.</span>
                        <span>
                          Go to{' '}
                          <a href="https://www.linkedin.com/jobs/collections/recommended/" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                            LinkedIn Recommended Jobs
                          </a>{' '}
                          while logged in.
                        </span>
                      </li>
                      <li className="flex gap-2">
                        <span className="font-bold text-gray-400 shrink-0">2.</span>
                        <span>
                          Open DevTools —{' '}
                          <kbd className="px-1.5 py-0.5 rounded bg-gray-200 text-gray-700 font-mono text-xs">F12</kbd> on Windows/Linux or{' '}
                          <kbd className="px-1.5 py-0.5 rounded bg-gray-200 text-gray-700 font-mono text-xs">Cmd ⌥ J</kbd> on Mac — Console tab.
                        </span>
                      </li>
                      <li className="flex gap-2">
                        <span className="font-bold text-gray-400 shrink-0">3.</span>
                        <span>Copy the script below, paste into the console, press Enter. Wait ~10 seconds.</span>
                      </li>
                    </ol>
                    <div className="relative">
                      <pre className="bg-gray-900 text-green-300 rounded-lg px-4 py-3 text-xs overflow-x-auto leading-relaxed whitespace-pre-wrap break-all">{LINKEDIN_CONSOLE_SCRIPT}</pre>
                      <button
                        type="button"
                        onClick={async () => {
                          await navigator.clipboard.writeText(LINKEDIN_CONSOLE_SCRIPT)
                          setScriptCopied(true)
                          setTimeout(() => setScriptCopied(false), 2000)
                        }}
                        className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs text-gray-200 transition-colors"
                      >
                        {scriptCopied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
                      </button>
                    </div>
                    <p className="text-xs text-gray-500">
                      The script copies up to 20 job URLs to your clipboard. Paste them into the URL input above, then click <strong>Screen JDs</strong>.
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-3">
              {jdEntries.map((entry, idx) => (
                <div key={entry.id} className="rounded-lg border border-gray-200 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-400">
                      JD {jdEntries.length > 1 ? `#${idx + 1}` : ''}
                    </span>
                    {jdEntries.length > 1 && (
                      <button onClick={() => removeJdEntry(entry.id)} className="text-gray-400 hover:text-red-500 transition-colors" title="Remove">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="Job title (optional)"
                      value={entry.job_title}
                      onChange={(e) => updateJdEntry(entry.id, 'job_title', e.target.value)}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <input
                      type="text"
                      placeholder="Company (optional)"
                      value={entry.company}
                      onChange={(e) => updateJdEntry(entry.id, 'company', e.target.value)}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <textarea
                    value={entry.jd_text}
                    onChange={(e) => { updateJdEntry(entry.id, 'jd_text', e.target.value); setScreenError(null) }}
                    rows={6}
                    placeholder="Paste the full job description here..."
                    className="w-full resize-none rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              ))}
              {jdEntries.length < 10 && (
                <button
                  onClick={addJdEntry}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
                >
                  <Plus size={14} />
                  Add another JD
                </button>
              )}
              <p className="text-xs text-gray-400">Use this tab when the URL scraper can&apos;t reach the page</p>
            </div>
          )}

          {/* ── Inline error banners (#1, #4, #5, #7) ── */}
          {screenError && (
            <div className={`rounded-lg px-4 py-3 text-sm flex items-start gap-3 ${
              screenError.type === 'invalid_key'
                ? 'bg-red-50 border border-red-200 text-red-800'
                : screenError.type === 'no_api_key'
                ? 'bg-amber-50 border border-amber-200 text-amber-800'
                : 'bg-amber-50 border border-amber-200 text-amber-800'
            }`}>
              {screenError.type === 'network' ? <WifiOff size={15} className="shrink-0 mt-0.5" /> : <AlertTriangle size={15} className="shrink-0 mt-0.5" />}
              <div className="flex-1 space-y-2">
                {screenError.type === 'no_api_key' && (
                  <>
                    <p>⚠️ No API key saved. Add your Anthropic or OpenAI key in Profile settings to enable screening.</p>
                    <a href="/profile" className="inline-block font-semibold underline text-xs">→ Go to Profile</a>
                  </>
                )}
                {screenError.type === 'invalid_key' && (
                  <>
                    <p>✕ Your API key was rejected by {screenError.provider === 'openai' ? 'OpenAI' : 'Anthropic'}. It may have expired or been revoked.</p>
                    <a href="/profile" className="inline-block font-semibold underline text-xs">→ Update your API key in Profile</a>
                  </>
                )}
                {screenError.type === 'rate_limit' && (
                  <div className="flex items-center justify-between gap-4">
                    <p>
                      Your {providerLabel} API key hit a rate limit. Screening paused.
                      {rateLimitCountdown > 0 ? ` Try again in ${rateLimitCountdown}s.` : ' Ready to retry.'}
                    </p>
                    <button
                      onClick={() => { setScreenError(null); handleScreen() }}
                      disabled={rateLimitCountdown > 0}
                      className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {rateLimitCountdown > 0 ? `Retry in ${rateLimitCountdown}s` : 'Retry'}
                    </button>
                  </div>
                )}
                {screenError.type === 'network' && (
                  <div className="flex items-center justify-between gap-4">
                    <p>{screenError.message ?? 'Connection error — check your internet connection and try again.'}</p>
                    <button
                      onClick={() => { setScreenError(null); handleScreen() }}
                      className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-700 text-white hover:bg-gray-800 transition-colors"
                    >
                      Retry
                    </button>
                  </div>
                )}
              </div>
              {screenError.type !== 'rate_limit' && screenError.type !== 'network' && (
                <button onClick={() => setScreenError(null)} className="shrink-0 opacity-60 hover:opacity-100 transition-opacity">
                  <X size={14} />
                </button>
              )}
            </div>
          )}

          <button
            onClick={handleScreen}
            disabled={screening || inputEmpty || (screenError?.type === 'rate_limit' && rateLimitCountdown > 0)}
            className="w-full py-3 rounded-lg font-medium text-sm text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: '#1B3A5C' }}
          >
            {screening ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Screening...
              </span>
            ) : 'Screen JDs →'}
          </button>
        </div>
      </div>

      {/* Results / Empty state */}
      {results.length === 0 && !screening ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileSearch size={48} className="text-gray-300 mb-4" />
          <p className="text-gray-500 font-medium">Paste your first job URL above to get started</p>
          <p className="text-gray-400 text-sm mt-1">Your results will appear here</p>
        </div>
      ) : results.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-100">
            <div>
              <h2 className="font-semibold text-gray-900">
                Results
                {errorResults.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-amber-600">
                    ({errorResults.length} failed to scrape)
                  </span>
                )}
              </h2>
              {batchTime && <p className="text-xs text-gray-400 mt-0.5">Screened {timeAgo(batchTime)}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-sm text-gray-500">
              <span className="text-xs text-gray-400 mr-1">Sort by:</span>
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setSortKey(k)}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                    sortKey === k ? 'bg-gray-900 text-white' : 'hover:bg-gray-100 text-gray-500'
                  }`}
                >
                  {SORT_LABELS[k]}
                </button>
              ))}
              <button
                onClick={() => setShowAllColumns((v) => !v)}
                className="md:hidden ml-1 px-2 py-1 rounded text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors"
              >
                {showAllColumns ? 'Fewer columns' : 'All columns'}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 sm:px-6 py-3 font-medium text-gray-500 whitespace-nowrap">Company</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 whitespace-nowrap">Job title</th>
                  <th className={`text-center px-4 py-3 font-medium text-gray-500 whitespace-nowrap ${showAllColumns ? '' : 'hidden md:table-cell'}`}>ATS %</th>
                  <th className={`text-center px-4 py-3 font-medium text-gray-500 whitespace-nowrap ${showAllColumns ? '' : 'hidden md:table-cell'}`}>Role fit %</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500 whitespace-nowrap">Composite %</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500 whitespace-nowrap">Verdict</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {sortedResults.map((result) => {
                  // #3: error row — scrape failed
                  const isErrorRow = result.id === ''
                  const errorMsg = isErrorRow ? (result.hard_reject_reasons?.[0] ?? 'Could not scrape this URL') : null

                  return (
                    <Fragment key={result.id || result.job_url || result.created_at}>
                      <tr className={`border-b border-gray-100 transition-colors ${isErrorRow ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-gray-50'}`}>
                        <td className="px-4 sm:px-6 py-4 font-medium text-gray-900 whitespace-nowrap">
                          {isErrorRow ? <span className="text-amber-700">Unknown</span> : (result.company ?? '—')}
                        </td>
                        <td className="px-4 py-4 text-gray-700 max-w-48">
                          {isErrorRow ? (
                            <span className="text-amber-700 text-xs truncate block" title={result.job_url ?? ''}>
                              {(result.job_url ?? '').slice(0, 40)}{(result.job_url ?? '').length > 40 ? '…' : ''}
                            </span>
                          ) : (
                            <span className="line-clamp-2">{result.job_title ?? '—'}</span>
                          )}
                        </td>
                        <td className={`px-4 py-4 text-center whitespace-nowrap ${isErrorRow ? 'text-gray-300' : scoreClass(result.ats_score)} ${showAllColumns ? '' : 'hidden md:table-cell'}`}>
                          {isErrorRow ? '—' : `${result.ats_score}%`}
                        </td>
                        <td className={`px-4 py-4 text-center whitespace-nowrap ${isErrorRow ? 'text-gray-300' : scoreClass(result.role_level_score)} ${showAllColumns ? '' : 'hidden md:table-cell'}`}>
                          {isErrorRow ? '—' : `${result.role_level_score}%`}
                        </td>
                        <td className={`px-4 py-4 text-center whitespace-nowrap ${isErrorRow ? 'text-gray-300' : scoreClass(result.composite_score)}`}>
                          {isErrorRow ? '—' : `${result.composite_score}%`}
                        </td>
                        <td className="px-4 py-4 text-center">
                          {isErrorRow ? (
                            <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                              ⚠ Scrape failed
                            </span>
                          ) : (
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${verdictClass(result.verdict)}`}>
                              {result.verdict}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2 justify-end">
                            <button
                              onClick={() => setExpandedId(expandedId === (result.id || result.job_url) ? null : (result.id || result.job_url))}
                              className="p-1.5 rounded hover:bg-gray-200 text-gray-500 transition-colors"
                              title={isErrorRow ? 'View error' : 'View analysis'}
                            >
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

                      {expandedId === (result.id || result.job_url) && (
                        <tr className={isErrorRow ? 'bg-amber-50' : 'bg-slate-50'}>
                          <td colSpan={7} className="px-6 py-5">
                            {isErrorRow ? (
                              // #3 expanded: error details + paste manually
                              <div className="space-y-3 max-w-xl">
                                <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-100 rounded-lg px-3 py-2.5">
                                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                                  <span>{errorMsg}</span>
                                </div>
                                {result.job_url && (
                                  <button
                                    onClick={() => handlePasteManually(result.job_url!)}
                                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors"
                                  >
                                    <Pencil size={12} />
                                    Paste manually
                                  </button>
                                )}
                              </div>
                            ) : (
                              <div className="space-y-4 max-w-3xl">
                                {result.hard_reject_reasons?.length > 0 && !result.analysis_json?.matching_skills && (
                                  <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200">
                                    <p className="text-xs font-semibold text-red-600 mb-0.5">Hard reject</p>
                                    <p className="text-sm text-red-700">{result.hard_reject_reasons[0]}</p>
                                  </div>
                                )}
                                <SkillPills label="Matching skills" skills={result.analysis_json?.matching_skills ?? []} color="green" />
                                <SkillPills label="Missing skills" skills={result.analysis_json?.missing_skills ?? []} color="red" />
                                <AnalysisBlock label="Role level assessment" text={result.analysis_json?.role_level_assessment ?? ''} />
                                <AnalysisBlock label="Gap analysis" text={result.analysis_json?.gap_analysis ?? ''} />
                                <AnalysisBlock label="Recommendation" text={result.analysis_json?.recommendation ?? ''} />
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 px-4 sm:px-6 py-4 border-t border-gray-100">
            <button onClick={exportCSV} className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              <Download size={15} />
              Export CSV
            </button>
            <button onClick={handleShare} disabled={shareLoading} className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50">
              <Share2 size={15} />
              {shareLoading ? 'Sharing...' : 'Share results'}
            </button>
          </div>
        </div>
      ) : null}

      {/* #6: Tier limit modal */}
      {showTierModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowTierModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-xl font-bold text-gray-900">Monthly limit reached</h2>
            <p className="text-gray-500 text-sm">
              You&apos;ve used all 5 free screens this month. Upgrade to paid for unlimited screens.
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={() => { setShowTierModal(false); setShowPaymentModal(true) }}
                className="w-full py-3 rounded-xl font-semibold text-sm text-white hover:opacity-90 transition-opacity"
                style={{ backgroundColor: '#1B3A5C' }}
              >
                Upgrade — ₹499 one-time
              </button>
              <button
                onClick={() => setShowTierModal(false)}
                className="w-full text-center text-xs text-gray-400 hover:text-gray-600 transition-colors py-2"
              >
                Maybe later
              </button>
            </div>
          </div>
        </div>
      )}

      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        onSuccess={() => {
          setUserTier('paid')
          setShowPaymentModal(false)
          toast.success('Upgraded! Unlimited screens unlocked.')
        }}
      />
    </div>
  )
}

function SkillPills({ label, skills, color }: { label: string; skills: string[]; color: 'green' | 'red' }) {
  const pillClass = color === 'green' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">
        {skills.length === 0 ? (
          <span className="text-xs text-gray-400">None</span>
        ) : (
          skills.map((s) => (
            <span key={s} className={`px-2 py-0.5 rounded-full text-xs ${pillClass}`}>{s}</span>
          ))
        )}
      </div>
    </div>
  )
}

function AnalysisBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 mb-1">{label}</p>
      <p className="text-sm text-gray-700 leading-relaxed">{text}</p>
    </div>
  )
}
