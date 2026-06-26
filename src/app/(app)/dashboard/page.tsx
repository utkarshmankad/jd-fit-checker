'use client'

import { useState, useEffect, Fragment } from 'react'
import { createClient } from '@/lib/supabase/client'
import { FileSearch, Eye, ExternalLink, Download, Share2, Plus, X } from 'lucide-react'
import toast from 'react-hot-toast'
import type { ScreeningResult } from '@/types'

type SortKey = 'composite_score' | 'ats_score' | 'role_level_score' | 'verdict'
type InputTab = 'urls' | 'text'

interface JdEntry {
  id: string
  jd_text: string
  job_title: string
  company: string
}

const SORT_LABELS: Record<SortKey, string> = {
  composite_score: 'Composite score',
  ats_score: 'ATS score',
  role_level_score: 'Role fit',
  verdict: 'Verdict',
}

const VERDICT_ORDER: Record<'STRONG' | 'DECENT' | 'WEAK' | 'REJECT', number> = {
  STRONG: 0,
  DECENT: 1,
  WEAK: 2,
  REJECT: 3,
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
  return text
    .split('\n')
    .filter((l) => {
      const t = l.trim()
      return t.length > 0 && (t.startsWith('http') || /^[\w-]+\.\w+/.test(t))
    }).length
}

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
  const [hasResume, setHasResume] = useState<boolean | null>(null)
  const [userTier, setUserTier] = useState<'free' | 'paid'>('free')

  useEffect(() => {
    async function loadProfile() {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('tier, resume_text')
        .eq('id', user.id)
        .single()

      if (profile) {
        setUserTier((profile.tier as 'free' | 'paid') ?? 'free')
        setHasResume(!!(profile.resume_text as string | null))
      } else {
        setHasResume(false)
      }
    }

    loadProfile()
  }, [])

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

  const inputEmpty =
    tab === 'urls'
      ? !urlInput.trim()
      : jdEntries.every((e) => !e.jd_text.trim())
  const urlCount = countValidUrls(urlInput)

  async function handleScreen() {
    setScreening(true)
    try {
      const batch_id = crypto.randomUUID()
      const payload =
        tab === 'urls'
          ? { urls: urlInput.split('\n').filter((u) => u.trim()), batch_id }
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

      const res = await fetch('/api/screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const msg = await res.text()
        throw new Error(msg || 'Screening failed')
      }

      const data = (await res.json()) as { results: ScreeningResult[] }
      setResults(data.results)
      setBatchTime(new Date().toISOString())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Screening failed')
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
    a.href = url
    a.download = 'jd-fit-results.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleShare() {
    setShareLoading(true)
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: results[0]?.batch_id }),
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

  const sortedResults = [...results].sort((a, b) => {
    if (sortKey === 'verdict') {
      return VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict]
    }
    return b[sortKey] - a[sortKey]
  })

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Profile incomplete banner */}
      {hasResume === false && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <span>⚠️</span>
          <span>
            Your profile is incomplete — add your resume to get accurate scores.{' '}
            <a href="/profile" className="font-semibold underline">
              Set up profile →
            </a>
          </span>
        </div>
      )}

      {/* Top bar */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Screen JDs</h1>
      </div>

      {/* Input section */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 pt-6 pb-0">
          <h2 className="font-semibold text-gray-900 mb-4">Paste job URLs to screen</h2>

          {/* Tabs */}
          <div className="flex border-b border-gray-200">
            {(['urls', 'text'] as InputTab[]).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setResults([]); setBatchTime(null); }}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === t
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
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
                onChange={(e) => setUrlInput(e.target.value)}
                rows={5}
                placeholder={
                  'Paste one or more job URLs, one per line.\n\nWorks with LinkedIn, Naukri, Greenhouse, Lever, Workday, and most company career pages.'
                }
                className="w-full resize-none rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              {urlInput.trim() && (
                <p className="text-xs text-gray-400">
                  {urlCount} URL{urlCount !== 1 ? 's' : ''} detected
                </p>
              )}
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
                      <button
                        onClick={() => removeJdEntry(entry.id)}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                        title="Remove this JD"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
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
                    onChange={(e) => updateJdEntry(entry.id, 'jd_text', e.target.value)}
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
              <p className="text-xs text-gray-400">
                Use this tab when the URL scraper can&apos;t reach the page
              </p>
            </div>
          )}

          <button
            onClick={handleScreen}
            disabled={screening || inputEmpty}
            className="w-full py-3 rounded-lg font-medium text-sm text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: '#1B3A5C' }}
          >
            {screening ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8z"
                  />
                </svg>
                Screening...
              </span>
            ) : (
              'Screen JDs →'
            )}
          </button>
        </div>
      </div>

      {/* Results / Empty state */}
      {results.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileSearch size={48} className="text-gray-300 mb-4" />
          <p className="text-gray-500 font-medium">Paste your first job URL above to get started</p>
          <p className="text-gray-400 text-sm mt-1">Your results will appear here</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Results header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 border-b border-gray-100">
            <div>
              <h2 className="font-semibold text-gray-900">Results</h2>
              {batchTime && (
                <p className="text-xs text-gray-400 mt-0.5">Screened {timeAgo(batchTime)}</p>
              )}
            </div>

            {/* Sort controls */}
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
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-6 py-3 font-medium text-gray-500 whitespace-nowrap">
                    Company
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 whitespace-nowrap">
                    Job title
                  </th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500 whitespace-nowrap">
                    ATS %
                  </th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500 whitespace-nowrap">
                    Role fit %
                  </th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500 whitespace-nowrap">
                    Composite %
                  </th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500 whitespace-nowrap">
                    Verdict
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {sortedResults.map((result) => (
                  <Fragment key={result.id}>
                    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">
                        {result.company ?? '—'}
                      </td>
                      <td className="px-4 py-4 text-gray-700 max-w-48">
                        <span className="line-clamp-2">{result.job_title ?? '—'}</span>
                      </td>
                      <td className={`px-4 py-4 text-center whitespace-nowrap ${scoreClass(result.ats_score)}`}>
                        {result.ats_score}%
                      </td>
                      <td
                        className={`px-4 py-4 text-center whitespace-nowrap ${scoreClass(result.role_level_score)}`}
                      >
                        {result.role_level_score}%
                      </td>
                      <td
                        className={`px-4 py-4 text-center whitespace-nowrap ${scoreClass(result.composite_score)}`}
                      >
                        {result.composite_score}%
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${verdictClass(result.verdict)}`}
                        >
                          {result.verdict}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            onClick={() =>
                              setExpandedId(expandedId === result.id ? null : result.id)
                            }
                            className="p-1.5 rounded hover:bg-gray-200 text-gray-500 transition-colors"
                            title="View analysis"
                          >
                            <Eye size={15} />
                          </button>
                          {result.job_url && (
                            <a
                              href={result.job_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 rounded hover:bg-gray-200 text-gray-500 transition-colors"
                              title="Open original URL"
                            >
                              <ExternalLink size={15} />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>

                    {expandedId === result.id && (
                      <tr className="bg-slate-50">
                        <td colSpan={7} className="px-6 py-5">
                          <div className="space-y-4 max-w-3xl">
                            {result.hard_reject_reasons?.length > 0 && !result.analysis_json?.matching_skills && (
                              <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200">
                                <p className="text-xs font-semibold text-red-600 mb-0.5">Error</p>
                                <p className="text-sm text-red-700">{result.hard_reject_reasons[0]}</p>
                              </div>
                            )}
                            <SkillPills
                              label="Matching skills"
                              skills={result.analysis_json?.matching_skills ?? []}
                              color="green"
                            />
                            <SkillPills
                              label="Missing skills"
                              skills={result.analysis_json?.missing_skills ?? []}
                              color="red"
                            />
                            <AnalysisBlock
                              label="Role level assessment"
                              text={result.analysis_json?.role_level_assessment ?? ''}
                            />
                            <AnalysisBlock
                              label="Gap analysis"
                              text={result.analysis_json?.gap_analysis ?? ''}
                            />
                            <AnalysisBlock
                              label="Recommendation"
                              text={result.analysis_json?.recommendation ?? ''}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Bottom bar */}
          <div className="flex items-center gap-3 px-6 py-4 border-t border-gray-100">
            <button
              onClick={exportCSV}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Download size={15} />
              Export CSV
            </button>
            <button
              onClick={handleShare}
              disabled={shareLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <Share2 size={15} />
              {shareLoading ? 'Sharing...' : 'Share results'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SkillPills({
  label,
  skills,
  color,
}: {
  label: string
  skills: string[]
  color: 'green' | 'red'
}) {
  const pillClass =
    color === 'green' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">
        {skills.length === 0 ? (
          <span className="text-xs text-gray-400">None</span>
        ) : (
          skills.map((s) => (
            <span key={s} className={`px-2 py-0.5 rounded-full text-xs ${pillClass}`}>
              {s}
            </span>
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
