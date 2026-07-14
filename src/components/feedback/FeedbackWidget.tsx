'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { MessageSquarePlus, X } from 'lucide-react'
import toast from 'react-hot-toast'

const MAX_MESSAGE_CHARS = 5000

export default function FeedbackWidget() {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const pathname = usePathname()

  async function handleSubmit() {
    const trimmed = message.trim()
    if (!trimmed) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, page: pathname }),
      })
      if (!res.ok) throw new Error('failed')
      toast.success("Thanks — feedback sent, it'll reach a real person.")
      setMessage('')
      setOpen(false)
    } catch {
      toast.error('Could not send feedback. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* Icon-only on mobile — the full pill was wide enough to sit on top of
          page content (e.g. the "See the guide" link) on narrow screens. */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 sm:bottom-5 sm:right-5 z-40 flex items-center gap-2 p-3 sm:px-4 sm:py-2.5 rounded-full text-white text-sm font-semibold shadow-lg hover:opacity-90 transition-opacity"
        style={{ backgroundColor: '#1B3A5C' }}
        aria-label="Send feedback"
      >
        <MessageSquarePlus size={16} />
        <span className="hidden sm:inline">Feedback</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Send feedback</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Bug, idea, or a complaint — goes straight to the person building this.
            </p>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              maxLength={MAX_MESSAGE_CHARS}
              placeholder="What's on your mind?"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <button
              onClick={handleSubmit}
              disabled={submitting || !message.trim()}
              className="w-full py-2.5 rounded-lg font-semibold text-white text-sm disabled:opacity-50 transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#1B3A5C' }}
            >
              {submitting ? 'Sending…' : 'Send feedback'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
