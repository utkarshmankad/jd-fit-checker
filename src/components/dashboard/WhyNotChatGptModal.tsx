'use client'

import { X } from 'lucide-react'

const POINTS = [
  'Your dealbreakers are saved. ChatGPT forgets between sessions — you\'d have to re-explain your rules every time.',
  'We process 20 JDs at once and rank them. ChatGPT handles one at a time — that\'s 20 separate conversations.',
  'We detect fake EM roles specifically — player-coach roles, IC disguised as management, zero-report EMs. That pattern recognition is built in.',
  'Batch intelligence: after 10 JDs, we tell you which skills are blocking 70% of your pipeline. ChatGPT can\'t see across multiple JDs at once.',
]

export default function WhyNotChatGptModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-xl font-bold text-gray-900">Why not just use ChatGPT?</h2>
          <button onClick={onClose} className="shrink-0 text-gray-400 hover:text-gray-600 transition-colors" title="Close">
            <X size={18} />
          </button>
        </div>
        <ul className="space-y-3">
          {POINTS.map((point, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-gray-600 leading-relaxed">
              <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-gray-300" />
              {point}
            </li>
          ))}
        </ul>
        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  )
}
