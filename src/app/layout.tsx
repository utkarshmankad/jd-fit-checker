import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { Toaster } from 'react-hot-toast'
import { ThemeProvider, THEME_INIT_SCRIPT } from '@/components/theme/ThemeProvider'
import { DevBanner } from '@/components/DevBanner'
import { PostHogProvider } from '@/components/PostHogProvider'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: 'JobSnob',
  description: 'Instantly evaluate whether a job description is worth applying for.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Runs before hydration so the right theme class is already on
            <html> at first paint — avoids a flash of the wrong theme. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-surface text-foreground">
        <ThemeProvider>
          <PostHogProvider>
            {children}
            <Toaster position="top-right" />
          </PostHogProvider>
        </ThemeProvider>
        <DevBanner />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
