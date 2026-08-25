'use client'

import { useEffect, useRef } from 'react'

const ACTIVE_HEARTBEAT_MS = 8 * 60 * 1000

export default function RenderWakeManager() {
  const lastWake = useRef(0)
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastWake.current < 60_000) return
      lastWake.current = Date.now()
      void fetch('/api/screen/wake', { method: 'POST', keepalive: true }).catch(() => undefined)
    }
    wake()
    const timer = window.setInterval(wake, ACTIVE_HEARTBEAT_MS)
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', wake); window.removeEventListener('focus', wake) }
  }, [])
  return null
}
