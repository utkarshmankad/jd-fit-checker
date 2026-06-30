'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

function loadCheckoutScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && window.Razorpay) {
      resolve(true)
      return
    }
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.onload = () => resolve(true)
    script.onerror = () => resolve(false)
    document.body.appendChild(script)
  })
}

export default function PaymentModal({ isOpen, onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState(false)
  const [userInfo, setUserInfo] = useState<{ email: string; name: string } | null>(null)

  useEffect(() => {
    if (!isOpen) return
    async function loadUser() {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single()
      setUserInfo({ email: user.email ?? '', name: (profile?.full_name as string) ?? '' })
    }
    loadUser()
  }, [isOpen])

  const handlePay = useCallback(async () => {
    setLoading(true)
    try {
      const loaded = await loadCheckoutScript()
      if (!loaded) {
        toast.error('Could not load payment SDK. Check your connection.')
        return
      }

      const orderRes = await fetch('/api/payment/create-order', { method: 'POST' })
      if (!orderRes.ok) {
        const err = (await orderRes.json()) as { error?: string }
        toast.error(err.error ?? 'Could not create order')
        return
      }
      const order = (await orderRes.json()) as {
        order_id: string
        amount: number
        currency: string
        key_id: string
      }

      const rzp = new window.Razorpay({
        key: order.key_id,
        order_id: order.order_id,
        amount: order.amount,
        currency: order.currency,
        name: 'JD Fit Checker',
        description: 'Monthly subscription — unlimited screens',
        prefill: {
          email: userInfo?.email ?? '',
          name: userInfo?.name ?? '',
        },
        theme: { color: '#1B3A5C' },
        modal: { ondismiss: () => setLoading(false) },
        handler: async (response) => {
          try {
            const verify = await fetch('/api/payment/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(response),
            })
            if (verify.ok) {
              onSuccess()
              onClose()
              toast.success('Upgraded! Unlimited rejections unlocked.')
            } else {
              toast.error('Payment verification failed. Contact support.')
            }
          } catch {
            toast.error('Payment verification failed. Contact support.')
          } finally {
            setLoading(false)
          }
        },
      })

      rzp.open()
    } catch {
      toast.error('Something went wrong. Please try again.')
      setLoading(false)
    }
  }, [userInfo, onSuccess, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-5">
        <div className="text-center">
          <h2 className="text-xl font-bold text-gray-900">Keep rejecting unlimited jobs</h2>
          <p className="text-gray-500 text-sm mt-1">
            You&apos;ve used your 5 free batches. Upgrade once for unlimited rejections — no monthly subscription.
          </p>
        </div>

        {/* Feature list */}
        <ul className="space-y-2 text-sm text-gray-700">
          {[
            'Unlimited batch screenings, forever',
            'Full gap analysis + requirements check',
            'CSV export & shareable report links',
            'Priority support',
          ].map((f) => (
            <li key={f} className="flex items-center gap-2">
              <span className="text-green-500 font-bold">✓</span>
              {f}
            </li>
          ))}
        </ul>

        {/* Price */}
        <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 text-center">
          <span className="text-3xl font-bold text-gray-900">₹499</span>
          <span className="text-gray-500 text-sm"> one-time</span>
        </div>

        <button
          onClick={handlePay}
          disabled={loading}
          className="w-full py-3 rounded-xl font-semibold text-white text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          style={{ backgroundColor: '#1B3A5C' }}
        >
          {loading ? 'Opening payment...' : 'Unlock unlimited rejections →'}
        </button>

        <button
          onClick={onClose}
          className="w-full text-center text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
