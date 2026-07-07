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
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-green-100 text-green-800 border border-green-300">
        ✓ Active Search · Unlimited
      </span>
    )
  }

  if (effective_is_beta) {
    const remaining = Math.max(0, beta_limit - screens_used_total)
    const pct = Math.min(100, (screens_used_total / beta_limit) * 100)
    const color = remaining === 0 ? 'red' : remaining < 5 ? 'amber' : 'green'
    const colorCls = {
      green: 'bg-green-100 text-green-800 border-green-300',
      amber: 'bg-amber-100 text-amber-800 border-amber-300',
      red: 'bg-red-100 text-red-800 border-red-300',
    }[color]
    const barCls = { green: 'bg-green-500', amber: 'bg-amber-500', red: 'bg-red-500' }[color]

    return (
      <div className="flex flex-col items-end gap-1.5">
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${colorCls}`}>
          🧪 Beta access · {remaining} of {beta_limit} free scans left
        </span>
        <div className="w-40 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div className={`h-1.5 rounded-full ${barCls} transition-all`} style={{ width: `${pct}%` }} />
        </div>
        {remaining === 0 && (
          pricingEnabled ? (
            <button onClick={onUpgradeClick} className="text-xs font-semibold text-red-600 underline">
              Upgrade to Active Search →
            </button>
          ) : (
            <a href="/profile" className="text-xs font-semibold text-red-600 underline">
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
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-700 border border-gray-300">
        Free · {remaining} screens this week
      </span>
      <p className="text-xs text-gray-400">Resets {formatResetDate(week_reset_at)}</p>
      {referral_bonus_screens > 0 && (
        <p className="text-xs text-green-600 font-medium">+ {referral_bonus_screens} referral bonus</p>
      )}
      {pricingEnabled && (
        <button
          onClick={() => document.getElementById('referral-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          className="text-xs font-semibold text-blue-600 underline"
        >
          Refer a friend for +10 screens
        </button>
      )}
    </div>
  )
}
