import { ImageResponse } from 'next/og'
import { isValidReferralCode } from '@/lib/rewards/policy'
import { siteOrigin } from '@/lib/og/site'

/**
 * Kartu undangan referral 4:5 (1080x1350) untuk dilampirkan ke share sheet.
 *
 * URL absolut dicetak DI DALAM gambar: sebagian aplikasi penerima membuang
 * field `url` saat ada berkas, dan gambar di WhatsApp tidak bisa diklik.
 * Tanpa URL di gambar, share bisa "berhasil" tanpa satu pun kunjungan /r/.
 */
export const dynamic = 'force-dynamic'

const CACHE_CONTROL = 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { code } = await params
  if (!isValidReferralCode(code)) {
    return new Response('Kode referral tidak valid', { status: 400 })
  }

  const inviteCode = code.toUpperCase()
  const displayUrl = `${siteOrigin().replace(/^https?:\/\//, '')}/r/${inviteCode}`

  const image = new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'linear-gradient(165deg, #191319 0%, #3d1f3d 62%, #191319 100%)',
          color: '#fff7ee',
          fontFamily: 'serif',
          padding: '88px 72px',
        }}
      >
        <div style={{ display: 'flex', fontSize: 28, letterSpacing: 10, color: '#d5a45c' }}>
          UNDANGAN MEMBACA
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          <div style={{ display: 'flex', fontSize: 92, lineHeight: 1.1 }}>
            Kamu yang jadi tokoh utamanya.
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 38,
              lineHeight: 1.4,
              color: '#e8dce8',
            }}
          >
            Novel interaktif: pilih jalan ceritamu sendiri. Setiap keputusan mengubah akhir.
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              border: '3px solid #d5a45c',
              borderRadius: 28,
              padding: '36px 40px',
            }}
          >
            <div style={{ display: 'flex', fontSize: 26, letterSpacing: 6, color: '#d5a45c' }}>
              BUKA DI SINI
            </div>
            <div style={{ display: 'flex', fontSize: 46, color: '#fff7ee' }}>{displayUrl}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ display: 'flex', fontSize: 54, color: '#d5a45c' }}>Lakoku</div>
            <div style={{ display: 'flex', fontSize: 28, color: '#96899a' }}>
              50 bab · banyak akhir cerita
            </div>
          </div>
        </div>
      </div>
    ),
    { width: 1080, height: 1350 },
  )

  image.headers.set('cache-control', CACHE_CONTROL)
  return image
}
