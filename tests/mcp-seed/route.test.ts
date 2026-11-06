import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mintAccessToken } from '@/lib/mcp-seed/oauth-core'

vi.mock('@/lib/mcp-seed/wiring.server', () => ({
  buildSeedToolHandlers: vi.fn(() => ({
    assignNovel: vi.fn(),
    getUnitSpec: vi.fn(),
    submitUnit: vi.fn(),
    getNovelStatus: vi.fn(),
    finalizeNovel: vi.fn(),
  })),
}))

vi.mock('@/lib/mcp-seed/dispatch.server', () => ({
  handleMcpRpc: vi.fn(async ({ sub }: { sub: string | null }) => {
    return Response.json({ jsonrpc: '2.0', id: 1, result: { sub } })
  }),
}))

describe('app/api/mcp/seed/route', () => {
  const origSecret = process.env.MCP_SEED_OAUTH_SECRET
  const origBetterAuth = process.env.BETTER_AUTH_SECRET
  const origOrigin = process.env.MCP_SEED_PUBLIC_ORIGIN

  beforeEach(() => {
    process.env.MCP_SEED_OAUTH_SECRET = 'test-secret-min-32-bytes-long-for-hmac'
    process.env.MCP_SEED_PUBLIC_ORIGIN = 'https://lakoku.test'
  })

  afterEach(() => {
    process.env.MCP_SEED_OAUTH_SECRET = origSecret
    process.env.BETTER_AUTH_SECRET = origBetterAuth
    process.env.MCP_SEED_PUBLIC_ORIGIN = origOrigin
  })

  it('GET mengembalikan 405', async () => {
    const { GET } = await import('@/app/api/mcp/seed/route')
    const res = await GET()
    expect(res.status).toBe(405)
  })

  it('POST dengan JSON rusak mengembalikan 400 parse error', async () => {
    const { POST } = await import('@/app/api/mcp/seed/route')
    const req = new Request('https://lakoku.test/api/mcp/seed', {
      method: 'POST',
      body: 'bukan json',
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json() as { error: { code: number } }
    expect(json.error.code).toBe(-32700)
  })

  it('POST dengan token tak valid mengembalikan 401 + www-authenticate', async () => {
    const { POST } = await import('@/app/api/mcp/seed/route')
    const req = new Request('https://lakoku.test/api/mcp/seed', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call' }),
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer token-ngawur',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata')
  })

  it('POST dengan token saat secret kosong gagal fail-closed 500', async () => {
    delete process.env.MCP_SEED_OAUTH_SECRET
    delete process.env.BETTER_AUTH_SECRET
    const { POST } = await import('@/app/api/mcp/seed/route')
    const req = new Request('https://lakoku.test/api/mcp/seed', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call' }),
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer some-token',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(500)
  })

  it('POST dengan token valid meneruskan sub ke handleMcpRpc', async () => {
    const secret = 'test-secret-min-32-bytes-long-for-hmac'
    const nowSec = Math.floor(Date.now() / 1000)
    const token = mintAccessToken('user-gemini', secret, nowSec, 3600)

    const { POST } = await import('@/app/api/mcp/seed/route')
    const req = new Request('https://lakoku.test/api/mcp/seed', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json() as { result: { sub: string } }
    expect(json.result.sub).toBe('user-gemini')
  })

  it('POST tanpa header authorization meneruskan sub null ke handleMcpRpc', async () => {
    const { POST } = await import('@/app/api/mcp/seed/route')
    const req = new Request('https://lakoku.test/api/mcp/seed', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json() as { result: { sub: string | null } }
    expect(json.result.sub).toBeNull()
  })
})
