import type { Metadata } from 'next'
import { Suspense } from 'react'
import { TasteProfileFlow } from '@/components/onboarding/taste-profile-flow'
import SeleraLoading from './loading'

export const metadata: Metadata = {
  title: 'Atur Selera Cerita — Lakoku',
  description:
    'Pilih genre, gaya bahasa, dan batas cerita yang kamu suka. Lakoku akan memakai ini sebagai arah awal saat membuat cerita baru.',
}

export const dynamic = 'force-dynamic'

export default function SeleraPage() {
  return (
    <Suspense fallback={<SeleraLoading />}>
      <TasteProfileFlow />
    </Suspense>
  )
}
