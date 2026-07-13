'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'jobsnob-theme'

interface ThemeContextValue {
  mode: ThemeMode
  resolvedMode: 'light' | 'dark'
  setMode: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function applyResolvedMode(resolved: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', resolved === 'dark')
}

function resolveMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Initial value doesn't matter for the flash-of-wrong-theme problem — the
  // inline script in layout.tsx (ThemeScript) already set the class on
  // <html> before hydration. This just needs to agree with it once mounted.
  const [mode, setModeState] = useState<ThemeMode>('system')
  const [resolvedMode, setResolvedMode] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as ThemeMode | null) ?? 'system'
    setModeState(stored)
    setResolvedMode(resolveMode(stored))
  }, [])

  useEffect(() => {
    if (mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      const resolved = resolveMode('system')
      setResolvedMode(resolved)
      applyResolvedMode(resolved)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [mode])

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next)
    localStorage.setItem(STORAGE_KEY, next)
    const resolved = resolveMode(next)
    setResolvedMode(resolved)
    applyResolvedMode(resolved)
  }, [])

  return (
    <ThemeContext.Provider value={{ mode, resolvedMode, setMode }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

// Inlined into <head> (see layout.tsx) and run synchronously before React
// hydrates, so the correct class is already on <html> at first paint — no
// dark-content-flashes-light (or vice versa) frame between page load and
// ThemeProvider's own effect running.
export const THEME_INIT_SCRIPT = `
(function() {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    var mode = stored === 'light' || stored === 'dark' ? stored : 'system';
    var resolved = mode === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : mode;
    if (resolved === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`
