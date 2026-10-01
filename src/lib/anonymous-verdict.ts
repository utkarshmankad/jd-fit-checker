export type ProvisionalVerdict = 'STRONG' | 'DECENT' | 'WEAK' | 'REJECT'

export interface AnonymousVerdictInput {
  currentRole: string
  yearsExperience: number
  targetLevel: string
  skills: string
  dealbreaker: string
  jobDescription: string
}

export interface AnonymousVerdictResult {
  verdict: ProvisionalVerdict
  headline: string
  reasons: string[]
  nextStep: string
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ').trim()

const phrases = (value: string) =>
  value
    .split(/[,;\n]/)
    .map((item) => normalize(item))
    .filter((item) => item.length >= 2)

export function calculateAnonymousVerdict(input: AnonymousVerdictInput): AnonymousVerdictResult {
  const jd = normalize(input.jobDescription)
  const skillList = phrases(input.skills)
  const matchedSkills = skillList.filter((skill) => jd.includes(skill))
  const missingSkills = skillList.filter((skill) => !jd.includes(skill))
  const dealbreakers = phrases(input.dealbreaker)
  const matchedDealbreaker = dealbreakers.find((item) => jd.includes(item))
  const target = normalize(input.targetLevel)
  const currentRole = normalize(input.currentRole)
  const levelMatch = target.length > 0 && jd.includes(target)
  const currentRoleMatch = currentRole.length > 0 && jd.includes(currentRole)
  const yearsMatches = [...jd.matchAll(/(\d{1,2})\s*\+?\s*(?:years|yrs)/g)].map((match) => Number(match[1]))
  const requiredYears = yearsMatches.length > 0 ? Math.max(...yearsMatches) : null
  const experienceGap = requiredYears !== null && requiredYears > input.yearsExperience + 2

  if (matchedDealbreaker) {
    return {
      verdict: 'REJECT',
      headline: `Your deal-breaker “${matchedDealbreaker}” appears in this role.`,
      reasons: ['The role conflicts with a condition you said you would not accept.'],
      nextStep: 'Skip this one unless the job description is inaccurate or the condition is negotiable.',
    }
  }

  const matchRatio = skillList.length === 0 ? 0 : matchedSkills.length / skillList.length
  const reasons = [
    matchedSkills.length > 0
      ? `Matched skills: ${matchedSkills.join(', ')}.`
      : 'None of the skills you supplied are clearly named in the description.',
    missingSkills.length > 0 ? `Not clearly evidenced: ${missingSkills.join(', ')}.` : 'All supplied skills are represented.',
    levelMatch ? `The description explicitly references your target level: ${input.targetLevel}.` : `Your target level “${input.targetLevel}” is not explicit.`,
    currentRoleMatch ? `Your current role “${input.currentRole}” is named in the description.` : `Your current role “${input.currentRole}” is not named directly.`,
  ]

  if (experienceGap) {
    reasons.push(`The role appears to ask for ${requiredYears}+ years, above the ${input.yearsExperience} years you entered.`)
  }

  if (matchRatio >= 0.6 && levelMatch && !experienceGap) {
    return {
      verdict: 'STRONG',
      headline: 'This role deserves a closer look.',
      reasons,
      nextStep: 'Validate scope, reporting line and compensation before investing in the application.',
    }
  }

  if (matchRatio >= 0.35 && !experienceGap) {
    return {
      verdict: 'DECENT',
      headline: 'There is enough alignment to investigate.',
      reasons,
      nextStep: 'Confirm the missing skills and role level before tailoring your resume.',
    }
  }

  return {
    verdict: 'WEAK',
    headline: 'This is probably a low-priority application.',
    reasons,
    nextStep: 'Spend time elsewhere unless the missing requirements are optional or the role scope is unusually attractive.',
  }
}
