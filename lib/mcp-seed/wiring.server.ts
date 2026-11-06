import 'server-only'
import { getDb, single } from '@lakoku/db'
import { createProviderFromExactRoutes } from '@lakoku/ai-gateway/server'
import { DEFAULT_RUNTIME_POLICY, type GenerationProvider } from '@lakoku/ai-gateway'
import { toAiModelRoute, assertM10GG1RouteAuthority } from '@/lib/narrative-qa/contracts/m10-g-g1-route-authority.contract'
import { M10_G_G1_9ROUTER_ROUTE_AUTHORITY } from '../../fixtures/m10-g/g1-route-authority-9router'
import { createCatalogDraft, createDbCatalogWriter, resolveCatalogSource } from '@/lib/catalog/generator-db.server'
import { assertCatalogStoryId } from '@/lib/catalog/catalog-contract'
import { resolveGenreId, GENRE_BY_LABEL } from '@/lib/taste-profile/catalog'
import { createMcpSeedPump, mapUnits, unitIndexToTarget, type MappedUnit } from '@/lib/mcp-seed/pump.server'
import { parseAgentProse, unitKeyOf, type AgentWriteInstruction } from '@/lib/mcp-seed/agent-provider.server'
import { assertAssignAllowed, assertToolUser, seedEnv, toolRateLimit, type SeedVolumeLoaders } from '@/lib/mcp-seed/gates.server'
import type { SeedToolHandlers } from '@/lib/mcp-seed/dispatch.server'
import type { StoryContract } from '@/lib/story-engine/story-contract'

/** Provider 9Router terkualifikasi (kontrak/reaksi/pilihan). FROZEN M10-G. */
function innerProvider(): GenerationProvider {
  const baseUrl = process.env.NINEROUTER_BASE_URL
  const apiKey = process.env.NINEROUTER_API_KEY
  if (!baseUrl || !apiKey) throw new Error('MISSING_NINEROUTER_CREDENTIALS')
  const authority = assertM10GG1RouteAuthority(M10_G_G1_9ROUTER_ROUTE_AUTHORITY)
  return createProviderFromExactRoutes({
    writerRoute: toAiModelRoute(authority, 'writer'),
    choicesRoute: toAiModelRoute(authority, 'choice'),
    judgeRoute: toAiModelRoute(authority, 'continuity'),
    generationPolicy: DEFAULT_RUNTIME_POLICY,
  })
}

const proseTimeoutMs = (() => {
  const raw = Number.parseInt(process.env.MCP_SEED_PROSE_TIMEOUT_MS ?? '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : 1_800_000
})()

let _pumpInstance: ReturnType<typeof createMcpSeedPump> | null = null
function getPump(): ReturnType<typeof createMcpSeedPump> {
  if (!_pumpInstance) {
    _pumpInstance = createMcpSeedPump({
      writer: createDbCatalogWriter(),
      inner: innerProvider(),
      proseTimeoutMs,
    })
  }
  return _pumpInstance
}

const loaders: SeedVolumeLoaders = {
  async novelsThisMonth(source, monthStart) {
    const db = getDb()
    const rows = await db.selectFrom('catalog_stories')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('source', '=', source)
      .where('created_at', '>=', monthStart)
      .execute()
    return Number(rows[0]?.count ?? 0)
  },
  async activeDrafts(source) {
    const db = getDb()
    const rows = await db.selectFrom('catalog_stories')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .innerJoin('stories', 'stories.id', 'catalog_stories.story_id')
      .where('catalog_stories.source', '=', source)
      .where('catalog_stories.status', 'in', ['draft', 'generating'])
      .execute()
    return Number(rows[0]?.count ?? 0)
  },
}

function slugify(judul: string): string {
  const slug = judul.toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim().replace(/[\s-]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'novel'
}

async function uniqueStoryId(judul: string): Promise<string> {
  const db = getDb()
  const base = slugify(judul)
  for (let attempt = 0; attempt < 9; attempt++) {
    const candidate = attempt === 0 ? `catalog:${base}` : `catalog:${base}-${attempt + 1}`
    const existing = await single(
      db.selectFrom('stories').select('id').where('id', '=', candidate).limit(1).execute(),
    )
    if (existing.error) throw new Error(`[mcp-seed] cek slug gagal: ${existing.error.message}`)
    if (!existing.data) return candidate
  }
  throw new Error('MCP_SLUG_EXHAUSTED: judul terlalu generik, ubah judul lalu coba lagi')
}

/** Allowlist + rate limit untuk SETIAP tool call (sub dari token OAuth). */
function guard(sub: string): void {
  const env = seedEnv()
  assertToolUser(sub, env.allowedUserIds)
  const limiter = toolRateLimit(sub)
  if (!limiter.ok) throw new Error(`MCP_RATE_LIMITED: coba lagi dalam ${limiter.retryAfterSec} detik`)
}

function keyOf(target: { number: number; endingKey: string | null }): string {
  return unitKeyOf(target.endingKey, target.number)
}

function indexForTarget(contract: StoryContract, target: { number: number; endingKey: string | null }): number {
  const unit = mapUnits(contract).find((item) => item.number === target.number && item.endingKey === target.endingKey)
  if (!unit) throw new Error('MCP_UNIT_TARGET_NOT_FOUND')
  return unit.index
}

async function waitInstruction(storyId: string, key: string, maxMs = 15_000): Promise<AgentWriteInstruction | null> {
  const pump = getPump()
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const instruction = pump.store.instruction(key)
    if (instruction && instruction.storyId === storyId) return instruction
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}

function isUnitStored(
  state: { spine: Map<number, unknown>; variants: Map<string, Map<number, unknown>> } | null,
  unit: { number: number; endingKey: string | null },
): boolean {
  if (!state) return false
  if (unit.endingKey === null) {
    return state.spine.has(unit.number)
  }
  return state.variants.get(unit.endingKey)?.has(unit.number) ?? false
}

interface UnitProgress {
  unit_index: number
  number: number
  ending_key: string | null
  state: 'missing' | 'stored' | 'approved'
}

async function progressOf(contract: StoryContract, storyId: string): Promise<{
  stored: number
  total: number
  units: UnitProgress[]
}> {
  const pump = getPump()
  const db = getDb()
  const state = await pump.loadState(storyId)
  const approvedRows = await db.selectFrom('catalog_chapter_reviews')
    .select(['chapter_number', 'variant_key', 'status'])
    .where('story_id', '=', storyId)
    .execute()
  const approved = new Set(
    approvedRows
      .filter((row) => String(row.status) === 'approved')
      .map((row) => `${String(row.variant_key)}#${Number(row.chapter_number)}`),
  )
  const units: UnitProgress[] = mapUnits(contract).map((unit: MappedUnit) => {
    const isApproved = approved.has(unitKeyOf(unit.endingKey, unit.number))
    const stored = isUnitStored(state, unit)
    return {
      unit_index: unit.index,
      number: unit.number,
      ending_key: unit.endingKey,
      state: (isApproved ? 'approved' : stored ? 'stored' : 'missing') as UnitProgress['state'],
    }
  })
  return {
    stored: units.filter((unit) => unit.state !== 'missing').length,
    total: units.length,
    units,
  }
}

export function buildSeedToolHandlers(): SeedToolHandlers {
  return {
    async assignNovel(raw, sub) {
      guard(sub)
      await assertAssignAllowed(loaders, new Date())
      const input = raw as {
        genre: string; judul: string; tagline?: string; premis: string; protagonis: string; tropes?: string[]
      }
      const genreId = resolveGenreId(input.genre) ?? (GENRE_BY_LABEL[input.genre.toLowerCase()] ?? null)
      if (!genreId) {
        throw new Error(`MCP_GENRE_INVALID:${input.genre} (pilih: family_drama, romance, mystery, fantasy_kingdom, slice_of_life, survival_thriller)`)
      }
      const storyId = await uniqueStoryId(input.judul)
      await createCatalogDraft({
        storyId,
        title: input.judul,
        tagline: input.tagline ?? input.judul,
        synopsis: input.premis,
        protagonistName: input.protagonis,
        tropes: input.tropes ?? [],
        genreId,
        provider: innerProvider(),
        source: resolveCatalogSource('gemini-agent'),
      })
      const pump = getPump()
      pump.kick(storyId)
      return {
        novel_id: storyId,
        judul: input.judul,
        genre: genreId,
        total_units: 62,
        status: 'drafting',
        next: 'Panggil seed_get_unit_spec untuk unit pertama.',
      }
    },
    async getUnitSpec(raw, sub) {
      guard(sub)
      const input = raw as { novel_id: string; unit_index?: number }
      assertCatalogStoryId(input.novel_id)
      const pump = getPump()
      const contract = await pump.loadContract(input.novel_id)
      let target: { number: number; endingKey: string | null }
      if (input.unit_index !== undefined) {
        target = unitIndexToTarget(contract, input.unit_index)
      } else {
        const state = await pump.loadState(input.novel_id)
        const allUnits = mapUnits(contract)
        const nextUnit = allUnits.find((u) => !isUnitStored(state, u))
        if (!nextUnit) {
          throw new Error('MCP_ALL_UNITS_COMMITTED: semua unit tersimpan — panggil seed_finalize_novel')
        }
        target = { number: nextUnit.number, endingKey: nextUnit.endingKey }
      }
      const key = keyOf(target)
      pump.kick(input.novel_id)
      const instruction = await waitInstruction(input.novel_id, key)
      if (!instruction) {
        throw new Error('MCP_UNIT_NOT_PENDING: unit ini tidak sedang menunggu prosa — cek seed_get_novel_status (mungkin unit lain sedang diproses)')
      }
      return { unit_index: indexForTarget(contract, target), ...instruction }
    },
    async submitUnit(raw, sub) {
      guard(sub)
      const input = raw as { novel_id: string; unit_index: number; prose_markdown: string }
      assertCatalogStoryId(input.novel_id)
      const pump = getPump()
      const contract = await pump.loadContract(input.novel_id)
      const target = unitIndexToTarget(contract, input.unit_index)
      const key = keyOf(target)
      let prose
      try {
        prose = parseAgentProse(input.prose_markdown)
      } catch (err) {
        throw new Error(`${(err as Error).message} | kirim ulang dengan format: baris pertama "# Judul", paragraf dipisah baris kosong`)
      }
      const resolved = pump.store.resolve(key, prose)
      if (!resolved) {
        throw new Error('MCP_UNIT_NOT_PENDING: tidak ada generasi menunggu untuk unit ini (mungkin kadaluarsa) — ambil ulang seed_get_unit_spec')
      }
      const committed = await pump.commits.waitCommitted(input.novel_id, key, 180_000)
      if (committed) {
        return {
          status: 'accepted',
          unit_index: input.unit_index,
          progress: await progressOf(contract, input.novel_id),
          next: pump.isRunning(input.novel_id)
            ? 'Unit berikutnya siap diambil via seed_get_unit_spec.'
            : 'Semua unit tersimpan — panggil seed_finalize_novel.',
        }
      }
      const pumpError = pump.lastError(input.novel_id)
      if (pumpError) {
        throw new Error(`MCP_UNIT_REJECTED:${pumpError} — panggil seed_get_unit_spec untuk percobaan perbaikan`)
      }
      if (pump.isRunning(input.novel_id)) {
        throw new Error('MCP_UNIT_REJECTED: validasi bab gagal — ambil ulang seed_get_unit_spec untuk instruksi perbaikan (repairFindings)')
      }
      throw new Error('MCP_UNIT_TIMEOUT: generasi bab tidak selesai dalam 180 detik — cek seed_get_novel_status')
    },
    async getNovelStatus(raw, sub) {
      guard(sub)
      const input = raw as { novel_id: string }
      assertCatalogStoryId(input.novel_id)
      const pump = getPump()
      const contract = await pump.loadContract(input.novel_id)
      pump.kick(input.novel_id)
      const state = await pump.loadState(input.novel_id)
      return {
        novel_id: input.novel_id,
        status: state?.status ?? 'draft',
        running: pump.isRunning(input.novel_id),
        last_error: pump.lastError(input.novel_id),
        progress: await progressOf(contract, input.novel_id),
      }
    },
    async finalizeNovel(raw, sub) {
      guard(sub)
      const input = raw as { novel_id: string }
      assertCatalogStoryId(input.novel_id)
      const pump = getPump()
      const contract = await pump.loadContract(input.novel_id)
      const progress = await progressOf(contract, input.novel_id)
      const missing = progress.units.filter((unit) => unit.state !== 'approved' && unit.state !== 'stored')
      if (missing.length > 0) {
        return {
          status: 'not_ready',
          blockers: missing.map((unit) => `unit ${unit.unit_index} (${unit.number}${unit.ending_key ? `, ${unit.ending_key}` : ''}) belum tersimpan`),
        }
      }
      if (pump.isRunning(input.novel_id)) {
        return { status: 'not_ready', blockers: ['generasi masih berjalan — tunggu lalu cek seed_get_novel_status'] }
      }
      await pump.markReview(input.novel_id)
      return { status: 'review', blockers: [], next: 'QC manual admin di /admin/katalog — publish di sana.' }
    },
  }
}
