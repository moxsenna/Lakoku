import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.mock('server-only', () => ({}))

import { assertCatalogContract } from '@/lib/catalog/catalog-contract'
import { fantasiPetualanganContract } from '@/fixtures/contracts/fantasi-petualangan'
import type { AgentWriteInstruction } from '@/lib/mcp-seed/agent-provider.server'

const TEST_CONTRACT = assertCatalogContract({
  ...fantasiPetualanganContract,
  storyId: 'catalog:uji-wiring',
  title: 'Uji Wiring',
})

function fakeInstruction(attempt: number, repairFindings: string[] = []): AgentWriteInstruction {
  return {
    storyId: 'catalog:uji-wiring',
    unitKey: 'spine#1',
    chapterNumber: 1,
    attempt,
    genre: 'mystery',
    targetWordsMin: 500,
    targetWordsMax: 1000,
    novelTitle: 'Uji Wiring',
    phase: 'setup',
    chapterGoal: 'Goal',
    plannedBeats: [],
    mandatoryBeats: [],
    forbiddenReveals: [],
    corePromise: 'Promise',
    mainConflict: 'Conflict',
    finalQuestion: 'Question',
    previousChapterTitle: null,
    previousEnding: [],
    repairFindings,
    formatRules: [],
  }
}

const mockPump = {
  kick: vi.fn(),
  isRunning: vi.fn(() => true),
  lastError: vi.fn<() => string | null>(() => null),
  loadContract: vi.fn(async () => TEST_CONTRACT),
  loadState: vi.fn(async () => null),
  markReview: vi.fn(async () => {}),
  store: {
    instruction: vi.fn<() => AgentWriteInstruction | null>(() => null),
    resolve: vi.fn(() => true),
    rejectAll: vi.fn(),
    park: vi.fn(),
  },
  commits: {
    committed: vi.fn(() => false),
    waitCommitted: vi.fn(async () => false),
  },
}

vi.mock('@/lib/mcp-seed/pump.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mcp-seed/pump.server')>()
  return {
    ...actual,
    createMcpSeedPump: vi.fn(() => mockPump),
  }
})

vi.mock('@lakoku/db', () => ({
  getDb: vi.fn(() => ({
    selectFrom: vi.fn(() => ({
      select: vi.fn(() => ({
        where: vi.fn(() => ({
          execute: vi.fn(async () => []),
          limit: vi.fn(() => ({
            execute: vi.fn(async () => []),
          })),
        })),
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            where: vi.fn(() => ({
              execute: vi.fn(async () => [{ count: 0 }]),
            })),
          })),
        })),
      })),
    })),
  })),
  single: vi.fn(async () => ({ data: null, error: null })),
}))

vi.mock('@/lib/catalog/generator-db.server', () => ({
  createCatalogDraft: vi.fn(async () => {}),
  createDbCatalogWriter: vi.fn(() => ({})),
  resolveCatalogSource: vi.fn(() => 'gemini-agent'),
}))

vi.mock('@lakoku/ai-gateway/server', () => ({
  createProviderFromExactRoutes: vi.fn(() => ({})),
}))

describe('wiring.server (F1 & F3)', () => {
  const origEnabled = process.env.MCP_SEED_ENABLED
  const origAllowedUsers = process.env.MCP_SEED_ALLOWED_USER_IDS
  const origNineBase = process.env.NINEROUTER_BASE_URL
  const origNineKey = process.env.NINEROUTER_API_KEY
  const sampleProse = '# Bab 1\n\n' + 'Ini adalah isi cerita uji validasi yang memuat cukup karakter untuk memenuhi syarat panjang minimal.'.repeat(3)

  beforeEach(() => {
    process.env.MCP_SEED_ENABLED = '1'
    process.env.MCP_SEED_ALLOWED_USER_IDS = 'user-valid'
    process.env.NINEROUTER_BASE_URL = 'https://router.test'
    process.env.NINEROUTER_API_KEY = 'test-key'
    mockPump.lastError.mockReturnValue(null)
    mockPump.commits.committed.mockReturnValue(false)
    mockPump.store.resolve.mockReturnValue(true)
    mockPump.store.instruction.mockReturnValue(fakeInstruction(1))
  })

  afterEach(() => {
    process.env.MCP_SEED_ENABLED = origEnabled
    process.env.MCP_SEED_ALLOWED_USER_IDS = origAllowedUsers
    process.env.NINEROUTER_BASE_URL = origNineBase
    process.env.NINEROUTER_API_KEY = origNineKey
  })

  describe('F1: Master switch menutup semua 5 tool', () => {
    it('semua tool melempar MCP_SEED_DISABLED saat MCP_SEED_ENABLED=0', async () => {
      process.env.MCP_SEED_ENABLED = '0'
      const { buildSeedToolHandlers } = await import('@/lib/mcp-seed/wiring.server')
      const handlers = buildSeedToolHandlers()

      await expect(handlers.assignNovel({ genre: 'mystery', judul: 'Judul', premis: 'Premis', protagonis: 'Laras' }, 'user-valid'))
        .rejects.toThrow(/MCP_SEED_DISABLED/)

      await expect(handlers.getUnitSpec({ novel_id: 'catalog:uji-wiring' }, 'user-valid'))
        .rejects.toThrow(/MCP_SEED_DISABLED/)

      await expect(handlers.submitUnit({ novel_id: 'catalog:uji-wiring', unit_index: 0, prose_markdown: sampleProse }, 'user-valid'))
        .rejects.toThrow(/MCP_SEED_DISABLED/)

      await expect(handlers.getNovelStatus({ novel_id: 'catalog:uji-wiring' }, 'user-valid'))
        .rejects.toThrow(/MCP_SEED_DISABLED/)

      await expect(handlers.finalizeNovel({ novel_id: 'catalog:uji-wiring' }, 'user-valid'))
        .rejects.toThrow(/MCP_SEED_DISABLED/)
    })

    it('semua tool melempar MCP_SEED_DISABLED saat MCP_SEED_ENABLED unset', async () => {
      delete process.env.MCP_SEED_ENABLED
      const { buildSeedToolHandlers } = await import('@/lib/mcp-seed/wiring.server')
      const handlers = buildSeedToolHandlers()

      await expect(handlers.assignNovel({ genre: 'mystery', judul: 'Judul', premis: 'Premis', protagonis: 'Laras' }, 'user-valid'))
        .rejects.toThrow(/MCP_SEED_DISABLED/)
      await expect(handlers.getUnitSpec({ novel_id: 'catalog:uji-wiring' }, 'user-valid'))
        .rejects.toThrow(/MCP_SEED_DISABLED/)
      await expect(handlers.submitUnit({ novel_id: 'catalog:uji-wiring', unit_index: 0, prose_markdown: sampleProse }, 'user-valid'))
        .rejects.toThrow(/MCP_SEED_DISABLED/)
      await expect(handlers.getNovelStatus({ novel_id: 'catalog:uji-wiring' }, 'user-valid'))
        .rejects.toThrow(/MCP_SEED_DISABLED/)
      await expect(handlers.finalizeNovel({ novel_id: 'catalog:uji-wiring' }, 'user-valid'))
        .rejects.toThrow(/MCP_SEED_DISABLED/)
    })
  })

  describe('F3: submitUnit 90s poll loop 4 cabang keluar', () => {
    it('cabang 1: pump.commits.committed() true -> accepted', async () => {
      const { buildSeedToolHandlers } = await import('@/lib/mcp-seed/wiring.server')
      const handlers = buildSeedToolHandlers({ submitPollMs: 5, submitTimeoutMs: 100 })
      mockPump.commits.committed.mockReturnValue(true)

      const res = await handlers.submitUnit({
        novel_id: 'catalog:uji-wiring',
        unit_index: 0,
        prose_markdown: sampleProse,
      }, 'user-valid')

      expect(res.status).toBe('accepted')
      expect(res.unit_index).toBe(0)
    })

    it('cabang 2: pump.lastError non-null -> throw MCP_UNIT_REJECTED:<err>', async () => {
      const { buildSeedToolHandlers } = await import('@/lib/mcp-seed/wiring.server')
      const handlers = buildSeedToolHandlers({ submitPollMs: 5, submitTimeoutMs: 100 })
      mockPump.lastError.mockReturnValue('DATABASE_DEADLOCK')

      await expect(handlers.submitUnit({
        novel_id: 'catalog:uji-wiring',
        unit_index: 0,
        prose_markdown: sampleProse,
      }, 'user-valid')).rejects.toThrow(/MCP_UNIT_REJECTED:DATABASE_DEADLOCK/)
    })

    it('cabang 3: instruction baru di-park dengan attempt > submittedAttempt -> fast-path repair throw', async () => {
      const { buildSeedToolHandlers } = await import('@/lib/mcp-seed/wiring.server')
      const handlers = buildSeedToolHandlers({ submitPollMs: 5, submitTimeoutMs: 100 })

      let callCount = 0
      mockPump.store.instruction.mockImplementation(() => {
        callCount++
        if (callCount <= 1) {
          return fakeInstruction(1)
        }
        return fakeInstruction(2, ['PROSE_TOO_SHORT'])
      })

      await expect(handlers.submitUnit({
        novel_id: 'catalog:uji-wiring',
        unit_index: 0,
        prose_markdown: sampleProse,
      }, 'user-valid')).rejects.toThrow(/MCP_UNIT_REJECTED: attempt 1 ditolak validator — ambil ulang seed_get_unit_spec untuk instruksi perbaikan \(repairFindings\)/)
    })

    it('cabang 4: deadline 90s tercapai tanpa commit/error/repair -> throw MCP_UNIT_TIMEOUT', async () => {
      const { buildSeedToolHandlers } = await import('@/lib/mcp-seed/wiring.server')
      const handlers = buildSeedToolHandlers({ submitPollMs: 5, submitTimeoutMs: 25 })
      mockPump.commits.committed.mockReturnValue(false)
      mockPump.lastError.mockReturnValue(null)

      let callCount = 0
      mockPump.store.instruction.mockImplementation(() => {
        callCount++
        if (callCount <= 1) {
          return fakeInstruction(1)
        }
        return null
      })

      await expect(handlers.submitUnit({
        novel_id: 'catalog:uji-wiring',
        unit_index: 0,
        prose_markdown: sampleProse,
      }, 'user-valid')).rejects.toThrow(/MCP_UNIT_TIMEOUT: generasi bab tidak selesai dalam 90 detik — cek seed_get_novel_status/)
    })
  })
})
