'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'

export default function RegisterPage() {
  const router = useRouter()
  const supabase = createClient()

  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    async function checkSession() {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        router.replace('/auth/login')
        return
      }
      if (user.user_metadata?.registration_completed === true) {
        router.replace('/dashboard')
        return
      }

      setEmail(user.email ?? '')
      // Pre-fill name if available (e.g. from Google)
      setFullName(user.user_metadata?.full_name ?? '')
      setChecking(false)
    }

    checkSession()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!fullName.trim()) {
      toast.error('Enter your full name')
      return
    }
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    if (password !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    setLoading(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
        data: { full_name: fullName.trim(), registration_completed: true },
      })
      if (updateError) throw updateError

      // Sync full_name into the profiles table
      const profileRes = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: fullName.trim() }),
      })
      if (!profileRes.ok) {
        const { error } = (await profileRes.json()) as { error: string }
        throw new Error(error)
      }

      toast.success('Account created! Welcome to JD Fit Checker.')
      router.push('/dashboard')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
      </div>
    )
  }

  const isValid = fullName.trim() && password.length >= 8 && password === confirmPassword

  return (
    <div className="min-h-screen flex">
      {/* Left panel */}
      <div
        className="hidden md:flex md:w-[40%] flex-col justify-between p-10"
        style={{ backgroundColor: '#1B3A5C' }}
      >
        <p className="text-white text-2xl font-bold tracking-tight">JD Fit Checker</p>

        <div className="space-y-6">
          <h2 className="text-white text-3xl font-bold leading-snug">
            One more step to get started
          </h2>
          <p className="text-white/70 text-base">
            Set a password so you can sign in quickly next time — no email link needed.
          </p>
          <ul className="space-y-3">
            {[
              'Screen 20 JDs in 60 seconds',
              'ATS score before you apply',
              'Auto-reject roles that don\'t fit',
            ].map((t) => (
              <li key={t} className="flex items-center gap-3 text-white/80 text-sm">
                <svg className="w-4 h-4 text-green-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {t}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-white/50 text-sm">Built by an EM, for EMs</p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-8 bg-white">
        <div className="w-full max-w-sm space-y-8">
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Create your account</h1>
            <p className="text-sm text-gray-500 mt-1">
              Signed in as{' '}
              <span className="font-medium text-gray-700">{email}</span>
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Full name */}
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">
                Full name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Smith"
                required
                autoFocus
                className="w-full px-4 py-3 rounded-lg border border-gray-300 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Email (read-only) */}
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Email</label>
              <input
                type="email"
                value={email}
                readOnly
                className="w-full px-4 py-3 rounded-lg border border-gray-200 text-sm text-gray-500 bg-gray-50 cursor-not-allowed"
              />
            </div>

            {/* Password */}
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">
                Password <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  minLength={8}
                  className="w-full px-4 py-3 pr-10 rounded-lg border border-gray-300 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {password && password.length < 8 && (
                <p className="text-xs text-red-500">Too short — need at least 8 characters</p>
              )}
            </div>

            {/* Confirm password */}
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">
                Confirm password <span className="text-red-500">*</span>
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
                required
                className="w-full px-4 py-3 rounded-lg border border-gray-300 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              {confirmPassword && password !== confirmPassword && (
                <p className="text-xs text-red-500">Passwords don&apos;t match</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !isValid}
              className="w-full py-3 rounded-lg font-medium text-sm text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#1B3A5C' }}
            >
              {loading ? 'Creating account…' : 'Create account & continue'}
            </button>
          </form>

          <p className="text-center text-xs text-gray-400">
            By creating an account you agree to our terms of service.
          </p>
        </div>
      </div>
    </div>
  )
}
