export interface VerdictDisplay {
  label: string
  color: string
  bg: string
  border: string
  icon: string
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
  },
  DECENT: {
    label: 'Worth Applying',
    color: 'text-blue-800',
    bg: 'bg-blue-100',
    border: 'border-blue-300',
    icon: '◉',
  },
  WEAK: {
    label: 'Low Priority',
    color: 'text-gray-600',
    bg: 'bg-gray-100',
    border: 'border-gray-300',
    icon: '○',
  },
  REJECT: {
    label: 'Skip This One',
    color: 'text-red-800',
    bg: 'bg-red-100',
    border: 'border-red-300',
    icon: '✕',
  },
}

const FALLBACK_DISPLAY: VerdictDisplay = {
  label: 'Unknown',
  color: 'text-gray-600',
  bg: 'bg-gray-100',
  border: 'border-gray-300',
  icon: '○',
}

export function getVerdictDisplay(verdict: string): VerdictDisplay {
  return VERDICT_DISPLAY[verdict] ?? FALLBACK_DISPLAY
}

// Convenience for the common "pill" badge className pattern used across the UI.
export function verdictPillClass(verdict: string): string {
  const d = getVerdictDisplay(verdict)
  return `${d.bg} ${d.color} border ${d.border}`
}
