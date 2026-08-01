import type { NextRequest } from 'next/server'

/**
 * Public browser origin for redirects after auth.
 * Behind Caddy/Docker, request.nextUrl.origin can be https://0.0.0.0:5200
 * (container bind address). Prefer forwarded headers, then env site URL.
 */
export function getPublicOrigin(request: NextRequest): string {
  const forwardedHost = firstHeader(request.headers.get('x-forwarded-host'))
  const host = firstHeader(request.headers.get('host'))
  const isDevelopment = process.env.NODE_ENV === 'development'
  const configuredOrigin = configuredPublicOrigin()
  if (!isDevelopment && configuredOrigin) return configuredOrigin
  const forwardedProto = firstHeader(request.headers.get('x-forwarded-proto'))
  const requestProto = request.nextUrl.protocol.replace(':', '') || 'http'
  const proto = forwardedProto ?? requestProto

  const candidateHost = forwardedHost ?? host
  if (isDevelopment && candidateHost && isLoopbackHost(candidateHost)) {
    const scheme = proto === 'http' ? 'http' : 'https'
    return `${scheme}://${candidateHost}`
  }

  if (configuredOrigin) return configuredOrigin

  const fallback = request.nextUrl.origin
  if (isDevelopment && isLoopbackHost(new URL(fallback).host)) {
    return fallback
  }

  // Last resort: known production host (never return 0.0.0.0 to browsers).
  return 'https://lakoku.biz.id'
}

function firstHeader(value: string | null): string | null {
  if (!value) return null
  return value.split(',')[0]?.trim() || null
}

function configuredPublicOrigin(): string | null {
  const value = process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.SITE_URL?.trim()
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

function isLoopbackHost(host: string): boolean {
  const hostname = host.replace(/^\[|\](?::\d+)?$/g, '').split(':')[0]?.toLowerCase()
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}
