import { NextResponse } from 'next/server'

async function sha1(str: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** ETag kuat berbasis hash konten JSON (stabil untuk payload immutable). */
export async function makeETag(payload: unknown): Promise<string> {
  const json = JSON.stringify(payload)
  const hash = await sha1(json)
  return `"${hash}"`
}

/**
 * Kembalikan JSON dengan header ETag; bila If-None-Match cocok, balas 304
 * (hemat bandwidth untuk konten reader yang immutable setelah publish).
 */
export async function jsonWithETag(
  req: Request,
  payload: unknown,
  init?: { cacheControl?: string },
): Promise<NextResponse> {
  const etag = await makeETag(payload)
  const inm = req.headers.get('if-none-match')
  const cacheControl = init?.cacheControl ?? 'private, max-age=0, must-revalidate'

  if (inm && inm === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': cacheControl },
    })
  }
  const res = NextResponse.json(payload)
  res.headers.set('ETag', etag)
  res.headers.set('Cache-Control', cacheControl)
  return res
}
