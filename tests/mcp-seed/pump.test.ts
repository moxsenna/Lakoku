import { describe, expect, it } from 'vitest'
import {
  createMcpSeedPump,
  mapUnits,
  unitIndexToTarget as toTarget,
} from '@/lib/mcp-seed/pump.server'
import { createAutoResponderProseStore } from '@/lib/mcp-seed/agent-provider.server'
import { createDeterministicProvider, DEFAULT_RUNTIME_POLICY } from '@lakoku/ai-gateway'
import type { CatalogGeneratorWriter, CatalogGeneratorStoryState, CatalogChapterRef } from '@/lib/catalog/generator.server'
import type { CanonSnapshot } from '@lakoku/narrative-core'
import { assertCatalogContract } from '@/lib/catalog/catalog-contract'
import { fantasiPetualanganContract } from '@/fixtures/contracts/fantasi-petualangan'

const CONTRACT = assertCatalogContract({
  ...fantasiPetualanganContract,
  storyId: 'catalog:uji-pump',
  title: 'Uji Pump',
  endingCandidates: [
    {
      key: 'ending-a',
      kind: 'main' as const,
      name: 'Kemenangan',
      condition: 'Rara menang di pengadilan.',
      requiredClosure: ['Rara menang.'],
      blockingConditions: [],
    },
    {
      key: 'ending-b',
      kind: 'main' as const,
      name: 'Kalah',
      condition: 'Rara kalah tapi damai.',
      requiredClosure: ['Rara damai.'],
      blockingConditions: [],
    },
    {
      key: 'ending-s',
      kind: 'secret' as const,
      name: 'Rahasia Ibu',
      condition: 'Ibu masih hidup.',
      requiredClosure: ['Ibu hidup.'],
      blockingConditions: [],
    },
  ],
})

describe('mapUnits', () => {
  it('menghasilkan 62 unit: 44 spine lalu 3×6 varian sesuai urutan kandidat', () => {
    const units = mapUnits(CONTRACT)
    expect(units).toHaveLength(62)
    expect(units[0]).toEqual({ index: 0, number: 1, endingKey: null })
    expect(units[43]).toEqual({ index: 43, number: 44, endingKey: null })
    expect(units[44]).toEqual({ index: 44, number: 45, endingKey: 'ending-a' })
    expect(units[49]).toEqual({ index: 49, number: 50, endingKey: 'ending-a' })
    expect(units[50]).toEqual({ index: 50, number: 45, endingKey: 'ending-b' })
    expect(units[61]).toEqual({ index: 61, number: 50, endingKey: 'ending-s' })
    expect(toTarget(CONTRACT, 61)).toEqual({ number: 50, endingKey: 'ending-s' })
    expect(() => toTarget(CONTRACT, 62)).toThrow(/MCP_UNIT_INDEX_INVALID/)
  })
})

function fakeWriter(): CatalogGeneratorWriter & { state: CatalogGeneratorStoryState; progress: () => number } {
  let progressValue = 0
  const state: CatalogGeneratorStoryState = {
    status: 'draft',
    contract: CONTRACT,
    spine: new Map<number, CatalogChapterRef>(),
    variants: new Map(),
  }
  return {
    state,
    progress: () => progressValue,
    async loadState() { return state },
    async loadCanon() {
      return {
        storyId: 'catalog:uji-pump',
        characters: [
          {
            id: 'ch1',
            storyId: 'catalog:uji-pump',
            canonicalName: 'Rara',
            role: 'protagonis',
            motivation: 'Membuktikan kebenaran',
            status: 'ALIVE',
            introducedChapter: 1,
          },
          {
            id: 'ch2',
            storyId: 'catalog:uji-pump',
            canonicalName: 'Bu Sinta',
            role: 'pendukung',
            motivation: 'Menjaga keluarga',
            status: 'ALIVE',
            introducedChapter: 1,
          },
        ],
        aliases: [],
        facts: [],
        knowledge: [],
        secrets: [],
        voiceSheets: [],
        timeline: [],
        threads: [],
        actRollups: [],
        blueprints: [],
      } as CanonSnapshot
    },
    async markGenerating() { state.status = 'generating' },
    async writeSpineChapter(_storyId, chapter) { state.spine.set(chapter.chapterNumber, { title: chapter.title, paragraphs: chapter.paragraphs }) },
    async writeVariantChapter(_storyId, endingKey, chapter) {
      const map = state.variants.get(endingKey) ?? new Map<number, CatalogChapterRef>()
      map.set(chapter.chapterNumber, { title: chapter.title, paragraphs: chapter.paragraphs })
      state.variants.set(endingKey, map)
    },
    async deleteSpineChapter() {},
    async setProgress(_storyId, progress) { progressValue = progress },
    async markReview() { state.status = 'review' },
  }
}

async function runPumpToCompletion(storyId: string): Promise<void> {
  const writer = fakeWriter()
  const pump = createMcpSeedPump({
    writer,
    inner: createDeterministicProvider(DEFAULT_RUNTIME_POLICY),
    store: createAutoResponderProseStore(),
    proseTimeoutMs: 5_000,
  })
  pump.kick(storyId)
  for (let i = 0; i < 400; i++) {
    if (!pump.isRunning(storyId)) break
    await new Promise((r) => setTimeout(r, 10))
  }
  expect(pump.lastError(storyId)).toBeNull()
  expect(writer.state.status).toBe('review')
  expect(writer.state.spine.size).toBe(44)
  expect(writer.state.variants.get('ending-a')?.size).toBe(6)
}

describe('createMcpSeedPump', () => {
  it('menuntaskan novel penuh via auto-responder dan berakhir status review', { timeout: 120_000 }, async () => {
    await runPumpToCompletion('catalog:uji-pump')
  })

  it('kick idempoten: kick kedua saat berjalan tidak menumpuk run', async () => {
    const writer = fakeWriter()
    const pump = createMcpSeedPump({
      writer,
      inner: createDeterministicProvider(DEFAULT_RUNTIME_POLICY),
      store: createAutoResponderProseStore(),
      proseTimeoutMs: 5_000,
    })
    pump.kick('catalog:uji-pump')
    pump.kick('catalog:uji-pump')
    for (let i = 0; i < 400; i++) {
      if (!pump.isRunning('catalog:uji-pump')) break
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(writer.state.status).toBe('review')
  })

  it('menyediakan helper loadState, loadContract, markReview, dan nextRequiredUnit', async () => {
    const writer = fakeWriter()
    const pump = createMcpSeedPump({
      writer,
      inner: createDeterministicProvider(DEFAULT_RUNTIME_POLICY),
      store: createAutoResponderProseStore(),
      proseTimeoutMs: 5_000,
    })

    const state = await pump.loadState('catalog:uji-pump')
    expect(state).toBe(writer.state)

    const contract = await pump.loadContract('catalog:uji-pump')
    expect(contract.title).toBe('Uji Pump')

    await pump.markReview('catalog:uji-pump')
    expect(writer.state.status).toBe('review')

    // Unit pertama sebelum generasi adalah bab 1 spine
    const firstUnit = pump.nextRequiredUnit('catalog:uji-pump', contract)
    expect(firstUnit).toEqual({ index: 0, number: 1, endingKey: null })
  })

  it('loadContract melempar bila novel tidak ditemukan', async () => {
    const writer = fakeWriter()
    writer.loadState = async () => null
    const pump = createMcpSeedPump({
      writer,
      inner: createDeterministicProvider(DEFAULT_RUNTIME_POLICY),
      store: createAutoResponderProseStore(),
    })
    await expect(pump.loadContract('catalog:tidak-ada')).rejects.toThrow(/MCP_NOVEL_NOT_FOUND/)
  })

  it('commit tracker mencatat commit dan waitCommitted bekerja secara akurat', async () => {
    const writer = fakeWriter()
    const pump = createMcpSeedPump({
      writer,
      inner: createDeterministicProvider(DEFAULT_RUNTIME_POLICY),
      store: createAutoResponderProseStore(),
      proseTimeoutMs: 5_000,
    })

    expect(pump.commits.committed('catalog:uji-pump', 'spine#1')).toBe(false)

    // waitCommitted sebelum commit dengan timeout singkat -> false
    const fastWait = await pump.commits.waitCommitted('catalog:uji-pump', 'spine#99', 20)
    expect(fastWait).toBe(false)

    // Saat pump dijalankan, bab ter-commit dan waitCommitted me-resolve true
    const waitPromise = pump.commits.waitCommitted('catalog:uji-pump', 'spine#1', 5_000)
    pump.kick('catalog:uji-pump')

    const committed = await waitPromise
    expect(committed).toBe(true)
    expect(pump.commits.committed('catalog:uji-pump', 'spine#1')).toBe(true)

    // waitCommitted setelah commit me-resolve true seketika
    expect(await pump.commits.waitCommitted('catalog:uji-pump', 'spine#1', 100)).toBe(true)

    // Tunggu selesai agar tidak bocor ke test lain
    for (let i = 0; i < 400; i++) {
      if (!pump.isRunning('catalog:uji-pump')) break
      await new Promise((r) => setTimeout(r, 10))
    }
  })

  it('nextRequiredUnit melempar MCP_ALL_UNITS_COMMITTED saat semua bab sudah commit', async () => {
    const writer = fakeWriter()
    const pump = createMcpSeedPump({
      writer,
      inner: createDeterministicProvider(DEFAULT_RUNTIME_POLICY),
      store: createAutoResponderProseStore(),
      proseTimeoutMs: 5_000,
    })
    pump.kick('catalog:uji-pump')
    for (let i = 0; i < 400; i++) {
      if (!pump.isRunning('catalog:uji-pump')) break
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(writer.state.status).toBe('review')
    expect(() => pump.nextRequiredUnit('catalog:uji-pump', CONTRACT)).toThrow(/MCP_ALL_UNITS_COMMITTED/)
  })
})
