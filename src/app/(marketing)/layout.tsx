import Link from 'next/link'
import { LogoMark } from '@/components/Logo'
import ThemeToggle from '@/components/theme/ThemeToggle'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-gray-950">
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg" style={{ color: '#1B3A5C' }}>
          <LogoMark size={24} />
          JD Fit Checker
        </Link>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link
            href="/auth/login"
            className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: '#1B3A5C' }}
          >
            Sign In
          </Link>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="px-6 py-4 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-center text-sm text-gray-500 dark:text-gray-400">
        Built by Utkarsh Maheshwari · {new Date().getFullYear()}
      </footer>
    </div>
  )
}
