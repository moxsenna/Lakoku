import { describe, expect, it } from 'vitest'
import {
  createMemoryTokenStore,
  mintAccessToken,
  randomToken,
  sha256B64Url,
  verifyAccessToken,
  verifyPkce,
} from '@/lib/mcp-seed/oauth-core'

describe('verifyPkce', () => {
  it('cocok untuk S256 yang benar', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const challenge = sha256B64Url(verifier)
    expect(verifyPkce(verifier, challenge)).toBe(true)
  })
  it('menolak verifier salah', () => {
    expect(verifyPkce('salah', sha256B64Url('benar'))).toBe(false)
  })
  it('menolak method plain', () => {
    expect(verifyPkce('abc', 'abc')).toBe(false)
  })
})

describe('access token HMAC', () => {
  it('mint → verify mengembalikan sub', () => {
    const token = mintAccessToken('user-1', 'rahasia', 1_000_000)
    expect(verifyAccessToken(token, 'rahasia', 1_000_100)).toEqual({ sub: 'user-1' })
  })
  it('kadaluarsa ditolak', () => {
    const token = mintAccessToken('user-1', 'rahasia', 1_000_000, 60)
    expect(verifyAccessToken(token, 'rahasia', 1_000_061)).toBeNull()
  })
  it('secret salah ditolak', () => {
    const token = mintAccessToken('user-1', 'rahasia', 1_000_000)
    expect(verifyAccessToken(token, 'salah', 1_000_100)).toBeNull()
  })
  it('payload dimodifikasi ditolak', () => {
    const token = mintAccessToken('user-1', 'rahasia', 1_000_000)
    const tampered = `${token.slice(0, -3)}xyz`
    expect(verifyAccessToken(tampered, 'rahasia', 1_000_100)).toBeNull()
  })
})

describe('memory token store', () => {
  it('code single-use: takeCode kedua null', async () => {
    const store = createMemoryTokenStore()
    const code = randomToken(32)
    await store.putCode({
      codeHash: sha256B64Url(code),
      userId: 'u1',
      clientId: 'c1',
      redirectUri: 'https://x/cb',
      codeChallenge: 'challenge-1',
      scope: 'seed',
      expiresAt: Date.now() + 60_000,
    })
    const first = await store.takeCode(sha256B64Url(code))
    expect(first?.userId).toBe('u1')
    expect(first?.codeChallenge).toBe('challenge-1')
    expect(await store.takeCode(sha256B64Url(code))).toBeNull()
  })
  it('code kadaluarsa dianggap null', async () => {
    const store = createMemoryTokenStore()
    const code = randomToken(32)
    await store.putCode({
      codeHash: sha256B64Url(code),
      userId: 'u1',
      clientId: 'c1',
      redirectUri: 'https://x/cb',
      codeChallenge: 'challenge-1',
      scope: 'seed',
      expiresAt: Date.now() - 1,
    })
    expect(await store.takeCode(sha256B64Url(code))).toBeNull()
  })
  it('refresh dipakai sekali lalu null', async () => {
    const store = createMemoryTokenStore()
    const token = randomToken(48)
    await store.putRefresh({
      tokenHash: sha256B64Url(token),
      userId: 'u1',
      clientId: 'c1',
      scope: 'seed',
      expiresAt: Date.now() + 3_600_000,
    })
    expect((await store.takeRefresh(sha256B64Url(token)))?.userId).toBe('u1')
    expect(await store.takeRefresh(sha256B64Url(token))).toBeNull()
  })
})
