'use client'

import { useState, useEffect, Fragment } from 'react'
import { Download, Share2, ChevronDown, ChevronUp, History } from 'lucide-react'
import toast from 'react-hot-toast'
import type { ScreeningResult } from '@/types'

interface Batch {
  batch_id: string
  created_at: string
  count: number
  results: ScreeningResult[]
}

const VERDICT_ORDER: Record<string, number> = {
  STRONG: 0,
  DECENT: 1,
  WEAK: 2,
  REJECT: 3,
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

function scoreClass(n: number) {
  if (n >= 70) return 'text-green-700 font-semibold'
  if (n >= 50) return 'text-amber-600 font-semibold'
  return 'text-red-600 font-semibold'
}

function topVerdict(results: ScreeningResult[]): string {
  return [...results].sort((a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict])[0]
    ?.verdict ?? '—'
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function HistoryPage() {
  const [batches, setBatches] = useState<Batch[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null)
  const [sharingBatch, setSharingBatch] = useState<string | null>(null)

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

  async function handleShare(batch_id: string) {
    setSharingBatch(batch_id)
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id }),
      })
      if (!res.ok) throw new Error('Share failed')
      const { url } = (await res.json()) as { url: string }
      await navigator.clipboard.writeText(url)
      toast.success('Share link copied!')
    } catch {
      toast.error('Could not create share link')
    } finally {
      setSharingBatch(null)
    }
  }

  function handleExport(batch_id: string) {
    window.location.href = `/api/export?batch_id=${batch_id}`
  }

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
          Your past batches will appear here after your first screen.
        </p>
        <a
          href="/dashboard"
          className="mt-4 text-sm text-blue-600 underline"
        >
          Screen your first JD →
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-6xl">
      <h1 className="text-2xl font-bold text-gray-900">Screening history</h1>

      {batches.map((batch) => {
        const isExpanded = expandedBatch === batch.batch_id
        const best = topVerdict(batch.results)

        return (
          <div
            key={batch.batch_id}
            className="bg-white rounded-xl border border-gray-200 overflow-hidden"
          >
            {/* Batch header row */}
            <div className="flex items-center gap-4 px-6 py-4">
              <button
                onClick={() =>
                  setExpandedBatch(isExpanded ? null : batch.batch_id)
                }
                className="flex-1 flex items-center gap-4 text-left"
              >
                <div className="flex-1">
                  <p className="font-medium text-gray-900 text-sm">
                    {formatDate(batch.created_at)}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {batch.count} role{batch.count !== 1 ? 's' : ''}
                  </p>
                </div>
                <span
                  className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${verdictClass(best)}`}
                >
                  Best: {best}
                </span>
                {isExpanded ? (
                  <ChevronUp size={16} className="text-gray-400 shrink-0" />
                ) : (
                  <ChevronDown size={16} className="text-gray-400 shrink-0" />
                )}
              </button>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleExport(batch.batch_id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <Download size={13} />
                  CSV
                </button>
                <button
                  onClick={() => handleShare(batch.batch_id)}
                  disabled={sharingBatch === batch.batch_id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  <Share2 size={13} />
                  {sharingBatch === batch.batch_id ? 'Sharing...' : 'Share'}
                </button>
              </div>
            </div>

            {/* Expanded results table */}
            {isExpanded && (
              <div className="border-t border-gray-100">
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
                      </tr>
                    </thead>
                    <tbody>
                      {batch.results.map((r) => (
                        <Fragment key={r.id}>
                          <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                            <td className="px-6 py-3 font-medium text-gray-900 whitespace-nowrap">
                              {r.company ?? '—'}
                            </td>
                            <td className="px-4 py-3 text-gray-700 max-w-xs">
                              <span className="line-clamp-1">{r.job_title ?? '—'}</span>
                            </td>
                            <td className={`px-4 py-3 text-center whitespace-nowrap ${scoreClass(r.ats_score)}`}>
                              {r.ats_score}%
                            </td>
                            <td className={`px-4 py-3 text-center whitespace-nowrap ${scoreClass(r.role_level_score)}`}>
                              {r.role_level_score}%
                            </td>
                            <td className={`px-4 py-3 text-center whitespace-nowrap ${scoreClass(r.composite_score)}`}>
                              {r.composite_score}%
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span
                                className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${verdictClass(r.verdict)}`}
                              >
                                {r.verdict}
                              </span>
                            </td>
                          </tr>
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
