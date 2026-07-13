'use client'

import { useState, useEffect } from 'react'
import { Copy, Check } from 'lucide-react'

interface ReferralInfo {
  code: string
  referrals_count: number
  bonus_screens_earned: number
}

export default function ReferralCard() {
  const [info, setInfo] = useState<ReferralInfo | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch('/api/referral')
      .then((r) => r.json())
      .then((data: ReferralInfo) => setInfo(data))
      .catch(() => {})
  }, [])

  if (!info) return null

  function copyCode() {
    if (!info) return
    navigator.clipboard.writeText(info.code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div id="referral-card" className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Give a friend 10 bonus screens. Get 10 yourself.</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
          You&apos;ve referred {info.referrals_count} people · earned {info.bonus_screens_earned} bonus screens
        </p>
      </div>
      <button
        onClick={copyCode}
        className="shrink-0 flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        {copied ? <Check size={14} className="text-green-600 dark:text-green-400" /> : <Copy size={14} />}
        {copied ? 'Copied!' : `Copy code: ${info.code}`}
      </button>
    </div>
  )
}
