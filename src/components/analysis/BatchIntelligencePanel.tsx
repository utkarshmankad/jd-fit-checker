'use client'

import { useState, useEffect } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { BatchIntelligence } from '@/types'

const SEEN_KEY = 'jobsnob-batch-intel-seen'
const MIN_BATCH_SIZE = 3

interface BatchIntelligencePanelProps {
  intelligence: BatchIntelligence
  matchingSkills: string[]
}

function SkillBar({ skill, percentage, trend, inProfile }: { skill: string; percentage: number; trend: string; inProfile: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-medium text-gray-700 dark:text-gray-300 w-28 shrink-0 truncate" title={skill}>{skill}</span>
      <div className="flex-1 h-2.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-2.5 rounded-full ${inProfile ? 'bg-green-500 dark:bg-green-600' : 'bg-red-400 dark:bg-red-500'}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 w-9 text-right shrink-0">{percentage}%</span>
      {trend === 'high_demand' && (
        <span className="text-xs shrink-0" title="High demand">🔥</span>
      )}
    </div>
  )
}

export default function BatchIntelligencePanel({ intelligence, matchingSkills }: BatchIntelligencePanelProps) {
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem(SEEN_KEY) !== '1'
  })

  useEffect(() => {
    localStorage.setItem(SEEN_KEY, '1')
  }, [])

  if (intelligence.total_jds < MIN_BATCH_SIZE) return null

  const matchingLower = new Set(matchingSkills.map((s) => s.toLowerCase()))

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 sm:px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">📊 What this batch tells you about the market</h2>
        {expanded ? <ChevronUp size={16} className="text-gray-400 dark:text-gray-500" /> : <ChevronDown size={16} className="text-gray-400 dark:text-gray-500" />}
      </button>

      {expanded && (
        <div className="px-4 sm:px-6 pb-6 space-y-6">
          {/* A. Strategy callout */}
          {intelligence.recommendation && (
            <div className="pl-4 py-3 pr-4 rounded-r-lg" style={{ borderLeft: '4px solid #1B3A5C', backgroundColor: '#F0F4F8' }}>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200">💡 {intelligence.recommendation}</p>
            </div>
          )}

          {/* B. Top skills in demand */}
          {intelligence.top_required_skills?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-3">What this market is asking for</p>
              <div className="space-y-2.5">
                {intelligence.top_required_skills.slice(0, 8).map((s) => (
                  <SkillBar
                    key={s.skill}
                    skill={s.skill}
                    percentage={s.percentage}
                    trend={s.trend}
                    inProfile={matchingLower.has(s.skill.toLowerCase())}
                  />
                ))}
              </div>
            </div>
          )}

          {/* C. Gaps to address */}
          {intelligence.top_missing_from_profile?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Skills appearing in JDs but not in your profile</p>
              <div className="flex flex-wrap gap-1.5">
                {intelligence.top_missing_from_profile.map((skill) => (
                  <span key={skill} className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
                    {skill}
                  </span>
                ))}
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">Consider adding these to your profile or addressing them in applications.</p>
            </div>
          )}

          {/* D. Market observation */}
          {intelligence.market_observation && (
            <p className="text-sm text-gray-500 dark:text-gray-400 italic">{intelligence.market_observation}</p>
          )}

          {/* E. Role patterns */}
          {intelligence.title_patterns?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Common roles in this batch:</p>
              <div className="flex flex-wrap gap-1.5">
                {intelligence.title_patterns.map((pattern) => (
                  <span key={pattern} className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
                    {pattern}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
