'use client'

import { useState, useEffect } from 'react'
import { Briefcase, ExternalLink, X } from 'lucide-react'
import toast from 'react-hot-toast'
import type { TrackedJob, TrackedJobStatus } from '@/types'

const STATUSES: TrackedJobStatus[] = ['Applied', 'Interviewing', 'Offer', 'Rejected', 'Withdrawn']

const STATUS_CONFIG: Record<TrackedJobStatus, string> = {
  Applied: 'bg-blue-100 text-blue-800 border-blue-200',
  Interviewing: 'bg-amber-100 text-amber-800 border-amber-200',
  Offer: 'bg-green-100 text-green-800 border-green-200',
  Rejected: 'bg-red-100 text-red-800 border-red-200',
  Withdrawn: 'bg-gray-100 text-gray-600 border-gray-200',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function TrackerPage() {
  const [items, setItems] = useState<TrackedJob[]>([])
  const [loading, setLoading] = useState(true)
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({})

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/tracker')
        if (!res.ok) throw new Error('failed')
        const data = (await res.json()) as { items: TrackedJob[] }
        setItems(data.items)
        setNotesDraft(Object.fromEntries(data.items.map((i) => [i.id, i.notes ?? ''])))
      } catch {
        toast.error('Could not load tracked jobs')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function updateItem(id: string, updates: { status?: TrackedJobStatus; notes?: string }) {
    const prev = items
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, ...updates } : i)))
    try {
      const res = await fetch(`/api/tracker/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) throw new Error('failed')
      if (updates.status) toast.success('Status updated')
    } catch {
      setItems(prev)
      toast.error('Could not update')
    }
  }

  async function untrack(id: string) {
    const prev = items
    setItems((cur) => cur.filter((i) => i.id !== id))
    try {
      const res = await fetch(`/api/tracker/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
      toast.success('Untracked')
    } catch {
      setItems(prev)
      toast.error('Could not untrack')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-400 text-sm">Loading tracker...</div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Briefcase size={48} className="text-gray-300 mb-4" />
        <p className="text-gray-500 font-medium">No tracked jobs yet</p>
        <p className="text-gray-400 text-sm mt-1">
          Track a job from your screening results to follow its status here.
        </p>
        <a href="/dashboard" className="mt-4 text-sm text-blue-600 underline">
          Screen a JD →
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Job tracker</h1>
        <p className="text-sm text-gray-500 mt-1">{items.length} tracked job{items.length !== 1 ? 's' : ''}</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
        {items.map((item) => (
          <div key={item.id} className="px-5 py-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="font-semibold text-gray-900 text-sm truncate">{item.company ?? '—'}</p>
                  {item.job_url && (
                    <a href={item.job_url} target="_blank" rel="noopener noreferrer" title="Open job posting" className="shrink-0 text-blue-400 hover:text-blue-600 transition-colors">
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5 truncate">{item.job_title ?? '—'}</p>
                <p className="text-xs text-gray-400 mt-1">Tracked {formatDate(item.created_at)}</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={item.status}
                  onChange={(e) => updateItem(item.id, { status: e.target.value as TrackedJobStatus })}
                  className={`rounded-full text-xs font-semibold border px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 ${STATUS_CONFIG[item.status]}`}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <button
                  onClick={() => untrack(item.id)}
                  title="Untrack"
                  className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-red-600 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            <textarea
              value={notesDraft[item.id] ?? ''}
              onChange={(e) => setNotesDraft((cur) => ({ ...cur, [item.id]: e.target.value }))}
              onBlur={() => {
                if ((notesDraft[item.id] ?? '') !== (item.notes ?? '')) {
                  updateItem(item.id, { notes: notesDraft[item.id] ?? '' })
                }
              }}
              placeholder="Notes (interview dates, contacts, next steps...)"
              rows={2}
              className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        ))}
      </div>
    </div>
  )
}
