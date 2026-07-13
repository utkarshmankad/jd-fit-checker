export interface VerdictDisplay {
  label: string
  color: string
  bg: string
  border: string
  icon: string
  /** Hero-element verdict line for the card design — a judgment, not a label. */
  verdictLine: string
  /** Hex for the card's 4px left border, distinct from the Tailwind classes above. */
  barColor: string
}

// UI-facing display mapping. Database/API values (STRONG/DECENT/WEAK/REJECT)
// are unchanged — this only controls what the user reads. Advisory framing:
// software suggests, the user decides. Never "Apply"/"Skip" as bare commands.
const VERDICT_DISPLAY: Record<string, VerdictDisplay> = {
  STRONG: {
    label: 'Excellent Match',
    color: 'text-green-800',
    bg: 'bg-green-100',
    border: 'border-green-300',
    icon: '✦',
    verdictLine: "This one's worth it.",
    barColor: '#16A34A',
  },
  DECENT: {
    label: 'Worth Applying',
    color: 'text-blue-800',
    bg: 'bg-blue-100',
    border: 'border-blue-300',
    icon: '◉',
    verdictLine: 'Probably worth a look.',
    barColor: '#2E75B6',
  },
  WEAK: {
    label: 'Low Priority',
    color: 'text-gray-600',
    bg: 'bg-gray-100',
    border: 'border-gray-300',
    icon: '○',
    verdictLine: 'Probably not.',
    barColor: '#9CA3AF',
  },
  REJECT: {
    label: 'Skip This One',
    color: 'text-red-800',
    bg: 'bg-red-100',
    border: 'border-red-300',
    icon: '✕',
    verdictLine: 'Skip this one.',
    barColor: '#DC2626',
  },
}

const FALLBACK_DISPLAY: VerdictDisplay = {
  label: 'Unknown',
  color: 'text-gray-600',
  bg: 'bg-gray-100',
  border: 'border-gray-300',
  icon: '○',
  verdictLine: 'Unclear.',
  barColor: '#9CA3AF',
}

export function getVerdictDisplay(verdict: string): VerdictDisplay {
  return VERDICT_DISPLAY[verdict] ?? FALLBACK_DISPLAY
}

// Convenience for the common "pill" badge className pattern used across the UI.
export function verdictPillClass(verdict: string): string {
  const d = getVerdictDisplay(verdict)
  return `${d.bg} ${d.color} border ${d.border}`
}
