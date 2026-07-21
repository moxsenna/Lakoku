import type { NextRequest } from 'next/server'

/**
 * Public browser origin for redirects after auth.
 * Behind Caddy/Docker, request.nextUrl.origin can be https://0.0.0.0:5200
 * (container bind address). Prefer forwarded headers, then env site URL.
 */
export function getPublicOrigin(request: NextRequest): string {
  const forwardedHost = firstHeader(request.headers.get('x-forwarded-host'))
  const host = firstHeader(request.headers.get('host'))
  const forwardedProto = firstHeader(request.headers.get('x-forwarded-proto'))
  const requestProto = request.nextUrl.protocol.replace(':', '') || 'http'
  const proto = forwardedProto ?? requestProto

  const candidateHost = forwardedHost ?? host
  if (candidateHost && isPublicHost(candidateHost)) {
    const scheme = proto === 'http' ? 'http' : 'https'
    return `${scheme}://${candidateHost}`
  }

  const fromEnv =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL?.trim()
  if (fromEnv) {
    try {
      return new URL(fromEnv).origin
    } catch {
      // ignore invalid env
    }
  }

  const fallback = request.nextUrl.origin
  if (isPublicHost(new URL(fallback).host)) {
    return fallback
  }

  // Last resort: known production host (never return 0.0.0.0 to browsers).
  return 'https://lakoku.appvibe.biz.id'
}

function firstHeader(value: string | null): string | null {
  if (!value) return null
  return value.split(',')[0]?.trim() || null
}

function isPublicHost(host: string): boolean {
  const h = host.toLowerCase()
  if (!h || h.startsWith('0.0.0.0')) return false
  if (h.startsWith('[::]') || h.startsWith('::')) return false
  // Container-internal binds are not browser-reachable.
  if (h === '127.0.0.1:5200' || h === 'localhost:5200') return false
  return true
}
