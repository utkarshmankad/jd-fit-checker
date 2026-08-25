'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Eye, ExternalLink } from 'lucide-react'
import type { ScreeningResult } from '@/types'
import { getVerdictDisplay } from '@/lib/utils/verdicts'
import { calculateTimeSaved } from '@/lib/utils/time-saved'
import {
  FakeEmBadge, FakeEmCallout, RequirementsChecklist, SoftConcernsCallout,
  ProfileEvidenceCallout,
} from './AnalysisDetail'

// Converts the LLM's raw "APPLY — reasoning" / "SKIP — reasoning" /
// "APPLY IF condition — reasoning" into the card's blunter final-word
// template. Falls back to the raw text if the shape doesn't match (LLM
// output isn't 100% guaranteed to follow the prompted format).
function finalWord(recommendation?: string): string | null {
  if (!recommendation) return null
  const m = recommendation.match(/^(APPLY IF|APPLY|SKIP)\s*[-—–]?\s*([\s\S]*)$/i)
  if (!m) return recommendation
  const [, kind, rest] = m
  const clean = rest.trim().replace(/^[-—–]\s*/, '')
  const kindUpper = kind.toUpperCase()
  if (kindUpper === 'APPLY IF') {
    const condition = clean.charAt(0).toLowerCase() + clean.slice(1)
    return `Apply if ${condition}${condition.endsWith('.') ? '' : '.'} Otherwise, move on.`
  }
  if (kindUpper === 'APPLY') return clean ? `Apply. ${clean}` : 'Apply.'
  if (kindUpper === 'SKIP') return clean ? `Skip it. ${clean}` : 'Skip it.'
  return recommendation
}

function CardChrome({
  result,
  children,
  isExpanded,
  onToggle,
  timeSavedChip,
}: {
  result: ScreeningResult
  children: React.ReactNode
  isExpanded: boolean
  onToggle: () => void
  timeSavedChip?: string
}) {
  const display = getVerdictDisplay(result.verdict)
  return (
    <div
      className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden animate-card-in"
      style={{ borderLeft: `4px solid ${display.barColor}`, transition: 'border-color 200ms ease-in-out' }}
    >
      <div className="px-4 sm:px-6 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-gray-900 dark:text-gray-100 text-base">{result.company ?? '—'}</span>
              <span className="text-gray-500 dark:text-gray-400 text-sm truncate">{result.job_title ?? '—'}</span>
              <FakeEmBadge detection={result.analysis_json?.fake_em_detection} />
            </div>
            {children}
          </div>
          <div className="flex items-start gap-2 shrink-0">
            {timeSavedChip && (
              <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap mt-1">{timeSavedChip}</span>
            )}
            <button
              onClick={onToggle}
              className="p-1.5 rounded text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title={isExpanded ? 'Collapse' : 'Why we said that'}
            >
              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ScoreBreakdown({ result }: { result: ScreeningResult }) {
  const [shown, setShown] = useState(false)
  if (result.verdict === 'REJECT') return null
  return (
    // Hidden entirely on mobile, even behind the toggle — numbers are proof
    // for the curious on a bigger screen, not useful on a phone.
    <div className="mt-4 hidden sm:block">
      {!shown ? (
        <button onClick={() => setShown(true)} className="text-xs text-gray-400 dark:text-gray-500 underline hover:text-gray-600 dark:hover:text-gray-300">
          Show score breakdown →
        </button>
      ) : (
        <div className="text-xs font-mono text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 rounded px-2 py-1.5 inline-block">
          <p className="mb-0.5 text-gray-500 dark:text-gray-400 font-sans font-semibold not-italic">How we calculated this</p>
          Composite {result.composite_score} = (Evidence-enhanced ATS {result.ats_score} × 0.55) + (Role {result.role_level_score} × 0.45) = {(result.ats_score * 0.55 + result.role_level_score * 0.45).toFixed(1)}
        </div>
      )}
    </div>
  )
}

// Full card — used for the non-dismissed zone (STRONG / DECENT / WEAK).
export function VerdictCard({ result, isExpanded, onToggle }: { result: ScreeningResult; isExpanded: boolean; onToggle: () => void }) {
  const display = getVerdictDisplay(result.verdict)
  const headline = result.analysis_json?.headline
  const word = finalWord(result.analysis_json?.recommendation)
  const requirements = (result.analysis_json?.requirements_met ?? []).slice(0, 6)

  return (
    <CardChrome result={result} isExpanded={isExpanded} onToggle={onToggle}>
      <p className="font-bold text-lg sm:text-xl leading-tight mt-2" style={{ color: display.barColor }}>
        {display.verdictLine}
      </p>
      {headline && <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{headline}</p>}

      {isExpanded && (
        <div className="mt-4 space-y-4 max-w-2xl">
          <FakeEmCallout detection={result.analysis_json?.fake_em_detection} />
          <RequirementsChecklist items={requirements} />
          <ProfileEvidenceCallout
            items={result.analysis_json?.retrieved_evidence}
            score={result.analysis_json?.rag_score}
          />
          <SoftConcernsCallout concerns={result.analysis_json?.soft_concerns} />
          {word && (
            <p className="font-bold text-base" style={{ color: '#1B3A5C' }}>{word}</p>
          )}
          <ScoreBreakdown result={result} />
          {result.job_url && (
            <a href={result.job_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
              <ExternalLink size={12} /> Open posting
            </a>
          )}
        </div>
      )}
    </CardChrome>
  )
}

// Reject-zone card — terse reasons list + "Next.", no expand chevron. A
// person who's already decided doesn't linger — this card shouldn't either.
export function DismissedCard({ result }: { result: ScreeningResult }) {
  const display = getVerdictDisplay(result.verdict)
  const reasons = (result.hard_reject_reasons ?? []).slice(0, 4)
  const timeSaved = calculateTimeSaved(1)

  return (
    <div
      className="bg-white dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-800 px-4 py-3 animate-card-in"
      style={{ borderLeft: `4px solid ${display.barColor}`, transition: 'border-color 200ms ease-in-out' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="font-semibold text-gray-700 dark:text-gray-300">{result.company ?? '—'}</span>
            <span className="text-gray-400 dark:text-gray-500 truncate">{result.job_title ?? '—'}</span>
          </div>
          <div className="mt-1 space-y-0.5">
            {reasons.length > 0 ? reasons.map((r, i) => (
              <p key={i} className="text-xs text-gray-500 dark:text-gray-400">{r}</p>
            )) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">Hard-reject rule triggered.</p>
            )}
            <p className="text-xs text-gray-400 dark:text-gray-500 italic">Next.</p>
          </div>
        </div>
        <span className="text-xs text-gray-300 dark:text-gray-600 whitespace-nowrap shrink-0">~{timeSaved} saved</span>
      </div>
    </div>
  )
}

// Error/scrape-failure card — kept visually distinct (amber) from real
// verdicts since it's not a judgment, it's a "couldn't judge this" state.
export function ErrorCard({ result, onOpen, onEdit }: { result: ScreeningResult; onOpen?: () => void; onEdit?: () => void }) {
  const errorMsg = result.hard_reject_reasons?.[0] ?? 'Could not scrape this URL'
  return (
    <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800 px-4 sm:px-6 py-4 animate-card-in">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-amber-800 dark:text-amber-300 text-sm">Couldn&apos;t judge this one</p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">{errorMsg}</p>
          {result.job_url && (
            <p className="text-xs text-amber-600 dark:text-amber-500 truncate mt-0.5" title={result.job_url}>{result.job_url}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {result.job_url && (
            <button onClick={onEdit} className="p-1.5 rounded text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30" title="Paste manually">
              <Eye size={15} />
            </button>
          )}
          {onOpen && (
            <button onClick={onOpen} className="p-1.5 rounded text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30" title="Open URL">
              <ExternalLink size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// Placeholder shown while a batch item is still being judged. Company/title
// come from user-entered fields when available (the "Paste JD text" tab);
// URL-tab items don't have that yet client-side (company/title are only
// known once the scrape+judge round trip returns), so those placeholders
// fall back to a plain "Judging…" card with no identity shown.
export function LoadingCard({ label, message }: { label?: string; message: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 px-4 sm:px-6 py-4" style={{ borderLeft: '4px solid #E5E7EB' }}>
      {label && <p className="font-medium text-gray-700 dark:text-gray-300 text-sm truncate">{label}</p>}
      <div className="mt-2 h-5 w-40 rounded animate-shimmer" />
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 italic">{message}</p>
    </div>
  )
}
