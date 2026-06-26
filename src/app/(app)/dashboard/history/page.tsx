'use client'

import { useState, useEffect } from 'react'
import { Download, Share2, History } from 'lucide-react'
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

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
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
          Your past sessions will appear here after your first screen.
        </p>
        <a href="/dashboard" className="mt-4 text-sm text-blue-600 underline">
          Screen your first JD →
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Screening history</h1>

      {batches.map((batch) => {
        const sortedResults = [...batch.results].sort(
          (a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict]
        )

        return (
          <div
            key={batch.batch_id}
            className="bg-white rounded-xl border border-gray-200 overflow-hidden"
          >
            {/* Batch header */}
            <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-gray-100 bg-gray-50">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">
                  {formatDateTime(batch.created_at)}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {batch.count} role{batch.count !== 1 ? 's' : ''} screened
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                {/* All verdict pills */}
                <div className="flex gap-1 flex-wrap justify-end">
                  {sortedResults.map((r) => (
                    <span
                      key={r.id}
                      className={`px-2 py-0.5 rounded-full text-xs font-semibold ${verdictClass(r.verdict)}`}
                    >
                      {r.verdict}
                    </span>
                  ))}
                </div>

                <button
                  onClick={() => handleExport(batch.batch_id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-white transition-colors"
                >
                  <Download size={12} />
                  CSV
                </button>
                <button
                  onClick={() => handleShare(batch.batch_id)}
                  disabled={sharingBatch === batch.batch_id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-white transition-colors disabled:opacity-50"
                >
                  <Share2 size={12} />
                  {sharingBatch === batch.batch_id ? 'Sharing...' : 'Share'}
                </button>
              </div>
            </div>

            {/* All results — always visible */}
            <div className="divide-y divide-gray-100">
              {sortedResults.map((r) => (
                <div key={r.id} className="flex items-center gap-4 px-6 py-4">
                  {/* Company + role */}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">
                      {r.company ?? '—'}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">
                      {r.job_title ?? '—'}
                    </p>
                  </div>

                  {/* Scores */}
                  <div className="hidden sm:flex items-center gap-3 text-xs shrink-0">
                    <span className={scoreClass(r.composite_score)}>
                      {r.composite_score}%
                    </span>
                  </div>

                  {/* Verdict */}
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-semibold shrink-0 ${verdictClass(r.verdict)}`}
                  >
                    {r.verdict}
                  </span>

                  {/* Date + time */}
                  <p className="hidden md:block text-xs text-gray-400 whitespace-nowrap shrink-0">
                    {formatDateTime(r.created_at)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
