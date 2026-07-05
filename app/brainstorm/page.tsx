import type { Metadata } from 'next'
import { BrainstormWizard } from '@/components/brainstorm/brainstorm-wizard'

export const metadata: Metadata = {
  title: 'Rancang Cerita Baru — lakoku',
  description: 'Ber-brainstorm dengan AI untuk merancang story bible 50 bab, lalu kunci ke canon.',
}

export default function BrainstormPage() {
  return <BrainstormWizard />
}
