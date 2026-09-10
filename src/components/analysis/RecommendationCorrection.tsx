'use client'

import { useState } from 'react'
import { Flag } from 'lucide-react'
import toast from 'react-hot-toast'
import type { AnalysisResult } from '@/types'

const VERDICTS: AnalysisResult['verdict'][] = ['STRONG', 'DECENT', 'WEAK', 'REJECT']

export function RecommendationCorrection({ resultId, currentVerdict }: { resultId: string; currentVerdict: AnalysisResult['verdict'] }) {
  const [open, setOpen] = useState(false)
  const [verdict, setVerdict] = useState<AnalysisResult['verdict'] | ''>('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  if (!resultId) return null

  async function submit() {
    if (!verdict || reason.trim().length < 3) return toast.error('Choose the right result and explain why.')
    setSaving(true)
    try {
      const response = await fetch('/api/screen/correction', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ screening_result_id: resultId, corrected_verdict: verdict, reason }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not save correction')
      setSaved(true); setOpen(false); toast.success('Saved. Similar future jobs will use this correction.')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save correction') }
    finally { setSaving(false) }
  }

  if (saved) return <p className="text-xs text-emerald-600 dark:text-emerald-400">Correction saved for future screening.</p>
  return <div className="pt-2">
    <button onClick={() => setOpen(!open)} className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400">
      <Flag size={12} /> Recommendation looks wrong
    </button>
    {open && <div className="mt-2 space-y-2 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
      <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">What should it have been?</label>
      <select value={verdict} onChange={(e) => setVerdict(e.target.value as AnalysisResult['verdict'])} className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm">
        <option value="">Select recommendation</option>
        {VERDICTS.filter((v) => v !== currentVerdict).map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={2} placeholder="What did the model miss?" className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm" />
      <button disabled={saving} onClick={submit} className="rounded bg-gray-900 dark:bg-gray-100 px-3 py-1.5 text-xs font-semibold text-white dark:text-gray-900 disabled:opacity-50">{saving ? 'Saving…' : 'Save correction'}</button>
    </div>}
  </div>
}
