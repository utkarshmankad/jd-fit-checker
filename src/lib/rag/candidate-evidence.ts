import { createHash } from 'node:crypto'

export const EVIDENCE_EMBEDDING_DIMENSIONS = 192
const MAX_CHUNKS = 64
const MAX_CHUNK_CHARS = 900

export type CandidateEvidenceInput = {
  id?: string
  evidence_type: string
  content: string
  skills: string[]
  embedding: number[]
  metadata?: Record<string, unknown>
}

export type CandidateEvidenceInsert = CandidateEvidenceInput & {
  user_id: string
  source_hash: string
  chunk_index: number
}

type ParsedProfileEvidence = {
  preferred_tech_stack?: string[]
  target_industries?: string[]
  title_floor?: string
  geography_allowed?: string[]
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have',
  'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'were',
  'will', 'with', 'your', 'you', 'our', 'their', 'using', 'work', 'worked',
])

const KNOWN_SKILLS = [
  'React', 'Node.js', 'TypeScript', 'JavaScript', 'Python', 'Java', 'C#', 'PHP',
  'Go', 'Ruby', 'AWS', 'GCP', 'Azure', 'Docker', 'Kubernetes', 'PostgreSQL',
  'MongoDB', 'Redis', 'GraphQL', 'REST APIs', 'Microservices', 'CI/CD', 'Jest',
  'Cypress', 'Tailwind CSS', 'System Design', 'Leadership', 'Kafka', 'Flink',
  'Spark', 'Airflow', 'Terraform', 'Databricks', 'Snowflake', 'Machine Learning',
]

const SKILL_ALIASES: Record<string, string[]> = {
  'Node.js': ['node.js', 'nodejs', 'node js'],
  'C#': ['c#', 'c sharp', '.net'],
  'AWS': ['aws', 'amazon web services'],
  'GCP': ['gcp', 'google cloud'],
  'Kubernetes': ['kubernetes', 'k8s'],
  'PostgreSQL': ['postgresql', 'postgres'],
  'REST APIs': ['rest api', 'restful', 'api design'],
  'Microservices': ['microservices', 'micro-services'],
  'CI/CD': ['ci/cd', 'continuous integration', 'github actions'],
  'System Design': ['system design', 'distributed systems', 'architecture'],
  'Leadership': ['technical leadership', 'engineering leadership', 'mentoring', 'coaching'],
  'Machine Learning': ['machine learning', 'ml engineering', 'applied ai'],
}

function tokenise(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9+#.]{2,}/g) ?? [])
    .filter((token) => !STOP_WORDS.has(token))
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

export function createEvidenceEmbedding(text: string): number[] {
  const vector = new Array<number>(EVIDENCE_EMBEDDING_DIMENSIONS).fill(0)
  const tokens = tokenise(text)
  const features = [...tokens]
  for (let i = 0; i + 1 < tokens.length; i++) features.push(`${tokens[i]}::${tokens[i + 1]}`)

  for (const feature of features) {
    const hash = fnv1a(feature)
    const index = hash % EVIDENCE_EMBEDDING_DIMENSIONS
    vector[index] += (hash & 0x80000000) === 0 ? 1 : -1
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1
  return vector.map((value) => Number((value / norm).toFixed(6)))
}

function containsPhrase(text: string, phrase: string): boolean {
  const escaped = phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(text.toLowerCase())
}

function extractSkills(text: string, preferred: string[]): string[] {
  const candidates = [...new Set([...KNOWN_SKILLS, ...preferred.filter(Boolean)])]
  return candidates.filter((skill) => {
    const aliases = SKILL_ALIASES[skill] ?? [skill.toLowerCase()]
    return aliases.some((alias) => containsPhrase(text, alias))
  })
}

function evidenceType(text: string): string {
  const lower = text.toLowerCase()
  if (/\b(project|built|implemented|developed|designed|launched|migrated)\b/.test(lower)) return 'achievement'
  if (/\b(education|university|college|bachelor|master|degree|certification)\b/.test(lower)) return 'education'
  if (/\b(skill|technology|tech stack|proficient|expertise)\b/.test(lower)) return 'skills'
  if (/\b(manager|engineer|architect|developer|lead|director|company|experience)\b/.test(lower)) return 'experience'
  return 'other'
}

function resumeChunks(resumeText: string): string[] {
  const blocks = resumeText
    .replace(/\r/g, '')
    .split(/\n\s*\n|(?=\n\s*[•●▪*-]\s+)/)
    .map((block) => block.replace(/\s+/g, ' ').replace(/^[•●▪*-]\s*/, '').trim())
    .filter((block) => block.length >= 30)

  const chunks: string[] = []
  for (const block of blocks) {
    if (block.length <= MAX_CHUNK_CHARS) {
      chunks.push(block)
      continue
    }
    const sentences = block.split(/(?<=[.!?])\s+/)
    let current = ''
    for (const sentence of sentences) {
      if (current && `${current} ${sentence}`.length > MAX_CHUNK_CHARS) {
        chunks.push(current)
        current = sentence
      } else {
        current = current ? `${current} ${sentence}` : sentence
      }
    }
    if (current) chunks.push(current)
  }
  return chunks.slice(0, MAX_CHUNKS)
}

export function buildCandidateEvidence(
  userId: string,
  resumeText: string,
  parsed: ParsedProfileEvidence = {}
): CandidateEvidenceInsert[] {
  const sourceHash = createHash('sha256').update(resumeText).digest('hex')
  const preferredSkills = parsed.preferred_tech_stack ?? []
  const summaryParts = [
    parsed.title_floor ? `Candidate seniority: ${parsed.title_floor}.` : '',
    preferredSkills.length ? `Core skills: ${preferredSkills.join(', ')}.` : '',
    parsed.target_industries?.length ? `Industry experience: ${parsed.target_industries.join(', ')}.` : '',
    parsed.geography_allowed?.length ? `Geography: ${parsed.geography_allowed.join(', ')}.` : '',
  ].filter(Boolean)

  const chunks = resumeChunks(resumeText)
  if (summaryParts.length) chunks.unshift(summaryParts.join(' '))

  return chunks.slice(0, MAX_CHUNKS).map((content, chunkIndex) => ({
    user_id: userId,
    source_hash: sourceHash,
    chunk_index: chunkIndex,
    evidence_type: chunkIndex === 0 && summaryParts.length ? 'summary' : evidenceType(content),
    content,
    skills: extractSkills(content, preferredSkills),
    embedding: createEvidenceEmbedding(content),
    metadata: { source: 'resume', version: 1 },
  }))
}

