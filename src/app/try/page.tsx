import type { Metadata } from 'next'
import Link from 'next/link'
import AnonymousVerdictExperiment from '@/components/AnonymousVerdictExperiment'

export const metadata: Metadata = {
  title: 'Try one job without signing in | JobSnob',
  description: 'Paste one job description and get a provisional JobSnob verdict without creating an account or uploading a resume.',
}

export default function TryPage() {
  return (
    <main className="min-h-screen bg-[#F8FAFC] px-4 py-8 text-gray-900 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <Link href="/" className="text-sm font-semibold text-[#1B3A5C] underline underline-offset-4">← JobSnob home</Link>
        <header className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-wide text-[#2E75B6]">Anonymous first verdict</p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Paste one job. Decide if it deserves your time.</h1>
          <p className="max-w-2xl text-gray-600">No account and no resume upload. Answer five quick questions for an instant, provisional verdict.</p>
        </header>
        <AnonymousVerdictExperiment />
      </div>
    </main>
  )
}
