'use client'

import { Suspense, useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { initPostHog, posthog } from '@/lib/posthog'

function PageviewTracker() {
  // useSearchParams forces this subtree to client-render past the nearest
  // Suspense boundary (see Next.js docs on useSearchParams + prerendering)
  // — isolated into its own leaf component, wrapped in Suspense by the
  // exported PostHogProvider below, so that de-opt doesn't spread to
  // `children` (the entire app) which would otherwise lose prerendering.
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    initPostHog()
  }, [])

  useEffect(() => {
    if (!pathname) return
    posthog.capture('$pageview', {
      $current_url: window.location.href,
    })
    // searchParams is read only via window.location.href above, but it's
    // still a dependency here — a search-param-only navigation (e.g.
    // /profile -> /profile?onboarding=true) doesn't change pathname, and
    // without this the pageview for that navigation would never fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams])

  return null
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <PageviewTracker />
      </Suspense>
      {children}
    </>
  )
}
