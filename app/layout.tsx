import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { DM_Serif_Display, Plus_Jakarta_Sans } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import { ThemeProvider } from '@/components/theme-provider'
import { FontSizeProvider } from '@/components/font-size-provider'
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
  title: 'Lakoku - Novel Interaktif',
  description:
    'Kamu bukan sekadar pembaca. Kamu adalah tokoh utamanya. Masuk ke cerita, ambil keputusan, dan lihat hidup tokohmu berubah karena pilihanmu.',
  generator: 'v0.app',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/logo.webp', type: 'image/webp' },
    ],
    apple: '/logo.webp',
  },
}

export const viewport: Viewport = {
  themeColor: '#191319',
}

const themeInlineHelper = 'self.__name=self.__name||function(target){return target}'
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
      </head>
      <body className="font-sans antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <FontSizeProvider>{children}</FontSizeProvider>
          <Toaster position="top-center" />
        </ThemeProvider>
        {enableVercelAnalytics && <Analytics />}
      </body>
    </html>
  )
}
