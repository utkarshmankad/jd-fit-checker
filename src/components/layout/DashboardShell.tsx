'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { FileSearch, History, User, LogOut, Menu, X, BookOpen, Briefcase } from 'lucide-react'

const navLinks = [
  { href: '/dashboard', label: 'Screen JDs', icon: FileSearch },
  { href: '/dashboard/history', label: 'History', icon: History },
  { href: '/dashboard/tracker', label: 'Tracker', icon: Briefcase },
  { href: '/dashboard/guide', label: 'How to use', icon: BookOpen },
  { href: '/profile', label: 'Profile', icon: User },
]

interface DashboardShellProps {
  children: React.ReactNode
  userEmail: string
  isNewUser?: boolean
}

export default function DashboardShell({ children, userEmail, isNewUser }: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    if (isNewUser && pathname === '/dashboard') {
      router.replace('/profile?onboarding=true')
    }
  }, [isNewUser, pathname, router])

  return (
    <div className="min-h-screen flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-30 w-60 flex flex-col transition-transform duration-200',
          'md:relative md:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
        style={{ backgroundColor: '#1B3A5C' }}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-white/10">
          <span className="text-white font-bold text-lg tracking-tight">JD Fit Checker</span>
          <button
            className="md:hidden text-white/70 hover:text-white"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navLinks.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setSidebarOpen(false)}
                className={[
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  active
                    ? 'bg-white/20 text-white'
                    : 'text-white/70 hover:bg-white/10 hover:text-white',
                ].join(' ')}
              >
                <Icon size={18} />
                {label}
              </Link>
            )
          })}
        </nav>

        {/* Bottom: user + sign out */}
        <div className="px-3 py-4 border-t border-white/10 space-y-2">
          <p className="px-3 text-xs text-white/40 truncate">{userEmail}</p>
          <form action="/auth/logout" method="POST">
            <button
              type="submit"
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white transition-colors"
            >
              <LogOut size={18} />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-gray-600 hover:text-gray-900"
          >
            <Menu size={22} />
          </button>
          <span className="font-semibold text-gray-900">JD Fit Checker</span>
        </header>

        <main className="flex-1 bg-surface p-4 md:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  )
}
