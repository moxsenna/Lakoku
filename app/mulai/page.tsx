import type { Metadata } from 'next'
import { OnboardingFlow } from '@/components/mulai/onboarding-flow'
import { getSupabasePublicConfig } from '@/lib/supabase/public-config'

export const metadata: Metadata = {
  title: 'Pilih Peranmu — Lakoku',
  description:
    'Jawab beberapa pertanyaan singkat, pilih satu dari tiga cerita yang disiapkan untukmu, dan mulai perjalananmu sebagai tokoh utama.',
}

export default function MulaiPage() {
  return <OnboardingFlow supabaseConfig={getSupabasePublicConfig()} />
}

export const dynamic = 'force-dynamic';
