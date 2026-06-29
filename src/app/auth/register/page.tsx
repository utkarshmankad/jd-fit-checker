'use client'

import dynamic from 'next/dynamic'

// ssr: false prevents createBrowserClient from running during prerender
// (which throws when NEXT_PUBLIC_SUPABASE_URL is a placeholder at build time)
const RegisterForm = dynamic(() => import('./_form'), { ssr: false })

export default function RegisterPage() {
  return <RegisterForm />
}
