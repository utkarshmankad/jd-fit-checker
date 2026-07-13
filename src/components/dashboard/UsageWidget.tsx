'use client'

interface UsageWidgetProps {
  tier: 'free' | 'paid'
  effective_is_beta: boolean
  screens_used_total: number
  screens_used_this_week: number
  week_reset_at: string
  referral_bonus_screens: number
  beta_limit: number
  weekly_limit: number
  pricingEnabled: boolean
  onUpgradeClick: () => void
}

function formatResetDate(weekResetAt: string) {
  const d = new Date(weekResetAt)
  d.setDate(d.getDate() + 7)
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })
}

export default function UsageWidget({
  tier,
  effective_is_beta,
  screens_used_total,
  screens_used_this_week,
  week_reset_at,
  referral_bonus_screens,
  beta_limit,
  weekly_limit,
  pricingEnabled,
  onUpgradeClick,
}: UsageWidgetProps) {
  if (tier === 'paid') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border border-green-300 dark:border-green-700">
        ✓ Unlimited judgments
      </span>
    )
  }

  if (effective_is_beta) {
    const effectiveBetaLimit = beta_limit + referral_bonus_screens
    const remaining = Math.max(0, effectiveBetaLimit - screens_used_total)
    const pct = Math.min(100, (screens_used_total / effectiveBetaLimit) * 100)
    const color = remaining === 0 ? 'red' : remaining < 5 ? 'amber' : 'green'
    const colorCls = {
      green: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border-green-300 dark:border-green-700',
      amber: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700',
      red: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 border-red-300 dark:border-red-700',
    }[color]
    const barCls = { green: 'bg-green-500 dark:bg-green-600', amber: 'bg-amber-500 dark:bg-amber-600', red: 'bg-red-500 dark:bg-red-600' }[color]

    return (
      <div className="flex flex-col items-end gap-1.5">
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${colorCls}`}>
          🧪 Beta access · {remaining} of {effectiveBetaLimit} free judgments left
        </span>
        <div className="w-40 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div className={`h-1.5 rounded-full ${barCls} transition-all`} style={{ width: `${pct}%` }} />
        </div>
        {referral_bonus_screens > 0 && (
          <p className="text-xs text-green-600 dark:text-green-400 font-medium">+ {referral_bonus_screens} referral bonus</p>
        )}
        {remaining > 0 && (
          <button
            onClick={() => document.getElementById('referral-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            className="text-xs font-semibold text-blue-600 dark:text-blue-400 underline"
          >
            Refer a friend for +10 more judgments
          </button>
        )}
        {remaining === 0 && (
          pricingEnabled ? (
            <button onClick={onUpgradeClick} className="text-xs font-semibold text-red-600 dark:text-red-400 underline">
              Keep judging →
            </button>
          ) : (
            <a href="/profile" className="text-xs font-semibold text-red-600 dark:text-red-400 underline">
              Add your own API key to keep going →
            </a>
          )
        )}
      </div>
    )
  }

  const effectiveLimit = weekly_limit + referral_bonus_screens
  const remaining = Math.max(0, effectiveLimit - screens_used_this_week)

  return (
    <div className="flex flex-col items-end gap-1">
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600">
        Free · {remaining} judgments this week
      </span>
      <p className="text-xs text-gray-400 dark:text-gray-500">Resets {formatResetDate(week_reset_at)}</p>
      {referral_bonus_screens > 0 && (
        <p className="text-xs text-green-600 dark:text-green-400 font-medium">+ {referral_bonus_screens} referral bonus</p>
      )}
      <button
        onClick={() => document.getElementById('referral-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
        className="text-xs font-semibold text-blue-600 dark:text-blue-400 underline"
      >
        Refer a friend for +10 judgments
      </button>
    </div>
  )
}
