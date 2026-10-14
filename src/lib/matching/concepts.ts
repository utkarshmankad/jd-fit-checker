// Concept layer for requirement matching.
//
// * Equivalence: aliases are already normalised by the profile extractors
//   (Golang → Go, Postgres → PostgreSQL), so identical concept keys are the same thing.
// * Adjacency: concepts in the same family are *transferable*, never a match —
//   Java experience is relevant to a Go role, but it is not Go experience.
// * Requirement phrasing → capability: wording differs between job descriptions
//   and resumes ("on-call ownership" vs "incident response"), so requirement text is
//   mapped onto the capability vocabulary the candidate profile infers.

export const FAMILIES: Record<string, string[]> = {
  'backend language': ['Java', 'Go', 'C#', '.NET', 'Python', 'Ruby', 'PHP', 'Node.js', 'TypeScript', 'JavaScript'],
  'frontend framework': ['React', 'TypeScript', 'JavaScript', 'Tailwind CSS'],
  'event streaming': ['Kafka', 'Flink'],
  'batch data processing': ['Spark', 'Airflow', 'Databricks', 'Snowflake', 'SQL'],
  'cloud platform': ['AWS', 'GCP', 'Azure'],
  'containers': ['Docker', 'Kubernetes'],
  'relational data': ['PostgreSQL', 'SQL'],
  'datastore': ['PostgreSQL', 'MongoDB', 'Redis', 'Snowflake'],
  'test automation': ['Jest', 'Cypress'],
  'api design': ['REST APIs', 'GraphQL'],
  'infrastructure as code': ['Terraform'],
  'service architecture': ['Microservices', 'Distributed Systems', 'System Design'],
}

/** Families shared by two different concepts (empty when unrelated or identical). */
export function sharedFamilies(a: string, b: string): string[] {
  if (a === b) return []
  return Object.entries(FAMILIES).filter(([, members]) => members.includes(a) && members.includes(b)).map(([family]) => family)
}

/**
 * Requirement text → capability concepts the candidate profile can evidence.
 * Ordered; a requirement can map to several. Kept deliberately narrow: an
 * unmapped requirement stays `unknown` instead of being guessed.
 */
export const REQUIREMENT_CONCEPTS: Array<{ concept: string; kind: 'people_management' | 'manages_managers' | 'technical_leadership' | 'architecture' | 'capability' | 'hands_on'; pattern: RegExp }> = [
  { concept: 'Managing managers', kind: 'manages_managers', pattern: /\b(?:manag(?:e|es|ing)|lead(?:ing)?) (?:\d+ |several |multiple )?(?:engineering )?managers\b|\bmanagers of managers\b/ },
  { concept: 'People Management', kind: 'people_management', pattern: /\b(?:people management|direct reports?|performance (?:reviews?|management)|manag(?:e|ing) (?:an? |the )?(?:[a-z-]+ ){0,2}(?:teams?|engineers|people)|grow(?:ing)? (?:and develop(?:ing)? )?(?:engineers|the team|talent)|career development)\b/ },
  { concept: 'Hiring', kind: 'capability', pattern: /\b(?:hir(?:e|ing)|recruit(?:ing)?)\b/ },
  { concept: 'Technical Leadership', kind: 'technical_leadership', pattern: /\b(?:technical (?:lead(?:ership)?|direction)|tech lead|lead(?:ing)? (?:the )?(?:design|architecture)|design reviews?|mentor(?:ing)?|leading small teams|lead(?:ing)? (?:small )?teams)\b/ },
  { concept: 'System Design', kind: 'architecture', pattern: /\b(?:system design|architect(?:ure|ing)?|distributed systems?|scalable|highly available|high availability)\b/ },
  { concept: 'Cross-team Influence', kind: 'capability', pattern: /\b(?:cross-team|across (?:\d+\+? |multiple |many )?teams|organi[sz]ation-wide|org-wide|influence engineering leadership)\b/ },
  { concept: 'Stakeholder Management', kind: 'capability', pattern: /\b(?:stakeholders?|cross-functional|partner with (?:product|design|business)|executives?)\b/ },
  { concept: 'Incident Response', kind: 'capability', pattern: /\b(?:on-call|incident(?:s| response)?|production support|reliability)\b/ },
  { concept: 'Observability', kind: 'capability', pattern: /\b(?:observability|monitoring|tracing|alerting)\b/ },
  { concept: 'Data Pipelines', kind: 'capability', pattern: /\b(?:data pipelines?|etl|batch and streaming|streaming pipelines?|pipelines?)\b/ },
  { concept: 'Performance Optimization', kind: 'capability', pattern: /\b(?:performance|latency|throughput)\b/ },
  { concept: 'Testing Automation', kind: 'capability', pattern: /\b(?:test automation|automated tests?|testing)\b/ },
  { concept: 'Hands-on Coding', kind: 'hands_on', pattern: /\b(?:hands-on|write (?:production )?code|coding|writing code)\b/ },
]

/** Capabilities that are adjacent but must never be accepted as each other. */
export const NOT_EQUIVALENT: Record<string, string[]> = {
  // Mentoring, technical leadership and "leadership" language are not people management.
  'People Management': ['Mentoring', 'Technical Leadership', 'Leadership'],
}
