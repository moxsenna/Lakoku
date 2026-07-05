import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'

/** ETag kuat berbasis hash konten JSON (stabil untuk payload immutable). */
export function makeETag(payload: unknown): string {
  const json = JSON.stringify(payload)
  const hash = createHash('sha1').update(json).digest('base64url')
  return `"${hash}"`
}

/**
 * Kembalikan JSON dengan header ETag; bila If-None-Match cocok, balas 304
 * (hemat bandwidth untuk konten reader yang immutable setelah publish).
 */
export function jsonWithETag(
  req: Request,
  payload: unknown,
  init?: { cacheControl?: string },
): NextResponse {
  const etag = makeETag(payload)
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
