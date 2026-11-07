import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const mockUser = { id: 'admin-1', email: 'admin@lakoku.test' }
let currentSessionUser: { id: string; email: string } | null = mockUser
let currentAdminRole: string | null = 'superadmin'

vi.mock('@/lib/api/user-state', () => ({
  getSessionUser: vi.fn(async () => currentSessionUser),
}))

vi.mock('@/lib/admin/auth', () => ({
  getAdminRole: vi.fn(async () => currentAdminRole),
}))

const mockPutCode = vi.fn(async () => {})
vi.mock('@/lib/mcp-seed/oauth-store.server', () => ({
  createDbTokenStore: vi.fn(() => ({
    putCode: mockPutCode,
  })),
}))

describe('app/api/mcp/seed/oauth/authorize/route (F2 & F4)', () => {
  const origAllowedUsers = process.env.MCP_SEED_ALLOWED_USER_IDS
  const origClientId = process.env.MCP_SEED_OAUTH_CLIENT_ID
  const origRedirectUris = process.env.MCP_SEED_OAUTH_REDIRECT_URIS
  const origOrigin = process.env.MCP_SEED_PUBLIC_ORIGIN

  beforeEach(() => {
    currentSessionUser = mockUser
    currentAdminRole = 'superadmin'
    process.env.MCP_SEED_OAUTH_CLIENT_ID = 'test-client'
    process.env.MCP_SEED_ALLOWED_USER_IDS = 'admin-1,admin-2'
    process.env.MCP_SEED_PUBLIC_ORIGIN = 'https://lakoku.test'
    delete process.env.MCP_SEED_OAUTH_REDIRECT_URIS
  })

  afterEach(() => {
    process.env.MCP_SEED_ALLOWED_USER_IDS = origAllowedUsers
    process.env.MCP_SEED_OAUTH_CLIENT_ID = origClientId
    process.env.MCP_SEED_OAUTH_REDIRECT_URIS = origRedirectUris
    process.env.MCP_SEED_PUBLIC_ORIGIN = origOrigin
  })

  it('F2: allowlist kosong fail-closed (redirect login)', async () => {
    delete process.env.MCP_SEED_ALLOWED_USER_IDS
    const { GET } = await import('@/app/api/mcp/seed/oauth/authorize/route')
    const req = new Request('https://lakoku.test/api/mcp/seed/oauth/authorize?client_id=test-client&redirect_uri=https://example.com/cb&code_challenge=xyz', {
      headers: { 'x-forwarded-for': '10.0.1.1' },
    })
    const res = await GET(req)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('/login?next=')
  })

  it('F2: user tidak ada di allowlist fail-closed (redirect login)', async () => {
    process.env.MCP_SEED_ALLOWED_USER_IDS = 'admin-other'
    const { GET } = await import('@/app/api/mcp/seed/oauth/authorize/route')
    const req = new Request('https://lakoku.test/api/mcp/seed/oauth/authorize?client_id=test-client&redirect_uri=https://example.com/cb&code_challenge=xyz', {
      headers: { 'x-forwarded-for': '10.0.1.2' },
    })
    const res = await GET(req)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('/login?next=')
  })

  it('F2: POST menolak 401 bila user tidak ada di allowlist', async () => {
    process.env.MCP_SEED_ALLOWED_USER_IDS = 'admin-other'
    const { POST } = await import('@/app/api/mcp/seed/oauth/authorize/route')
    const form = new FormData()
    form.set('client_id', 'test-client')
    form.set('redirect_uri', 'https://example.com/cb')
    form.set('code_challenge', 'xyz')
    const req = new Request('https://lakoku.test/api/mcp/seed/oauth/authorize', {
      method: 'POST',
      body: form,
      headers: { 'x-forwarded-for': '10.0.1.3' },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('F4: redirect_uri diizinkan jika https dan env redirect uris tidak di-set', async () => {
    delete process.env.MCP_SEED_OAUTH_REDIRECT_URIS
    const { GET } = await import('@/app/api/mcp/seed/oauth/authorize/route')
    const req = new Request('https://lakoku.test/api/mcp/seed/oauth/authorize?client_id=test-client&redirect_uri=https://example.com/cb&code_challenge=xyz', {
      headers: { 'x-forwarded-for': '10.0.1.4' },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  it('F4: redirect_uri non-https ditolak 400', async () => {
    const { GET } = await import('@/app/api/mcp/seed/oauth/authorize/route')
    const req = new Request('https://lakoku.test/api/mcp/seed/oauth/authorize?client_id=test-client&redirect_uri=http://example.com/cb&code_challenge=xyz', {
      headers: { 'x-forwarded-for': '10.0.1.5' },
    })
    const res = await GET(req)
    expect(res.status).toBe(400)
    const json = await res.json() as { error: string }
    expect(json.error).toBe('redirect_uri tidak diizinkan.')
  })

  it('F4: saat MCP_SEED_OAUTH_REDIRECT_URIS diisi, redirect_uri wajib cocok persis', async () => {
    process.env.MCP_SEED_OAUTH_REDIRECT_URIS = 'https://flow.google.com/oauth, https://gemini.google.com/cb'
    const { GET, POST } = await import('@/app/api/mcp/seed/oauth/authorize/route')

    // Cocok persis -> lolos 200
    const validReq = new Request('https://lakoku.test/api/mcp/seed/oauth/authorize?client_id=test-client&redirect_uri=https://flow.google.com/oauth&code_challenge=xyz', {
      headers: { 'x-forwarded-for': '10.0.1.6' },
    })
    const validRes = await GET(validReq)
    expect(validRes.status).toBe(200)

    // Tidak cocok -> tolak 400
    const invalidReq = new Request('https://lakoku.test/api/mcp/seed/oauth/authorize?client_id=test-client&redirect_uri=https://evil.com/cb&code_challenge=xyz', {
      headers: { 'x-forwarded-for': '10.0.1.7' },
    })
    const invalidRes = await GET(invalidReq)
    expect(invalidRes.status).toBe(400)

    // POST juga menolak jika tidak cocok
    const form = new FormData()
    form.set('client_id', 'test-client')
    form.set('redirect_uri', 'https://evil.com/cb')
    form.set('code_challenge', 'xyz')
    const invalidPostReq = new Request('https://lakoku.test/api/mcp/seed/oauth/authorize', {
      method: 'POST',
      body: form,
      headers: { 'x-forwarded-for': '10.0.1.8' },
    })
    const invalidPostRes = await POST(invalidPostReq)
    expect(invalidPostRes.status).toBe(400)
  })
})
