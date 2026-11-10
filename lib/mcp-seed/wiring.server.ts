import 'server-only'
import { getDb, single } from '@lakoku/db'
import { createDeterministicProvider, DEFAULT_RUNTIME_POLICY, type GenerationProvider } from '@lakoku/ai-gateway'
import type { CanonSnapshot } from '@lakoku/narrative-core'
import { createCatalogDraft, createDbCatalogWriter, resolveCatalogSource } from '@/lib/catalog/generator-db.server'
import {
  assertCatalogStoryId,
  CATALOG_SPINE_LAST_CHAPTER,
  CATALOG_VARIANT_FIRST_CHAPTER,
} from '@/lib/catalog/catalog-contract'
import {
  blueprintForChapter,
  buildCatalogContinuation,
  snapshotWithContract,
  storeCatalogUnit,
  timelineFor,
} from '@/lib/catalog/generator.server'
import { buildChapterBrief } from '@/lib/story-engine/chapter-brief'
import { buildPreProseChapterBrief } from '@/lib/story-engine/pre-prose-brief'
import { normalizeRouteState } from '@/lib/story-engine/route-state'
import { resolveGenreId, GENRE_BY_LABEL } from '@/lib/taste-profile/catalog'
import { createMcpSeedPump, mapUnits, unitIndexToTarget, type MappedUnit } from '@/lib/mcp-seed/pump.server'
import { parseAgentProse, buildAgentInstruction, unitKeyOf, type AgentWriteInstruction } from '@/lib/mcp-seed/agent-provider.server'
import { choicesDirectiveFor, parseAgentChoices, endingLockLabels } from '@/lib/mcp-seed/agent-choices'
import { assertAssignAllowed, assertToolUser, seedEnv, toolRateLimit, type SeedVolumeLoaders } from '@/lib/mcp-seed/gates.server'
import type { SeedToolHandlers } from '@/lib/mcp-seed/dispatch.server'
import type { StoryContract } from '@/lib/story-engine/story-contract'

/**
 * Full-Gemini: seluruh teks reader-facing (prosa + choices + reaksi) ditulis
 * agent Gemini via MCP; server hanya validasi guard + effects deterministik.
 * Jalur MCP TIDAK memanggil 9Router sama sekali — stub provider ini hanya
 * pemenuh tipe; contract memakai jalur template resilient (nol model).
 */
const templateContractProvider: GenerationProvider = {
  name: 'mcp-seed-template-contract',
  async generatePlan(): Promise<never> {
    throw new Error('MCP_TEMPLATE_CONTRACT_STUB')
  },
  async writeChapter(): Promise<never> {
    throw new Error('MCP_TEMPLATE_CONTRACT_STUB')
  },
}

/** Pump inner: tak pernah dipanggil di jalur full-Gemini; deterministic cukup. */
const inertInnerProvider: GenerationProvider = createDeterministicProvider(DEFAULT_RUNTIME_POLICY)

const proseTimeoutMs = (() => {
  const raw = Number.parseInt(process.env.MCP_SEED_PROSE_TIMEOUT_MS ?? '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : 1_800_000
})()

let _pumpInstance: ReturnType<typeof createMcpSeedPump> | null = null
function getPump(): ReturnType<typeof createMcpSeedPump> {
  if (!_pumpInstance) {
    _pumpInstance = createMcpSeedPump({
      writer: createDbCatalogWriter(),
      inner: inertInnerProvider,
      proseTimeoutMs,
    })
  }
  return _pumpInstance
}

const loaders: SeedVolumeLoaders = {
  async novelsThisMonth(source, monthStart) {
    const db = getDb()
    // Arsip (hasil smoke/uji) tidak dihitung ke kuota bulanan — smoke selalu
    // mengarsipkan novelnya, jadi gate tak boleh menghitungnya lagi.
    const rows = await db.selectFrom('catalog_stories')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('source', '=', source)
      .where('created_at', '>=', monthStart)
      .where('status', '!=', 'archived')
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
  if (!env.enabled) throw new Error('MCP_SEED_DISABLED: fitur belum diaktifkan di server')
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

// ─── Batch mode (full-Gemini) ────────────────────────────────────────────────

const batchWriter = createDbCatalogWriter()
const batchPlanProvider = createDeterministicProvider(DEFAULT_RUNTIME_POLICY)

/** Batas aman unit per panggilan batch. */
const MAX_BATCH_UNITS = 12

/**
 * Susun konteks penulisan (instruction + directive) untuk satu unit — tanpa
 * park, murni dari state DB + kontrak. Dipakai seed_get_batch_spec.
 */
async function buildBatchUnitSpec(args: {
  storyId: string
  contract: StoryContract
  target: { number: number; endingKey: string | null }
  unitIndex: number
}): Promise<Record<string, unknown>> {
  const { contract, target } = args
  const n = target.number
  const state = await batchWriter.loadState(args.storyId)
  if (!state) throw new Error(`MCP_NOVEL_NOT_FOUND:${args.storyId}`)
  const baseCanon = await batchWriter.loadCanon(args.storyId)
  const contractCanon = snapshotWithContract(baseCanon, contract)

  const spineTitles = [...state.spine.entries()].sort((a, b) => a[0] - b[0]).map(([number, ref]) => ({
    number,
    title: ref.title,
  }))
  const variantTitles = target.endingKey === null
    ? []
    : [...(state.variants.get(target.endingKey)?.entries() ?? [])]
        .sort((a, b) => a[0] - b[0])
        .map(([number, ref]) => ({ number, title: ref.title }))

  const previousChapter = target.endingKey === null
    ? (n > 1 ? state.spine.get(n - 1) ?? null : null)
    : (n === CATALOG_VARIANT_FIRST_CHAPTER
        ? state.spine.get(CATALOG_SPINE_LAST_CHAPTER) ?? null
        : state.variants.get(target.endingKey)?.get(n - 1) ?? null)
  const previousChapterNumber = previousChapter === null
    ? null
    : (target.endingKey === null ? n - 1 : (n === CATALOG_VARIANT_FIRST_CHAPTER ? CATALOG_SPINE_LAST_CHAPTER : n - 1))

  const snapshot: CanonSnapshot = {
    ...baseCanon,
    blueprints: contractCanon.blueprints,
    secrets: contractCanon.secrets,
    timeline: timelineFor([...spineTitles, ...variantTitles]),
  }
  const blueprint = blueprintForChapter(snapshot, n)
  const chapterBrief = buildChapterBrief({
    storyContract: contract,
    snapshot,
    readerState: {
      routeState: normalizeRouteState({}),
      choiceHistory: [],
      lockedEndingKey: target.endingKey,
    },
    chapterNumber: n,
    previousChoice: null,
  })
  const continuation = buildCatalogContinuation({
    storyId: args.storyId,
    contract,
    targetChapterNumber: n,
    previousChapter,
    previousChapterNumber,
    lockedEndingKey: target.endingKey,
    previousTitles: snapshot.timeline.slice(-24).map((event) => event.description),
  })
  const preProseBrief = buildPreProseChapterBrief({
    storyId: args.storyId,
    chapterNumber: n,
    snapshot,
    blueprint,
    continuation,
    chapterBrief,
  })
  const plan = await batchPlanProvider.generatePlan({
    snapshot,
    blueprint,
    chapterNumber: n,
    continuation,
    brief: preProseBrief,
  })
  const instruction = buildAgentInstruction({
    input: {
      snapshot,
      plan,
      continuation,
      brief: preProseBrief,
      genre: contract.genre,
    },
    policy: DEFAULT_RUNTIME_POLICY,
    novelTitle: contract.title,
    previousChapter,
    previousChapterNumber,
    corePromise: contract.corePromise,
    mainConflict: contract.mainConflict,
    finalQuestion: contract.finalQuestion,
  })
  const directive = choicesDirectiveFor({
    chapterNumber: n,
    endingKey: target.endingKey,
    contract,
  })
  return {
    unit_index: args.unitIndex,
    ...instruction,
    choices_directive: directive,
    ...(directive === 'ending_lock' ? { ending_lock_labels: endingLockLabels(contract) } : {}),
  }
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

export function buildSeedToolHandlers(opts?: { submitPollMs?: number; submitTimeoutMs?: number }): SeedToolHandlers {
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
        provider: templateContractProvider,
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
      // Full-Gemini: arahan choices per unit (spine 44 label dikunci server,
      // bab 50 tanpa pilihan, lainnya agent usulkan 2-3 pilihan + reaksi).
      const directive = choicesDirectiveFor({
        chapterNumber: target.number,
        endingKey: target.endingKey,
        contract,
      })
      return {
        unit_index: indexForTarget(contract, target),
        ...instruction,
        choices_directive: directive,
        ...(directive === 'ending_lock'
          ? { ending_lock_labels: endingLockLabels(contract) }
          : {}),
      }
    },
    async submitUnit(raw, sub) {
      guard(sub)
      const input = raw as {
        novel_id: string
        unit_index: number
        prose_markdown: string
        choice_prompt?: string
        choices?: Array<{ label: string; reaction: string[] }>
      }
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
      // Full-Gemini: validasi choices+reaksi agent SEBELUM resolve — guard dan
      // batas kata sama dengan jalur model server. Gagal → error berkode agar
      // agent memperbaiki dan submit ulang unit yang sama.
      const directive = choicesDirectiveFor({
        chapterNumber: target.number,
        endingKey: target.endingKey,
        contract,
      })
      const agentChoices = parseAgentChoices(
        { choice_prompt: input.choice_prompt, choices: input.choices },
        { directive, contract, proseTitle: prose.title },
      )
      const parkedInstruction = pump.store.instruction(key)
      if (!parkedInstruction) {
        throw new Error('MCP_UNIT_NOT_PENDING: tidak ada generasi menunggu untuk unit ini (mungkin kadaluarsa) — ambil ulang seed_get_unit_spec')
      }
      const submittedAttempt = parkedInstruction.attempt
      const resolved = pump.store.resolve(key, {
        ...prose,
        storyId: input.novel_id,
        ...(agentChoices ? { chapterChoices: agentChoices } : {}),
      })
      if (!resolved) {
        throw new Error('MCP_UNIT_NOT_PENDING: tidak ada generasi menunggu untuk unit ini (mungkin kadaluarsa) — ambil ulang seed_get_unit_spec')
      }
      const deadline = Date.now() + (opts?.submitTimeoutMs ?? 90_000)
      const pollIntervalMs = opts?.submitPollMs ?? 500
      while (Date.now() < deadline) {
        if (pump.commits.committed(input.novel_id, key)) {
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
        const nextInstruction = pump.store.instruction(key)
        if (nextInstruction && nextInstruction.attempt > submittedAttempt) {
          throw new Error(`MCP_UNIT_REJECTED: attempt ${submittedAttempt} ditolak validator — ambil ulang seed_get_unit_spec untuk instruksi perbaikan (repairFindings)`)
        }
        await new Promise((r) => setTimeout(r, pollIntervalMs))
      }
      if (pump.commits.committed(input.novel_id, key)) {
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
      const nextInstruction = pump.store.instruction(key)
      if (nextInstruction && nextInstruction.attempt > submittedAttempt) {
        throw new Error(`MCP_UNIT_REJECTED: attempt ${submittedAttempt} ditolak validator — ambil ulang seed_get_unit_spec untuk instruksi perbaikan (repairFindings)`)
      }
      throw new Error('MCP_UNIT_TIMEOUT: generasi bab tidak selesai dalam 90 detik — cek seed_get_novel_status')
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
    async getBatchSpec(raw, sub) {
      guard(sub)
      const input = raw as { novel_id: string; count?: number }
      assertCatalogStoryId(input.novel_id)
      const pump = getPump()
      if (pump.isRunning(input.novel_id)) {
        throw new Error('MCP_PUMP_ACTIVE: generasi jalur tunggal masih berjalan untuk novel ini — selesaikan lewat seed_get_unit_spec/seed_submit_unit atau tunggu sampai berhenti')
      }
      const contract = await pump.loadContract(input.novel_id)
      const state = await pump.loadState(input.novel_id)
      const count = Math.min(Math.max(input.count ?? 8, 1), MAX_BATCH_UNITS)
      const pending = mapUnits(contract).filter((unit) => !isUnitStored(state, unit))
      if (pending.length === 0) {
        throw new Error('MCP_ALL_UNITS_COMMITTED: semua unit tersimpan — panggil seed_finalize_novel')
      }
      const batch = pending.slice(0, count)
      const units: Array<Record<string, unknown>> = []
      for (const unit of batch) {
        units.push(await buildBatchUnitSpec({
          storyId: input.novel_id,
          contract,
          target: { number: unit.number, endingKey: unit.endingKey },
          unitIndex: unit.index,
        }))
      }
      return {
        novel_id: input.novel_id,
        pending_total: pending.length,
        batch_size: units.length,
        units,
        next: 'Tulis SEMUA unit pada array ini di konteksmu, lalu kirim berurutan (unit_index naik) dalam SATU panggilan seed_submit_units.',
      }
    },
    async submitUnits(raw, sub) {
      guard(sub)
      const input = raw as {
        novel_id: string
        units: Array<{ unit_index: number; prose_markdown: string; choice_prompt?: string; choices?: Array<{ label: string; reaction: string[] }> }>
      }
      assertCatalogStoryId(input.novel_id)
      const pump = getPump()
      if (pump.isRunning(input.novel_id)) {
        throw new Error('MCP_PUMP_ACTIVE: generasi jalur tunggal masih berjalan untuk novel ini — gunakan jalur batch konsisten')
      }
      const contract = await pump.loadContract(input.novel_id)
      if (!input.units?.length) throw new Error('MCP_BATCH_EMPTY: units wajib 1-12 item')
      if (input.units.length > MAX_BATCH_UNITS) {
        throw new Error(`MCP_BATCH_TOO_LARGE:${input.units.length} (maks ${MAX_BATCH_UNITS})`)
      }
      const results: Array<Record<string, unknown>> = []
      for (const [offset, unit] of input.units.entries()) {
        const target = unitIndexToTarget(contract, unit.unit_index)
        let prose
        try {
          prose = parseAgentProse(unit.prose_markdown)
        } catch (err) {
          throw new Error(`MCP_BATCH_UNIT_FAILED:${offset}:${(err as Error).message} | perbaiki unit offset ${offset} lalu kirim ulang SISA unit (yang sudah accepted tidak perlu dikirim ulang)`)
        }
        const directive = choicesDirectiveFor({
          chapterNumber: target.number,
          endingKey: target.endingKey,
          contract,
        })
        let agentChoices
        try {
          agentChoices = parseAgentChoices(
            { choice_prompt: unit.choice_prompt, choices: unit.choices },
            { directive, contract, proseTitle: prose.title },
          )
        } catch (err) {
          throw new Error(`MCP_BATCH_UNIT_FAILED:${offset}:${(err as Error).message}`)
        }
        try {
          const stored = await storeCatalogUnit(
            { provider: inertInnerProvider, writer: batchWriter, policy: DEFAULT_RUNTIME_POLICY },
            {
              storyId: input.novel_id,
              chapterNumber: target.number,
              endingKey: target.endingKey,
              title: prose.title,
              paragraphs: prose.paragraphs,
              choices: agentChoices,
            },
          )
          results.push({
            unit_index: unit.unit_index,
            status: stored.alreadyStored ? 'already_stored' : 'accepted',
            chapter_number: stored.chapterNumber,
            ending_key: stored.endingKey,
            review_marked: stored.reviewMarked,
          })
        } catch (err) {
          throw new Error(`MCP_BATCH_UNIT_FAILED:${offset}:${(err as Error).message}`)
        }
      }
      const progress = await progressOf(contract, input.novel_id)
      const anyReview = results.some((result) => result.review_marked === true)
      return {
        novel_id: input.novel_id,
        results,
        progress,
        ...(anyReview ? { status: 'review' } : {}),
        next: progress.stored >= progress.total
          ? 'Semua unit tersimpan — panggil seed_finalize_novel lalu laporkan bahwa novel menunggu QC admin.'
          : 'Lanjutkan unit berikutnya via seed_get_batch_spec.',
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
