'use client'

import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme, type ThemeMode } from './ThemeProvider'

const OPTIONS: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: 'light', label: 'Light', icon: Sun },
  { mode: 'dark', label: 'Dark', icon: Moon },
  { mode: 'system', label: 'System', icon: Monitor },
]

interface ThemeToggleProps {
  variant?: 'light' | 'dark'
}

// variant controls the toggle's OWN chrome color, independent of the
// resolved site theme — used on the navy sidebar (variant="dark", needs
// light icons/text on a dark background) vs. everywhere else on a white/
// surface background (variant="light", the default).
export default function ThemeToggle({ variant = 'light' }: ThemeToggleProps) {
  const { mode, setMode } = useTheme()

  const trackCls = variant === 'dark' ? 'bg-white/10' : 'bg-gray-100 dark:bg-gray-800'
  const activeCls = variant === 'dark' ? 'bg-white/20 text-white' : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
  const inactiveCls = variant === 'dark' ? 'text-white/50 hover:text-white/80' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'

  return (
    <div className={`inline-flex items-center gap-0.5 p-0.5 rounded-lg ${trackCls}`}>
      {OPTIONS.map(({ mode: optionMode, label, icon: Icon }) => (
        <button
          key={optionMode}
          type="button"
          onClick={() => setMode(optionMode)}
          title={label}
          aria-label={`${label} theme`}
          aria-pressed={mode === optionMode}
          className={`flex items-center justify-center p-1.5 rounded-md transition-colors ${mode === optionMode ? activeCls : inactiveCls}`}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  )
}
