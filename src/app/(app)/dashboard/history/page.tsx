'use client'

import { useState, useEffect, useMemo, Fragment } from 'react'
import { Download, History, Search, ChevronDown, ChevronUp, ExternalLink, Eye } from 'lucide-react'
import toast from 'react-hot-toast'
import type { ScreeningResult, TrackedJob } from '@/types'
import { SCORE_TOOLTIPS, getReasonLine, ScorePill, AnalysisDetailBody, FakeEmBadge } from '@/components/analysis/AnalysisDetail'
import { getVerdictDisplay } from '@/lib/utils/verdicts'
import { RecommendationCorrection } from '@/components/analysis/RecommendationCorrection'
import ApplicationStatusButton from '@/components/tracker/ApplicationStatusButton'

type HistoryRow = Omit<ScreeningResult, 'jd_text'>

interface Batch {
  batch_id: string
  created_at: string
  count: number
  results: HistoryRow[]
}

const VERDICTS = ['ALL', 'STRONG', 'DECENT', 'WEAK', 'REJECT'] as const
type VerdictFilter = (typeof VERDICTS)[number]
type ApplicationFilter = 'ALL' | 'APPLIED' | 'NOT_APPLIED'

function verdictFilterLabel(v: VerdictFilter) {
  return v === 'ALL' ? 'ALL' : getVerdictDisplay(v).label
}

function verdictFilterClass(v: VerdictFilter, active: boolean) {
  if (!active) return 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50'
  if (v === 'ALL') return 'bg-gray-900 text-white border border-gray-900'
  const map: Record<string, string> = {
    STRONG: 'bg-green-600 dark:bg-green-700 text-white border border-green-600',
    DECENT: 'bg-blue-600 text-white border border-blue-600',
    WEAK: 'bg-gray-500 text-white border border-gray-500',
    REJECT: 'bg-red-600 dark:bg-red-700 text-white border border-red-600',
  }
  return map[v] ?? 'bg-gray-900 text-white border border-gray-900'
}

function scoreClass(n: number) {
  if (n >= 70) return 'text-green-700 dark:text-green-400 font-semibold'
  if (n >= 50) return 'text-amber-600 dark:text-amber-400 font-semibold'
  return 'text-red-600 dark:text-red-400 font-semibold'
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
  const [applicationFilter, setApplicationFilter] = useState<ApplicationFilter>('ALL')
  const [collapsedBatches, setCollapsedBatches] = useState<Set<string>>(new Set())
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  const [trackedByResult, setTrackedByResult] = useState<Map<string, TrackedJob>>(new Map())

  useEffect(() => {
    async function load() {
      try {
        const [historyResponse, trackerResponse] = await Promise.all([
          fetch('/api/screen/history'),
          fetch('/api/tracker'),
        ])
        if (!historyResponse.ok || !trackerResponse.ok) throw new Error('Failed to load history')
        const data = (await historyResponse.json()) as { batches: Batch[] }
        const trackerData = (await trackerResponse.json()) as { items: TrackedJob[] }
        setBatches(data.batches)
        setTrackedByResult(new Map(
          trackerData.items
            .filter((item) => item.screening_result_id)
            .map((item) => [item.screening_result_id as string, item])
        ))
      } catch {
        toast.error('Could not load history')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  function setApplicationStatus(resultId: string, item: TrackedJob | null) {
    setTrackedByResult((previous) => {
      const next = new Map(previous)
      if (item) next.set(resultId, item)
      else next.delete(resultId)
      return next
    })
  }

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
          const isApplied = trackedByResult.has(r.id)
          if (applicationFilter === 'APPLIED' && !isApplied) return false
          if (applicationFilter === 'NOT_APPLIED' && isApplied) return false
          if (q) {
            const inCompany = r.company?.toLowerCase().includes(q) ?? false
            const inTitle = r.job_title?.toLowerCase().includes(q) ?? false
            if (!inCompany && !inTitle) return false
          }
          return true
        }),
      }))
      .filter((b) => b.results.length > 0)
  }, [applicationFilter, batches, search, trackedByResult, verdictFilter])

  const filteredCount = useMemo(() => filteredBatches.reduce((sum, b) => sum + b.results.length, 0), [filteredBatches])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-400 dark:text-gray-500 text-sm">Loading history...</div>
      </div>
    )
  }

  if (batches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <History size={48} className="text-gray-300 dark:text-gray-600 mb-4" />
        <p className="text-gray-500 dark:text-gray-400 font-medium">No judgments yet.</p>
        <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">
          Your past batches will show up here once you&apos;ve judged something.
        </p>
        <a href="/dashboard" className="mt-4 text-sm text-blue-600 dark:text-blue-400 underline">
          Judge your first job →
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Screening history</h1>
        <span className="text-sm text-gray-400 dark:text-gray-500">
          {filteredCount} of {totalCount} roles across {filteredBatches.length} batch{filteredBatches.length !== 1 ? 'es' : ''}
        </span>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company or role..."
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="flex gap-1.5">
          {VERDICTS.map((v) => (
            <button
              key={v}
              onClick={() => setVerdictFilter(v)}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${verdictFilterClass(v, verdictFilter === v)}`}
            >
              {verdictFilterLabel(v)}
            </button>
          ))}
        </div>

        <div className="flex gap-1.5" aria-label="Filter by application status">
          {(['ALL', 'APPLIED', 'NOT_APPLIED'] as ApplicationFilter[]).map((status) => (
            <button
              key={status}
              onClick={() => setApplicationFilter(status)}
              className={`px-2.5 py-1 rounded-full border text-xs font-semibold transition-colors ${
                applicationFilter === status
                  ? 'border-green-600 bg-green-600 text-white'
                  : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800'
              }`}
            >
              {status === 'ALL' ? 'Any status' : status === 'APPLIED' ? 'Applied' : 'Not applied'}
            </button>
          ))}
        </div>
      </div>

      {/* Batch sections */}
      {filteredBatches.length === 0 ? (
        <div className="py-16 text-center text-gray-400 dark:text-gray-500 text-sm">
          No results match your filters.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredBatches.map((batch) => {
            const isCollapsed = collapsedBatches.has(batch.batch_id)
            return (
              <div key={batch.batch_id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                {/* Batch header */}
                <div className="flex items-center justify-between px-5 py-3.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
                  <button
                    onClick={() => toggleBatch(batch.batch_id)}
                    className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                  >
                    {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                    <span>{formatDate(batch.created_at)}</span>
                    <span className="text-xs font-normal text-gray-400 dark:text-gray-500">{formatTime(batch.created_at)}</span>
                    <span className="text-xs font-normal text-gray-400 dark:text-gray-500">· {batch.results.length} job{batch.results.length !== 1 ? 's' : ''}</span>
                  </button>
                  <button
                    onClick={() => handleExport(batch.batch_id)}
                    title="Download batch as CSV"
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
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
                          <div className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm truncate">{r.company ?? '—'}</p>
                                {r.job_url && (
                                  <a
                                    href={r.job_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="Open job posting"
                                    className="shrink-0 text-blue-400 dark:text-blue-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                  >
                                    <ExternalLink size={12} />
                                  </a>
                                )}
                              </div>
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate flex items-center gap-1.5">
                                <span className="truncate">{r.job_title ?? '—'}</span>
                                <FakeEmBadge detection={r.analysis_json?.fake_em_detection} />
                              </p>
                              {reasonLine && (
                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 truncate">{reasonLine}</p>
                              )}
                              {r.analysis_json?.salary_range && <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 mt-1">Salary: {r.analysis_json.salary_range.raw}</p>}
                            </div>

                            <div className="hidden md:flex items-center gap-3 shrink-0">
                              <ScorePill label="ATS " score={r.ats_score} tip={SCORE_TOOLTIPS.ats} />
                              <ScorePill label="Role " score={r.role_level_score} tip={SCORE_TOOLTIPS.role} />
                            </div>

                            <span className={`hidden sm:block text-sm shrink-0 w-10 text-right ${scoreClass(r.composite_score)}`}>
                              {r.composite_score}
                            </span>

                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold shrink-0 ${getVerdictDisplay(r.verdict).bg} ${getVerdictDisplay(r.verdict).color} border ${getVerdictDisplay(r.verdict).border}`}>
                              {getVerdictDisplay(r.verdict).label}
                            </span>

                            <div className="flex items-center gap-1 shrink-0">
                              <ApplicationStatusButton
                                screeningResultId={r.id}
                                trackedItem={trackedByResult.get(r.id) ?? null}
                                onChange={(item) => setApplicationStatus(r.id, item)}
                              />
                              <button
                                onClick={() => setExpandedRowId(isExpanded ? null : rowKey)}
                                className={`p-1.5 rounded transition-colors ${isExpanded ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                                title="View analysis"
                              >
                                <Eye size={15} />
                              </button>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="bg-slate-50 dark:bg-gray-800/50 px-6 py-5">
                              <AnalysisDetailBody result={r as ScreeningResult} />
                              <RecommendationCorrection resultId={r.id} currentVerdict={r.verdict} />
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
