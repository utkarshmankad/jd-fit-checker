'use client'

import { useState } from 'react'
import { Check, Circle } from 'lucide-react'
import toast from 'react-hot-toast'
import type { TrackedJob } from '@/types'

interface ApplicationStatusButtonProps {
  screeningResultId: string
  trackedItem: TrackedJob | null
  onChange: (item: TrackedJob | null) => void
}

export default function ApplicationStatusButton({ screeningResultId, trackedItem, onChange }: ApplicationStatusButtonProps) {
  const [loading, setLoading] = useState(false)
  const isApplied = trackedItem !== null

  async function toggle() {
    if (loading) return
    const previous = trackedItem
    setLoading(true)
    try {
      if (previous) {
        onChange(null)
        const response = await fetch(`/api/tracker/${previous.id}`, { method: 'DELETE' })
        if (!response.ok) throw new Error('Failed to mark as not applied')
        toast.success('Marked as not applied')
      } else {
        const response = await fetch('/api/tracker', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ screening_result_id: screeningResultId }),
        })
        if (!response.ok) throw new Error('Failed to mark as applied')
        const { item } = (await response.json()) as { item: TrackedJob }
        onChange(item)
        toast.success('Marked as applied')
      }
    } catch {
      onChange(previous)
      toast.error('Could not update application status')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={loading}
      aria-pressed={isApplied}
      title={isApplied ? 'Mark as not applied' : 'Mark as applied'}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
        isApplied
          ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300'
          : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800'
      }`}
    >
      {isApplied ? <Check size={12} /> : <Circle size={12} />}
      {loading ? 'Saving…' : isApplied ? 'Applied' : 'Not applied'}
    </button>
  )
}
