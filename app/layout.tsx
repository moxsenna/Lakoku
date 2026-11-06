import { ReticleDev } from './reticle-dev';
import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { DM_Serif_Display, Plus_Jakarta_Sans } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import { ThemeProvider } from '@/components/theme-provider'
import { FontSizeProvider } from '@/components/font-size-provider'
import { GlobalPendingIndicator } from '@/components/loading/global-pending'
import { PushPrompt } from '@/components/push/push-prompt'
import { AndroidPushBridge } from '@/components/push/android-bridge'
import { AdsenseScript } from '@/components/ads/adsense-script'
import { siteOrigin } from '@/lib/og/site'
import './globals.css'

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
})

const dmSerif = DM_Serif_Display({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-dm-serif',
})

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  title: 'Lakoku — Interactive Fiction / Novel Interaktif',
  description:
    'Lakoku is an interactive fiction web app (novel interaktif). Read branching stories, make choices that change the plot, and save progress with email or Google sign-in.',
  applicationName: 'Lakoku',
  manifest: '/manifest.webmanifest',
  openGraph: {
    type: 'website',
    siteName: 'Lakoku',
    locale: 'id_ID',
  },
  twitter: { card: 'summary_large_image' },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/logo.png', type: 'image/png' },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#191319',
  // Konten memenuhi layar sampai ke notch/gesture bar; jarak aman diatur
  // lewat env(safe-area-inset-*) di navigasi bawah dan shell.
  viewportFit: 'cover',
}

const themeInlineHelper = 'self.__name=self.__name||function(target){return target}'
// Audit BL-4 2026-11-06: tangkap event beforeinstallprompt seawal mungkin di <head>
// sebelum hidrasi React agar deferred prompt tidak terlewat di Chrome mobile.
const pwaEarlyPromptHelper = "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__pwaPrompt=e;});"
const enableVercelAnalytics = process.env.VERCEL === '1'

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="id"
      className={`bg-background ${jakarta.variable} ${dmSerif.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: themeInlineHelper }}
          suppressHydrationWarning
        />
        <script
          dangerouslySetInnerHTML={{ __html: pwaEarlyPromptHelper }}
          suppressHydrationWarning
        />
      </head>
      <body className="font-sans antialiased">{process.env.NODE_ENV === 'development' ? (
        // Audit M14: kredensial dev Reticle disuntik via props dari server
        // (env non-publik, fallback NEXT_PUBLIC_ untuk .env.local lama) —
        // tidak lagi ter-inline di bundle produksi.
        <ReticleDev
          token={process.env.RETICLE_TOKEN || process.env.NEXT_PUBLIC_RETICLE_TOKEN}
          root={process.env.RETICLE_ROOT || process.env.NEXT_PUBLIC_RETICLE_ROOT}
          url={process.env.RETICLE_URL || process.env.NEXT_PUBLIC_RETICLE_URL}
        />
      ) : null}
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <FontSizeProvider>{children}</FontSizeProvider>
          <GlobalPendingIndicator />
          <Toaster position="top-center" />
          <PushPrompt />
          <AndroidPushBridge />
        </ThemeProvider>
        <AdsenseScript />
        {enableVercelAnalytics && <Analytics />}
      </body>
    </html>
  )
}
