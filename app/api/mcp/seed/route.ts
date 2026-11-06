import { verifyAccessToken } from '@/lib/mcp-seed/oauth-core'
import { handleMcpRpc } from '@/lib/mcp-seed/dispatch.server'
import { buildSeedToolHandlers } from '@/lib/mcp-seed/wiring.server'

function oauthSecret(): string {
  return process.env.MCP_SEED_OAUTH_SECRET ?? process.env.BETTER_AUTH_SECRET ?? ''
}

function siteOrigin(req: Request): string {
  return process.env.MCP_SEED_PUBLIC_ORIGIN ?? new URL(req.url).origin
}

export async function POST(req: Request): Promise<Response> {
  const origin = siteOrigin(req)
  const auth = req.headers.get('authorization')
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null

  let sub: string | null = null
  if (token) {
    const secret = oauthSecret()
    if (!secret) {
      return Response.json(
        { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Server configuration error' } },
        { status: 500 },
      )
    }
    sub = verifyAccessToken(token, secret, Math.floor(Date.now() / 1000))?.sub ?? null
    if (!sub) {
      return Response.json(
        { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Invalid token' } },
        { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"` } },
      )
    }
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 })
  }
  return handleMcpRpc({ body, sub, handlers: buildSeedToolHandlers(), origin })
}

export async function GET(): Promise<Response> {
  return Response.json({ error: 'Gunakan POST JSON-RPC.' }, { status: 405 })
}
