import type { Metadata } from 'next'
import nextDynamic from 'next/dynamic'
import { Suspense } from 'react'
import { getSupabasePublicConfig } from '@/lib/supabase/public-config'

export const metadata: Metadata = {
  title: 'Bentuk Ceritamu — Lakoku',
  description:
    'Pilih cara memulai: cepat dengan pilihan arah cerita, atau tulis ide ceritamu sendiri. Lakoku menyiapkan 3 premis untuk perjalananmu sebagai tokoh utama.',
}

// Needs Supabase public config at request time; skip CF build-time prerender.
export const dynamic = 'force-dynamic'

function MulaiSkeleton() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-background px-5 pb-10 pt-6">
      <header className="flex items-center gap-3">
        <div className="size-10 animate-pulse rounded-full bg-muted" />
        <div className="flex flex-1 items-center gap-1.5">
          <div className="h-1 flex-1 animate-pulse rounded-full bg-muted" />
          <div className="h-1 flex-1 animate-pulse rounded-full bg-muted" />
          <div className="h-1 flex-1 animate-pulse rounded-full bg-muted" />
          <div className="h-1 flex-1 animate-pulse rounded-full bg-muted" />
          <div className="h-1 flex-1 animate-pulse rounded-full bg-muted" />
        </div>
      </header>

      <section className="mt-10 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="h-3 w-36 animate-pulse rounded bg-muted" />
          <div className="h-10 w-full animate-pulse rounded bg-muted" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        </div>
        <div className="flex flex-col gap-3">
          <div className="h-14 animate-pulse rounded-2xl bg-card" />
          <div className="h-14 animate-pulse rounded-2xl bg-card" />
          <div className="h-14 animate-pulse rounded-2xl bg-card" />
          <div className="h-14 animate-pulse rounded-2xl bg-card" />
        </div>
      </section>
    </main>
  )
}

const OnboardingFlow = nextDynamic(
  () => import('@/components/mulai/onboarding-flow').then((mod) => mod.OnboardingFlow),
  { loading: () => <MulaiSkeleton /> },
)

export default function MulaiPage() {
  return (
    <Suspense fallback={<MulaiSkeleton />}>
      <OnboardingFlow supabaseConfig={getSupabasePublicConfig()} />
    </Suspense>
  )
}
