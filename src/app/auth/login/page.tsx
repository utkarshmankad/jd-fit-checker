'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'

type AuthTab = 'signin' | 'signup'

function formatAuthError(raw: string): string {
  const lower = raw.toLowerCase()
  if (lower.includes('rate limit') || lower.includes('email rate') || lower.includes('over_email')) {
    return 'Too many emails sent. Wait a few minutes, then try again.'
  }
  if (lower.includes('invalid login credentials') || lower.includes('invalid credentials')) {
    return 'Wrong email or password.'
  }
  if (lower.includes('email not confirmed')) {
    return 'Email not confirmed — check your inbox for a verification link.'
  }
  return raw
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const [tab, setTab] = useState<AuthTab>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      const isOAuth = (user.app_metadata?.provider ?? 'email') !== 'email'
      const registered = isOAuth || user.user_metadata?.registration_completed === true
      router.replace(registered ? '/dashboard' : '/auth/register')
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const err = searchParams.get('error')
    if (err) setError(decodeURIComponent(err))
  }, [searchParams])

  function switchTab(t: AuthTab) {
    setTab(t)
    setError(null)
    setMagicLinkSent(false)
    setPassword('')
  }

  async function handleGoogleSignIn() {
    setOauthLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/auth/callback' },
    })
    if (error) {
      const msg = formatAuthError(error.message)
      setError(msg)
      toast.error(msg)
      setOauthLoading(false)
    }
  }

  async function handlePasswordSignIn(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !password) return
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) {
      const msg = formatAuthError(error.message)
      setError(msg)
      toast.error(msg)
    } else {
      router.push('/dashboard')
    }
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin + '/auth/callback',
        shouldCreateUser: true,
      },
    })
    setLoading(false)
    if (error) {
      const msg = formatAuthError(error.message)
      setError(msg)
      toast.error(msg)
    } else {
      setMagicLinkSent(true)
    }
  }

  const benefits = [
    'Screen 20 JDs in 60 seconds',
    'ATS score before you apply',
    "Auto-reject roles that don't fit",
  ]

  return (
    <div className="min-h-screen flex">
      {/* Left panel */}
      <div
        className="hidden md:flex md:w-[40%] flex-col justify-between p-10"
        style={{ backgroundColor: '#1B3A5C' }}
      >
        <p className="text-white text-2xl font-bold tracking-tight">JD Fit Checker</p>

        <div className="space-y-8">
          <h2 className="text-white text-3xl font-bold leading-snug">
            Stop reading JDs that waste your time.
          </h2>
          <ul className="space-y-4">
            {benefits.map((b) => (
              <li key={b} className="flex items-center gap-3 text-white/90">
                <svg className="w-5 h-5 text-green-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-base">{b}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-white/50 text-sm">Built by an EM, for EMs</p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-8 bg-white">
        <div className="w-full max-w-sm space-y-7">

          {/* Tab switcher */}
          <div className="flex rounded-lg border border-gray-200 p-1 bg-gray-50">
            <button
              onClick={() => switchTab('signin')}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${
                tab === 'signin'
                  ? 'bg-white shadow-sm text-gray-900'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Sign in
            </button>
            <button
              onClick={() => switchTab('signup')}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${
                tab === 'signup'
                  ? 'bg-white shadow-sm text-gray-900'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Create account
            </button>
          </div>

          {/* Heading */}
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {tab === 'signin' ? 'Welcome back' : 'Get started free'}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {tab === 'signin'
                ? 'Sign in with your email and password.'
                : "Enter your email — we'll send a sign-up link."}
            </p>
          </div>

          <div className="space-y-4">
            {/* Google */}
            <button
              onClick={handleGoogleSignIn}
              disabled={oauthLoading || loading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              {oauthLoading ? 'Redirecting…' : 'Continue with Google'}
            </button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-3 bg-white text-gray-400">or</span>
              </div>
            </div>

            {/* ── SIGN IN: email + password ── */}
            {tab === 'signin' && (
              <form onSubmit={handlePasswordSignIn} className="space-y-3">
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full px-4 py-3 pr-16 rounded-lg border border-gray-300 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={loading || oauthLoading || !email || !password}
                  className="w-full py-3 rounded-lg font-medium text-sm text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  style={{ backgroundColor: '#1B3A5C' }}
                >
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
                <p className="text-center text-xs text-gray-400">
                  Don&apos;t have an account?{' '}
                  <button
                    type="button"
                    onClick={() => switchTab('signup')}
                    className="text-blue-600 hover:underline"
                  >
                    Create one
                  </button>
                </p>
              </form>
            )}

            {/* ── CREATE ACCOUNT: magic link ── */}
            {tab === 'signup' && (
              magicLinkSent ? (
                <div className="rounded-lg bg-green-50 border border-green-200 p-5 text-center space-y-2">
                  <p className="text-green-800 font-semibold text-sm">Check your inbox</p>
                  <p className="text-green-700 text-xs">
                    We sent a sign-up link to <strong>{email}</strong>.
                    Click it to complete your registration.
                  </p>
                  <button
                    type="button"
                    onClick={() => setMagicLinkSent(false)}
                    className="text-xs text-green-600 underline mt-1"
                  >
                    Use a different email
                  </button>
                </div>
              ) : (
                <form onSubmit={handleMagicLink} className="space-y-3">
                  <input
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full px-4 py-3 rounded-lg border border-gray-300 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    type="submit"
                    disabled={loading || oauthLoading || !email}
                    className="w-full py-3 rounded-lg font-medium text-sm text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    style={{ backgroundColor: '#1B3A5C' }}
                  >
                    {loading ? 'Sending…' : 'Send sign-up link'}
                  </button>
                  <p className="text-center text-xs text-gray-400">
                    Already have an account?{' '}
                    <button
                      type="button"
                      onClick={() => switchTab('signin')}
                      className="text-blue-600 hover:underline"
                    >
                      Sign in
                    </button>
                  </p>
                </form>
              )
            )}

            {error && (
              <p className="text-sm text-red-600 text-center">{error}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}
