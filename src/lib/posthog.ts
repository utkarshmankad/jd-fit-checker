import posthog from 'posthog-js'

let initialized = false

export function initPostHog() {
  if (typeof window === 'undefined' || !process.env.NEXT_PUBLIC_POSTHOG_KEY) return
  // React effects can fire more than once (StrictMode, fast refresh, remounts
  // across client-side navigations that unmount/remount the provider) —
  // posthog.init() itself is idempotent, but this guard avoids re-running
  // the `loaded` callback (and its opt_out_capturing() call below) on every
  // remount for no reason.
  if (initialized) return
  initialized = true

  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com',
    capture_pageview: false, // manual control — see PostHogProvider
    capture_pageleave: true,
    autocapture: false, // manual events only, see src/lib/analytics.ts
    persistence: 'localStorage',
    loaded: (ph) => {
      if (process.env.NODE_ENV === 'development') {
        ph.opt_out_capturing() // no dev noise in production analytics
      }
    },
  })
}

export { posthog }
