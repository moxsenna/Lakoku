/**
 * Pump generasi per novel untuk MCP Seed Server.
 *
 * Satu background run generateCatalogNovel per storyId. Prosa di-park di
 * AgentProseStore; tool MCP mengambil instruction dan menyelesaikannya.
 * Commit bab dilacak lewat dekorator writer sehingga seed_submit_unit bisa
 * mengembalikan verdict final (accepted/rejected) per unit.
 * Modul ini murni (dependency diinjeksi) agar bisa diuji tanpa DB.
 */
import type { GenerationProvider, GenerationRuntimePolicy } from '@lakoku/ai-gateway'
import { DEFAULT_RUNTIME_POLICY } from '@lakoku/ai-gateway'
import type { StoryContract } from '@/lib/story-engine/story-contract'
import {
  CATALOG_SPINE_LAST_CHAPTER,
  CATALOG_VARIANT_FIRST_CHAPTER,
  assertCatalogContract,
} from '@/lib/catalog/catalog-contract'
import {
  generateCatalogNovel,
  type CatalogAgentChoices,
  type CatalogChoiceSupplier,
  type CatalogGeneratedChapter,
  type CatalogGeneratorStoryState,
  type CatalogGeneratorWriter,
} from '@/lib/catalog/generator.server'
import {
  createAgentProseProvider,
  createAgentProseStore,
  unitKeyOf,
  type AgentProseStore,
} from '@/lib/mcp-seed/agent-provider.server'

export interface MappedUnit {
  index: number
  number: number
  endingKey: string | null
}

export function mapUnits(contract: StoryContract): MappedUnit[] {
  const normalized = assertCatalogContract(contract)
  const units: MappedUnit[] = []
  for (let n = 1; n <= CATALOG_SPINE_LAST_CHAPTER; n++) {
    units.push({ index: units.length, number: n, endingKey: null })
  }
  for (const candidate of normalized.endingCandidates) {
    for (let n = CATALOG_VARIANT_FIRST_CHAPTER; n <= 50; n++) {
      units.push({ index: units.length, number: n, endingKey: candidate.key })
    }
  }
  return units
}

export function unitIndexToTarget(
  contract: StoryContract,
  index: number,
): { number: number; endingKey: string | null } {
  const units = mapUnits(contract)
  const unit = units[index]
  if (!unit) throw new Error(`MCP_UNIT_INDEX_INVALID:${index} (0-${units.length - 1})`)
  return { number: unit.number, endingKey: unit.endingKey }
}

export interface CommitTracker {
  committed(storyId: string, key: string): boolean
  waitCommitted(storyId: string, key: string, timeoutMs: number): Promise<boolean>
}

interface PumpEntry {
  running: boolean
  lastError: string | null
}

export interface McpSeedPump {
  kick(storyId: string): void
  isRunning(storyId: string): boolean
  lastError(storyId: string): string | null
  store: AgentProseStore
  commits: CommitTracker
  /** State novel dari writer (kontrak + bab tersimpan). */
  loadState(storyId: string): Promise<CatalogGeneratorStoryState | null>
  /** Kontrak katalog tervalidasi (assertCatalogContract). */
  loadContract(storyId: string): Promise<StoryContract>
  /** Tandai novel selesai generasi → status review. */
  markReview(storyId: string): Promise<void>
  /** Unit pertama (urutan mapUnits) yang belum ter-commit. */
  nextRequiredUnit(storyId: string, contract: StoryContract): MappedUnit
}

export function createMcpSeedPump(deps: {
  writer: CatalogGeneratorWriter
  inner: GenerationProvider
  policy?: GenerationRuntimePolicy
  proseTimeoutMs?: number
  /** Store pengganti untuk smoke (createAutoResponderProseStore). */
  store?: AgentProseStore
}): McpSeedPump {
  const policy = deps.policy ?? DEFAULT_RUNTIME_POLICY
  const proseTimeoutMs = deps.proseTimeoutMs ?? 1_800_000

  const baseStore: AgentProseStore = deps.store ?? createAgentProseStore({ timeoutMs: proseTimeoutMs })
  // Full-Gemini: payload choices+reaksi per (storyId|unitKey), diisi saat
  // wiring men-resolve pending unit, dikonsumsi choiceSupplier di generator.
  const payloads = new Map<string, CatalogAgentChoices>()
  const store: AgentProseStore = {
    ...baseStore,
    resolve(key, prose) {
      const ok = baseStore.resolve(key, prose)
      if (ok && prose.storyId && prose.chapterChoices) {
        payloads.set(`${prose.storyId}|${key}`, prose.chapterChoices)
      }
      return ok
    },
  }
  const choiceSupplier: CatalogChoiceSupplier = async (args) => {
    const key = unitKeyOf(args.endingKey, args.chapterNumber)
    return payloads.get(`${args.storyId}|${key}`) ?? null
  }

  const commitKeys = new Map<string, Set<string>>()
  const commitWaiters = new Map<string, Array<{ key: string; resolve: (ok: boolean) => void }>>()

  const markCommitted = (storyId: string, key: string): void => {
    const set = commitKeys.get(storyId) ?? new Set<string>()
    set.add(key)
    commitKeys.set(storyId, set)
    const waiters = commitWaiters.get(storyId) ?? []
    commitWaiters.set(
      storyId,
      waiters.filter((waiter) => {
        if (waiter.key !== key) return true
        waiter.resolve(true)
        return false
      }),
    )
  }

  const commits: CommitTracker = {
    committed(storyId, key) {
      return commitKeys.get(storyId)?.has(key) ?? false
    },
    async waitCommitted(storyId, key, timeoutMs) {
      if (commits.committed(storyId, key)) return true
      return new Promise<boolean>((resolve) => {
        const waiterEntry: { key: string; resolve: (ok: boolean) => void } = {
          key,
          resolve: (ok: boolean) => {
            clearTimeout(timer)
            resolve(ok)
          },
        }
        const list = commitWaiters.get(storyId) ?? []
        list.push(waiterEntry)
        commitWaiters.set(storyId, list)
        const timer = setTimeout(() => {
          const current = commitWaiters.get(storyId) ?? []
          commitWaiters.set(
            storyId,
            current.filter((w) => w !== waiterEntry),
          )
          resolve(commits.committed(storyId, key))
        }, timeoutMs)
      })
    },
  }

  const trackingWriter: CatalogGeneratorWriter = {
    ...deps.writer,
    async writeSpineChapter(storyId, chapter: CatalogGeneratedChapter) {
      await deps.writer.writeSpineChapter(storyId, chapter)
      markCommitted(storyId, unitKeyOf(null, chapter.chapterNumber))
    },
    async writeVariantChapter(storyId, endingKey, chapter: CatalogGeneratedChapter) {
      await deps.writer.writeVariantChapter(storyId, endingKey, chapter)
      markCommitted(storyId, unitKeyOf(endingKey, chapter.chapterNumber))
    },
  }

  const provider = createAgentProseProvider({ inner: deps.inner, policy, store })
  const entries = new Map<string, PumpEntry>()

  const nextRequiredUnit = (storyId: string, contract: StoryContract): MappedUnit => {
    const unit = mapUnits(contract).find((item) => {
      const key = unitKeyOf(item.endingKey, item.number)
      return !commitKeys.get(storyId)?.has(key)
    })
    if (!unit) throw new Error('MCP_ALL_UNITS_COMMITTED')
    return unit
  }

  return {
    store,
    commits,
    isRunning(storyId) {
      return entries.get(storyId)?.running ?? false
    },
    lastError(storyId) {
      return entries.get(storyId)?.lastError ?? null
    },
    async loadState(storyId) {
      return deps.writer.loadState(storyId)
    },
    async loadContract(storyId) {
      const state = await deps.writer.loadState(storyId)
      if (!state) throw new Error(`MCP_NOVEL_NOT_FOUND:${storyId}`)
      return assertCatalogContract(state.contract)
    },
    async markReview(storyId) {
      await deps.writer.markReview(storyId)
    },
    nextRequiredUnit,
    kick(storyId) {
      const entry = entries.get(storyId) ?? { running: false, lastError: null }
      if (entry.running) return
      entry.running = true
      entry.lastError = null
      entries.set(storyId, entry)
      void (async () => {
        try {
          const state = await deps.writer.loadState(storyId)
          if (state) {
            for (const n of state.spine.keys()) {
              markCommitted(storyId, unitKeyOf(null, n))
            }
            for (const [endingKey, map] of state.variants.entries()) {
              for (const n of map.keys()) {
                markCommitted(storyId, unitKeyOf(endingKey, n))
              }
            }
          }
          await generateCatalogNovel(
            { provider, writer: trackingWriter, policy, choiceSupplier },
            {
              storyId,
              log: (message) => console.log(`[mcp-seed:${storyId}] ${message}`),
            },
          )
        } catch (err: unknown) {
          entry.lastError = err instanceof Error ? err.message : String(err)
          console.error(`[mcp-seed:${storyId}] pump gagal:`, entry.lastError)
        } finally {
          entry.running = false
          store.rejectAll(storyId, 'MCP_PUMP_STOPPED')
          for (const key of [...payloads.keys()]) {
            if (key.startsWith(`${storyId}|`)) payloads.delete(key)
          }
        }
      })()
    },
  }
}
