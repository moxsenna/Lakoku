import { NextResponse } from 'next/server'
import {
  mintAccessToken,
  randomToken,
  sha256B64Url,
  verifyPkce,
} from '@/lib/mcp-seed/oauth-core'
import { createDbTokenStore } from '@/lib/mcp-seed/oauth-store.server'
import { clientIpFrom, rateLimit } from '@/lib/security/rate-limit'

const ACCESS_TTL_SEC = 3_600
const REFRESH_TTL_MS = 30 * 24 * 3_600 * 1000

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  'Pragma': 'no-cache',
}

function jsonResponse(data: unknown, status = 200): Response {
  return NextResponse.json(data, {
    status,
    headers: NO_STORE_HEADERS,
  })
}

function oauthSecret(): string {
  return process.env.MCP_SEED_OAUTH_SECRET ?? process.env.BETTER_AUTH_SECRET ?? ''
}

function clientCredentials(req: Request, form: URLSearchParams): { id: string; secret: string } | null {
  const header = req.headers.get('authorization')
  if (header?.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
      const idx = decoded.indexOf(':')
      if (idx > 0) return { id: decoded.slice(0, idx), secret: decoded.slice(idx + 1) }
    } catch {
      /* Authorization header malformed atau bukan base64 valid */
    }
  }
  const id = form.get('client_id')
  const secret = form.get('client_secret')
  if (id && secret) return { id, secret }
  return null
}

async function issueTokens(
  store: ReturnType<typeof createDbTokenStore>,
  userId: string,
  clientId: string,
  scope: string,
  secret: string,
): Promise<Response> {
  const refresh = randomToken(48)
  await store.putRefresh({
    tokenHash: sha256B64Url(refresh),
    userId,
    clientId,
    scope,
    expiresAt: Date.now() + REFRESH_TTL_MS,
  })
  const nowSec = Math.floor(Date.now() / 1000)
  return jsonResponse({
    access_token: mintAccessToken(userId, secret, nowSec, ACCESS_TTL_SEC),
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_SEC,
    refresh_token: refresh,
    scope,
  })
}

export async function POST(req: Request): Promise<Response> {
  const limiter = rateLimit(`mcp-token:${clientIpFrom(req)}`, 30, 60_000)
  if (!limiter.ok) return jsonResponse({ error: 'terlalu sering' }, 429)

  const expectedId = process.env.MCP_SEED_OAUTH_CLIENT_ID
  const expectedSecret = process.env.MCP_SEED_OAUTH_CLIENT_SECRET
  if (!expectedId || !expectedSecret) {
    return jsonResponse({ error: 'server_error' }, 500)
  }

  const form = new URLSearchParams(await req.text())
  const creds = clientCredentials(req, form)
  if (!creds || creds.id !== expectedId || creds.secret !== expectedSecret) {
    return jsonResponse({ error: 'invalid_client' }, 401)
  }

  const secret = oauthSecret()
  if (!secret) {
    return jsonResponse({ error: 'server_error' }, 500)
  }

  const grant = form.get('grant_type')
  const store = createDbTokenStore()

  if (grant === 'authorization_code') {
    const code = form.get('code') ?? ''
    const verifier = form.get('code_verifier') ?? ''
    const redirectUri = form.get('redirect_uri') ?? ''
    const row = await store.takeCode(sha256B64Url(code))
    if (!row || row.clientId !== expectedId) {
      return jsonResponse({ error: 'invalid_grant' }, 400)
    }
    if (row.redirectUri !== redirectUri) {
      return jsonResponse({ error: 'invalid_grant' }, 400)
    }
    if (!verifyPkce(verifier, row.codeChallenge)) {
      return jsonResponse({ error: 'invalid_grant' }, 400)
    }
    return issueTokens(store, row.userId, expectedId, row.scope, secret)
  }

  if (grant === 'refresh_token') {
    const token = form.get('refresh_token') ?? ''
    const row = await store.takeRefresh(sha256B64Url(token))
    if (!row || row.clientId !== expectedId) {
      return jsonResponse({ error: 'invalid_grant' }, 400)
    }
    return issueTokens(store, row.userId, expectedId, row.scope, secret)
  }

  return jsonResponse({ error: 'unsupported_grant_type' }, 400)
}
