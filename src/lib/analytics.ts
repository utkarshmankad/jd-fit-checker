import { posthog } from '@/lib/posthog'

// Typed event tracking — every PostHog capture() call in the app should go
// through one of these instead of calling posthog.capture() directly, so
// event names and payload shapes stay consistent (and greppable) across
// call sites instead of drifting per-component.
export const track = {
  // Profile setup
  profilePageViewed: () => posthog.capture('profile_page_viewed'),

  resumeUploaded: (wordCount: number) => posthog.capture('resume_uploaded', { word_count: wordCount }),

  filtersConfigured: (filterCount: number) => posthog.capture('filters_configured', { filter_count: filterCount }),

  profileCompleted: () => posthog.capture('profile_completed'),

  // Screening funnel (the most important events)
  dashboardViewed: (hasHistory: boolean) => posthog.capture('dashboard_viewed', { has_history: hasHistory }),

  urlsPasted: (urlCount: number) => posthog.capture('urls_pasted', { url_count: urlCount }),

  screeningStarted: (urlCount: number, inputType: 'url' | 'paste') =>
    posthog.capture('screening_started', { url_count: urlCount, input_type: inputType }),

  screeningCompleted: (urlCount: number, rejectedCount: number, durationMs: number) =>
    posthog.capture('screening_completed', {
      url_count: urlCount,
      rejected_count: rejectedCount,
      passed_count: urlCount - rejectedCount,
      duration_ms: durationMs,
      time_saved_minutes: rejectedCount * 12,
    }),

  screeningFailed: (error: string, urlCount: number) => posthog.capture('screening_failed', { error, url_count: urlCount }),

  // Result interaction
  resultExpanded: (verdict: string, company: string) => posthog.capture('result_expanded', { verdict, company }),

  csvExported: (resultCount: number) => posthog.capture('csv_exported', { result_count: resultCount }),

  shareCreated: () => posthog.capture('share_link_created'),

  // Upgrade funnel
  upgradeModalOpened: (trigger: string) => posthog.capture('upgrade_modal_opened', { trigger }),

  paymentStarted: () => posthog.capture('payment_started'),

  paymentCompleted: () => posthog.capture('payment_completed'),

  // Drop-off signals
  screeningAbandoned: (step: string) => posthog.capture('screening_abandoned', { step }),
}
