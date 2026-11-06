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

async function issueTokens(store: ReturnType<typeof createDbTokenStore>, userId: string, clientId: string, scope: string): Promise<Response> {
  const refresh = randomToken(48)
  await store.putRefresh({
    tokenHash: sha256B64Url(refresh),
    userId,
    clientId,
    scope,
    expiresAt: Date.now() + REFRESH_TTL_MS,
  })
  const nowSec = Math.floor(Date.now() / 1000)
  return NextResponse.json({
    access_token: mintAccessToken(userId, oauthSecret(), nowSec, ACCESS_TTL_SEC),
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_SEC,
    refresh_token: refresh,
    scope,
  })
}

export async function POST(req: Request): Promise<Response> {
  const limiter = rateLimit(`mcp-token:${clientIpFrom(req)}`, 30, 60_000)
  if (!limiter.ok) return NextResponse.json({ error: 'terlalu sering' }, { status: 429 })

  const form = new URLSearchParams(await req.text())
  const creds = clientCredentials(req, form)
  const expectedId = process.env.MCP_SEED_OAUTH_CLIENT_ID ?? ''
  const expectedSecret = process.env.MCP_SEED_OAUTH_CLIENT_SECRET ?? ''
  if (!creds || creds.id !== expectedId || creds.secret !== expectedSecret) {
    return NextResponse.json({ error: 'invalid_client' }, { status: 401 })
  }

  const grant = form.get('grant_type')
  const store = createDbTokenStore()

  if (grant === 'authorization_code') {
    const code = form.get('code') ?? ''
    const verifier = form.get('code_verifier') ?? ''
    const redirectUri = form.get('redirect_uri') ?? ''
    const row = await store.takeCode(sha256B64Url(code))
    if (!row || row.clientId !== expectedId) {
      return NextResponse.json({ error: 'invalid_grant' }, { status: 400 })
    }
    if (row.redirectUri !== redirectUri) {
      return NextResponse.json({ error: 'invalid_grant' }, { status: 400 })
    }
    if (!verifyPkce(verifier, row.codeChallenge)) {
      return NextResponse.json({ error: 'invalid_grant' }, { status: 400 })
    }
    return issueTokens(store, row.userId, expectedId, row.scope)
  }

  if (grant === 'refresh_token') {
    const token = form.get('refresh_token') ?? ''
    const row = await store.takeRefresh(sha256B64Url(token))
    if (!row || row.clientId !== expectedId) {
      return NextResponse.json({ error: 'invalid_grant' }, { status: 400 })
    }
    return issueTokens(store, row.userId, expectedId, row.scope)
  }

  return NextResponse.json({ error: 'unsupported_grant_type' }, { status: 400 })
}
