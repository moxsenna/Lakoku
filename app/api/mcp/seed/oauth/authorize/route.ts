import { NextResponse } from 'next/server'
import { getAdminRole } from '@/lib/admin/auth'
import { getSessionUser } from '@/lib/api/user-state'
import { seedEnv } from '@/lib/mcp-seed/gates.server'
import { renderConsentPage } from '@/lib/mcp-seed/oauth-consent.server'
import { randomToken, sha256B64Url } from '@/lib/mcp-seed/oauth-core'
import { createDbTokenStore } from '@/lib/mcp-seed/oauth-store.server'
import { clientIpFrom, rateLimit } from '@/lib/security/rate-limit'

const CODE_TTL_MS = 10 * 60 * 1000

function siteOrigin(req: Request): string {
  return process.env.MCP_SEED_PUBLIC_ORIGIN ?? new URL(req.url).origin
}

function loginRedirect(req: Request): Response {
  const next = encodeURIComponent(new URL(req.url).pathname + '?' + new URL(req.url).searchParams.toString())
  return NextResponse.redirect(`${siteOrigin(req)}/login?next=${next}`)
}

function paramsOf(req: Request): URLSearchParams {
  return new URL(req.url).searchParams
}

async function sessionAdmin(_req: Request): Promise<{ id: string; email: string | undefined } | null> {
  const user = await getSessionUser()
  if (!user) return null
  const role = await getAdminRole(user.id)
  if (!role) return null
  const env = seedEnv()
  if (env.allowedUserIds.length > 0 && !env.allowedUserIds.includes(user.id)) return null
  return { id: user.id, email: user.email }
}

export async function GET(req: Request): Promise<Response> {
  const limiter = rateLimit(`mcp-oauth:${clientIpFrom(req)}`, 20, 60_000)
  if (!limiter.ok) return NextResponse.json({ error: 'Terlalu sering.' }, { status: 429 })
  const admin = await sessionAdmin(req)
  if (!admin) return loginRedirect(req)
  const params = paramsOf(req)
  const clientId = params.get('client_id') ?? ''
  const redirectUri = params.get('redirect_uri') ?? ''
  const state = params.get('state') ?? ''
  const scope = params.get('scope') ?? 'seed'
  const codeChallenge = params.get('code_challenge') ?? ''
  if (clientId !== (process.env.MCP_SEED_OAUTH_CLIENT_ID ?? '')) {
    return NextResponse.json({ error: 'client_id tidak dikenal.' }, { status: 400 })
  }
  if (!redirectUri.startsWith('https://')) {
    return NextResponse.json({ error: 'redirect_uri wajib https.' }, { status: 400 })
  }
  if (!codeChallenge) {
    return NextResponse.json({ error: 'code_challenge (PKCE S256) wajib.' }, { status: 400 })
  }
  return new Response(renderConsentPage({ clientId, redirectUri, state, scope, codeChallenge, email: admin.email }), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

export async function POST(req: Request): Promise<Response> {
  const admin = await sessionAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 })
  const form = await req.formData()
  const clientId = String(form.get('client_id') ?? '')
  const redirectUri = String(form.get('redirect_uri') ?? '')
  const state = String(form.get('state') ?? '')
  const scope = String(form.get('scope') ?? 'seed')
  const codeChallenge = String(form.get('code_challenge') ?? '')
  if (clientId !== (process.env.MCP_SEED_OAUTH_CLIENT_ID ?? '') || !redirectUri.startsWith('https://') || !codeChallenge) {
    return NextResponse.json({ error: 'Permintaan tidak valid.' }, { status: 400 })
  }
  const code = randomToken(32)
  await createDbTokenStore().putCode({
    codeHash: sha256B64Url(code),
    userId: admin.id,
    clientId,
    redirectUri,
    codeChallenge,
    scope,
    expiresAt: Date.now() + CODE_TTL_MS,
  })
  const target = new URL(redirectUri)
  target.searchParams.set('code', code)
  if (state) target.searchParams.set('state', state)
  return NextResponse.redirect(target.toString())
}
