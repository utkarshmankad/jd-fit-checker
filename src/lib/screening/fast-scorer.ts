import type { AnalysisResult, HardRejectFilters, RetrievedEvidence } from '@/types'
import { createEvidenceEmbedding, type CandidateEvidenceInput } from '@/lib/rag/candidate-evidence'

const SKILL_ALIASES: Record<string, string[]> = {
  React: ['react', 'react.js', 'reactjs'], 'Node.js': ['node.js', 'nodejs', 'node js'],
  TypeScript: ['typescript'], JavaScript: ['javascript'], Python: ['python'], Java: ['java'],
  'C#': ['c#', 'c sharp', '.net'], PHP: ['php'], Go: ['golang', 'go language'], Ruby: ['ruby', 'rails'],
  AWS: ['aws', 'amazon web services'], GCP: ['gcp', 'google cloud'], Azure: ['azure'],
  Docker: ['docker', 'containers', 'containerization'], Kubernetes: ['kubernetes', 'k8s'],
  PostgreSQL: ['postgresql', 'postgres'], MongoDB: ['mongodb', 'mongo db'], Redis: ['redis'],
  GraphQL: ['graphql'], 'REST APIs': ['rest api', 'restful', 'api design'],
  Microservices: ['microservices', 'micro-services'], 'CI/CD': ['ci/cd', 'continuous integration', 'github actions'],
  Jest: ['jest'], Cypress: ['cypress'], 'Tailwind CSS': ['tailwind'],
  'System Design': ['system design', 'distributed systems', 'architecture'],
  Leadership: ['technical leadership', 'engineering leadership', 'mentoring', 'coaching'],
  Kafka: ['kafka', 'event streaming', 'streaming platform'], Flink: ['flink', 'apache flink'],
  Spark: ['spark', 'apache spark', 'pyspark'], Airflow: ['airflow', 'apache airflow'],
  Terraform: ['terraform', 'infrastructure as code'], Databricks: ['databricks'], Snowflake: ['snowflake'],
  'Machine Learning': ['machine learning', 'ml engineering', 'applied ai'],
}

const LEVELS: Array<[number, string[]]> = [
  [6, ['principal', 'distinguished', 'vp engineering', 'vice president']],
  [5, ['senior staff', 'staff engineer', 'director', 'head of engineering']],
  [4, ['senior manager', 'engineering manager', 'manager', 'tech lead', 'technical lead', 'senior engineer', 'lead engineer']],
  [3, ['software engineer', 'full stack engineer', 'fullstack engineer']],
  [2, ['associate', 'junior', 'entry level']], [1, ['intern', 'trainee']],
]

const LOCATIONS: Record<string, string[]> = {
  gurgaon: ['gurgaon', 'gurugram'], hyderabad: ['hyderabad'], bengaluru: ['bengaluru', 'bangalore'],
  delhi: ['delhi', 'new delhi', 'ncr'], mumbai: ['mumbai', 'bombay'], pune: ['pune'],
  chennai: ['chennai', 'madras'], noida: ['noida'],
}

const STOP = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'were', 'will', 'with', 'your', 'you', 'our', 'their', 'using', 'work', 'worked'])

function contains(text: string, phrase: string): boolean {
  const escaped = phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(text.toLowerCase())
}

function skills(text: string): Set<string> {
  return new Set(Object.entries(SKILL_ALIASES).filter(([, aliases]) => aliases.some((alias) => contains(text, alias))).map(([name]) => name))
}

function skillsInOrder(values: Set<string>, text: string): string[] {
  const lower = text.toLowerCase()
  return [...values].sort((a, b) => Math.min(...SKILL_ALIASES[a].map((x) => lower.indexOf(x)).filter((x) => x >= 0), lower.length) - Math.min(...SKILL_ALIASES[b].map((x) => lower.indexOf(x)).filter((x) => x >= 0), lower.length))
}

function roleLevel(text: string): number {
  for (const [level, patterns] of LEVELS) if (patterns.some((pattern) => contains(text, pattern))) return level
  return 3
}

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9+#.]{2,}/g) ?? []).filter((token) => !STOP.has(token))
}

function cosine(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return 0
  const ln = Math.sqrt(left.reduce((s, x) => s + x * x, 0)); const rn = Math.sqrt(right.reduce((s, x) => s + x * x, 0))
  return ln && rn ? left.reduce((s, x, i) => s + x * right[i], 0) / (ln * rn) : 0
}

function retrieve(jdText: string, jdSkills: Set<string>, rows: CandidateEvidenceInput[]): { score: number; evidence: RetrievedEvidence[] } {
  if (!rows.length) return { score: 0, evidence: [] }
  const queryEmbedding = createEvidenceEmbedding(jdText); const queryTokens = new Set(tokens(jdText))
  const ranked = rows.slice(0, 64).map((row) => {
    const embedding = row.embedding.length === 192 ? row.embedding : createEvidenceEmbedding(row.content)
    const semantic = Math.max(0, cosine(queryEmbedding, embedding)); const rowTokens = new Set(tokens(row.content))
    const overlap = [...queryTokens].filter((x) => rowTokens.has(x)).length
    const lexical = overlap / Math.max(1, Math.min(queryTokens.size, rowTokens.size))
    const rowSkills = new Set(row.skills.map((x) => x.toLowerCase()))
    const matched = [...jdSkills].filter((x) => rowSkills.has(x.toLowerCase())).sort()
    return { row, matched, score: semantic * .55 + lexical * .25 + matched.length / Math.max(1, jdSkills.size) * .2 }
  }).filter((x) => x.score >= .08).sort((a, b) => b.score - a.score).slice(0, 5)
  const evidence = ranked.map(({ row, matched, score }) => ({ evidence_id: row.id, evidence_type: row.evidence_type, content: row.content.slice(0, 500), skills: row.skills, score: Math.round(score * 100), matched_requirements: matched }))
  const covered = new Set(evidence.flatMap((x) => x.matched_requirements))
  const coverage = jdSkills.size ? covered.size / jdSkills.size : 0; const top = ranked[0]?.score ?? 0
  return { score: Math.max(0, Math.min(100, Math.round((coverage * .6 + Math.min(1, top * 2) * .4) * 100))), evidence }
}

function rejectReasons(jdText: string, filters: HardRejectFilters, title?: string | null): string[] {
  const reasons: string[] = []; const lower = jdText.toLowerCase(); const raw = filters as unknown as Record<string, unknown>
  for (const tech of filters.tech_stack_dealbreakers ?? []) if (lower.includes(tech.toLowerCase())) reasons.push(`Requires ${tech}`)
  for (const type of filters.company_type_excluded ?? []) if (contains(lower, type)) reasons.push(`Excluded company type: ${type}`)
  for (const type of filters.role_type_excluded ?? []) if (contains(lower, type)) reasons.push(`Excluded role type: ${type}`)
  if (filters.title_floor && roleLevel(`${title ?? ''} ${jdText.slice(0, 200)}`) < roleLevel(filters.title_floor)) reasons.push(`Role is below ${filters.title_floor} level`)
  if (filters.geography_allowed?.length) {
    const allowedText = filters.geography_allowed.join(' ').toLowerCase()
    const allowed = new Set(Object.entries(LOCATIONS).filter(([, aliases]) => aliases.some((x) => allowedText.includes(x))).map(([x]) => x))
    const detected = new Set(Object.entries(LOCATIONS).filter(([, aliases]) => aliases.some((x) => contains(lower, x))).map(([x]) => x))
    if (allowed.size && detected.size && ![...detected].some((x) => allowed.has(x)) && !lower.includes('remote')) reasons.push(`Location outside ${filters.geography_allowed.join(', ')}`)
  }
  if (raw.no_contract && ['contract role', 'contract position', 'freelance'].some((x) => lower.includes(x))) reasons.push('Contract role')
  if (raw.no_remote && !lower.includes('remote') && ['on-site', 'onsite', 'in office'].some((x) => lower.includes(x))) reasons.push('Fully on-site role')
  if (raw.requires_clearance && lower.includes('security clearance')) reasons.push('Requires security clearance')
  if (raw.no_visa_sponsorship && ['no sponsorship', 'without sponsorship', 'sponsorship is not available'].some((x) => lower.includes(x))) reasons.push('No visa sponsorship')
  const maxYoe = raw.max_required_yoe
  if (typeof maxYoe === 'number') {
    const years = [...lower.matchAll(/(\d{1,2})\+?\s*years?/g)].map((x) => Number(x[1]))
    if (years.length && Math.max(...years) > maxYoe) reasons.push(`Requires more than ${maxYoe} years of experience`)
  }
  return [...new Set(reasons)]
}

export function scoreJobFast(input: { jdText: string; resumeText: string; filters: HardRejectFilters; jobTitle?: string | null; company?: string | null; evidence: CandidateEvidenceInput[] }): AnalysisResult {
  const jdText = input.jdText.slice(0, 6000); const resumeText = input.resumeText.slice(0, 6000)
  const jdSkills = skills(jdText); const resumeSkills = skills(resumeText); const retrieval = retrieve(jdText, jdSkills, input.evidence)
  const matching = skillsInOrder(new Set([...jdSkills].filter((x) => resumeSkills.has(x))), jdText)
  const missing = skillsInOrder(new Set([...jdSkills].filter((x) => !resumeSkills.has(x))), jdText)
  const keywordScore = Math.round((jdSkills.size ? matching.length / jdSkills.size : .65) * 100)
  const ats = input.evidence.length ? Math.round(keywordScore * .75 + retrieval.score * .25) : keywordScore
  const gap = roleLevel(`${input.jobTitle ?? ''} ${jdText.slice(0, 1200)}`) - roleLevel(resumeText)
  const role = gap <= 0 ? 92 : gap === 1 ? 76 : gap === 2 ? 48 : 25
  const rejects = rejectReasons(jdText, input.filters, input.jobTitle); const composite = rejects.length ? 0 : Math.round(ats * .55 + role * .45)
  const verdict: AnalysisResult['verdict'] = rejects.length ? 'REJECT' : composite >= 70 && role >= 70 ? 'STRONG' : composite >= 50 ? 'DECENT' : 'WEAK'
  const keyword = verdict === 'STRONG' ? 'APPLY' : verdict === 'DECENT' ? 'APPLY IF' : 'SKIP'
  const headline = rejects.length ? `Skip this one. ${rejects[0]}.` : verdict === 'STRONG' ? "This one's worth it. Strong skills and seniority alignment." : verdict === 'DECENT' ? 'Worth a closer look, with a few gaps to verify.' : 'Probably skip. The important requirements do not line up well enough.'
  const gapText = missing.length ? `Missing: ${missing.slice(0, 4).join(', ')}.` : 'No major technology gap found.'
  return { ats_score: ats, role_level_score: role, composite_score: composite, verdict, hard_reject_triggered: !!rejects.length, hard_reject_reasons: rejects, matching_skills: matching.slice(0, 6), missing_skills: missing.slice(0, 6), role_level_assessment: gap <= 0 ? 'Candidate seniority meets or exceeds the role.' : `Role appears ${gap} level${gap === 1 ? '' : 's'} above the resume evidence.`, gap_analysis: gapText, recommendation: `${keyword} — ${headline}`, headline, requirements_met: [...jdSkills].sort().slice(0, 4).map((skill) => { const support = retrieval.evidence.find((x) => x.matched_requirements.includes(skill)); const met = resumeSkills.has(skill) || !!support; return { requirement: skill, status: met ? 'met' as const : 'missing' as const, evidence: support?.content.slice(0, 180) ?? (met ? `Resume mentions ${skill}` : 'None found') } }), soft_concerns: missing.length ? [gapText] : [], rag_score: retrieval.score, retrieved_evidence: retrieval.evidence }
}
