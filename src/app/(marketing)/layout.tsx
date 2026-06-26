import Link from 'next/link'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
        <Link href="/" className="font-bold text-lg" style={{ color: '#1B3A5C' }}>
          JD Fit Checker
        </Link>
        <Link
          href="/auth/login"
          className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90"
          style={{ backgroundColor: '#1B3A5C' }}
        >
          Sign In
        </Link>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="px-6 py-4 border-t border-gray-200 bg-white text-center text-sm text-gray-500">
        Built by Utkarsh Maheshwari · {new Date().getFullYear()}
      </footer>
    </div>
  )
}
