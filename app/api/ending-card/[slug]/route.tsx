import { ImageResponse } from 'next/og'
import { getShareBySlug } from '@/lib/api/share'
import { clampText } from '@/lib/og/site'

/**
 * Kartu akhir 9:16 (1080x1920) untuk status/di story sosial — dirender dari
 * teaser share yang memang publik. Tanpa sesi, tanpa data privat.
 */
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params
  const share = await getShareBySlug(slug).catch(() => null)
  if (!share) {
    return new Response('Tidak ditemukan', { status: 404 })
  }
  const t = share.teaser
  const ending = t.endingName ?? 'Akhir Cerita'

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'linear-gradient(160deg, #191319 0%, #3d1f3d 70%, #191319 100%)',
          color: '#fff7ee',
          fontFamily: 'serif',
          padding: '96px 72px',
        }}
      >
        <div style={{ display: 'flex', fontSize: 30, letterSpacing: 8, color: '#d5a45c' }}>
          ENDING CARD
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
          <div style={{ display: 'flex', fontSize: 76, lineHeight: 1.15 }}>
            {clampText(t.title, 60)}
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 20,
              border: '3px solid #d5a45c',
              borderRadius: 28,
              padding: '40px 36px',
            }}
          >
            <div style={{ display: 'flex', fontSize: 30, color: '#d5a45c', letterSpacing: 4 }}>
              AKHIR YANG DICAPAI
            </div>
            <div style={{ display: 'flex', fontSize: 88, lineHeight: 1.1, color: '#d5a45c' }}>
              {clampText(ending, 40)}
            </div>
          </div>
          {t.bigChoices.length > 0 ? (
            <div style={{ display: 'flex', fontSize: 32, lineHeight: 1.5, color: '#e8dce8' }}>
              {clampText(t.bigChoices.slice(0, 2).join(' · '), 120)}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', fontSize: 40, color: '#c94967' }}>
            Kamu akan memilih jalan yang sama?
          </div>
          <div style={{ display: 'flex', fontSize: 32, color: '#96899a' }}>
            lakoku.biz.id
          </div>
        </div>
      </div>
    ),
    { width: 1080, height: 1920 },
  )
}
