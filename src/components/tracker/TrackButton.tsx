'use client'

import { useState } from 'react'
import { Briefcase, BriefcaseBusiness } from 'lucide-react'
import toast from 'react-hot-toast'
import type { TrackedJob } from '@/types'

interface TrackButtonProps {
  screeningResultId: string
  jobTitle: string | null
  company: string | null
  jobUrl: string | null
  tracked: boolean
  onTracked: (item: TrackedJob) => void
}

export default function TrackButton({ screeningResultId, jobTitle, company, jobUrl, tracked, onTracked }: TrackButtonProps) {
  const [loading, setLoading] = useState(false)

  if (tracked) {
    return (
      <span className="p-1.5 rounded text-green-600" title="Tracked">
        <BriefcaseBusiness size={15} />
      </span>
    )
  }

  async function handleClick() {
    setLoading(true)
    try {
      const res = await fetch('/api/tracker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screening_result_id: screeningResultId,
          job_title: jobTitle,
          company,
          job_url: jobUrl,
        }),
      })
      if (!res.ok) throw new Error('failed')
      const { item } = await res.json() as { item: TrackedJob }
      onTracked(item)
      toast.success('Tracking this job')
    } catch {
      toast.error('Could not track job')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="p-1.5 rounded hover:bg-gray-200 text-gray-500 transition-colors disabled:opacity-50"
      title="Track this job"
    >
      <Briefcase size={15} />
    </button>
  )
}
