'use client'

import { useState, useEffect, useMemo } from 'react'
import { Download, History, Search, ArrowUpDown, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'
import type { ScreeningResult } from '@/types'

type HistoryRow = Omit<ScreeningResult, 'jd_text' | 'analysis_json'>

interface Batch {
  batch_id: string
  created_at: string
  count: number
  results: HistoryRow[]
}

const VERDICTS = ['ALL', 'STRONG', 'DECENT', 'WEAK', 'REJECT'] as const
type VerdictFilter = (typeof VERDICTS)[number]

function verdictClass(v: string) {
  const map: Record<string, string> = {
    STRONG: 'bg-green-100 text-green-800',
    DECENT: 'bg-amber-100 text-amber-800',
    WEAK: 'bg-gray-100 text-gray-700',
    REJECT: 'bg-red-100 text-red-800',
  }
  return map[v] ?? 'bg-gray-100 text-gray-700'
}

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
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

type FlatResult = HistoryRow & { batch_created_at: string }

export default function HistoryPage() {
  const [batches, setBatches] = useState<Batch[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>('ALL')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')
  const [showDuplicates, setShowDuplicates] = useState(false)

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
  }, [])

  function handleExport(batch_id: string) {
    window.location.href = `/api/export?batch_id=${batch_id}`
  }

  const flatResults = useMemo<FlatResult[]>(() => {
    return batches.flatMap((b) =>
      b.results.map((r) => ({ ...r, batch_created_at: b.created_at }))
    )
  }, [batches])

  // Deduplicate: for each (company, job_title) exact pair keep only the latest entry.
  // Only dedup when both fields are known; null-field entries always pass through.
  const deduplicatedResults = useMemo<FlatResult[]>(() => {
    if (showDuplicates) return flatResults
    const sorted = [...flatResults].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    const seen = new Set<string>()
    const out: FlatResult[] = []
    for (const r of sorted) {
      if (r.company && r.job_title) {
        const key = `${r.company.toLowerCase().trim()}|||${r.job_title.toLowerCase().trim()}`
        if (seen.has(key)) continue
        seen.add(key)
      }
      out.push(r)
    }
    return out
  }, [flatResults, showDuplicates])

  const dupCount = flatResults.length - deduplicatedResults.length

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return deduplicatedResults
      .filter((r) => {
        if (verdictFilter !== 'ALL' && r.verdict !== verdictFilter) return false
        if (q) {
          const inCompany = r.company?.toLowerCase().includes(q) ?? false
          const inTitle = r.job_title?.toLowerCase().includes(q) ?? false
          if (!inCompany && !inTitle) return false
        }
        return true
      })
      .sort((a, b) => {
        const diff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        return sortDir === 'desc' ? diff : -diff
      })
  }, [flatResults, search, verdictFilter, sortDir])

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
        <div className="flex items-center gap-3">
          {dupCount > 0 && (
            <button
              type="button"
              onClick={() => setShowDuplicates((v) => !v)}
              className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 transition-colors"
            >
              {showDuplicates ? `Hide ${dupCount} duplicate${dupCount !== 1 ? 's' : ''}` : `${dupCount} duplicate${dupCount !== 1 ? 's' : ''} hidden`}
            </button>
          )}
          <span className="text-sm text-gray-400">
            {filtered.length} of {deduplicatedResults.length} roles
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
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

        {/* Verdict chips */}
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

        {/* Sort toggle */}
        <button
          onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <ArrowUpDown size={12} />
          {sortDir === 'desc' ? 'Newest first' : 'Oldest first'}
        </button>
      </div>

      {/* Results list */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center text-gray-400 text-sm">
          No results match your filters.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
          {filtered.map((r) => (
            <div key={r.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors">
              {/* Company + role */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="font-semibold text-gray-900 text-sm truncate">
                    {r.company ?? '—'}
                  </p>
                  {r.job_url && (
                    <a
                      href={r.job_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open job posting"
                      className="shrink-0 text-blue-400 hover:text-blue-600 transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5 truncate">
                  {r.job_title ?? '—'}
                </p>
              </div>

              {/* Score */}
              <span className={`hidden sm:block text-sm shrink-0 ${scoreClass(r.composite_score)}`}>
                {r.composite_score}%
              </span>

              {/* Verdict */}
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-semibold shrink-0 ${verdictClass(r.verdict)}`}
              >
                {r.verdict}
              </span>

              {/* Date + time */}
              <div className="hidden md:flex flex-col items-end shrink-0 text-xs text-gray-400 leading-tight">
                <span>{formatDate(r.created_at)}</span>
                <span>{formatTime(r.created_at)}</span>
              </div>

              {/* Export */}
              <button
                onClick={() => handleExport(r.batch_id)}
                title="Export batch as CSV"
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors shrink-0"
              >
                <Download size={11} />
                CSV
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
