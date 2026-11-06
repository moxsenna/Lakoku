/**
 * OAuth 2.1 murni untuk MCP Seed Server (tanpa dependency baru):
 * PKCE S256, access token HMAC-SHA256 (format compact JWT-like),
 * penyimpanan code/refresh via hash SHA-256 (single-use).
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

function b64Url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

export function sha256B64Url(input: string): string {
  return createHash('sha256').update(input).digest('base64url')
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false
  if (verifier.length < 43 || verifier.length > 128) return false
  return sha256B64Url(verifier) === challenge
}

interface AccessPayload {
  sub: string
  iat: number
  exp: number
  jti: string
}

export function mintAccessToken(sub: string, secret: string, nowSec: number, ttlSec = 3_600): string {
  const payload: AccessPayload = {
    sub,
    iat: nowSec,
    exp: nowSec + ttlSec,
    jti: randomToken(8),
  }
  const body = b64Url(JSON.stringify(payload))
  const sig = b64Url(createHmac('sha256', secret).update(body).digest())
  return `${body}.${sig}`
}

export function verifyAccessToken(token: string, secret: string, nowSec: number): { sub: string } | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, sig] = parts as [string, string]
  const expected = createHmac('sha256', secret).update(body).digest()
  const actual = (() => {
    try {
      return Buffer.from(sig, 'base64url')
    } catch {
      return null
    }
  })()
  if (!actual || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  let payload: AccessPayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AccessPayload
  } catch {
    return null
  }
  if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null
  if (payload.exp <= nowSec) return null
  return { sub: payload.sub }
}

export interface CodeRow {
  codeHash: string
  userId: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  scope: string
  expiresAt: number
}

export interface RefreshRow {
  tokenHash: string
  userId: string
  clientId: string
  scope: string
  expiresAt: number
}

export interface OAuthTokenStore {
  putCode(row: CodeRow): Promise<void>
  takeCode(codeHash: string): Promise<CodeRow | null>
  putRefresh(row: RefreshRow): Promise<void>
  takeRefresh(tokenHash: string): Promise<RefreshRow | null>
}

export function createMemoryTokenStore(): OAuthTokenStore {
  const codes = new Map<string, CodeRow>()
  const refreshes = new Map<string, RefreshRow>()
  return {
    async putCode(row) {
      codes.set(row.codeHash, row)
    },
    async takeCode(codeHash) {
      const row = codes.get(codeHash)
      if (!row) return null
      codes.delete(codeHash)
      if (row.expiresAt <= Date.now()) return null
      return row
    },
    async putRefresh(row) {
      refreshes.set(row.tokenHash, row)
    },
    async takeRefresh(tokenHash) {
      const row = refreshes.get(tokenHash)
      if (!row) return null
      refreshes.delete(tokenHash)
      if (row.expiresAt <= Date.now()) return null
      return row
    },
  }
}
