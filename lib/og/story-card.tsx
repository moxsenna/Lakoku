import { ImageResponse } from 'next/og'
import { clampText, ogCoverUrl } from './site'

export const OG_SIZE = { width: 1200, height: 630 }

/**
 * Sampul diambil lebih dulu dengan batas waktu agar kartu tetap terbit
 * walau host gambar lambat atau formatnya tidak didukung renderer.
 */
async function loadCover(cover: string | null | undefined): Promise<string | null> {
  const url = ogCoverUrl(cover)
  if (!url) return null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) })
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok || !/image\/(png|jpe?g)/.test(type)) return null
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.byteLength > 4_000_000) return null
    return `data:${type};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

export async function renderStoryCard(input: {
  eyebrow: string
  title: string
  subtitle?: string | null
  highlight?: string | null
  cover?: string | null
}): Promise<ImageResponse> {
  const cover = await loadCover(input.cover)

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: 'linear-gradient(135deg, #191319 0%, #3d1f3d 100%)',
          color: '#fff7ee',
          fontFamily: 'serif',
        }}
      >
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '64px 64px 56px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div
              style={{
                display: 'flex',
                fontSize: 24,
                letterSpacing: 6,
                color: '#d5a45c',
                textTransform: 'uppercase',
              }}
            >
              {input.eyebrow}
            </div>
            <div style={{ display: 'flex', fontSize: 64, lineHeight: 1.1 }}>
              {clampText(input.title, 70)}
            </div>
            {input.subtitle ? (
              <div style={{ display: 'flex', fontSize: 28, lineHeight: 1.4, color: '#e8dce8' }}>
                {clampText(input.subtitle, 140)}
              </div>
            ) : null}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {input.highlight ? (
              <div
                style={{
                  display: 'flex',
                  alignSelf: 'flex-start',
                  fontSize: 30,
                  padding: '12px 24px',
                  borderRadius: 16,
                  border: '2px solid #d5a45c',
                  color: '#d5a45c',
                }}
              >
                {clampText(input.highlight, 50)}
              </div>
            ) : null}
            <div style={{ display: 'flex', fontSize: 26, color: '#c94967' }}>
              Lakoku · Kamu tokoh utamanya
            </div>
          </div>
        </div>
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- ImageResponse hanya menerima <img>
          <img
            src={cover}
            alt=""
            width={420}
            height={630}
            style={{ width: 420, height: 630, objectFit: 'cover' }}
          />
        ) : null}
      </div>
    ),
    OG_SIZE,
  )
}
