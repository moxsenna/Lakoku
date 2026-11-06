import { afterEach, describe, expect, it } from 'vitest'
import {
  assertAssignAllowed,
  assertToolUser,
  seedEnv,
  toolRateLimit,
  type SeedVolumeLoaders,
} from '@/lib/mcp-seed/gates.server'

function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

afterEach(() => {
  setEnv({
    MCP_SEED_ENABLED: undefined,
    MCP_SEED_MAX_NOVELS_PER_MONTH: undefined,
    MCP_SEED_MAX_ACTIVE_DRAFTS: undefined,
    MCP_SEED_ALLOWED_USER_IDS: undefined,
  })
})

const loaders: SeedVolumeLoaders = {
  async novelsThisMonth() {
    return 0
  },
  async activeDrafts() {
    return 0
  },
}

describe('seedEnv', () => {
  it('default: disabled, cap 3 novel/bulan, 1 draft aktif', () => {
    setEnv({ MCP_SEED_ENABLED: undefined })
    const env = seedEnv()
    expect(env.enabled).toBe(false)
    expect(env.maxNovelsPerMonth).toBe(3)
    expect(env.maxActiveDrafts).toBe(1)
    expect(env.allowedUserIds).toEqual([])
  })

  it('membaca konfigurasi env kustom dengan parsing allowlist koma', () => {
    setEnv({
      MCP_SEED_ENABLED: '1',
      MCP_SEED_MAX_NOVELS_PER_MONTH: '5',
      MCP_SEED_MAX_ACTIVE_DRAFTS: '2',
      MCP_SEED_ALLOWED_USER_IDS: 'u-1, u-2,  u-3, ',
    })
    const env = seedEnv()
    expect(env.enabled).toBe(true)
    expect(env.maxNovelsPerMonth).toBe(5)
    expect(env.maxActiveDrafts).toBe(2)
    expect(env.allowedUserIds).toEqual(['u-1', 'u-2', 'u-3'])
  })

  it('fallback ke default jika angka env tidak valid', () => {
    setEnv({
      MCP_SEED_MAX_NOVELS_PER_MONTH: '-1',
      MCP_SEED_MAX_ACTIVE_DRAFTS: 'abc',
    })
    const env = seedEnv()
    expect(env.maxNovelsPerMonth).toBe(3)
    expect(env.maxActiveDrafts).toBe(1)
  })
})

describe('assertAssignAllowed', () => {
  it('melempar MCP_SEED_DISABLED saat env off', async () => {
    setEnv({ MCP_SEED_ENABLED: undefined })
    await expect(assertAssignAllowed(loaders, new Date())).rejects.toThrow(/MCP_SEED_DISABLED/)
  })

  it('lolos saat enabled dan kuota tersisa', async () => {
    setEnv({ MCP_SEED_ENABLED: '1' })
    await expect(assertAssignAllowed(loaders, new Date())).resolves.toBeUndefined()
  })

  it('melempar MCP_SEED_VOLUME_CAP saat kuota habis', async () => {
    setEnv({ MCP_SEED_ENABLED: '1', MCP_SEED_MAX_NOVELS_PER_MONTH: '2' })
    const capped: SeedVolumeLoaders = { ...loaders, async novelsThisMonth() { return 2 } }
    await expect(assertAssignAllowed(capped, new Date())).rejects.toThrow(/MCP_SEED_VOLUME_CAP:2/)
  })

  it('melempar MCP_SEED_ACTIVE_DRAFT_CAP saat ada draft generasi berjalan', async () => {
    setEnv({ MCP_SEED_ENABLED: '1' })
    const busy: SeedVolumeLoaders = { ...loaders, async activeDrafts() { return 1 } }
    await expect(assertAssignAllowed(busy, new Date())).rejects.toThrow(/MCP_SEED_ACTIVE_DRAFT_CAP:1/)
  })

  it('mengirim monthStart UTC dan source gemini-agent ke loader', async () => {
    setEnv({ MCP_SEED_ENABLED: '1' })
    const recorded: { source: string; monthStart: Date | null } = {
      source: '',
      monthStart: null,
    }
    const recordingLoaders: SeedVolumeLoaders = {
      async novelsThisMonth(source, monthStart) {
        recorded.source = source
        recorded.monthStart = monthStart
        return 0
      },
      async activeDrafts() {
        return 0
      },
    }
    const testDate = new Date('2026-11-15T14:30:00.000Z')
    await assertAssignAllowed(recordingLoaders, testDate)
    expect(recorded.source).toBe('gemini-agent')
    expect(recorded.monthStart?.toISOString()).toBe('2026-11-01T00:00:00.000Z')
  })
})

describe('assertToolUser', () => {
  it('menerima user dalam allowlist', () => {
    expect(() => assertToolUser('u-1', ['u-1', 'u-2'])).not.toThrow()
  })
  it('menolak user di luar allowlist', () => {
    expect(() => assertToolUser('u-9', ['u-1'])).toThrow(/MCP_SEED_USER_FORBIDDEN:u-9/)
  })
})

describe('toolRateLimit', () => {
  it('menolak setelah 60 panggilan dalam jendela', () => {
    const sub = 'rate-test-user-limit'
    let ok = true
    for (let i = 0; i < 60; i++) ok = toolRateLimit(sub, 1_000_000).ok
    expect(ok).toBe(true)
    const blocked = toolRateLimit(sub, 1_000_000)
    expect(blocked.ok).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThan(0)
  })

  it('memisahkan bucket antar sub user', () => {
    const userA = 'rate-user-a'
    const userB = 'rate-user-b'
    for (let i = 0; i < 60; i++) {
      toolRateLimit(userA, 2_000_000)
    }
    expect(toolRateLimit(userA, 2_000_000).ok).toBe(false)
    expect(toolRateLimit(userB, 2_000_000).ok).toBe(true)
  })
})
