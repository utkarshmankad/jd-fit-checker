'use client'

import { useState, useEffect, useMemo, Fragment } from 'react'
import { Download, History, Search, ChevronDown, ChevronUp, ExternalLink, Eye } from 'lucide-react'
import toast from 'react-hot-toast'
import type { ScreeningResult } from '@/types'
import { VERDICT_CONFIG, SCORE_TOOLTIPS, getReasonLine, ScorePill, AnalysisDetailBody } from '@/components/analysis/AnalysisDetail'
import TrackButton from '@/components/tracker/TrackButton'

type HistoryRow = Omit<ScreeningResult, 'jd_text'>

interface Batch {
  batch_id: string
  created_at: string
  count: number
  results: HistoryRow[]
}

const VERDICTS = ['ALL', 'STRONG', 'DECENT', 'WEAK', 'REJECT'] as const
type VerdictFilter = (typeof VERDICTS)[number]

function verdictFilterClass(v: VerdictFilter, active: boolean) {
  if (!active) return 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'
  if (v === 'ALL') return 'bg-gray-900 text-white border border-gray-900'
  const map: Record<string, string> = {
    STRONG: 'bg-green-600 text-white border border-green-600',
    DECENT: 'bg-amber-500 text-white border border-amber-500',
    WEAK: 'bg-gray-500 text-white border border-gray-500',
    REJECT: 'bg-red-600 text-white border border-red-600',
  }
  return map[v] ?? 'bg-gray-900 text-white border border-gray-900'
}

function scoreClass(n: number) {
  if (n >= 70) return 'text-green-700 font-semibold'
  if (n >= 50) return 'text-amber-600 font-semibold'
  return 'text-red-600 font-semibold'
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

export default function HistoryPage() {
  const [batches, setBatches] = useState<Batch[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>('ALL')
  const [collapsedBatches, setCollapsedBatches] = useState<Set<string>>(new Set())
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  const [trackedIds, setTrackedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/screen/history')
        if (!res.ok) throw new Error('Failed to load history')
        const data = (await res.json()) as { batches: Batch[] }
        setBatches(data.batches)
      } catch {
        toast.error('Could not load history')
      } finally {
        setLoading(false)
      }
    }
    load()

    fetch('/api/tracker')
      .then((r) => r.json())
      .then((data: { items?: { screening_result_id: string | null }[] }) => {
        setTrackedIds(new Set((data.items ?? []).filter((i) => i.screening_result_id).map((i) => i.screening_result_id as string)))
      })
      .catch(() => {})
  }, [])

  function handleExport(batch_id: string) {
    window.location.href = `/api/export?batch_id=${batch_id}`
  }

  function toggleBatch(batch_id: string) {
    setCollapsedBatches((prev) => {
      const next = new Set(prev)
      if (next.has(batch_id)) next.delete(batch_id)
      else next.add(batch_id)
      return next
    })
  }

  const totalCount = useMemo(() => batches.reduce((sum, b) => sum + b.results.length, 0), [batches])

  const filteredBatches = useMemo(() => {
    const q = search.toLowerCase().trim()
    return batches
      .map((b) => ({
        ...b,
        results: b.results.filter((r) => {
          if (verdictFilter !== 'ALL' && r.verdict !== verdictFilter) return false
          if (q) {
            const inCompany = r.company?.toLowerCase().includes(q) ?? false
            const inTitle = r.job_title?.toLowerCase().includes(q) ?? false
            if (!inCompany && !inTitle) return false
          }
          return true
        }),
      }))
      .filter((b) => b.results.length > 0)
  }, [batches, search, verdictFilter])

  const filteredCount = useMemo(() => filteredBatches.reduce((sum, b) => sum + b.results.length, 0), [filteredBatches])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-400 text-sm">Loading history...</div>
      </div>
    )
  }

  if (batches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <History size={48} className="text-gray-300 mb-4" />
        <p className="text-gray-500 font-medium">No screening history yet</p>
        <p className="text-gray-400 text-sm mt-1">
          Your past sessions will appear here after your first screen.
        </p>
        <a href="/dashboard" className="mt-4 text-sm text-blue-600 underline">
          Screen your first JD →
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-gray-900">Screening history</h1>
        <span className="text-sm text-gray-400">
          {filteredCount} of {totalCount} roles across {filteredBatches.length} batch{filteredBatches.length !== 1 ? 'es' : ''}
        </span>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company or role..."
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="flex gap-1.5">
          {VERDICTS.map((v) => (
            <button
              key={v}
              onClick={() => setVerdictFilter(v)}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${verdictFilterClass(v, verdictFilter === v)}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Batch sections */}
      {filteredBatches.length === 0 ? (
        <div className="py-16 text-center text-gray-400 text-sm">
          No results match your filters.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredBatches.map((batch) => {
            const isCollapsed = collapsedBatches.has(batch.batch_id)
            return (
              <div key={batch.batch_id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Batch header */}
                <div className="flex items-center justify-between px-5 py-3.5 bg-gray-50 border-b border-gray-100">
                  <button
                    onClick={() => toggleBatch(batch.batch_id)}
                    className="flex items-center gap-2 text-sm font-semibold text-gray-900 hover:text-gray-700 transition-colors"
                  >
                    {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                    <span>{formatDate(batch.created_at)}</span>
                    <span className="text-xs font-normal text-gray-400">{formatTime(batch.created_at)}</span>
                    <span className="text-xs font-normal text-gray-400">· {batch.results.length} job{batch.results.length !== 1 ? 's' : ''}</span>
                  </button>
                  <button
                    onClick={() => handleExport(batch.batch_id)}
                    title="Download batch as CSV"
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors shrink-0"
                  >
                    <Download size={11} />
                    Download CSV
                  </button>
                </div>

                {!isCollapsed && (
                  <div className="divide-y divide-gray-100">
                    {batch.results.map((r) => {
                      const rowKey = r.id
                      const isExpanded = expandedRowId === rowKey
                      const reasonLine = getReasonLine(r as ScreeningResult)
                      return (
                        <Fragment key={rowKey}>
                          <div className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="font-semibold text-gray-900 text-sm truncate">{r.company ?? '—'}</p>
                                {r.job_url && (
                                  <a
                                    href={r.job_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="Open job posting"
                                    className="shrink-0 text-blue-400 hover:text-blue-600 transition-colors"
                                  >
                                    <ExternalLink size={12} />
                                  </a>
                                )}
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5 truncate">{r.job_title ?? '—'}</p>
                              {reasonLine && (
                                <p className="text-xs text-gray-400 mt-1 truncate">{reasonLine}</p>
                              )}
                            </div>

                            <div className="hidden md:flex items-center gap-3 shrink-0">
                              <ScorePill label="ATS " score={r.ats_score} tip={SCORE_TOOLTIPS.ats} />
                              <ScorePill label="Role " score={r.role_level_score} tip={SCORE_TOOLTIPS.role} />
                            </div>

                            <span className={`hidden sm:block text-sm shrink-0 w-10 text-right ${scoreClass(r.composite_score)}`}>
                              {r.composite_score}
                            </span>

                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold shrink-0 ${VERDICT_CONFIG[r.verdict]?.cls ?? 'bg-gray-100 text-gray-600 border border-gray-300'}`}>
                              {r.verdict}
                            </span>

                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => setExpandedRowId(isExpanded ? null : rowKey)}
                                className={`p-1.5 rounded transition-colors ${isExpanded ? 'text-blue-600 bg-blue-50 hover:bg-blue-100' : 'text-gray-500 hover:bg-gray-200'}`}
                                title="View analysis"
                              >
                                <Eye size={15} />
                              </button>
                              <TrackButton
                                screeningResultId={r.id}
                                jobTitle={r.job_title}
                                company={r.company}
                                jobUrl={r.job_url}
                                tracked={trackedIds.has(r.id)}
                                onTracked={(item) => setTrackedIds((prev) => new Set(prev).add(item.screening_result_id as string))}
                              />
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="bg-slate-50 px-6 py-5">
                              <AnalysisDetailBody result={r as ScreeningResult} />
                            </div>
                          )}
                        </Fragment>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
