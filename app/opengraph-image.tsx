import { OG_SIZE, renderStoryCard } from '@/lib/og/story-card'

export const alt = 'Lakoku — novel interaktif berbahasa Indonesia'
export const size = OG_SIZE
export const contentType = 'image/png'

export default async function Image() {
  return renderStoryCard({
    eyebrow: 'Novel interaktif',
    title: 'Kalau ini ceritamu, apa yang akan kamu lakukan?',
    subtitle: 'Pilihanmu menentukan siapa yang mempercayaimu dan bagaimana semuanya berakhir.',
    highlight: '3 bab pertama gratis',
  })
}
