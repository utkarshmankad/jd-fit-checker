'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { track } from '@/lib/analytics'
import { initPostHog } from '@/lib/posthog'

export default function DemoActions() {
  const viewed = useRef(false)

  useEffect(() => {
    initPostHog()
    if (!viewed.current) {
      viewed.current = true
      track.demoViewed()
    }
  }, [])

  return (
    <Link href="/auth/login" onClick={() => track.demoSignInClicked()}
      className="inline-block rounded-xl bg-[#1B3A5C] px-6 py-3 font-semibold text-white hover:opacity-90">
      Sign in to screen your own jobs →
    </Link>
  )
}
