// Deterministic Candidate Intelligence Profile extraction.
//
// Pure function of the resume text: no network, no model call, no clock, so the
// same resume always yields the same profile and provider outages cannot affect
// it. The whole resume is processed through bounded chunks (nothing is dropped);
// every value is traceable to verbatim quotes, and anything without evidence is
// reported in `unknowns` rather than guessed.
import { createHash } from 'node:crypto'
import {
  CANDIDATE_PROFILE_EXTRACTOR_VERSION,
  CANDIDATE_PROFILE_SCHEMA_VERSION,
  type CandidateIntelligenceProfile,
  type EvidenceRef,
  type ProfessionalIdentity,
  type RoleEntry,
  type RoleFamily,
  type Scope,
  type ScopeLevel,
  type SeniorityLevel,
  type Traced,
} from './schema'

export const MAX_CHUNK_CHARS = 1200
const MAX_QUOTE_CHARS = 240
const MAX_EVIDENCE_PER_ITEM = 3

interface Unit { chunk: number; start: number; end: number; text: string; lower: string; line: number }

// ── Normalisation and chunking ──────────────────────────────────────────────

export function normaliseResume(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]/g, ' ')
    .split('\n')
    .map((line) => line.replace(/ {2,}/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function resumeSha256(text: string): string {
  return createHash('sha256').update(normaliseResume(text)).digest('hex')
}

/** Splits the full text into contiguous chunks of at most `max` chars at line (or word) boundaries. */
export function chunkResume(text: string, max = MAX_CHUNK_CHARS): Array<{ index: number; start: number; end: number }> {
  const chunks: Array<{ index: number; start: number; end: number }> = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(text.length, start + max)
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end)
      const space = text.lastIndexOf(' ', end)
      if (newline > start) end = newline + 1
      else if (space > start) end = space + 1
    }
    chunks.push({ index: chunks.length, start, end })
    start = end
  }
  return chunks
}

function splitUnits(text: string): Unit[] {
  const units: Unit[] = []
  const lineStarts = [0]
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') lineStarts.push(i + 1)
  const lineOf = (offset: number) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1 } return lo }
  for (const chunk of chunkResume(text)) {
    // Bullets, line breaks, semicolons and sentence ends delimit evidence units.
    const re = /[^\n;•]+?(?:[.!?](?=\s+[A-Z(])|(?=\n|;|•|$))/g
    const body = text.slice(chunk.start, chunk.end)
    for (const match of body.matchAll(re)) {
      const raw = match[0]
      const lead = raw.length - raw.trimStart().length
      const trimmed = raw.trim().replace(/^[-*–]\s+/, '')
      if (trimmed.length < 3) continue
      const start = chunk.start + (match.index ?? 0) + lead + (raw.trim().length - trimmed.length)
      units.push({ chunk: chunk.index, start, end: start + trimmed.length, text: trimmed, lower: trimmed.toLowerCase(), line: lineOf(start) })
    }
  }
  return units
}

function ref(source: string, unit: Unit): EvidenceRef {
  const end = Math.min(unit.end, unit.start + MAX_QUOTE_CHARS)
  return { chunk: unit.chunk, start: unit.start, end, quote: source.slice(unit.start, end) }
}

const clamp = (value: number, max = 0.95) => Number(Math.min(max, Math.max(0.05, value)).toFixed(2))

// ── Context classification ──────────────────────────────────────────────────

/** Statements that something did NOT happen must not count as evidence for it. */
function negatedBefore(lower: string, index: number): boolean {
  return /\b(?:no|not|never|without|none)\b[^.,;]{0,30}$/.test(lower.slice(Math.max(0, index - 40), index))
}

/** Student, hobby, course and certificate contexts are weaker than professional work. */
function nonProfessional(lower: string): boolean {
  return /\b(?:universit(?:y|ies)|college|student|club|hackathon|bootcamp|course|certificates?|certification|personal project|side project|demo|volunteer|hobby|interested in)\b/.test(lower)
}

function skillsListLine(unit: Unit): boolean {
  return /^(?:skills|technologies|tech stack|tools|languages|technical skills)\b\s*:?/.test(unit.lower) ||
    ((unit.text.match(/,/g) ?? []).length >= 4 && !/\b(?:built|led|designed|managed|owned|implemented|wrote|developed)\b/.test(unit.lower))
}

// ── Taxonomies ──────────────────────────────────────────────────────────────

const SKILLS: Record<string, string[]> = {
  React: ['react', 'react.js', 'reactjs'], 'Node.js': ['node.js', 'nodejs', 'node js'], TypeScript: ['typescript'],
  JavaScript: ['javascript'], Python: ['python', 'pyspark'], Java: ['java'], 'C#': ['c#', 'c sharp'], '.NET': ['.net'],
  PHP: ['php'], Go: ['golang', 'go language'], Ruby: ['ruby', 'rails'], SQL: ['sql'],
  AWS: ['aws', 'amazon web services'], GCP: ['gcp', 'google cloud'], Azure: ['azure'],
  Docker: ['docker', 'containerization'], Kubernetes: ['kubernetes', 'k8s'], PostgreSQL: ['postgresql', 'postgres'],
  MongoDB: ['mongodb', 'mongo db'], Redis: ['redis'], GraphQL: ['graphql'], 'REST APIs': ['rest api', 'rest apis', 'restful'],
  Microservices: ['microservices', 'micro-services'], 'CI/CD': ['ci/cd', 'continuous integration', 'github actions'],
  Jest: ['jest'], Cypress: ['cypress'], 'Tailwind CSS': ['tailwind'], Kafka: ['kafka'], Flink: ['flink'],
  Spark: ['spark', 'pyspark'], Airflow: ['airflow'], Terraform: ['terraform'], Databricks: ['databricks'],
  Snowflake: ['snowflake'], 'Machine Learning': ['machine learning', 'ml engineering'], 'Distributed Systems': ['distributed systems'],
}

interface CapabilityRule { name: string; patterns: RegExp[] }
const CAPABILITIES: CapabilityRule[] = [
  { name: 'System Design', patterns: [/\barchitect(?:ed|ing|ure)?\b/, /\bdesign(?:ed|ing)?\b[^.]{0,80}\b(?:scalable|distributed|highly available|idempotent|control plane|platform)\b/, /\b(?:design|architecture) reviews?\b/, /\bsystem design\b/] },
  { name: 'Technical Leadership', patterns: [/\btechnical (?:lead|leadership|direction)\b/, /\bset (?:the )?(?:technical direction|architecture)\b/, /\bled (?:the )?design\b/, /\bran design reviews\b/] },
  { name: 'Mentoring', patterns: [/\bmentor(?:ed|ing)?\b/, /\bcoach(?:ed|ing)\b/] },
  { name: 'People Management', patterns: [/\bdirect reports?\b/, /\bperformance (?:reviews?|management)\b/, /\bmanag(?:ed|es|ing) (?:a |the )?team\b/, /\bmanag(?:ed|es|ing) \d+ (?:engineers|people|engineering managers|managers)\b/] },
  { name: 'Hiring', patterns: [/\bhir(?:ed|ing)\b/, /\bheadcount\b/] },
  { name: 'Organization Design', patterns: [/\bheadcount planning\b/, /\borg(?:anization)? design\b/, /\bmanag(?:ed|ing) \d+ (?:engineering )?managers\b/] },
  { name: 'Budget Ownership', patterns: [/\b(?:owned|own|managed) (?:the )?budget\b/, /\bbudget\b/] },
  { name: 'Stakeholder Management', patterns: [/\bstakeholders?\b/, /\bpartnered with (?:product|design|business|data scientists|executive)/, /\bpresented to (?:executives|leadership|the board)\b/] },
  { name: 'Product Collaboration', patterns: [/\broadmap\b/, /\bprds?\b/, /\bpartnered with product\b/] },
  { name: 'Cross-team Influence', patterns: [/\b(?:across|adopted by|used by) (?:\d+|several|multiple|many) (?:product |internal )?(?:teams|squads)\b/, /\bcross-team\b/, /\borg(?:anization)?-wide\b/] },
  { name: 'Observability', patterns: [/\b(?:distributed tracing|observability|monitoring)\b/, /\b(?:reduced|improved) (?:mttr|incident response)\b/] },
  { name: 'Incident Response', patterns: [/\bon-call\b/, /\bincident(?:s| response)?\b/, /\brunbooks?\b/] },
  { name: 'Performance Optimization', patterns: [/\b(?:reduced|cut|improved)\b[^.]{0,40}\b(?:latency|p9\d|throughput|performance)\b/] },
  { name: 'Data Pipelines', patterns: [/\bpipelines?\b/] },
  { name: 'Testing Automation', patterns: [/\b(?:test suites?|wrote [^.]{0,30}tests|automation (?:suites?|framework))\b/] },
  { name: 'Design System Ownership', patterns: [/\bdesign system\b/] },
]

const DOMAINS: Record<string, RegExp> = {
  'payments / fintech': /\b(?:payments?|fintech|banking|bank|ledger|card settlement|lending|trading)\b/,
  insurance: /\binsurance\b/,
  healthcare: /\b(?:health(?:care|-tech)?|clinical|patients?|care)\b/,
  'retail / e-commerce': /\b(?:e-?commerce|retail|marketplace|commerce)\b/,
  education: /\b(?:education|edtech|teach(?:er|ers|ing)|lesson|school|learning platform|tutoring)\b/,
  'logistics / freight': /\b(?:logistics|freight|shipping|supply chain)\b/,
  advertising: /\b(?:ads|adtech|advertising|bidding)\b/,
  media: /\bmedia\b/,
  gaming: /\bgam(?:e|es|ing)\b/,
  'manufacturing / industrial': /\b(?:manufacturing|industrial|sensor data|sensors?)\b/,
  telecom: /\btelecom\b/,
  energy: /\b(?:energy|grid)\b/,
  'cloud infrastructure': /\b(?:cloud platform|control plane|kubernetes platform|infrastructure platform)\b/,
  'data platform': /\b(?:data platform|streaming pipelines|data infrastructure)\b/,
}

const SCOPE_RULES: Record<keyof CandidateIntelligenceProfile['scopes'], RegExp[]> = {
  leadership: [/\bled\b/, /\blead\b/, /\bmanag(?:ed|es|ing)\b/, /\bmentor(?:ed|ing)?\b/, /\bcoach(?:ed|ing)\b/, /\bdirect reports?\b/, /\bcaptain\b/, /\bleadership\b/],
  architecture: [/\barchitect(?:ed|ing|ure)?\b/, /\bsystem design\b/, /\bdesign(?:ed)?\b[^.]{0,80}\b(?:scalable|distributed|highly available|idempotent|platform|service)\b/, /\bdesign reviews?\b/, /\btechnical (?:direction|strategy)\b/],
  hands_on: [/\b(?:built|build|builds|implemented|wrote|writes|developed|coded|shipped|debugged|refactored|deployed|maintained|moved deployments)\b/],
  product_stakeholder: [/\bproduct\b/, /\broadmap\b/, /\bstakeholders?\b/, /\bpartnered with\b/, /\bprds?\b/, /\bexecutives?\b/],
  delivery_ownership: [/\bown(?:ed|s|ing)?\b/, /\bdelivery\b/, /\bdelivered\b/, /\bshipped\b/, /\blaunched\b/, /\bmigrat(?:ed|ion)\b/, /\bon-call\b/, /\bend to end\b/],
}

const TITLE_NOUN = /\b(?:engineer|developer|programmer|manager|lead|director|architect|analyst|scientist|officer|teacher|cto|vp|vice president|head of [a-z ]+|intern|trainee|consultant|designer|founder)\b/

function titleLevel(title: string): SeniorityLevel {
  const t = title.toLowerCase()
  if (/\b(?:principal|distinguished|fellow|vp|vice president|cto|chief)\b/.test(t)) return 6
  if (/\b(?:senior staff|staff|director|head of|senior (?:engineering )?manager|group manager)\b/.test(t)) return 5
  if (/\b(?:senior|sr\.?|lead|manager)\b/.test(t)) return 4
  if (/\b(?:junior|jr\.?|associate|graduate|entry)\b/.test(t)) return 2
  if (/\b(?:intern|trainee|apprentice)\b/.test(t)) return 1
  return 3
}

function titleFamily(title: string): RoleFamily {
  const t = title.toLowerCase()
  if (/\bproduct (?:manager|owner)\b/.test(t)) return 'product'
  if (/\b(?:qa|quality|test(?:ing)?|sdet)\b/.test(t)) return 'qa'
  if (/\banalyst\b/.test(t)) return 'data_analysis'
  if (/\bdata scientist\b|\bscientist\b/.test(t)) return 'data_science'
  if (/\b(?:engineer|developer|programmer|architect|tech lead|technical lead|cto|engineering|software)\b/.test(t)) return 'engineering'
  return 'non_technical'
}

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 }
const num = (value: string) => WORD_NUMBERS[value.toLowerCase()] ?? Number(value)

// ── Extraction ──────────────────────────────────────────────────────────────

export function extractCandidateProfile(resumeText: string): CandidateIntelligenceProfile {
  const text = normaliseResume(resumeText)
  const units = splitUnits(text)
  const chunks = chunkResume(text)
  const evidenceOf = (list: Unit[]) => list.slice(0, MAX_EVIDENCE_PER_ITEM).map((unit) => ref(text, unit))
  const firstMatch = (unit: Unit, patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const m = pattern.exec(unit.lower)
      if (m && !negatedBefore(unit.lower, m.index)) return m
    }
    return null
  }

  // Roles: lines that start with a job title followed by an employer / date separator.
  const roles: RoleEntry[] = []
  const roleUnits: Unit[] = []
  for (const unit of units) {
    const lineStart = text.lastIndexOf('\n', unit.start - 1) + 1
    if (unit.start !== lineStart) continue
    const beforeEmployer = unit.text.split(/\s+(?:at|@)\s+|\s*[(|–]\s*|\s+-\s+/)[0]
    const segments = beforeEmployer.split(/\s*,\s*/)
    const head = segments.length > 1 && titleFamily(segments[0]) === 'non_technical' && titleFamily(`${segments[0]} ${segments[1]}`) === 'engineering'
      ? `${segments[0]}, ${segments[1]}` : segments[0]
    if (head.length > 70 || !TITLE_NOUN.test(head.toLowerCase()) || /^(?:skills|summary|education)\b/i.test(head)) continue
    const range = /\b((?:19|20)\d{2})\s*(?:–|-|to)\s*((?:19|20)\d{2}|present|current|now)\b/i.exec(unit.text)
    const startYear = range ? Number(range[1]) : null
    const current = range ? /present|current|now/i.test(range[2]) : roles.length === 0
    roles.push({ title: head.trim(), start_year: startYear, end_year: range && !current ? Number(range[2]) : null, is_current: current, evidence: [ref(text, unit)] })
    roleUnits.push(unit)
  }
  const currentRole = roles.find((role) => role.is_current) ?? roles[0] ?? null
  const currentRoleUnit = currentRole ? roleUnits[roles.indexOf(currentRole)] : null

  // Explicit skills.
  const explicitSkills: Array<Traced<string>> = []
  for (const [name, aliases] of Object.entries(SKILLS)) {
    const hits = units.filter((unit) => aliases.some((alias) => new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9#]|$)`).test(unit.lower)))
    if (!hits.length) continue
    const professional = hits.filter((unit) => !nonProfessional(unit.lower) && !skillsListLine(unit))
    const listed = hits.filter((unit) => skillsListLine(unit) && !nonProfessional(unit.lower))
    const [rule, base, used] = professional.length
      ? ['used_in_experience', 0.8, professional] as const
      : listed.length ? ['skills_list_only', 0.55, listed] as const : ['non_professional_context_only', 0.35, hits] as const
    explicitSkills.push({ value: name, basis: 'explicit', confidence: clamp(base + 0.05 * (used.length - 1)), rule, evidence: evidenceOf(used) })
  }
  const explicitNames = new Set(explicitSkills.map((skill) => skill.value))

  // Implicit capabilities (inferred from responsibilities/achievements, never from skills lists).
  const capabilities: Array<Traced<string>> = []
  for (const rule of CAPABILITIES) {
    if (explicitNames.has(rule.name)) continue
    const hits = units.filter((unit) => !skillsListLine(unit) && firstMatch(unit, rule.patterns))
    if (!hits.length) continue
    const professional = hits.filter((unit) => !nonProfessional(unit.lower))
    const used = professional.length ? professional : hits
    const base = professional.length ? 0.55 : 0.3
    capabilities.push({ value: rule.name, basis: 'inferred', confidence: clamp(base + 0.1 * (used.length - 1), 0.8), rule: professional.length ? 'responsibility_pattern' : 'non_professional_context_only', evidence: evidenceOf(used) })
  }

  // Team size, direct reports, managers of managers.
  let largest: { size: number; unit: Unit } | null = null
  const reportsYes: Unit[] = [], reportsNo: Unit[] = [], managesManagers: Unit[] = []
  for (const unit of units) {
    if (nonProfessional(unit.lower)) continue
    for (const m of unit.lower.matchAll(/\b(?:team|org(?:anization)?|group) of (?:about |around |~)?(\d{1,4}|[a-z]+)\b|\b(\d{1,4}) (?:engineers|developers|direct reports|people|reports)\b|\bmanag(?:ed|es|ing) (\d{1,4})\b/g)) {
      const size = num(m[1] ?? m[2] ?? m[3])
      if (!Number.isFinite(size) || size < 2 || negatedBefore(unit.lower, m.index ?? 0)) continue
      if (!largest || size > largest.size) largest = { size, unit }
    }
    if (/\b(?:no|never had|never|without) direct reports\b/.test(unit.lower)) reportsNo.push(unit)
    else if (/\bdirect reports?\b|\bmanag(?:ed|es|ing) (?:a |the )?team\b|\bmanag(?:ed|es|ing) \d+ (?:engineers|people)\b/.test(unit.lower) && !/\binput on\b/.test(unit.lower)) reportsYes.push(unit)
    if (/\b(?:managed|manages|managing|led|leads|lead) (?:\d+|two|three|four|five|six|several|multiple) (?:engineering )?managers\b|\bmanaging managers\b/.test(unit.lower)) managesManagers.push(unit)
  }

  // Identity signals.
  const signals = { ic: 0, technical_lead: 0, people_manager: 0, executive: 0 }
  const handsOnNegations = units.filter((unit) => /\b(?:has not|have not|hasn't|haven't|not|no longer|did not)\b[^.]{0,30}\b(?:written|writing|coded|coding|code)\b/.test(unit.lower))
  for (const unit of units) {
    if (nonProfessional(unit.lower) || skillsListLine(unit)) continue
    const mentionsSkill = Object.values(SKILLS).some((aliases) => aliases.some((alias) => unit.lower.includes(alias)))
    if (firstMatch(unit, SCOPE_RULES.hands_on) && mentionsSkill && !/\b(?:team|teams|organization|org) (?:owned|built|ran)\b/.test(unit.lower)) signals.ic += 1
    if (/\b(?:tech(?:nical)? lead|lead engineer|technical leadership|technical direction|design reviews|set the architecture)\b/.test(unit.lower)) signals.technical_lead += 1
    if (reportsYes.includes(unit) || /\bperformance reviews?\b/.test(unit.lower) && !/\binput on|manager owned\b/.test(unit.lower)) signals.people_manager += 1
    if (managesManagers.includes(unit) || /\b(?:vp|vice president|cto|chief|head of engineering)\b/.test(unit.lower)) signals.executive += 1
  }

  const currentTitle = currentRole?.title.toLowerCase() ?? ''
  const family: RoleFamily | null = currentRole ? titleFamily(currentRole.title) : null
  let identity: ProfessionalIdentity | null = null
  let identityRule = ''
  const titleSays = currentRole
    ? /\b(?:vp|vice president|cto|chief|head of engineering)\b/.test(currentTitle) ? 'executive'
      : family === 'engineering' && /\b(?:manager|director)\b/.test(currentTitle) ? 'people_manager'
        : /\b(?:tech lead|technical lead|lead engineer|team lead)\b/.test(currentTitle) ? 'technical_lead'
          : family === 'engineering' || family === 'qa' || family === 'data_analysis' || family === 'data_science' ? 'ic' : null
    : null
  const handsOnNow = signals.ic >= 2 && !handsOnNegations.length
  if (titleSays === 'executive' || signals.executive >= 2 && signals.people_manager >= 1) { identity = 'executive'; identityRule = 'executive_title_or_org_scope' }
  else if (titleSays === 'people_manager' || signals.people_manager >= 2) { identity = handsOnNow ? 'hybrid' : 'people_manager'; identityRule = handsOnNow ? 'manager_with_hands_on_evidence' : 'manager_title_or_reports' }
  else if (titleSays === 'technical_lead') { identity = signals.people_manager >= 1 && handsOnNow ? 'hybrid' : 'technical_lead'; identityRule = 'lead_title' }
  else if (titleSays === 'ic' || signals.ic >= 1) { identity = 'ic'; identityRule = titleSays === 'ic' ? 'ic_title' : 'hands_on_evidence' }
  const identityAgree = titleSays !== null && (identity === titleSays || identity === 'hybrid')
  const identityEvidenceUnits = [currentRoleUnit, ...reportsYes, ...managesManagers].filter((unit): unit is Unit => !!unit)
  const identityTraced: Traced<ProfessionalIdentity> | null = identity ? {
    value: identity, basis: 'inferred', rule: identityRule,
    confidence: clamp(identity === 'hybrid' ? 0.6 : identityAgree && (signals.ic + signals.people_manager + signals.technical_lead + signals.executive) > 0 ? 0.85 : titleSays ? 0.7 : 0.55, 0.9),
    evidence: evidenceOf(identityEvidenceUnits.length ? identityEvidenceUnits : units.filter((unit) => firstMatch(unit, SCOPE_RULES.hands_on))),
  } : null

  // Career transition: an earlier non-engineering career, or a non-engineering role with technical courses.
  let transition: Traced<string> | null = null
  for (const unit of units) {
    const prior = /\bafter (\d+|[a-z]+) years? as an? ([a-z][a-z -]{2,40}?)(?=[,.;]| and |$)/.exec(unit.lower)
    if (prior) { transition = { value: `from ${prior[2].trim()}`, basis: 'explicit', confidence: 0.85, rule: 'prior_career_statement', evidence: [ref(text, unit)] }; break }
    if (/\b(?:career change|transitioned from|switched (?:careers|from))\b/.test(unit.lower)) { transition = { value: 'stated career change', basis: 'explicit', confidence: 0.8, rule: 'career_change_statement', evidence: [ref(text, unit)] }; break }
  }
  if (!transition && family && family !== 'engineering') {
    const courseUnits = units.filter((unit) => /\b(?:certificates?|certification|bootcamp|online [a-z]+ course|course)\b/.test(unit.lower))
    if (courseUnits.length) transition = { value: `${family.replace('_', ' ')} background moving toward engineering`, basis: 'inferred', confidence: 0.6, rule: 'non_engineering_role_with_technical_courses', evidence: evidenceOf(courseUnits) }
  }

  // Scopes.
  const scope = (key: keyof CandidateIntelligenceProfile['scopes']): Scope | null => {
    if (key === 'hands_on' && handsOnNegations.length) {
      return { value: 'low', basis: 'explicit', confidence: 0.85, rule: 'explicit_negative_statement', negated: true, evidence: evidenceOf(handsOnNegations) }
    }
    const hits = units.filter((unit) => !skillsListLine(unit) && firstMatch(unit, SCOPE_RULES[key]))
    const professional = hits.filter((unit) => !nonProfessional(unit.lower))
    if (!professional.length) {
      return hits.length ? { value: 'low', basis: 'inferred', confidence: 0.3, rule: 'non_professional_context_only', negated: false, evidence: evidenceOf(hits) } : null
    }
    const level: ScopeLevel = professional.length >= 3 ? 'high' : professional.length === 2 ? 'medium' : 'low'
    return { value: level, basis: 'inferred', confidence: clamp(0.5 + 0.1 * professional.length, 0.85), rule: 'responsibility_frequency', negated: false, evidence: evidenceOf(professional) }
  }
  const scopes = { leadership: scope('leadership'), architecture: scope('architecture'), hands_on: scope('hands_on'), product_stakeholder: scope('product_stakeholder'), delivery_ownership: scope('delivery_ownership') }

  // Experience and recency (never using the current date, so output is reproducible).
  const years = roles.filter((role) => role.start_year)
  let totalYears: Traced<number> | null = null
  if (years.length) {
    const start = Math.min(...years.map((role) => role.start_year!))
    const end = Math.max(...roles.map((role) => role.end_year ?? role.start_year ?? start))
    if (end >= start && !roles.some((role) => role.is_current && role.start_year)) {
      totalYears = { value: end - start, basis: 'inferred', confidence: 0.6, rule: 'date_ranges_span', evidence: roles.flatMap((role) => role.evidence).slice(0, MAX_EVIDENCE_PER_ITEM) }
    }
  }
  if (!totalYears) {
    const stated = units.find((unit) => /\b(\d{1,2})\+? years? of (?:professional |industry |software |engineering )?experience\b/.test(unit.lower) && !nonProfessional(unit.lower))
    const match = stated && /\b(\d{1,2})\+? years? of/.exec(stated.lower)
    if (stated && match) totalYears = { value: Number(match[1]), basis: 'explicit', confidence: 0.85, rule: 'stated_years_of_experience', evidence: [ref(text, stated)] }
    else if (currentRoleUnit) {
      const own = /^[^,]*,\s*(\d{1,2}) years?\b|,\s*(\d{1,2}) years?\b/.exec(currentRoleUnit.text)
      if (own) totalYears = { value: Number(own[1] ?? own[2]), basis: 'explicit', confidence: 0.6, rule: 'current_role_duration_only', evidence: [ref(text, currentRoleUnit)] }
    }
  }
  const allYears = roles.flatMap((role) => [role.start_year, role.end_year]).filter((year): year is number => !!year)
  const mostRecent: Traced<number> | null = allYears.length
    ? { value: Math.max(...allYears), basis: 'explicit', confidence: 0.8, rule: 'latest_year_in_role_dates', evidence: roles.flatMap((role) => role.evidence).slice(0, MAX_EVIDENCE_PER_ITEM) }
    : null

  // Seniority.
  const current: Traced<SeniorityLevel> | null = currentRole && currentRoleUnit
    ? { value: titleLevel(currentRole.title), basis: 'explicit', confidence: 0.8, rule: 'current_title', evidence: [ref(text, currentRoleUnit)] }
    : null
  let demonstratedLevel: SeniorityLevel | null = null
  const demoUnits: Unit[] = []
  const affirmed = (unit: Unit, pattern: RegExp) => { const m = pattern.exec(unit.lower); return !!m && !negatedBefore(unit.lower, m.index) && !nonProfessional(unit.lower) }
  const orgWide = units.filter((unit) => affirmed(unit, /\b(?:org(?:anization)?-wide|across (?:the |a )?(?:\d+-engineer )?(?:engineering )?organi[sz]ation|architecture review board|multi-year)\b/))
  const crossTeam = units.filter((unit) => affirmed(unit, /\b(?:across|adopted by) (?:\d+|three|four|five|six|several|multiple) (?:product )?teams\b|\bcross-team\b/))
  if (orgWide.length >= 2) { demonstratedLevel = 6; demoUnits.push(...orgWide) }
  else if (managesManagers.length || orgWide.length || crossTeam.length || (largest && largest.size >= 25)) { demonstratedLevel = 5; demoUnits.push(...managesManagers, ...orgWide, ...crossTeam) }
  else if (largest && largest.size >= 3 && (reportsYes.length || signals.technical_lead)) { demonstratedLevel = 4; demoUnits.push(largest.unit) }
  else if (totalYears && scopes.hands_on && !scopes.hands_on.negated && scopes.hands_on.rule !== 'non_professional_context_only') {
    demonstratedLevel = totalYears.value >= 6 ? 4 : totalYears.value >= 3 ? 3 : 2
    demoUnits.push(...units.filter((unit) => totalYears.evidence.some((e) => e.start === unit.start)))
  }
  if (largest && demoUnits.length === 0 && demonstratedLevel) demoUnits.push(largest.unit)
  const demonstrated: Traced<SeniorityLevel> | null = demonstratedLevel && demoUnits.length
    ? { value: demonstratedLevel, basis: 'inferred', confidence: clamp(0.5 + 0.1 * Math.min(3, demoUnits.length), 0.8), rule: 'demonstrated_scope', evidence: evidenceOf(demoUnits) }
    : null

  // Domains and measurable outcomes.
  const domains: Array<Traced<string>> = []
  for (const [name, pattern] of Object.entries(DOMAINS)) {
    const hits = units.filter((unit) => pattern.test(unit.lower) && !nonProfessional(unit.lower))
    if (hits.length) domains.push({ value: name, basis: 'inferred', confidence: clamp(0.45 + 0.1 * hits.length, 0.8), rule: 'domain_vocabulary', evidence: evidenceOf(hits) })
  }
  const outcomes: Array<Traced<string>> = units
    .filter((unit) => /\b\d+(?:\.\d+)?\s?%|\b\d+(?:\.\d+)?x\b|\b\d+(?:\.\d+)?\s?(?:k|m|b|million|billion)\b|\b\d{2,}\b/i.test(unit.text) &&
      /\b(?:reduced|improved|increased|cut|grew|saved|decreased|lowered|raised|processing|serving|adopted by|used by|scaled)\b/.test(unit.lower) && !nonProfessional(unit.lower))
    .slice(0, 12)
    .map((unit) => ({ value: unit.text.slice(0, MAX_QUOTE_CHARS), basis: 'explicit' as const, confidence: 0.9, rule: 'quantified_statement', evidence: [ref(text, unit)] }))

  const profile: CandidateIntelligenceProfile = {
    schema_version: CANDIDATE_PROFILE_SCHEMA_VERSION,
    extractor: { method: 'deterministic', version: CANDIDATE_PROFILE_EXTRACTOR_VERSION, ai_assisted: false },
    source: { resume_sha256: createHash('sha256').update(text).digest('hex'), characters: text.length, chunks: chunks.length, max_chunk_chars: MAX_CHUNK_CHARS },
    identity: identityTraced,
    identity_signals: signals,
    role_family: family && currentRoleUnit ? { value: family, basis: 'inferred', confidence: 0.75, rule: 'current_title_family', evidence: [ref(text, currentRoleUnit)] } : null,
    career_transition: transition,
    seniority: { current, demonstrated },
    explicit_skills: explicitSkills.sort((a, b) => b.confidence - a.confidence || a.value.localeCompare(b.value)),
    implicit_capabilities: capabilities.sort((a, b) => b.confidence - a.confidence || a.value.localeCompare(b.value)),
    scopes,
    team: {
      largest_team_size: largest ? { value: largest.size, basis: 'explicit', confidence: 0.8, rule: 'stated_team_or_org_size', evidence: [ref(text, largest.unit)] } : null,
      has_direct_reports: reportsNo.length
        ? { value: false, basis: 'explicit', confidence: 0.9, rule: 'explicit_no_direct_reports', evidence: evidenceOf(reportsNo) }
        : reportsYes.length ? { value: true, basis: 'explicit', confidence: 0.85, rule: 'stated_reports_or_team_management', evidence: evidenceOf(reportsYes) } : null,
      manages_managers: managesManagers.length ? { value: true, basis: 'explicit', confidence: 0.85, rule: 'stated_managers_of_managers', evidence: evidenceOf(managesManagers) } : null,
    },
    domains: domains.sort((a, b) => b.confidence - a.confidence || a.value.localeCompare(b.value)),
    outcomes,
    experience: { total_years: totalYears, roles, most_recent_activity_year: mostRecent },
    unknowns: [],
  }
  profile.unknowns = listUnknowns(profile)
  return profile
}

function listUnknowns(profile: CandidateIntelligenceProfile): string[] {
  const unknown: string[] = []
  if (!profile.identity) unknown.push('identity')
  if (!profile.role_family) unknown.push('role_family')
  if (!profile.seniority.current) unknown.push('seniority.current')
  if (!profile.seniority.demonstrated) unknown.push('seniority.demonstrated')
  if (!profile.explicit_skills.length) unknown.push('explicit_skills')
  for (const [key, value] of Object.entries(profile.scopes)) if (!value) unknown.push(`scopes.${key}`)
  for (const [key, value] of Object.entries(profile.team)) if (!value) unknown.push(`team.${key}`)
  if (!profile.domains.length) unknown.push('domains')
  if (!profile.outcomes.length) unknown.push('outcomes')
  if (!profile.experience.total_years) unknown.push('experience.total_years')
  if (!profile.experience.roles.length) unknown.push('experience.roles')
  if (!profile.experience.most_recent_activity_year) unknown.push('experience.most_recent_activity_year')
  return unknown
}

/** Every traced value in a profile, for auditing confidence/evidence invariants. */
export function tracedItems(profile: CandidateIntelligenceProfile): Array<{ path: string; item: Traced<unknown> }> {
  const out: Array<{ path: string; item: Traced<unknown> }> = []
  const add = (path: string, item: Traced<unknown> | null) => { if (item) out.push({ path, item }) }
  add('identity', profile.identity); add('role_family', profile.role_family); add('career_transition', profile.career_transition)
  add('seniority.current', profile.seniority.current); add('seniority.demonstrated', profile.seniority.demonstrated)
  profile.explicit_skills.forEach((item, i) => add(`explicit_skills[${i}]`, item))
  profile.implicit_capabilities.forEach((item, i) => add(`implicit_capabilities[${i}]`, item))
  for (const [key, value] of Object.entries(profile.scopes)) add(`scopes.${key}`, value)
  for (const [key, value] of Object.entries(profile.team)) add(`team.${key}`, value)
  profile.domains.forEach((item, i) => add(`domains[${i}]`, item))
  profile.outcomes.forEach((item, i) => add(`outcomes[${i}]`, item))
  add('experience.total_years', profile.experience.total_years)
  add('experience.most_recent_activity_year', profile.experience.most_recent_activity_year)
  return out
}
