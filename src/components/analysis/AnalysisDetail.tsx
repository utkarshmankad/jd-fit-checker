import { Info } from 'lucide-react'
import type { ScreeningResult, RequirementCheck } from '@/types'

export const VERDICT_CONFIG: Record<string, { cls: string; label: string }> = {
  STRONG: { cls: 'bg-green-100 text-green-800 border border-green-300', label: '✦ Strong match' },
  DECENT: { cls: 'bg-amber-100 text-amber-800 border border-amber-300', label: '◉ Decent match' },
  WEAK:   { cls: 'bg-gray-100 text-gray-600 border border-gray-300',   label: '○ Weak match' },
  REJECT: { cls: 'bg-red-100 text-red-800 border border-red-300',      label: '✕ Rejected' },
}

export const SCORE_TOOLTIPS = {
  ats: "How many of the JD's required skills appear in your resume, weighted by importance.",
  role: 'How well your seniority, scope, and team-size experience matches what this role needs.',
  composite: 'Weighted blend: 45% ATS keyword match, 55% role-level fit.',
}

export function scoreTextClass(n: number) {
  if (n >= 70) return 'text-green-600'
  if (n >= 50) return 'text-amber-500'
  return 'text-red-500'
}

export function whyVerdict(r: ScreeningResult): string {
  const { verdict, ats_score: ats, role_level_score: role } = r
  const missing = r.analysis_json?.missing_skills ?? []
  if (verdict === 'STRONG') return `STRONG because both ATS match (${ats}) and role-level fit (${role}) clear the threshold.`
  if (verdict === 'DECENT') {
    if (ats < role) return `DECENT because role-fit is solid (${role}) but ${missing.length > 0 ? `you're missing ${missing.length} required skill${missing.length !== 1 ? 's' : ''}, pulling ATS down to ${ats}` : `ATS match is moderate at ${ats}`}.`
    return `DECENT because keyword match is reasonable (${ats}) but role-level fit (${role}) shows some mismatch.`
  }
  if (verdict === 'WEAK') {
    if (ats < 50 && role < 50) return `WEAK because both ATS match (${ats}) and role-level fit (${role}) are below threshold.`
    if (ats < role) return `WEAK because ATS match (${ats}) is significantly below threshold despite reasonable role-fit (${role}).`
    return `WEAK because role-level fit (${role}) indicates significant mismatch.`
  }
  if (verdict === 'REJECT') {
    const reasons = r.hard_reject_reasons ?? []
    return `REJECT triggered before scoring — ${reasons.length > 0 ? `failed hard-reject rule: ${reasons[0]}` : 'failed your hard-reject filters'}.`
  }
  return ''
}

export function getReasonLine(r: ScreeningResult): string {
  if (r.verdict === 'REJECT') return r.hard_reject_reasons?.[0] ?? 'Hard-reject rule triggered'
  if (r.analysis_json?.headline) {
    const h = r.analysis_json.headline
    return h.length > 90 ? h.slice(0, 90) + '…' : h
  }
  if (r.analysis_json?.recommendation) {
    const rec = r.analysis_json.recommendation.replace(/^(APPLY IF|APPLY|SKIP)\s*/i, '')
    return rec.length > 90 ? rec.slice(0, 90) + '…' : rec
  }
  return ''
}

export function ScoreTooltip({ tip, children }: { tip: string; children: React.ReactNode }) {
  return (
    <span className="relative group inline-flex items-center gap-1 cursor-default">
      {children}
      <Info size={10} className="text-gray-300 opacity-60 shrink-0" />
      <span className="absolute bottom-full right-0 mb-2 w-52 bg-gray-900 text-white text-xs rounded-lg px-2.5 py-2 leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none whitespace-normal text-left shadow-lg">
        {tip}
        <span className="absolute top-full right-2 border-4 border-transparent border-t-gray-900" />
      </span>
    </span>
  )
}

export function ScorePill({ label, score, tip }: { label: string; score: number; tip: string }) {
  return (
    <ScoreTooltip tip={tip}>
      <span className="text-xs text-gray-400">{label}</span>
      <span className={`text-xs font-semibold ${scoreTextClass(score)}`}>{score}</span>
    </ScoreTooltip>
  )
}

export function RequirementsChecklist({ items }: { items: RequirementCheck[] }) {
  if (!items?.length) return null
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 mb-2">Requirements check</p>
      <ul className="space-y-2">
        {items.map((item, i) => {
          const icon = item.status === 'met' ? '✓' : item.status === 'partial' ? '◐' : '✗'
          const cls = item.status === 'met' ? 'text-green-600' : item.status === 'partial' ? 'text-amber-600' : 'text-red-600'
          return (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className={`shrink-0 font-bold mt-0.5 ${cls}`}>{icon}</span>
              <span>
                <span className="text-gray-800">{item.requirement}</span>
                {item.evidence && <span className="text-gray-400 text-xs ml-1">— {item.evidence}</span>}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function SoftConcernsCallout({ concerns }: { concerns?: string[] }) {
  if (!concerns?.length) return null
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-3">
      <p className="text-xs font-semibold text-amber-700 mb-1.5">Worth checking:</p>
      <ul className="space-y-1">
        {concerns.map((c, i) => (
          <li key={i} className="text-sm text-amber-800 flex items-start gap-1.5">
            <span className="text-amber-500 mt-0.5 shrink-0">•</span>{c}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ColoredRecommendation({ text }: { text: string }) {
  if (!text) return null
  const match = text.match(/^(APPLY IF|APPLY|SKIP)([\s\S]*)/)
  if (!match) return <p className="text-sm text-blue-900 leading-relaxed">{text}</p>
  const keyword = match[1]
  const rest = match[2]
  const color = keyword === 'SKIP' ? 'text-red-600' : keyword === 'APPLY IF' ? 'text-amber-600' : 'text-green-600'
  return (
    <p className="text-sm text-blue-900 leading-relaxed">
      <span className={`font-bold ${color}`}>{keyword}</span>{rest}
    </p>
  )
}

export function SkillPills({ label, skills, variant }: { label: string; skills: string[]; variant: 'match' | 'miss' }) {
  const pillCls = variant === 'match' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
  const prefix = variant === 'match' ? '✓ ' : '✗ '
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 mb-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {skills.length === 0 ? <span className="text-xs text-gray-400">None</span> : skills.map((s) => (
          <span key={s} className={`px-2 py-0.5 rounded-full text-xs font-medium ${pillCls}`}>{prefix}{s}</span>
        ))}
      </div>
    </div>
  )
}

export function AnalysisBlock({ label, text }: { label: string; text: string }) {
  if (!text) return null
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 mb-1">{label}</p>
      <p className="text-sm text-gray-700 leading-relaxed">{text}</p>
    </div>
  )
}

export function AnalysisDetailBody({ result }: { result: ScreeningResult }) {
  return (
    <div className="space-y-4 max-w-3xl">
      {/* a. Headline + why verdict */}
      {result.analysis_json?.headline && (
        <p className="text-sm font-medium text-gray-700">{result.analysis_json.headline}</p>
      )}
      <p className="text-xs text-gray-400 italic">{whyVerdict(result)}</p>

      {/* Hard reject */}
      {result.hard_reject_reasons?.length > 0 && result.verdict === 'REJECT' && (
        <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200">
          <p className="text-xs font-semibold text-red-600 mb-0.5">Hard reject</p>
          <p className="text-sm text-red-700">{result.hard_reject_reasons[0]}</p>
        </div>
      )}

      {/* b. Requirements + skills */}
      <RequirementsChecklist items={result.analysis_json?.requirements_met ?? []} />
      <SkillPills label="Matching skills" skills={result.analysis_json?.matching_skills ?? []} variant="match" />
      <SkillPills label="Missing skills" skills={result.analysis_json?.missing_skills ?? []} variant="miss" />
      <SoftConcernsCallout concerns={result.analysis_json?.soft_concerns} />
      <AnalysisBlock label="Role level assessment" text={result.analysis_json?.role_level_assessment ?? ''} />
      <AnalysisBlock label="Gap analysis" text={result.analysis_json?.gap_analysis ?? ''} />

      {/* c. Score breakdown (supplementary) */}
      {result.verdict !== 'REJECT' && (
        <p className="text-xs font-mono text-gray-400 bg-gray-100 rounded px-2 py-1 inline-block">
          Composite {result.composite_score} = (ATS {result.ats_score} × 0.45) + (Role {result.role_level_score} × 0.55) = {(result.ats_score * 0.45 + result.role_level_score * 0.55).toFixed(1)}
        </p>
      )}

      {/* d. Recommendation */}
      {result.analysis_json?.recommendation && (
        <div>
          <p className="text-xs font-semibold text-blue-500 uppercase tracking-wide mb-1.5">Recommendation</p>
          <div className="bg-blue-50 border-l-4 border-blue-500 p-3 rounded-r-md">
            <ColoredRecommendation text={result.analysis_json.recommendation} />
          </div>
        </div>
      )}
    </div>
  )
}
