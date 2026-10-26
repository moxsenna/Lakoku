import type { Metadata } from 'next'
import { BrainstormWizard } from '@/components/brainstorm/brainstorm-wizard'

export const metadata: Metadata = {
  title: 'Rancang Cerita Baru — lakoku',
  description: 'Rancang ceritamu perlahan — premis, tokoh, misteri, dan dunia — lalu jalani 50 babnya.',
}

export default function BrainstormPage() {
  return <BrainstormWizard />
}

export const dynamic = 'force-dynamic';
