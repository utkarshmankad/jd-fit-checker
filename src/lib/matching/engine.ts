// Deterministic evidence-to-requirement matching.
//
// Pure function of a Candidate Intelligence Profile and a Role Intelligence
// Profile: no network, model or clock, so identical inputs yield identical
// matrices. Every conclusion records its basis (explicit evidence, inference or
// deterministic fallback) and quotes only evidence the profiles already traced.
import { SKILLS } from '@/lib/candidate-profile/extract'
import type { CandidateIntelligenceProfile, EvidenceRef, ProfessionalIdentity, Traced } from '@/lib/candidate-profile/schema'
import type { RoleIntelligenceProfile } from '@/lib/role-profile/schema'
import { REQUIREMENT_CONCEPTS, sharedFamilies } from './concepts'
import {
  MATCHING_ENGINE_VERSION,
  type CandidateEvidence, type ConclusionBasis, type MatchStatus, type MatchSummary, type Recency,
  type RequirementMatch, type RequirementMatchReference, type RequirementMatrix, type RoleRequirement,
} from './schema'

const STATUS_VALUE: Record<MatchStatus, number> = { strong: 1, partial: 0.6, transferable: 0.35, unknown: 0.3, unsupported: 0.1, explicit_gap: 0 }
const MANDATORY_WEIGHT = 1
const PREFERRED_WEIGHT = 0.35
const STRUCTURAL_WEIGHT: Partial<Record<RoleRequirement['kind'], number>> = { identity: 1.5, role_family: 1.5, seniority: 1.2, people_management: 1.5, manages_managers: 1.2, hands_on: 1, experience_years: 1 }
/** Tool/skill rows may carry at most this share of the total weight. */
const MAX_SKILL_WEIGHT_SHARE = 0.4
const OVERALL_AREA = /\b(?:professional|industry|software|engineering|relevant|work|backend|frontend|full[- ]stack|development|programming|technical|data)\b/
const PEOPLE_AREA = /\b(?:people management|management|managing|leading people)\b/

const emptyCounts = (): Record<MatchStatus, number> => ({ strong: 0, partial: 0, transferable: 0, unsupported: 0, explicit_gap: 0, unknown: 0 })
const round2 = (value: number) => Number(Math.max(0, Math.min(1, value)).toFixed(2))

// ── Requirements ────────────────────────────────────────────────────────────

function aliasSpan(lower: string, skill: string): { at: number; end: number } | null {
  let best: { at: number; end: number } | null = null
  for (const alias of SKILLS[skill] ?? [skill.toLowerCase()]) {
    const m = new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9#]|$)`).exec(lower)
    if (!m) continue
    const at = m.index + m[1].length
    if (!best || at < best.at) best = { at, end: at + alias.length }
  }
  return best
}

/** "Go or Java, Kafka and PostgreSQL" → [[Go, Java], [Kafka], [PostgreSQL]]. */
export function skillGroups(text: string, skills: string[]): string[][] {
  const lower = text.toLowerCase()
  const located = skills.map((skill) => ({ skill, span: aliasSpan(lower, skill) }))
    .filter((x): x is { skill: string; span: { at: number; end: number } } => !!x.span)
    .sort((a, b) => a.span.at - b.span.at || a.skill.localeCompare(b.skill))
  const groups: string[][] = []
  located.forEach((item, index) => {
    const previous = located[index - 1]
    const between = previous ? lower.slice(previous.span.end, item.span.at) : ''
    if (previous && /^\s*(?:or|\/)\s*$/.test(between)) groups[groups.length - 1].push(item.skill)
    else groups.push([item.skill])
  })
  return groups
}

export function buildRequirements(role: RoleIntelligenceProfile): RoleRequirement[] {
  const out: RoleRequirement[] = []
  const seen = new Map<string, RoleRequirement>()
  const add = (req: Omit<RoleRequirement, 'id'>) => {
    const key = `${req.kind}:${req.concepts.join('|')}:${req.required ?? ''}`
    const existing = seen.get(key)
    if (existing) {
      existing.mandatory ||= req.mandatory
      if (existing.role_evidence.length < 3) existing.role_evidence.push(...req.role_evidence.slice(0, 3 - existing.role_evidence.length))
      return
    }
    const full = { id: `r${out.length + 1}`, ...req }
    seen.set(key, full)
    out.push(full)
  }

  for (const [list, mandatory] of [[role.mandatory_requirements, true], [role.preferred_requirements, false]] as const) {
    for (const line of list) {
      const lower = line.value.toLowerCase()
      let mapped = false
      if (line.years) {
        const area = line.years.area
        if (area && PEOPLE_AREA.test(area)) {
          add({ kind: 'experience_years', normalized: `${line.years.minimum}+ years of people management`, concepts: ['People Management'], any_of: false, mandatory, origin: 'requirement_line', role_evidence: line.evidence, required: line.years.minimum })
          mapped = true
        } else if (!area || OVERALL_AREA.test(area)) {
          mapped = true // overall years: covered by the structural experience row below
        }
      }
      for (const group of skillGroups(line.value, line.skills)) {
        add({ kind: 'skill', normalized: group.length > 1 ? `Skill: ${group.join(' or ')}` : `Skill: ${group[0]}`, concepts: group, any_of: group.length > 1, mandatory, origin: 'requirement_line', role_evidence: line.evidence, required: null })
        mapped = true
      }
      for (const rule of REQUIREMENT_CONCEPTS) {
        if (!rule.pattern.test(lower)) continue
        if (rule.kind === 'hands_on') continue // handled structurally
        add({ kind: rule.kind, normalized: rule.concept, concepts: [rule.concept], any_of: false, mandatory, origin: 'requirement_line', role_evidence: line.evidence, required: null })
        mapped = true
      }
      if (line.category === 'education') { add({ kind: 'education', normalized: `Education: ${line.value.slice(0, 80)}`, concepts: [], any_of: false, mandatory, origin: 'requirement_line', role_evidence: line.evidence, required: null }); mapped = true }
      if (!mapped) add({ kind: 'other', normalized: line.value.slice(0, 100), concepts: [], any_of: false, mandatory, origin: 'requirement_line', role_evidence: line.evidence, required: null })
    }
  }

  // Tools named only in responsibilities ("Build Go services on AWS") are needed but not
  // stated as must-haves: preferred skill rows (skill weight is capped below).
  const listed = new Set(out.filter((r) => r.kind === 'skill').flatMap((r) => r.concepts))
  for (const line of role.responsibilities) {
    const skills = Object.keys(SKILLS).filter((skill) => !listed.has(skill) && aliasSpan(line.value.toLowerCase(), skill))
    for (const group of skillGroups(line.value, skills)) {
      add({ kind: 'skill', normalized: group.length > 1 ? `Skill: ${group.join(' or ')}` : `Skill: ${group[0]}`, concepts: group, any_of: group.length > 1, mandatory: false, origin: 'requirement_line', role_evidence: line.evidence, required: null })
      group.forEach((skill) => listed.add(skill))
    }
  }

  const structural = (req: Omit<RoleRequirement, 'id' | 'origin' | 'any_of'>) => add({ ...req, origin: 'role_structure', any_of: false })
  if (role.role_family) structural({ kind: 'role_family', normalized: `Role family: ${role.role_family.value.replace('_', ' ')}`, concepts: [role.role_family.value], mandatory: true, role_evidence: role.role_family.evidence, required: null })
  if (role.identity) structural({ kind: 'identity', normalized: `Role identity: ${role.identity.value.replace('_', ' ')}`, concepts: [role.identity.value], mandatory: true, role_evidence: role.identity.evidence, required: null })
  if (role.seniority.target) structural({ kind: 'seniority', normalized: `Seniority: level ${role.seniority.target.value}`, concepts: [], mandatory: true, role_evidence: role.seniority.target.evidence, required: role.seniority.target.value })
  if (role.experience.minimum_years) structural({ kind: 'experience_years', normalized: `${role.experience.minimum_years.value}+ years of experience`, concepts: [], mandatory: true, role_evidence: role.experience.minimum_years.evidence, required: role.experience.minimum_years.value })
  const managerRole = role.identity && ['people_manager', 'hybrid', 'executive'].includes(role.identity.value)
  const pm = role.expectations.people_management
  if ((managerRole || (pm && !pm.negated && pm.value !== 'low')) && !out.some((r) => r.kind === 'people_management')) {
    structural({ kind: 'people_management', normalized: 'People Management', concepts: ['People Management'], mandatory: true, role_evidence: pm?.evidence ?? role.identity?.evidence ?? [], required: role.team.direct_reports?.value ?? null })
  }
  if (role.team.manages_managers?.value) structural({ kind: 'manages_managers', normalized: 'Managing managers', concepts: ['Managing managers'], mandatory: true, role_evidence: role.team.manages_managers.evidence, required: null })
  const arch = role.expectations.architecture
  if (arch && arch.value !== 'low' && !out.some((r) => r.kind === 'architecture')) structural({ kind: 'architecture', normalized: 'System Design', concepts: ['System Design'], mandatory: arch.value === 'high', role_evidence: arch.evidence, required: null })
  if (role.balance && (role.balance.value === 'hands_on' || role.balance.value === 'balanced')) {
    structural({ kind: 'hands_on', normalized: role.balance.hands_on_percent != null ? `Hands-on engineering (~${role.balance.hands_on_percent}% of time)` : 'Hands-on engineering', concepts: [], mandatory: role.balance.value === 'hands_on', role_evidence: role.balance.evidence, required: role.balance.hands_on_percent })
  }
  for (const domain of role.domains.filter((d) => d.confidence >= 0.55).slice(0, 2)) {
    structural({ kind: 'domain', normalized: `Domain: ${domain.value}`, concepts: [domain.value], mandatory: false, role_evidence: domain.evidence, required: null })
  }
  return out
}

// ── Candidate evidence ──────────────────────────────────────────────────────

const quotes = (item: Traced<unknown> | null | undefined) => item?.evidence.slice(0, 2) ?? []
const ev = (source: string, value: string, item: Traced<unknown>): CandidateEvidence => ({ source, value, quotes: quotes(item) })

function recencyFor(candidate: CandidateIntelligenceProfile, refs: EvidenceRef[]): Recency | null {
  if (!refs.length) return null
  const roles = [...candidate.experience.roles].sort((a, b) => (a.evidence[0]?.start ?? 0) - (b.evidence[0]?.start ?? 0))
  const at = refs[0].start
  const role = roles.filter((r) => (r.evidence[0]?.start ?? Infinity) <= at).at(-1) ?? null
  return { role_title: role?.title ?? null, start_year: role?.start_year ?? null, end_year: role?.end_year ?? null, is_current: role ? role.is_current : null, total_years: candidate.experience.total_years?.value ?? null }
}

interface Verdict { status: MatchStatus; basis: ConclusionBasis; confidence: number; evidence: CandidateEvidence[]; explanation: string }
const unknown = (explanation: string): Verdict => ({ status: 'unknown', basis: 'fallback', confidence: 0.5, evidence: [], explanation })

function skillVerdict(candidate: CandidateIntelligenceProfile, concept: string): Verdict {
  const skill = candidate.explicit_skills.find((s) => s.value === concept)
  if (skill?.rule === 'used_in_experience') return { status: 'strong', basis: 'explicit', confidence: skill.confidence, evidence: [ev('explicit_skills', concept, skill)], explanation: `${concept} is used in the candidate's work experience.` }
  const capability = candidate.implicit_capabilities.find((c) => c.value === concept && c.rule === 'responsibility_pattern')
  if (capability) return { status: 'strong', basis: 'inferred', confidence: capability.confidence, evidence: [ev('implicit_capabilities', concept, capability)], explanation: `${concept} is implied by the candidate's responsibilities.` }
  // Adjacent, professionally used concepts are transferable — never a match.
  const adjacent = candidate.explicit_skills.filter((s) => s.rule === 'used_in_experience' && sharedFamilies(concept, s.value).length)
  if (adjacent.length) {
    const family = sharedFamilies(concept, adjacent[0].value)[0]
    return { status: 'transferable', basis: 'inferred', confidence: round2(adjacent[0].confidence * 0.6), evidence: adjacent.slice(0, 2).map((s) => ev('explicit_skills', s.value, s)), explanation: `No ${concept} evidence; related ${family} experience (${adjacent.slice(0, 2).map((s) => s.value).join(', ')}) may transfer.` }
  }
  if (skill) return { status: 'unsupported', basis: 'explicit', confidence: skill.confidence, evidence: [ev('explicit_skills', concept, skill)], explanation: skill.rule === 'skills_list_only' ? `${concept} is only listed as a skill, not shown in work.` : `${concept} appears only in a course, certificate or non-work context.` }
  return unknown(`The resume does not mention ${concept}.`)
}

function capabilityVerdict(candidate: CandidateIntelligenceProfile, concept: string): Verdict {
  const capability = candidate.implicit_capabilities.find((c) => c.value === concept)
  if (capability?.rule === 'responsibility_pattern') return { status: 'strong', basis: 'inferred', confidence: capability.confidence, evidence: [ev('implicit_capabilities', concept, capability)], explanation: `${concept} is shown by the candidate's responsibilities.` }
  if (concept === 'System Design') {
    const arch = candidate.scopes.architecture
    const ds = candidate.explicit_skills.find((s) => s.value === 'Distributed Systems' && s.rule === 'used_in_experience')
    if (arch && arch.rule !== 'non_professional_context_only' && arch.value !== 'low') return { status: 'strong', basis: 'inferred', confidence: arch.confidence, evidence: [ev('scopes.architecture', arch.value, arch)], explanation: `Architecture work is a ${arch.value} part of the candidate's experience.` }
    if (ds) return { status: 'strong', basis: 'explicit', confidence: ds.confidence, evidence: [ev('explicit_skills', 'Distributed Systems', ds)], explanation: 'Distributed systems work is shown in experience.' }
    if (arch && arch.rule !== 'non_professional_context_only') return { status: 'partial', basis: 'inferred', confidence: arch.confidence, evidence: [ev('scopes.architecture', arch.value, arch)], explanation: 'Some design work is shown, but not at system-design scope.' }
  }
  if (concept === 'Technical Leadership') {
    const lead = candidate.scopes.leadership
    const mentoring = candidate.implicit_capabilities.find((c) => c.value === 'Mentoring' && c.rule === 'responsibility_pattern')
    if (mentoring) return { status: 'partial', basis: 'inferred', confidence: mentoring.confidence, evidence: [ev('implicit_capabilities', 'Mentoring', mentoring)], explanation: 'Mentoring is shown; broader technical leadership is not.' }
    if (lead && lead.rule === 'non_professional_context_only') return { status: 'unsupported', basis: 'inferred', confidence: lead.confidence, evidence: [ev('scopes.leadership', lead.value, lead)], explanation: 'Leadership appears only in a student or non-work context.' }
  }
  if (capability) return { status: 'unsupported', basis: 'inferred', confidence: capability.confidence, evidence: [ev('implicit_capabilities', concept, capability)], explanation: `${concept} appears only in a non-work context.` }
  return unknown(`No evidence of ${concept.toLowerCase()} in the resume.`)
}

/** People management requires reports / reviews / hiring evidence — leadership words are not enough. */
function peopleVerdict(candidate: CandidateIntelligenceProfile, required: number | null): Verdict {
  const reports = candidate.team.has_direct_reports
  if (reports && reports.value === false) return { status: 'explicit_gap', basis: 'explicit', confidence: reports.confidence, evidence: [ev('team.has_direct_reports', 'no direct reports', reports)], explanation: 'The resume states the candidate has no direct reports.' }
  const pm = candidate.implicit_capabilities.find((c) => c.value === 'People Management' && c.rule === 'responsibility_pattern')
  if (reports?.value || pm) {
    const size = candidate.team.largest_team_size?.value ?? null
    const evidence = [...(reports ? [ev('team.has_direct_reports', 'direct reports', reports)] : []), ...(pm ? [ev('implicit_capabilities', 'People Management', pm)] : [])]
    const smaller = required !== null && size !== null && size < required * 0.5
    return { status: smaller ? 'partial' : 'strong', basis: reports ? 'explicit' : 'inferred', confidence: (reports ?? pm)!.confidence, evidence, explanation: smaller ? `Has managed people, but a smaller team (${size}) than this role (${required}).` : `Has managed people${size ? ` (team of ${size})` : ''}.` }
  }
  const adjacent = candidate.implicit_capabilities.filter((c) => (c.value === 'Mentoring' || c.value === 'Technical Leadership') && c.rule === 'responsibility_pattern')
  if (adjacent.length) return { status: 'transferable', basis: 'inferred', confidence: round2(adjacent[0].confidence * 0.6), evidence: adjacent.map((c) => ev('implicit_capabilities', c.value, c)), explanation: `${adjacent.map((c) => c.value).join(' and ')} shown, but no direct reports or performance management — leadership language is not people management.` }
  const student = candidate.scopes.leadership
  if (student && student.rule === 'non_professional_context_only') return { status: 'unsupported', basis: 'inferred', confidence: student.confidence, evidence: [ev('scopes.leadership', student.value, student)], explanation: 'Leadership appears only in a student or non-work context.' }
  return unknown('No evidence either way about managing people.')
}

const IDENTITY_FIT: Record<ProfessionalIdentity, Partial<Record<ProfessionalIdentity, MatchStatus>>> = {
  ic: { ic: 'strong', technical_lead: 'strong', hybrid: 'partial', people_manager: 'explicit_gap', executive: 'explicit_gap' },
  technical_lead: { technical_lead: 'strong', ic: 'partial', hybrid: 'strong', people_manager: 'partial', executive: 'explicit_gap' },
  people_manager: { people_manager: 'strong', hybrid: 'strong', executive: 'partial', technical_lead: 'transferable', ic: 'explicit_gap' },
  hybrid: { hybrid: 'strong', people_manager: 'partial', technical_lead: 'partial', ic: 'transferable', executive: 'partial' },
  executive: { executive: 'strong', people_manager: 'partial', hybrid: 'partial', technical_lead: 'explicit_gap', ic: 'explicit_gap' },
}

function evaluate(req: RoleRequirement, candidate: CandidateIntelligenceProfile, role: RoleIntelligenceProfile): Verdict {
  switch (req.kind) {
    case 'skill': {
      const verdicts = req.concepts.map((concept) => skillVerdict(candidate, concept))
      const order: MatchStatus[] = ['strong', 'partial', 'transferable', 'unsupported', 'unknown', 'explicit_gap']
      if (req.any_of) return verdicts.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))[0]
      return verdicts[0]
    }
    case 'people_management': return peopleVerdict(candidate, req.required)
    case 'technical_leadership': case 'architecture': case 'capability': return capabilityVerdict(candidate, req.concepts[0])
    case 'manages_managers': {
      const mm = candidate.team.manages_managers
      if (mm?.value) return { status: 'strong', basis: 'explicit', confidence: mm.confidence, evidence: [ev('team.manages_managers', 'managers of managers', mm)], explanation: 'Has managed managers.' }
      const people = peopleVerdict(candidate, null)
      if (people.status === 'strong' || people.status === 'partial') return { ...people, status: 'transferable', confidence: round2(people.confidence * 0.6), explanation: 'Has managed a team, but not managers of managers.' }
      return people.status === 'explicit_gap' ? people : unknown('No evidence of managing managers.')
    }
    case 'identity': {
      const c = candidate.identity
      if (!c || !role.identity) return unknown('The candidate\'s professional identity could not be determined.')
      const status = IDENTITY_FIT[role.identity.value][c.value] ?? 'unknown'
      return { status, basis: 'inferred', confidence: round2(Math.min(c.confidence, role.identity.confidence)), evidence: [ev('identity', c.value, c)], explanation: status === 'strong' ? `Candidate works as ${c.value.replace('_', ' ')}, matching the role.` : `Role is ${role.identity.value.replace('_', ' ')}; candidate works as ${c.value.replace('_', ' ')}.` }
    }
    case 'role_family': {
      const c = candidate.role_family
      if (!c || !role.role_family) return unknown('The candidate\'s role family could not be determined.')
      const technical = ['engineering', 'qa', 'data_analysis', 'data_science']
      const status: MatchStatus = c.value === role.role_family.value ? 'strong'
        : technical.includes(c.value) && technical.includes(role.role_family.value) ? 'transferable' : 'explicit_gap'
      return { status, basis: 'inferred', confidence: round2(Math.min(c.confidence, role.role_family.confidence)), evidence: [ev('role_family', c.value, c)], explanation: status === 'strong' ? `Same function (${c.value.replace('_', ' ')}).` : `Role is ${role.role_family.value.replace('_', ' ')}; candidate works in ${c.value.replace('_', ' ')}${status === 'transferable' ? ' — related, but a different job' : ''}.` }
    }
    case 'seniority': {
      const current = candidate.seniority.current
      // An inflated title is a claim: a staff+/director-level title with no demonstrated
      // scope (team size, managers of managers, cross-team or org-wide work, years) is not proof.
      if (!candidate.seniority.demonstrated && current && current.value >= 5) {
        return { status: 'unsupported', basis: 'explicit', confidence: current.confidence, evidence: [ev('seniority.current', `title level ${current.value}`, current)], explanation: `The title implies level ${current.value}, but no team size, cross-team or organization-wide scope supports it.` }
      }
      const level = candidate.seniority.demonstrated ?? current
      if (!level || req.required === null) return unknown('Candidate seniority could not be determined.')
      const diff = level.value - req.required
      const status: MatchStatus = diff >= 0 ? (diff >= 2 ? 'partial' : 'strong') : diff === -1 ? 'partial' : 'explicit_gap'
      const explanation = diff >= 2 ? `Candidate operates above this role's level (${level.value} vs ${req.required}).` : diff >= 0 ? `Candidate seniority (level ${level.value}) meets the role (level ${req.required}).` : `Candidate seniority (level ${level.value}) is ${-diff} level${diff === -1 ? '' : 's'} below the role (level ${req.required}).`
      return { status, basis: 'inferred', confidence: level.confidence, evidence: [ev(candidate.seniority.demonstrated ? 'seniority.demonstrated' : 'seniority.current', `level ${level.value}`, level)], explanation }
    }
    case 'experience_years': {
      if (req.concepts[0] === 'People Management') {
        const people = peopleVerdict(candidate, null)
        if (people.status === 'strong') return { ...people, status: 'partial', explanation: `${people.explanation} Duration of people management is not stated.` }
        return people
      }
      const total = candidate.experience.total_years
      if (!total || req.required === null) return unknown('Total years of experience could not be determined.')
      const status: MatchStatus = total.value >= req.required ? 'strong' : total.value >= req.required * 0.6 ? 'partial' : 'explicit_gap'
      return { status, basis: total.basis === 'explicit' ? 'explicit' : 'inferred', confidence: total.confidence, evidence: [ev('experience.total_years', `${total.value} years`, total)], explanation: `${total.value} years of experience vs ${req.required}+ required.` }
    }
    case 'hands_on': {
      const h = candidate.scopes.hands_on
      if (!h) return unknown('No evidence either way about recent hands-on work.')
      if (h.negated) return { status: 'explicit_gap', basis: 'explicit', confidence: h.confidence, evidence: [ev('scopes.hands_on', 'not hands-on', h)], explanation: 'The resume says the candidate is no longer hands-on, but the role is.' }
      if (h.rule === 'non_professional_context_only') return { status: 'unsupported', basis: 'inferred', confidence: h.confidence, evidence: [ev('scopes.hands_on', h.value, h)], explanation: 'Hands-on work appears only in personal or course projects.' }
      return { status: h.value === 'low' ? 'partial' : 'strong', basis: 'inferred', confidence: h.confidence, evidence: [ev('scopes.hands_on', h.value, h)], explanation: h.value === 'low' ? 'Limited hands-on evidence.' : 'Hands-on engineering is a clear part of the candidate\'s work.' }
    }
    case 'domain': {
      const d = candidate.domains.find((x) => x.value === req.concepts[0])
      if (d) return { status: 'strong', basis: 'inferred', confidence: d.confidence, evidence: [ev('domains', d.value, d)], explanation: `Has worked in ${d.value}.` }
      return unknown(`No ${req.concepts[0]} domain experience is mentioned.`)
    }
    case 'education': return unknown('Education is not extracted from resumes yet.')
    default: return unknown('This requirement could not be interpreted deterministically.')
  }
}

// ── Matrix ──────────────────────────────────────────────────────────────────

export function matchProfiles(candidate: CandidateIntelligenceProfile, role: RoleIntelligenceProfile): RequirementMatrix {
  const header = {
    engine_version: MATCHING_ENGINE_VERSION,
    candidate: { schema_version: candidate.schema_version, extractor_version: candidate.extractor.version, resume_sha256: candidate.source.resume_sha256 },
    role: { schema_version: role.schema_version, extractor_version: role.extractor.version, content_sha256: role.source.content_sha256, page_kind: role.page.value },
  }
  if (role.page.value !== 'job_page') {
    return { ...header, rows: [], summary: { fit_score: 0, mandatory: emptyCounts(), preferred: emptyCounts(), skill_weight_share: 0, blocking_gaps: [] }, explanation: [`Not matched: the page is a ${role.page.value.replace('_', ' ')}, not a job description.`] }
  }
  const rows: RequirementMatch[] = buildRequirements(role).map((requirement) => {
    const verdict = evaluate(requirement, candidate, role)
    const weight = (requirement.mandatory ? MANDATORY_WEIGHT : PREFERRED_WEIGHT) * (requirement.origin === 'role_structure' ? STRUCTURAL_WEIGHT[requirement.kind] ?? 1 : 1)
    return {
      requirement, status: verdict.status, basis: verdict.basis, confidence: round2(verdict.confidence),
      evidence: verdict.evidence, recency: recencyFor(candidate, verdict.evidence.flatMap((e) => e.quotes)),
      explanation: verdict.explanation, weight,
    }
  })

  // Tool overlap must not dominate: cap the total weight of skill rows.
  const skillWeight = rows.filter((r) => r.requirement.kind === 'skill').reduce((sum, r) => sum + r.weight, 0)
  const otherWeight = rows.filter((r) => r.requirement.kind !== 'skill').reduce((sum, r) => sum + r.weight, 0)
  if (skillWeight > 0 && otherWeight > 0 && skillWeight / (skillWeight + otherWeight) > MAX_SKILL_WEIGHT_SHARE) {
    const scale = (MAX_SKILL_WEIGHT_SHARE * otherWeight) / ((1 - MAX_SKILL_WEIGHT_SHARE) * skillWeight)
    for (const row of rows) if (row.requirement.kind === 'skill') row.weight *= scale
  }
  for (const row of rows) row.weight = Number(row.weight.toFixed(4))

  const total = rows.reduce((sum, r) => sum + r.weight, 0)
  const summary: MatchSummary = {
    fit_score: total ? Math.round((100 * rows.reduce((sum, r) => sum + r.weight * STATUS_VALUE[r.status], 0)) / total) : 0,
    mandatory: emptyCounts(), preferred: emptyCounts(),
    skill_weight_share: total ? Number((rows.filter((r) => r.requirement.kind === 'skill').reduce((s, r) => s + r.weight, 0) / total).toFixed(2)) : 0,
    blocking_gaps: rows.filter((r) => r.requirement.mandatory && (r.status === 'explicit_gap' || r.status === 'unsupported')).map((r) => r.requirement.normalized),
  }
  for (const row of rows) (row.requirement.mandatory ? summary.mandatory : summary.preferred)[row.status] += 1
  return { ...header, rows, summary, explanation: explain(rows) }
}

function explain(rows: RequirementMatch[]): string[] {
  const names = (list: RequirementMatch[]) => list.slice(0, 3).map((r) => r.requirement.normalized.replace(/^Skill: /, '')).join(', ')
  const lines: string[] = []
  const identity = rows.find((r) => r.requirement.kind === 'identity')
  if (identity && identity.status !== 'strong' && identity.status !== 'unknown') lines.push(identity.explanation)
  const family = rows.find((r) => r.requirement.kind === 'role_family')
  if (family && family.status !== 'strong' && family.status !== 'unknown') lines.push(family.explanation)
  const gaps = rows.filter((r) => r.requirement.mandatory && r.status === 'explicit_gap' && r.requirement.kind !== 'identity' && r.requirement.kind !== 'role_family')
  if (gaps.length) lines.push(`Gaps against must-haves: ${[...new Set(gaps.map((r) => r.explanation))].slice(0, 3).join(' ')}`)
  const claimed = rows.filter((r) => r.status === 'unsupported')
  if (claimed.length) lines.push(`Claimed but not shown in work: ${names(claimed)}.`)
  const strong = rows.filter((r) => r.requirement.mandatory && r.status === 'strong' && r.requirement.kind !== 'identity' && r.requirement.kind !== 'role_family')
  if (strong.length) lines.push(`Clearly demonstrated: ${names(strong)}.`)
  const transferable = rows.filter((r) => r.status === 'transferable')
  if (transferable.length) lines.push(`Related, not identical: ${names(transferable)}.`)
  const unknownCount = rows.filter((r) => r.status === 'unknown').length
  if (unknownCount) lines.push(`${unknownCount} requirement${unknownCount === 1 ? '' : 's'} cannot be judged from the resume (unknown, not missing).`)
  return lines.slice(0, 5)
}

export function matrixReference(matrix: RequirementMatrix): RequirementMatchReference {
  return { engine_version: matrix.engine_version, fit_score: matrix.summary.fit_score, mandatory: matrix.summary.mandatory, preferred: matrix.summary.preferred, blocking_gaps: matrix.summary.blocking_gaps.slice(0, 5), explanation: matrix.explanation }
}
