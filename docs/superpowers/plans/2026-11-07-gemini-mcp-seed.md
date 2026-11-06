# MCP Seed Server — Gemini Agent Seeding: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PM memerintahkan seeding novel katalog dari Gemini web ("seed 1 novel <genre>"); prosa ditulis agent Gemini (kuota AI Pro), ketentuan Lakoku dipaksa server-side, status akhir selalu `review`.

**Architecture:** MCP streamable-HTTP endpoint (`/api/mcp/seed`, JSON-RPC tulisan tangan tanpa dependency baru) + OAuth 2.1 manual Client ID/Secret. Mesin naratif yang sudah terkualifikasi dipakai utuh: `generateCatalogNovel` menerima **dekorator `GenerationProvider`** yang hanya menggantikan `writeChapter` — prosa di-park sebagai pending instruction, agent mengambilnya via `seed_get_unit_spec` dan mengirim prosa via `seed_submit_unit`; plan/choices/reactions/kontrak tetap dari provider 9Router terkualifikasi.

**Tech Stack:** Next.js 16 App Router route handlers, Kysely/Neon, zod v4, node:crypto (HMAC/PKCE, tanpa `jose`/MCP SDK), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-07-gemini-mcp-seed-design.md`

## Global Constraints

- TypeScript strict; **dilarang** `as any`, `@ts-ignore`, `@ts-expect-error`, empty catch.
- Import boundary: file `*.server.ts` baru di `lib/mcp-seed/` yang butuh `server-only` HANYA boleh mengimpor `@lakoku/*` barrel + `@/lib/*`; modul yang DIUJI (agent-provider, pump-core, gates, oauth-core, dispatch, tools) **tidak boleh** mengimpor modul `server-only` atau `getDb()` — dependency DB/provider diinjeksi (pola `CatalogGeneratorDeps`).
- Dilarang menulis ke pembaca: tidak ada jalur status `published` dari tool mana pun; `seed_finalize_novel` maksimal ke `review`.
- Brand guard: jangan pernah mengekspos nama provider/model/internal ke teks yang bisa sampai pembaca (agent instructions adalah sisi admin, aman).
- Struktur 62 unit TIDAK berubah: spine 1–44, varian 45–50 × 3 kandidat ending.
- E0CostGuard & route authority M10-G tidak dimodifikasi.
- Migration naming `YYYYMMDDHHMMSS_<slug>.sql`, ditulis di `db/migrations/` **dan** disalin ke `neon/migrations/` (konvensi repo).
- Env gates wajib: `MCP_SEED_ENABLED`, `MCP_SEED_OAUTH_CLIENT_ID`, `MCP_SEED_OAUTH_CLIENT_SECRET`, `MCP_SEED_ALLOWED_USER_IDS`; opsional: `MCP_SEED_MAX_NOVELS_PER_MONTH` (default 3), `MCP_SEED_MAX_ACTIVE_DRAFTS` (default 1), `MCP_SEED_PROSE_TIMEOUT_MS` (default 1_800_000), `MCP_SEED_OAUTH_SECRET` (fallback `BETTER_AUTH_SECRET`), `MCP_SEED_PUBLIC_ORIGIN`.
- Commit per task, pesan bahasa Indonesia, hanya file yang disentuh task itu (`git add <path>` eksplisit — working tree ada perubahan lain milik stream lain, JANGAN di-sweep).

---

### Task 1: Migrasi provenance `source` + parameter di `createCatalogDraft`

**Files:**
- Create: `db/migrations/20261107120000_mcp_seed_provenance.sql`
- Create: `neon/migrations/20261107120000_mcp_seed_provenance.sql` (salinan identik)
- Modify: `lib/db/db-types.ts:297` (interface `CatalogStories`)
- Modify: `lib/catalog/generator-db.server.ts:24-33,97-106` (input + insert)
- Test: `tests/mcp-seed/provenance.test.ts`

**Interfaces:**
- Consumes: tabel `public.catalog_stories` (skema ada di `db/migrations/20261027000000_admin_catalog_stories.sql`).
- Produces: kolom `catalog_stories.source text not null default 'cli'`; `CreateCatalogDraftInput.source?: 'cli' | 'gemini-agent'`; helper `resolveCatalogSource(raw: unknown): 'cli' | 'gemini-agent'`.

- [ ] **Step 1: Tulis SQL migration (kedua lokasi)**

`db/migrations/20261107120000_mcp_seed_provenance.sql`:

```sql
-- MCP Seed Server (Gemini agent): provenance novel katalog
--
-- createCatalogDraft (lib/catalog/generator-db.server.ts) kini menerima
-- source: 'cli' (default) | 'gemini-agent'. Dipakai gate volume bulanan
-- lib/mcp-seed/gates dan filter QC admin.

alter table public.catalog_stories
  add column if not exists source text not null default 'cli';

alter table public.catalog_stories
  add constraint catalog_stories_source_check
  check (source in ('cli', 'gemini-agent'));

create index if not exists catalog_stories_source_created_idx
  on public.catalog_stories (source, created_at);
```

Salin file yang sama persis ke `neon/migrations/20261107120000_mcp_seed_provenance.sql`.

- [ ] **Step 2: Tulis test yang gagal dulu**

`tests/mcp-seed/provenance.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { resolveCatalogSource } from '@/lib/catalog/generator-db.server'

describe('resolveCatalogSource', () => {
  it('default cli saat tidak diberikan', () => {
    expect(resolveCatalogSource(undefined)).toBe('cli')
  })
  it('menerima gemini-agent', () => {
    expect(resolveCatalogSource('gemini-agent')).toBe('gemini-agent')
  })
  it('menolak nilai asing', () => {
    expect(() => resolveCatalogSource('hacker')).toThrow(/CATALOG_SOURCE_INVALID/)
  })
})
```

Catatan: `generator-db.server.ts` punya `import 'server-only'`. Jika Vitest gagal karena itu, pindahkan `resolveCatalogSource` ke file baru `lib/catalog/catalog-source.ts` (murni, tanpa `server-only`) dan impor dari sana — uji + konsumsi lewat file itu.

Run: `pnpm test:unit tests/mcp-seed/provenance.test.ts`
Expected: FAIL (`resolveCatalogSource` belum ada).

- [ ] **Step 3: Implementasi**

Di `lib/catalog/generator-db.server.ts` (atau `catalog-source.ts` sesuai catatan Step 2):

```typescript
export type CatalogSource = 'cli' | 'gemini-agent'

export function resolveCatalogSource(raw: unknown): CatalogSource {
  if (raw === undefined || raw === null) return 'cli'
  if (raw === 'cli' || raw === 'gemini-agent') return raw
  throw new Error(`CATALOG_SOURCE_INVALID:${String(raw)}`)
}
```

Tambahkan ke `CreateCatalogDraftInput`:

```typescript
export interface CreateCatalogDraftInput {
  storyId: string
  title: string
  tagline: string
  synopsis: string
  protagonistName: string
  tropes: string[]
  genreId: string | null
  provider: GenerationProvider
  source?: CatalogSource
}
```

Pada insert `catalog_stories` (blok `db.insertInto('catalog_stories').values({...})`), tambahkan satu properti:

```typescript
      source: resolveCatalogSource(input.source),
```

Di `lib/db/db-types.ts`, interface `CatalogStories` (baris ~297) tambahkan kolom:

```typescript
  source: Generated<string>;
```

- [ ] **Step 4: Jalankan test + typecheck**

Run: `pnpm test:unit tests/mcp-seed/provenance.test.ts && pnpm typecheck`
Expected: PASS, typecheck bersih.

- [ ] **Step 5: Terapkan migration ke DB dev & verifikasi**

Run: `pnpm db:migrate` (DATABASE_URL mengarah ke DB dev lokal, BUKAN produksi)
Lalu verifikasi:

```bash
psql "$DATABASE_URL" -c "select column_name, column_default from information_schema.columns where table_name='catalog_stories' and column_name='source';"
```

Expected: satu baris, default `'cli'::text`.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/20261107120000_mcp_seed_provenance.sql neon/migrations/20261107120000_mcp_seed_provenance.sql lib/db/db-types.ts lib/catalog/generator-db.server.ts lib/catalog/catalog-source.ts tests/mcp-seed/provenance.test.ts
git commit -m "feat(catalog): kolom provenance source untuk MCP seed"
```

---

### Task 2: Agent prose provider + prose store (`lib/mcp-seed/agent-provider.server.ts`)

**Files:**
- Create: `lib/mcp-seed/agent-provider.server.ts`
- Test: `tests/mcp-seed/agent-provider.test.ts`

**Interfaces:**
- Consumes: `GenerationProvider`, `WriteInput`, `ModelCallExecutionOptions`, `GenerationRuntimePolicy`, `DEFAULT_RUNTIME_POLICY` dari `@lakoku/ai-gateway` (barrel, murni); `CatalogChapterRef` type dari `@/lib/catalog/generator.server`.
- Produces:
  - `export interface AgentWriteInstruction { storyId, unitKey, chapterNumber, attempt, genre, targetWordsMin, targetWordsMax, novelTitle, phase, chapterGoal, plannedBeats, mandatoryBeats, forbiddenReveals, corePromise, mainConflict, finalQuestion, previousChapterTitle, previousEnding, repairFindings, formatRules }`
  - `export interface AgentProseResult { title: string; paragraphs: string[] }`
  - `export type UnitKey = string` (format `'<endingKey|spine>#<chapterNumber>'`)
  - `export function parseAgentProse(markdown: string): AgentProseResult`
  - `export function buildAgentInstruction(args: AgentInstructionArgs): AgentWriteInstruction`
  - `export function createAgentProseStore(opts: { timeoutMs: number }): AgentProseStore`
  - `export interface AgentProseStore { park(key: UnitKey, instruction: AgentWriteInstruction): Promise<AgentProseResult>; instruction(key: UnitKey): AgentWriteInstruction | null; resolve(key: UnitKey, prose: AgentProseResult): boolean; rejectAll(storyId: string, reason: string): void }`
  - `export function createAgentProseProvider(deps: { inner: GenerationProvider; policy: GenerationRuntimePolicy; store: AgentProseStore }): GenerationProvider` — `name: 'mcp-gemini-agent-v1'`; `generatePlan` & `evaluateSemanticContinuity` delegasi ke plan-fallback deterministik; `writeChapter` park→await→assemble; `generateChoices`, `generateCatalogReactions`, `generateStoryContract` delegasi ke `inner`.
  - `export function createAutoResponderProseStore(): AgentProseStore` — untuk smoke: `park` langsung resolve dengan prosa template dari instruction (pola `buildParagraphs` provider deterministik).

- [ ] **Step 1: Tulis test yang gagal dulu**

`tests/mcp-seed/agent-provider.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import {
  buildAgentInstruction,
  createAgentProseProvider,
  createAgentProseStore,
  parseAgentProse,
} from '@/lib/mcp-seed/agent-provider.server'
import { createDeterministicProvider, DEFAULT_RUNTIME_POLICY } from '@lakoku/ai-gateway'
import type { WriteInput } from '@lakoku/ai-gateway'

const snapshot = {
  storyId: 'catalog:uji-agent',
  characters: [
    { id: 'ch1', canonicalName: 'Rara', status: 'ALIVE', introducedChapter: 1 },
    { id: 'ch2', canonicalName: 'Bu Sinta', status: 'ALIVE', introducedChapter: 1 },
  ],
  facts: [{ id: 'f1', subjectCharacterId: 'ch1', establishedChapter: 1, summary: 'wasiat palsu' }],
  knowledge: [],
  secrets: [{ id: 's1', description: 'rahasia wasiat', revealGateChapter: 3, revealed: false }],
  voiceSheets: [],
  timeline: [],
} as unknown as Parameters<typeof buildAgentInstruction>[0]['input']['snapshot']

function writeInput(plan: Record<string, unknown>, repairFindings?: unknown[]): WriteInput {
  return {
    snapshot,
    plan: {
      chapterNumber: 3,
      phase: 'RISING',
      plannedBeats: ['Rara menemukan kunci kamar'],
      usesReveals: ['s1'],
      proposedStateDelta: { kunci_ditemukan: true },
      introducesCharacters: [],
      ...plan,
    },
    repairFindings: repairFindings as never,
    genre: 'mystery',
  } as WriteInput
}

function instructionOf(input: WriteInput) {
  return buildAgentInstruction({
    input,
    policy: DEFAULT_RUNTIME_POLICY,
    novelTitle: 'Warisan untuk Pembantu',
    previousChapter: { title: 'Bab 2: Sidang Pertama', paragraphs: ['Para satu.', 'Para dua.'] },
    previousChapterNumber: 2,
    corePromise: 'Rara membuktikan wasiat palsu.',
    mainConflict: 'Keluarga menekan Rara menyerah.',
    finalQuestion: 'Siapa yang menipu siapa?',
  })
}

describe('parseAgentProse', () => {
  it('mengambil judul dari heading # dan paragraf dari blok kosong', () => {
    const md = '# Malam Wasiat\n\nParagraf pertama berisi adegan pengadilan yang menegangkan.\n\nParagraf kedua berisi dialog: "Kamu tahu apa yang terjadi malam itu?"'
    const out = parseAgentProse(md)
    expect(out.title).toBe('Malam Wasiat')
    expect(out.paragraphs).toHaveLength(2)
  })

  it('fallback judul dari baris Judul:', () => {
    const md = 'Judul: Malam Wasiat\n\nIsi paragraf pertama yang cukup panjang untuk dihitung kata.'
    expect(parseAgentProse(md).title).toBe('Malam Wasiat')
  })

  it('menolak prosa kosong', () => {
    expect(() => parseAgentProse('   \n\n  ')).toThrow(/MCP_PROSE_EMPTY/)
  })
})

describe('buildAgentInstruction', () => {
  it('memuat beats, anchor cerita, target kata, dan formatRules', () => {
    const instr = instructionOf(writeInput({}))
    expect(instr.chapterNumber).toBe(3)
    expect(instr.plannedBeats).toContain('Rara menemukan kunci kamar')
    expect(instr.mandatoryBeats.length).toBeGreaterThan(0)
    expect(instr.corePromise).toBe('Rara membuktikan wasiat palsu.')
    expect(instr.targetWordsMin).toBe(800)
    expect(instr.formatRules.join('\n')).toMatch(/paragraf pendek/i)
    expect(instr.previousEnding).toEqual(['Para satu.', 'Para dua.'])
  })

  it('menyertakan repairFindings pada attempt perbaikan', () => {
    const instr = instructionOf(writeInput({}, ['SHORT: prosa terlalu pendek']))
    expect(instr.repairFindings).toEqual(['SHORT: prosa terlalu pendek'])
    expect(instr.attempt).toBe(2)
  })
})

describe('createAgentProseStore', () => {
  it('park → resolve mengembalikan prosa', async () => {
    const store = createAgentProseStore({ timeoutMs: 5_000 })
    const instr = instructionOf(writeInput({}))
    const pending = store.park('spine#3', instr)
    expect(store.instruction('spine#3')?.chapterNumber).toBe(3)
    expect(store.resolve('spine#3', { title: 'X', paragraphs: ['isi.'] })).toBe(true)
    await expect(pending).resolves.toEqual({ title: 'X', paragraphs: ['isi.'] })
  })

  it('park timeout melempar MCP_PROSE_TIMEOUT', async () => {
    const store = createAgentProseStore({ timeoutMs: 20 })
    const pending = store.park('spine#1', instructionOf(writeInput({})))
    await expect(pending).rejects.toThrow(/MCP_PROSE_TIMEOUT/)
  })

  it('rejectAll membatalkan pending berdasarkan storyId', async () => {
    const store = createAgentProseStore({ timeoutMs: 5_000 })
    const pending = store.park('spine#2', instructionOf(writeInput({})))
    store.rejectAll('catalog:uji-agent', 'pump error')
    await expect(pending).rejects.toThrow(/pump error/)
  })
})

describe('createAgentProseProvider', () => {
  it('writeChapter park dan mengembalikan draft terstruktur, choices delegasi ke inner', async () => {
    const inner = createDeterministicProvider(DEFAULT_RUNTIME_POLICY)
    const store = createAgentProseStore({ timeoutMs: 5_000 })
    const provider = createAgentProseProvider({ inner, policy: DEFAULT_RUNTIME_POLICY, store })
    expect(provider.name).toBe('mcp-gemini-agent-v1')

    const instr = instructionOf(writeInput({}))
    const input = writeInput({})
    const pending = provider.writeChapter(input, undefined)
    const key = instr.unitKey
    expect(store.resolve(key, { title: 'Malam Wasiat', paragraphs: ['Paragraf satu yang cukup panjang.', 'Paragraf dua.'] })).toBe(true)
    const draft = (await pending) as Record<string, unknown>
    expect(draft.title).toBe('Malam Wasiat')
    expect(draft.paragraphs).toHaveLength(2)
    expect(draft.hasChoiceOrGate).toBe(true)
    expect(draft.storyId).toBe('catalog:uji-agent')
    expect(Array.isArray(draft.events)).toBe(true)
    expect(provider.generateChoices).toBeDefined()
    expect(provider.generateCatalogReactions).toBeDefined()
  })
})
```

Run: `pnpm test:unit tests/mcp-seed/agent-provider.test.ts`
Expected: FAIL (modul belum ada).

- [ ] **Step 2: Implementasi `lib/mcp-seed/agent-provider.server.ts`**

```typescript
/**
 * Provider prosa agent Gemini untuk MCP Seed Server.
 *
 * Dekorator GenerationProvider: HANYA writeChapter yang diganti — prosa
 * di-park sebagai instruction yang diambil agent via tool MCP
 * (seed_get_unit_spec) dan dikirim balik via seed_submit_unit. Plan,
 * choices, reactions, kontrak, dan judge tetap delegasi ke provider
 * 9Router terkualifikasi (M10-G). Struktur draft mengikuti bentuk
 * provider deterministik supaya Layer A gateway & guard katalog jalan
 * tanpa pengecualian.
 */
import type {
  CatalogReactionsProviderInput,
  ChoiceProviderInput,
  GenerationProvider,
  GenerationRuntimePolicy,
  ModelCallExecutionOptions,
  StoryContractInput,
  WriteInput,
} from '@lakoku/ai-gateway'
import { createDeterministicProvider } from '@lakoku/ai-gateway'
import type { CanonSnapshot } from '@lakoku/narrative-core'
import type { StoryContractCallOptions } from '@lakoku/ai-gateway'

export type UnitKey = string

export function unitKeyOf(endingKey: string | null, chapterNumber: number): UnitKey {
  return `${endingKey ?? 'spine'}#${chapterNumber}`
}

export interface AgentWriteInstruction {
  storyId: string
  unitKey: UnitKey
  chapterNumber: number
  attempt: number
  genre: string | null
  targetWordsMin: number
  targetWordsMax: number
  novelTitle: string
  phase: string
  chapterGoal: string
  plannedBeats: string[]
  mandatoryBeats: string[]
  forbiddenReveals: string[]
  corePromise: string
  mainConflict: string
  finalQuestion: string
  previousChapterTitle: string | null
  previousEnding: string[]
  repairFindings: string[]
  formatRules: string[]
}

/** Aturan penulisan yang mengunci agent ke ketentuan Lakoku (sisi admin). */
export const AGENT_FORMAT_RULES: readonly string[] = [
  'Tulis dalam bahasa Indonesia, sudut pandang orang pertama sang protagonis.',
  'Paragraf pendek khas mobile (1-3 kalimat), selingi dialog natural.',
  'Jangan pernah memakai kata: AI, Narraza, RAG, token, skor, bias, ending, pembaca, rute.',
  'Jangan menyebut nomor bab atau istilah teknis apa pun di dalam prosa.',
  'Jangan menutup cerita; bab harus berhenti di tengah ketegangan (cliffhanger) kecuali diminta penutup.',
  'Balas HANYA dengan judul di baris pertama (awali dengan "# ") lalu paragraf dipisah baris kosong.',
]

export interface AgentProseResult {
  title: string
  paragraphs: string[]
}

export function parseAgentProse(markdown: string): AgentProseResult {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  let title = ''
  const bodyStart = (() => {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim() ?? ''
      if (!line) continue
      if (line.startsWith('# ')) {
        title = line.slice(2).trim()
        return i + 1
      }
      const judulMatch = line.match(/^Judul:\s*(.+)$/i)
      if (judulMatch) {
        title = judulMatch[1]?.trim() ?? ''
        return i + 1
      }
      return i
    }
    return lines.length
  })()
  const paragraphs = lines
    .slice(bodyStart)
    .join('\n')
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  if (!paragraphs.length) throw new Error('MCP_PROSE_EMPTY: prosa kosong')
  if (!title) title = paragraphs[0]!.slice(0, 80)
  return { title, paragraphs }
}

interface PlanShape {
  chapterNumber: number
  phase: string
  plannedBeats: string[]
  usesReveals: string[]
  proposedStateDelta: Record<string, unknown>
  introducesCharacters: string[]
}

export interface AgentInstructionArgs {
  input: WriteInput
  policy: GenerationRuntimePolicy
  novelTitle: string
  previousChapter: { title: string; paragraphs: string[] } | null
  previousChapterNumber: number | null
  corePromise: string
  mainConflict: string
  finalQuestion: string
}

export function buildAgentInstruction(args: AgentInstructionArgs): AgentWriteInstruction {
  const plan = args.input.plan as PlanShape
  const snapshot = args.input.snapshot as CanonSnapshot
  const storyAnchors = args.input.continuation?.storyAnchors
  const blueprint = args.input.snapshot.blueprints.find(
    (item) => item.chapterNumber === plan.chapterNumber,
  )
  const repairFindings = (args.input.repairFindings ?? []).map((finding) => {
    if (typeof finding === 'string') return finding
    const record = finding as { code?: string; message?: string; detail?: string }
    return record.message ?? record.detail ?? record.code ?? JSON.stringify(finding)
  })
  return {
    storyId: snapshot.storyId,
    unitKey: unitKeyOf(args.input.continuation?.lockedEndingKey ?? null, plan.chapterNumber),
    chapterNumber: plan.chapterNumber,
    attempt: repairFindings.length > 0 ? 2 : 1,
    genre: args.input.genre ?? null,
    targetWordsMin: args.policy.targetWordsMin,
    targetWordsMax: args.policy.targetWordsMax,
    novelTitle: args.novelTitle,
    phase: plan.phase,
    chapterGoal: String(plan.chapterGoal ?? blueprint?.chapterGoal ?? plan.phase),
    plannedBeats: plan.plannedBeats.map(String),
    mandatoryBeats: [
      ...(args.input.brief?.mustInclude ?? []),
      ...(blueprint?.mandatoryBeats ?? []),
    ].map(String),
    forbiddenReveals: (blueprint?.forbiddenReveals ?? []).map(String),
    corePromise: storyAnchors?.corePromise ?? args.corePromise,
    mainConflict: storyAnchors?.mainConflict ?? args.mainConflict,
    finalQuestion: storyAnchors?.finalQuestion ?? args.finalQuestion,
    previousChapterTitle: args.previousChapter?.title ?? null,
    previousEnding: (args.previousChapter?.paragraphs ?? []).slice(-5),
    repairFindings,
    formatRules: [...AGENT_FORMAT_RULES],
  }
}

export interface AgentProseStore {
  park(key: UnitKey, instruction: AgentWriteInstruction): Promise<AgentProseResult>
  instruction(key: UnitKey): AgentWriteInstruction | null
  resolve(key: UnitKey, prose: AgentProseResult): boolean
  rejectAll(storyId: string, reason: string): void
}

interface ParkedWrite {
  instruction: AgentWriteInstruction
  resolve: (prose: AgentProseResult) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export function createAgentProseStore(opts: { timeoutMs: number }): AgentProseStore & { parkedCount(): number } {
  const parked = new Map<UnitKey, ParkedWrite>()
  return {
    park(key, instruction) {
      const existing = parked.get(key)
      if (existing) {
        clearTimeout(existing.timer)
        existing.reject(new Error('MCP_PROSE_SUPERSEDED'))
      }
      return new Promise<AgentProseResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          parked.delete(key)
          reject(new Error(`MCP_PROSE_TIMEOUT:${key}`))
        }, opts.timeoutMs)
        parked.set(key, { instruction, resolve, reject, timer })
      })
    },
    instruction(key) {
      return parked.get(key)?.instruction ?? null
    },
    resolve(key, prose) {
      const entry = parked.get(key)
      if (!entry) return false
      parked.delete(key)
      clearTimeout(entry.timer)
      entry.resolve(prose)
      return true
    },
    rejectAll(storyId, reason) {
      for (const [key, entry] of [...parked.entries()]) {
        if (entry.instruction.storyId !== storyId) continue
        parked.delete(key)
        clearTimeout(entry.timer)
        entry.reject(new Error(reason))
      }
    },
    parkedCount() {
      return parked.size
    },
  }
}

function activeCharacters(snapshot: CanonSnapshot, chapter: number) {
  return snapshot.characters.filter(
    (c) => c.status !== 'DEAD' && c.introducedChapter <= chapter,
  )
}

function countWords(paragraphs: string[]): number {
  return paragraphs.join(' ').split(/\s+/).filter(Boolean).length
}

function assembleDraft(input: WriteInput, policy: GenerationRuntimePolicy, prose: AgentProseResult): unknown {
  const plan = input.plan as PlanShape
  const snapshot = input.snapshot as CanonSnapshot
  const chapter = plan.chapterNumber
  const chars = activeCharacters(snapshot, chapter)
  const relevantFact = snapshot.facts.find((f) => f.establishedChapter <= chapter)
  const events = chars.slice(0, 3).map((c, i) => ({
    characterMention: c.canonicalName,
    description: `${c.canonicalName} bergerak pada babak "${plan.phase}".`,
    ordinal: i,
    occursAt: chapter * 10 + i,
    isFlashback: false,
  }))
  const knowledgeAssertions = snapshot.knowledge
    .filter((k) => k.knownFromChapter <= chapter)
    .filter((k) => chars.some((c) => c.id === k.characterId))
    .slice(0, 2)
    .map((k) => ({
      characterMention:
        chars.find((c) => c.id === k.characterId)?.canonicalName ?? k.characterId,
      factId: k.factId,
    }))
  const speaker = chars[0]
  const dialogue = speaker
    ? [{ characterId: speaker.id, text: 'Aku akan menghadapi ini sampai selesai.' }]
    : []
  const emotionBeats =
    chars.length >= 2
      ? [{ characterId: chars[0]!.id, targetCharacterId: chars[1]!.id, valence: 'neutral' as const }]
      : []
  const softClaims = relevantFact
    ? [
        {
          characterId: chars[0]?.id ?? relevantFact.subjectCharacterId ?? 'unknown',
          factId: relevantFact.id,
          agrees: true,
        },
      ]
    : []
  return {
    storyId: snapshot.storyId,
    chapterNumber: chapter,
    title: prose.title,
    paragraphs: prose.paragraphs,
    wordCount: countWords(prose.paragraphs),
    sceneCount: policy.targetScenes,
    hasChoiceOrGate: true,
    events,
    knowledgeAssertions,
    reveals: plan.usesReveals.map((secretId) => ({ secretId })),
    proposedStateDelta: plan.proposedStateDelta,
    newNamedCharacters: plan.introducesCharacters,
    dialogue,
    emotionBeats,
    softClaims,
  }
}

export function createAgentProseProvider(deps: {
  inner: GenerationProvider
  policy: GenerationRuntimePolicy
  store: AgentProseStore
}): GenerationProvider {
  const planFallback = createDeterministicProvider(deps.policy)
  const { inner, store } = deps
  return {
    name: 'mcp-gemini-agent-v1',
    async generatePlan(input) {
      return planFallback.generatePlan(input)
    },
    async writeChapter(input: WriteInput, options?: ModelCallExecutionOptions): Promise<unknown> {
      const plan = input.plan as PlanShape
      const snapshot = input.snapshot as CanonSnapshot
      const continuation = input.continuation ?? null
      const previous = continuation?.previousChapter ?? null
      const instruction = buildAgentInstruction({
        input,
        policy: deps.policy,
        novelTitle: continuation?.storyAnchors?.corePromise ?? snapshot.storyId,
        previousChapter: previous
          ? { title: previous.title, paragraphs: previous.endingParagraphs }
          : null,
        previousChapterNumber: continuation?.previousChapter?.number ?? null,
        corePromise: continuation?.storyAnchors?.corePromise ?? '',
        mainConflict: continuation?.storyAnchors?.mainConflict ?? '',
        finalQuestion: continuation?.storyAnchors?.finalQuestion ?? '',
      })
      const prose = await store.park(instruction.unitKey, instruction)
      return assembleDraft(input, deps.policy, prose)
    },
    async generateChoices(input: ChoiceProviderInput, options?: ModelCallExecutionOptions) {
      if (!inner.generateChoices) throw new Error('MCP_INNER_CHOICES_UNAVAILABLE')
      return inner.generateChoices(input, options)
    },
    async generateCatalogReactions(input: CatalogReactionsProviderInput, options?: ModelCallExecutionOptions) {
      if (!inner.generateCatalogReactions) throw new Error('MCP_INNER_REACTIONS_UNAVAILABLE')
      return inner.generateCatalogReactions(input, options)
    },
    async generateStoryContract(input: StoryContractInput, options?: StoryContractCallOptions) {
      if (!inner.generateStoryContract) throw new Error('MCP_INNER_CONTRACT_UNAVAILABLE')
      return inner.generateStoryContract(input, options)
    },
    async evaluateSemanticContinuity(input, options?: ModelCallExecutionOptions) {
      if (!inner.evaluateSemanticContinuity) {
        return planFallback.evaluateSemanticContinuity()
      }
      return inner.evaluateSemanticContinuity(input, options)
    },
  }
}

/** Store smoke: langsung menjawab prosa template dari instruction (tanpa agent). */
export function createAutoResponderProseStore(): AgentProseStore {
  const inner = createAgentProseStore({ timeoutMs: 60_000 })
  return {
    park(key, instruction) {
      const pending = inner.park(key, instruction)
      const beats = instruction.plannedBeats.length
        ? instruction.plannedBeats
        : instruction.mandatoryBeats
      const opening = beats[0]
        ? `Aku menahan napas. ${beats[0]!.charAt(0).toUpperCase()}${beats[0]!.slice(1)} tidak bisa ditunda lagi.`
        : 'Aku menahan napas di ambang keputusan ini.'
      const body = [
        opening,
        `Sisa malam berjalan tanpa banyak kata. Aku menyelesaikan satu hal kecil, lalu satu lagi, seolah urutan itu bisa menahan dunia agar tidak berubah terlalu cepat.`,
        `"Kamu yakin dengan langkah ini?" tanya suara di sebelahku. Aku tidak menjawab segera.`,
        `Ketika lampu koridor meredup, satu kalimat tetap tergantung di kepala: keputusan seperti ini selalu menagih harganya.`,
      ]
      void pending.catch(() => undefined)
      inner.resolve(key, { title: `Bab ${instruction.chapterNumber}`, paragraphs: body })
      return pending
    },
    instruction: (key) => inner.instruction(key),
    resolve: (key, prose) => inner.resolve(key, prose),
    rejectAll: (storyId, reason) => inner.rejectAll(storyId, reason),
  }
}
```

Catatan: jika `generateChapter` gateway ternyata memanggil `evaluateSemanticContinuity` via inner pada jalur katalog dan itu menambah biaya tak terduga, biarkan — biaya judge flash kecil dan tetap diikat E0CostGuard.

- [ ] **Step 3: Jalankan test**

Run: `pnpm test:unit tests/mcp-seed/agent-provider.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/mcp-seed/agent-provider.server.ts tests/mcp-seed/agent-provider.test.ts
git commit -m "feat(mcp-seed): provider prosa agent gemini dengan park/resolve"
```

---

### Task 3: Pump per novel + pemetaan unit (`lib/mcp-seed/pump.server.ts`)

**Files:**
- Create: `lib/mcp-seed/pump.server.ts`
- Test: `tests/mcp-seed/pump.test.ts`

**Interfaces:**
- Consumes: `generateCatalogNovel`, `CatalogGeneratorDeps`, `CatalogGeneratorWriter`, `CatalogGeneratorStoryState`, `CatalogChapterRef` dari `@/lib/catalog/generator.server` (murni, tanpa server-only); `assertCatalogContract` dari `@/lib/catalog/catalog-contract`; Task 2 (`createAgentProseProvider`, `AgentProseStore`, `unitKeyOf`).
- Produces:
  - `export interface MappedUnit { index: number; number: number; endingKey: string | null }`
  - `export function mapUnits(contract: StoryContract): MappedUnit[]` — 0–43 spine, lalu per kandidat ending (urutan kontrak) bab 45–50.
  - `export function unitIndexToTarget(contract: StoryContract, index: number): { number: number; endingKey: string | null }`
  - `export interface CommitTracker { committed(storyId: string, key: UnitKey): boolean; waitCommitted(storyId: string, key: UnitKey, timeoutMs: number): Promise<boolean> }`
  - `export interface McpSeedPump { kick(storyId: string): void; isRunning(storyId: string): boolean; lastError(storyId: string): string | null; store: AgentProseStore; commits: CommitTracker }`
  - `export function createMcpSeedPump(deps: { writer: CatalogGeneratorWriter; inner: GenerationProvider; policy?: GenerationRuntimePolicy; proseTimeoutMs?: number; store?: AgentProseStore }): McpSeedPump` — McpSeedPump punya `kick/isRunning/lastError/store/commits/loadState/loadContract/markReview/nextRequiredUnit`.

- [ ] **Step 1: Tulis test yang gagal dulu**

`tests/mcp-seed/pump.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import {
  createMcpSeedPump,
  mapUnits,
  unitIndexToTarget,
  unitIndexToTarget as toTarget,
} from '@/lib/mcp-seed/pump.server'
import { createAutoResponderProseStore } from '@/lib/mcp-seed/agent-provider.server'
import { createDeterministicProvider, DEFAULT_RUNTIME_POLICY } from '@lakoku/ai-gateway'
import type { CatalogGeneratorWriter, CatalogGeneratorStoryState, CatalogChapterRef } from '@/lib/catalog/generator.server'
import type { StoryContract } from '@/lib/story-engine/story-contract'
import { assertCatalogContract } from '@/lib/catalog/catalog-contract'

const CONTRACT = assertCatalogContract({
  title: 'Uji Pump',
  mainCharacter: { name: 'Rara' },
  endingCandidates: [
    { key: 'ending-a', kind: 'main', name: 'Kemenangan', condition: 'Rara menang di pengadilan.' },
    { key: 'ending-b', kind: 'main', name: 'Kalah', condition: 'Rara kalah tapi damai.' },
    { key: 'ending-s', kind: 'secret', name: 'Rahasia Ibu', condition: 'Ibu masih hidup.' },
  ],
  chapterTargets: [],
  revealRunway: [],
  corePromise: 'p',
  mainConflict: 'c',
  finalQuestion: 'q',
  styleProfile: 'kbm_viral_v1',
  genre: 'mystery',
} as unknown as StoryContract)

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

function fakeWriter(): CatalogGeneratorWriter & { state: CatalogGeneratorStoryState } {
  const state: CatalogGeneratorStoryState = {
    status: 'draft',
    contract: CONTRACT,
    spine: new Map<number, CatalogChapterRef>(),
    variants: new Map(),
  }
  return {
    state,
    async loadState() { return state },
    async loadCanon() {
      return {
        storyId: 'catalog:uji-pump',
        characters: [
          { id: 'ch1', canonicalName: 'Rara', status: 'ALIVE', introducedChapter: 1 },
          { id: 'ch2', canonicalName: 'Bu Sinta', status: 'ALIVE', introducedChapter: 1 },
        ],
        facts: [],
        knowledge: [],
        secrets: [],
        voiceSheets: [],
        timeline: [],
        blueprints: [],
        characterAliases: [],
      } as never
    },
    async markGenerating() { state.status = 'generating' },
    async writeSpineChapter(_storyId, chapter) { state.spine.set(chapter.chapterNumber, { title: chapter.title, paragraphs: chapter.paragraphs }) },
    async writeVariantChapter(_storyId, endingKey, chapter) {
      const map = state.variants.get(endingKey) ?? new Map<number, CatalogChapterRef>()
      map.set(chapter.chapterNumber, { title: chapter.title, paragraphs: chapter.paragraphs })
      state.variants.set(endingKey, map)
    },
    async deleteSpineChapter() {},
    async setProgress(_storyId, progress) { state.progress = progress } as never,
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
})
```

Catatan implementasi fake writer: `setProgress` aslinya tak punya `state.progress` di interface state — tambahkan field lokal di fake saja; typecast sesuai kebutuhan tanpa `as any` (pakai `as never`/`satisfies` yang sah).

Run: `pnpm test:unit tests/mcp-seed/pump.test.ts`
Expected: FAIL (modul belum ada).

- [ ] **Step 2: Implementasi `lib/mcp-seed/pump.server.ts`**

```typescript
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
  type CatalogGeneratedChapter,
  type CatalogGeneratorStoryState,
  type CatalogGeneratorWriter,
} from '@/lib/catalog/generator.server'
import {
  createAgentProseProvider,
  unitKeyOf,
  type AgentProseResult,
  type AgentProseStore,
  type AgentWriteInstruction,
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

function createDefaultProseStore(proseTimeoutMs: number): AgentProseStore {
  const parked = new Map<string, {
    instruction: AgentWriteInstruction
    resolve: (prose: AgentProseResult) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  return {
    park(key, instruction) {
      const existing = parked.get(key)
      if (existing) {
        clearTimeout(existing.timer)
        existing.reject(new Error('MCP_PROSE_SUPERSEDED'))
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          parked.delete(key)
          reject(new Error(`MCP_PROSE_TIMEOUT:${key}`))
        }, proseTimeoutMs)
        parked.set(key, { instruction, resolve, reject, timer })
      })
    },
    instruction(key) {
      return parked.get(key)?.instruction ?? null
    },
    resolve(key, prose) {
      const entry = parked.get(key)
      if (!entry) return false
      parked.delete(key)
      clearTimeout(entry.timer)
      entry.resolve(prose)
      return true
    },
    rejectAll(storyId, reason) {
      for (const [key, entry] of [...parked.entries()]) {
        if (entry.instruction.storyId !== storyId) continue
        parked.delete(key)
        clearTimeout(entry.timer)
        entry.reject(new Error(reason))
      }
    },
  }
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

  const store: AgentProseStore = deps.store ?? createDefaultProseStore(proseTimeoutMs)

  const commitKeys = new Map<string, Set<string>>()
  const commitWaiters = new Map<string, Array<{ key: string; resolve: (ok: boolean) => void }>>()
  const markCommitted = (storyId: string, key: string): void => {
    const set = commitKeys.get(storyId) ?? new Set<string>()
    set.add(key)
    commitKeys.set(storyId, set)
    const waiters = commitWaiters.get(storyId) ?? []
    commitWaiters.set(storyId, waiters.filter((waiter) => {
      if (waiter.key !== key) return true
      waiter.resolve(true)
      return false
    }))
  }
  const commits: CommitTracker = {
    committed(storyId, key) {
      return commitKeys.get(storyId)?.has(key) ?? false
    },
    async waitCommitted(storyId, key, timeoutMs) {
      if (commits.committed(storyId, key)) return true
      return new Promise<boolean>((resolve) => {
        const list = commitWaiters.get(storyId) ?? []
        list.push({
          key,
          resolve: (ok) => {
            clearTimeout(timer)
            resolve(ok)
          },
        })
        commitWaiters.set(storyId, list)
        const timer = setTimeout(() => resolve(commits.committed(storyId, key)), timeoutMs)
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
      void generateCatalogNovel(
        { provider, writer: trackingWriter, policy },
        {
          storyId,
          log: (message) => console.log(`[mcp-seed:${storyId}] ${message}`),
        },
      )
        .catch((err: unknown) => {
          entry.lastError = err instanceof Error ? err.message : String(err)
          console.error(`[mcp-seed:${storyId}] pump gagal:`, entry.lastError)
        })
        .finally(() => {
          entry.running = false
          store.rejectAll(storyId, 'MCP_PUMP_STOPPED')
        })
    },
  }
}
```

- [ ] **Step 3: Jalankan test**

Run: `pnpm test:unit tests/mcp-seed/pump.test.ts`
Expected: PASS (novel 62 unit tuntas via auto-responder, status `review`).

- [ ] **Step 4: Commit**

```bash
git add lib/mcp-seed/pump.server.ts tests/mcp-seed/pump.test.ts
git commit -m "feat(mcp-seed): pump generasi per novel dengan commit tracker"
```

---

### Task 4: Gates (enable, volume, active drafts, allowlist) — `lib/mcp-seed/gates.server.ts`

**Files:**
- Create: `lib/mcp-seed/gates.server.ts`
- Test: `tests/mcp-seed/gates.test.ts`

**Interfaces:**
- Consumes: `rateLimit` dari `@/lib/security/rate-limit` (murni).
- Produces:
  - `export interface SeedVolumeLoaders { novelsThisMonth(source: string, monthStart: Date): Promise<number>; activeDrafts(source: string): Promise<number> }`
  - `export function seedEnv(): { enabled: boolean; maxNovelsPerMonth: number; maxActiveDrafts: number; allowedUserIds: string[] }`
  - `export async function assertAssignAllowed(loaders: SeedVolumeLoaders, now: Date): Promise<void>` — lempar `MCP_SEED_DISABLED`, `MCP_SEED_VOLUME_CAP:<n>`, `MCP_SEED_ACTIVE_DRAFT_CAP:<n>`.
  - `export function assertToolUser(sub: string, allowedUserIds: string[]): void` — lempar `MCP_SEED_USER_FORBIDDEN:<sub>`.
  - `export function toolRateLimit(sub: string, now?: number): { ok: boolean; retryAfterSec: number }` — 60 call/menit per user.

- [ ] **Step 1: Tulis test yang gagal dulu**

`tests/mcp-seed/gates.test.ts`:

```typescript
import { afterEach, describe, expect, it } from 'vitest'
import { assertAssignAllowed, assertToolUser, seedEnv, toolRateLimit, type SeedVolumeLoaders } from '@/lib/mcp-seed/gates.server'

function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

afterEach(() => {
  setEnv({ MCP_SEED_ENABLED: undefined, MCP_SEED_MAX_NOVELS_PER_MONTH: undefined, MCP_SEED_MAX_ACTIVE_DRAFTS: undefined, MCP_SEED_ALLOWED_USER_IDS: undefined })
})

const loaders: SeedVolumeLoaders = {
  async novelsThisMonth() { return 0 },
  async activeDrafts() { return 0 },
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
    const sub = 'rate-test-user'
    let ok = true
    for (let i = 0; i < 60; i++) ok = toolRateLimit(sub, 1_000_000).ok
    expect(ok).toBe(true)
    expect(toolRateLimit(sub, 1_000_000).ok).toBe(false)
  })
})
```

Run: `pnpm test:unit tests/mcp-seed/gates.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implementasi**

```typescript
/**
 * Gate MCP Seed Server: master switch, kuota volume bulanan, cap draft
 * aktif, allowlist user, dan rate limit per tool call. Murni — loader DB
 * diinjeksi agar bisa diuji tanpa koneksi.
 */
import { rateLimit } from '@/lib/security/rate-limit'

export interface SeedVolumeLoaders {
  novelsThisMonth(source: string, monthStart: Date): Promise<number>
  activeDrafts(source: string): Promise<number>
}

export interface SeedEnv {
  enabled: boolean
  maxNovelsPerMonth: number
  maxActiveDrafts: number
  allowedUserIds: string[]
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function seedEnv(): SeedEnv {
  return {
    enabled: process.env.MCP_SEED_ENABLED === '1',
    maxNovelsPerMonth: intEnv('MCP_SEED_MAX_NOVELS_PER_MONTH', 3),
    maxActiveDrafts: intEnv('MCP_SEED_MAX_ACTIVE_DRAFTS', 1),
    allowedUserIds: (process.env.MCP_SEED_ALLOWED_USER_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  }
}

export async function assertAssignAllowed(loaders: SeedVolumeLoaders, now: Date): Promise<void> {
  const env = seedEnv()
  if (!env.enabled) throw new Error('MCP_SEED_DISABLED: fitur belum diaktifkan di server')
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const created = await loaders.novelsThisMonth('gemini-agent', monthStart)
  if (created >= env.maxNovelsPerMonth) {
    throw new Error(`MCP_SEED_VOLUME_CAP:${env.maxNovelsPerMonth} novel per bulan sudah tercapai`)
  }
  const active = await loaders.activeDrafts('gemini-agent')
  if (active >= env.maxActiveDrafts) {
    throw new Error(`MCP_SEED_ACTIVE_DRAFT_CAP:${env.maxActiveDrafts} novel masih dalam generasi`)
  }
}

export function assertToolUser(sub: string, allowedUserIds: string[]): void {
  if (!allowedUserIds.includes(sub)) {
    throw new Error(`MCP_SEED_USER_FORBIDDEN:${sub}`)
  }
}

export function toolRateLimit(sub: string, now: number = Date.now()): { ok: boolean; retryAfterSec: number } {
  return rateLimit(`mcp-seed:${sub}`, 60, 60_000, now)
}
```

Run: `pnpm test:unit tests/mcp-seed/gates.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/mcp-seed/gates.server.ts tests/mcp-seed/gates.test.ts
git commit -m "feat(mcp-seed): gate enable, kuota volume, cap draft, allowlist"
```

---

### Task 5: OAuth 2.1 core + endpoint authorize/token + metadata well-known

**Files:**
- Create: `lib/mcp-seed/oauth-core.ts` (murni — diuji)
- Create: `lib/mcp-seed/oauth-store.server.ts` (MemoryTokenStore untuk test juga diekspor di sini; `server-only`)
- Create: `lib/mcp-seed/oauth-consent.server.ts` (HTML consent render — murni — diuji)
- Create: `app/api/mcp/seed/oauth/authorize/route.ts`
- Create: `app/api/mcp/seed/oauth/token/route.ts`
- Create: `app/.well-known/oauth-protected-resource/route.ts`
- Create: `app/.well-known/oauth-authorization-server/route.ts`
- Test: `tests/mcp-seed/oauth-core.test.ts`

**Interfaces:**
- Produces:
  - `export function verifyPkce(verifier: string, challenge: string): boolean`
  - `export function mintAccessToken(sub: string, secret: string, nowSec: number, ttlSec?: number): string`
  - `export function verifyAccessToken(token: string, secret: string, nowSec: number): { sub: string } | null`
  - `export function randomToken(bytes?: number): string` (base64url)
  - `export function sha256B64Url(input: string): string`
  - `export interface CodeRow { codeHash: string; userId: string; clientId: string; redirectUri: string; scope: string; expiresAt: number }`
  - `export interface RefreshRow { tokenHash: string; userId: string; clientId: string; scope: string; expiresAt: number }`
  - `export interface OAuthTokenStore { putCode(row: CodeRow): Promise<void>; takeCode(codeHash: string): Promise<CodeRow | null>; putRefresh(row: RefreshRow): Promise<void>; takeRefresh(tokenHash: string): Promise<RefreshRow | null> }`
  - `export function createMemoryTokenStore(): OAuthTokenStore`
  - `export function renderConsentPage(args: { clientId: string; redirectUri: string; state: string; scope: string; codeChallenge: string; email: string | undefined }): string` (HTML lengkap, form POST ke path yang sama)

- [ ] **Step 1: Tulis test yang gagal dulu**

`tests/mcp-seed/oauth-core.test.ts`:

```typescript
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
    await store.putCode({ codeHash: sha256B64Url(code), userId: 'u1', clientId: 'c1', redirectUri: 'https://x/cb', scope: 'seed', expiresAt: Date.now() + 60_000 })
    const first = await store.takeCode(sha256B64Url(code))
    expect(first?.userId).toBe('u1')
    expect(await store.takeCode(sha256B64Url(code))).toBeNull()
  })
  it('code kadaluarsa dianggap null', async () => {
    const store = createMemoryTokenStore()
    const code = randomToken(32)
    await store.putCode({ codeHash: sha256B64Url(code), userId: 'u1', clientId: 'c1', redirectUri: 'https://x/cb', scope: 'seed', expiresAt: Date.now() - 1 })
    expect(await store.takeCode(sha256B64Url(code))).toBeNull()
  })
  it('refresh dipakai sekali lalu null', async () => {
    const store = createMemoryTokenStore()
    const token = randomToken(48)
    await store.putRefresh({ tokenHash: sha256B64Url(token), userId: 'u1', clientId: 'c1', scope: 'seed', expiresAt: Date.now() + 3_600_000 })
    expect((await store.takeRefresh(sha256B64Url(token)))?.userId).toBe('u1')
    expect(await store.takeRefresh(sha256B64Url(token))).toBeNull()
  })
})
```

Run: `pnpm test:unit tests/mcp-seed/oauth-core.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implementasi `lib/mcp-seed/oauth-core.ts`**

```typescript
/**
 * OAuth 2.1 murni untuk MCP Seed Server (tanpa dependency baru):
 * PKCE S256, access token HMAC-SHA256 (format compact JWT-like),
 * penyimpanan code/refresh via hash SHA-256 (single-use).
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

function b64Url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

export function sha256B64Url(input: string): string {
  return createHash('sha256').update(input).digest('base64url')
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false
  if (verifier.length < 43 || verifier.length > 128) return false
  return sha256B64Url(verifier) === challenge
}

interface AccessPayload {
  sub: string
  iat: number
  exp: number
  jti: string
}

export function mintAccessToken(sub: string, secret: string, nowSec: number, ttlSec = 3_600): string {
  const payload: AccessPayload = {
    sub,
    iat: nowSec,
    exp: nowSec + ttlSec,
    jti: randomToken(8),
  }
  const body = b64Url(JSON.stringify(payload))
  const sig = b64Url(createHmac('sha256', secret).update(body).digest())
  return `${body}.${sig}`
}

export function verifyAccessToken(token: string, secret: string, nowSec: number): { sub: string } | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, sig] = parts as [string, string]
  const expected = createHmac('sha256', secret).update(body).digest()
  const actual = (() => {
    try {
      return Buffer.from(sig, 'base64url')
    } catch {
      return null
    }
  })()
  if (!actual || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  let payload: AccessPayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AccessPayload
  } catch {
    return null
  }
  if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null
  if (payload.exp <= nowSec) return null
  return { sub: payload.sub }
}

export interface CodeRow {
  codeHash: string
  userId: string
  clientId: string
  redirectUri: string
  scope: string
  expiresAt: number
}

export interface RefreshRow {
  tokenHash: string
  userId: string
  clientId: string
  scope: string
  expiresAt: number
}

export interface OAuthTokenStore {
  putCode(row: CodeRow): Promise<void>
  takeCode(codeHash: string): Promise<CodeRow | null>
  putRefresh(row: RefreshRow): Promise<void>
  takeRefresh(tokenHash: string): Promise<RefreshRow | null>
}

export function createMemoryTokenStore(): OAuthTokenStore {
  const codes = new Map<string, CodeRow>()
  const refreshes = new Map<string, RefreshRow>()
  return {
    async putCode(row) { codes.set(row.codeHash, row) },
    async takeCode(codeHash) {
      const row = codes.get(codeHash)
      if (!row) return null
      codes.delete(codeHash)
      if (row.expiresAt <= Date.now()) return null
      return row
    },
    async putRefresh(row) { refreshes.set(row.tokenHash, row) },
    async takeRefresh(tokenHash) {
      const row = refreshes.get(tokenHash)
      if (!row) return null
      refreshes.delete(tokenHash)
      if (row.expiresAt <= Date.now()) return null
      return row
    },
  }
}
```

- [ ] **Step 3: Implementasi `lib/mcp-seed/oauth-store.server.ts` (store DB)**

```typescript
import 'server-only'
import { getDb, result, single } from '@lakoku/db'
import type { CodeRow, OAuthTokenStore, RefreshRow } from '@/lib/mcp-seed/oauth-core'
import { sha256B64Url } from '@/lib/mcp-seed/oauth-core'

function assertOk(res: { error: { message: string } | null }, label: string): void {
  if (res.error) throw new Error(`[mcp-seed-oauth] ${label} gagal: ${res.error.message}`)
}

/**
 * Store OAuth di DB produksi (tabel mcp_seed_oauth, migration Task 5b).
 * Code & refresh disimpan sebagai hash SHA-256; single-use dijaga oleh
 * DELETE ... RETURNING (atomik).
 */
export function createDbTokenStore(): OAuthTokenStore {
  const db = getDb()
  return {
    async putCode(row: CodeRow): Promise<void> {
      assertOk(await result(
        db.insertInto('mcp_seed_oauth').values({
          kind: 'code',
          token_hash: row.codeHash,
          user_id: row.userId,
          client_id: row.clientId,
          redirect_uri: row.redirectUri,
          scope: row.scope,
          expires_at: new Date(row.expiresAt).toISOString(),
        }).execute(),
      ), 'putCode')
    },
    async takeCode(codeHash: string): Promise<CodeRow | null> {
      const deleted = await db.deleteFrom('mcp_seed_oauth')
        .where('token_hash', '=', codeHash)
        .where('kind', '=', 'code')
        .returning(['user_id', 'client_id', 'redirect_uri', 'scope', 'expires_at'])
        .execute()
      const row = deleted[0]
      if (!row) return null
      if (new Date(row.expires_at).getTime() <= Date.now()) return null
      return {
        codeHash,
        userId: String(row.user_id),
        clientId: String(row.client_id),
        redirectUri: String(row.redirect_uri),
        scope: String(row.scope),
        expiresAt: new Date(row.expires_at).getTime(),
      }
    },
    async putRefresh(row: RefreshRow): Promise<void> {
      assertOk(await result(
        db.insertInto('mcp_seed_oauth').values({
          kind: 'refresh',
          token_hash: row.tokenHash,
          user_id: row.userId,
          client_id: row.clientId,
          redirect_uri: null,
          scope: row.scope,
          expires_at: new Date(row.expiresAt).toISOString(),
        }).execute(),
      ), 'putRefresh')
    },
    async takeRefresh(tokenHash: string): Promise<RefreshRow | null> {
      const deleted = await db.deleteFrom('mcp_seed_oauth')
        .where('token_hash', '=', tokenHash)
        .where('kind', '=', 'refresh')
        .returning(['user_id', 'client_id', 'scope', 'expires_at'])
        .execute()
      const row = deleted[0]
      if (!row) return null
      if (new Date(row.expires_at).getTime() <= Date.now()) return null
      return {
        tokenHash,
        userId: String(row.user_id),
        clientId: String(row.client_id),
        scope: String(row.scope),
        expiresAt: new Date(row.expires_at).getTime(),
      }
    },
  }
}

export { sha256B64Url }
```

- [ ] **Step 4: Migration `mcp_seed_oauth`**

`db/migrations/20261107130000_mcp_seed_oauth.sql` (salin juga ke `neon/migrations/`):

```sql
-- MCP Seed Server: penyimpanan OAuth 2.1 (code + refresh, hash saja)
--
-- Hanya hash token yang disimpan; code single-use dijaga DELETE RETURNING
-- di lib/mcp-seed/oauth-store.server.ts.

create table if not exists public.mcp_seed_oauth (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('code', 'refresh')),
  token_hash text not null unique,
  user_id text not null,
  client_id text not null,
  redirect_uri text null,
  scope text not null default 'seed',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists mcp_seed_oauth_kind_idx on public.mcp_seed_oauth (kind);
create index if not exists mcp_seed_oauth_user_idx on public.mcp_seed_oauth (user_id);
```

Terapkan: `pnpm db:migrate` (DATABASE_URL dev).

- [ ] **Step 5: Implementasi `lib/mcp-seed/oauth-consent.server.ts`**

```typescript
/** Halaman consent OAuth minimal (sisi admin). Murni agar bisa diuji. */
export function renderConsentPage(args: {
  clientId: string
  redirectUri: string
  state: string
  scope: string
  codeChallenge: string
  email: string | undefined
}): string {
  const esc = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  return `<!doctype html>
<html lang="id">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Izinkan akses Seed — Lakoku</title>
<style>body{font-family:system-ui,sans-serif;background:#0d0d14;color:#eee;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{background:#171722;padding:32px;border-radius:16px;max-width:420px}
code{background:#0d0d14;padding:2px 6px;border-radius:6px;word-break:break-all}
button{background:#6d5dfc;color:#fff;border:0;border-radius:10px;padding:12px 20px;font-size:15px;width:100%;margin-top:16px;cursor:pointer}
.muted{color:#999;font-size:13px}</style></head>
<body><div class="card">
<h2>Izinkan akses Seed Lakoku</h2>
<p class="muted">Login sebagai <strong>${esc(args.email ?? '(tanpa email)')}</strong></p>
<p>Gemini (client <code>${esc(args.clientId)}</code>) meminta izin untuk:</p>
<ul>
<li>Membuat draft novel katalog</li>
<li>Menerima spesifikasi bab dan mengirim prosa</li>
<li>Menyelesaikan novel ke status <strong>review</strong> (tanpa publish)</li>
</ul>
<p class="muted">Redirect ke: <code>${esc(args.redirectUri)}</code></p>
<form method="post" action="/api/mcp/seed/oauth/authorize">
<input type="hidden" name="client_id" value="${esc(args.clientId)}">
<input type="hidden" name="redirect_uri" value="${esc(args.redirectUri)}">
<input type="hidden" name="state" value="${esc(args.state)}">
<input type="hidden" name="scope" value="${esc(args.scope)}">
<input type="hidden" name="code_challenge" value="${esc(args.codeChallenge)}">
<button type="submit">Izinkan</button>
</form>
</div></body></html>`
}
```

- [ ] **Step 6: Route authorize**

`app/api/mcp/seed/oauth/authorize/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/api/user-state'
import { getAdminRole } from '@/lib/admin/auth'
import { seedEnv } from '@/lib/mcp-seed/gates.server'
import { randomToken, sha256B64Url } from '@/lib/mcp-seed/oauth-core'
import { createDbTokenStore } from '@/lib/mcp-seed/oauth-store.server'
import { renderConsentPage } from '@/lib/mcp-seed/oauth-consent.server'
import { clientIpFrom, rateLimit } from '@/lib/security/rate-limit'

const CODE_TTL_MS = 10 * 60 * 1000

function siteOrigin(req: Request): string {
  return process.env.MCP_SEED_PUBLIC_ORIGIN ?? new URL(req.url).origin
}

function loginRedirect(req: Request): Response {
  const next = encodeURIComponent(new URL(req.url).pathname + '?' + new URL(req.url).searchParams.toString())
  return NextResponse.redirect(`${siteOrigin(req)}/login?next=${next}`)
}

function paramsOf(req: Request): URLSearchParams {
  return new URL(req.url).searchParams
}

async function sessionAdmin(req: Request): Promise<{ id: string; email: string | undefined } | null> {
  const user = await getSessionUser()
  if (!user) return null
  const role = await getAdminRole(user.id)
  if (!role) return null
  const env = seedEnv()
  if (env.allowedUserIds.length > 0 && !env.allowedUserIds.includes(user.id)) return null
  return { id: user.id, email: user.email }
}

export async function GET(req: Request): Promise<Response> {
  const limiter = rateLimit(`mcp-oauth:${clientIpFrom(req)}`, 20, 60_000)
  if (!limiter.ok) return NextResponse.json({ error: 'Terlalu sering.' }, { status: 429 })
  const admin = await sessionAdmin(req)
  if (!admin) return loginRedirect(req)
  const params = paramsOf(req)
  const clientId = params.get('client_id') ?? ''
  const redirectUri = params.get('redirect_uri') ?? ''
  const state = params.get('state') ?? ''
  const scope = params.get('scope') ?? 'seed'
  const codeChallenge = params.get('code_challenge') ?? ''
  if (clientId !== (process.env.MCP_SEED_OAUTH_CLIENT_ID ?? '')) {
    return NextResponse.json({ error: 'client_id tidak dikenal.' }, { status: 400 })
  }
  if (!redirectUri.startsWith('https://')) {
    return NextResponse.json({ error: 'redirect_uri wajib https.' }, { status: 400 })
  }
  if (!codeChallenge) {
    return NextResponse.json({ error: 'code_challenge (PKCE S256) wajib.' }, { status: 400 })
  }
  return new Response(renderConsentPage({ clientId, redirectUri, state, scope, codeChallenge, email: admin.email }), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

export async function POST(req: Request): Promise<Response> {
  const admin = await sessionAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 })
  const form = await req.formData()
  const clientId = String(form.get('client_id') ?? '')
  const redirectUri = String(form.get('redirect_uri') ?? '')
  const state = String(form.get('state') ?? '')
  const scope = String(form.get('scope') ?? 'seed')
  const codeChallenge = String(form.get('code_challenge') ?? '')
  if (clientId !== (process.env.MCP_SEED_OAUTH_CLIENT_ID ?? '') || !redirectUri.startsWith('https://') || !codeChallenge) {
    return NextResponse.json({ error: 'Permintaan tidak valid.' }, { status: 400 })
  }
  const code = randomToken(32)
  await createDbTokenStore().putCode({
    codeHash: sha256B64Url(code),
    userId: admin.id,
    clientId,
    redirectUri,
    scope,
    expiresAt: Date.now() + CODE_TTL_MS,
  })
  const target = new URL(redirectUri)
  target.searchParams.set('code', code)
  if (state) target.searchParams.set('state', state)
  return NextResponse.redirect(target.toString())
}
```

- [ ] **Step 7: Route token**

`app/api/mcp/seed/oauth/token/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { clientIpFrom, rateLimit } from '@/lib/security/rate-limit'
import {
  mintAccessToken,
  randomToken,
  sha256B64Url,
  verifyPkce,
} from '@/lib/mcp-seed/oauth-core'
import { createDbTokenStore } from '@/lib/mcp-seed/oauth-store.server'

const ACCESS_TTL_SEC = 3_600
const REFRESH_TTL_MS = 30 * 24 * 3_600 * 1000

function oauthSecret(): string {
  return process.env.MCP_SEED_OAUTH_SECRET ?? process.env.BETTER_AUTH_SECRET ?? ''
}

function clientCredentials(req: Request, form: URLSearchParams): { id: string; secret: string } | null {
  const header = req.headers.get('authorization')
  if (header?.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
      const idx = decoded.indexOf(':')
      if (idx > 0) return { id: decoded.slice(0, idx), secret: decoded.slice(idx + 1) }
    } catch { /* fallthrough */ }
  }
  const id = form.get('client_id')
  const secret = form.get('client_secret')
  if (id && secret) return { id, secret }
  return null
}

export async function POST(req: Request): Promise<Response> {
  const limiter = rateLimit(`mcp-token:${clientIpFrom(req)}`, 30, 60_000)
  if (!limiter.ok) return NextResponse.json({ error: 'terlalu sering' }, { status: 429 })

  const form = new URLSearchParams(await req.text())
  const creds = clientCredentials(req, form)
  const expectedId = process.env.MCP_SEED_OAUTH_CLIENT_ID ?? ''
  const expectedSecret = process.env.MCP_SEED_OAUTH_CLIENT_SECRET ?? ''
  if (!creds || creds.id !== expectedId || creds.secret !== expectedSecret) {
    return NextResponse.json({ error: 'invalid_client' }, { status: 401 })
  }

  const grant = form.get('grant_type')
  const store = createDbTokenStore()

  if (grant === 'authorization_code') {
    const code = form.get('code') ?? ''
    const verifier = form.get('code_verifier') ?? ''
    const redirectUri = form.get('redirect_uri') ?? ''
    const row = await store.takeCode(sha256B64Url(code))
    if (!row || row.clientId !== expectedId) {
      return NextResponse.json({ error: 'invalid_grant' }, { status: 400 })
    }
    if (row.redirectUri !== redirectUri) {
      return NextResponse.json({ error: 'invalid_grant' }, { status: 400 })
    }
    if (!verifyPkce(verifier, form.get('code_challenge') ?? '')) {
      return NextResponse.json({ error: 'invalid_grant' }, { status: 400 })
    }
    return issueTokens(store, row.userId, expectedId, row.scope)
  }

  if (grant === 'refresh_token') {
    const token = form.get('refresh_token') ?? ''
    const row = await store.takeRefresh(sha256B64Url(token))
    if (!row || row.clientId !== expectedId) {
      return NextResponse.json({ error: 'invalid_grant' }, { status: 400 })
    }
    return issueTokens(store, row.userId, expectedId, row.scope)
  }

  return NextResponse.json({ error: 'unsupported_grant_type' }, { status: 400 })
}

async function issueTokens(store: ReturnType<typeof createDbTokenStore>, userId: string, clientId: string, scope: string): Promise<Response> {
  const refresh = randomToken(48)
  await store.putRefresh({
    tokenHash: sha256B64Url(refresh),
    userId,
    clientId,
    scope,
    expiresAt: Date.now() + REFRESH_TTL_MS,
  })
  const nowSec = Math.floor(Date.now() / 1000)
  return NextResponse.json({
    access_token: mintAccessToken(userId, oauthSecret(), nowSec, ACCESS_TTL_SEC),
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_SEC,
    refresh_token: refresh,
    scope,
  })
}
```

Catatan PKCE di token endpoint: challenge TIDAK dikirim ulang oleh client pada token request — challenge tersimpan di code record. Simpan `code_challenge` di `putCode` saat consent POST (tambahkan kolom `code_challenge` ke `mcp_seed_oauth` **bila langkah 4 belum dijalankan** — final SQL di bawah). SQL final migration (ganti Step 4):

```sql
create table if not exists public.mcp_seed_oauth (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('code', 'refresh')),
  token_hash text not null unique,
  user_id text not null,
  client_id text not null,
  redirect_uri text null,
  code_challenge text null,
  scope text not null default 'seed',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists mcp_seed_oauth_kind_idx on public.mcp_seed_oauth (kind);
create index if not exists mcp_seed_oauth_user_idx on public.mcp_seed_oauth (user_id);
```

- `CodeRow` tambah field `codeChallenge: string`; `putCode` menyimpannya; pada grant `authorization_code` verifikasi `verifyPkce(verifier, row.codeChallenge)` (BUKAN dari form). Sesuaikan test memory store dengan field baru.
- `McpSeedOauth` interface di `lib/db/db-types.ts`:

```typescript
export interface McpSeedOauth {
  client_id: string;
  code_challenge: string | null;
  created_at: Generated<Timestamp>;
  expires_at: Timestamp;
  id: Generated<string>;
  kind: string;
  redirect_uri: string | null;
  scope: Generated<string>;
  token_hash: string;
  user_id: string;
}
```

dan daftarkan `mcp_seed_oauth: McpSeedOauth;` di interface Database (dekat `catalog_stories`, baris ~1344).

- [ ] **Step 8: Route metadata well-known**

`app/.well-known/oauth-protected-resource/route.ts`:

```typescript
export async function GET(req: Request): Promise<Response> {
  const origin = process.env.MCP_SEED_PUBLIC_ORIGIN ?? new URL(req.url).origin
  return Response.json({
    resource: `${origin}/api/mcp/seed`,
    authorization_servers: [origin],
    scopes_supported: ['seed'],
    bearer_methods_supported: ['header'],
    resource_documentation: `${origin}/api/mcp/seed`,
  }, { headers: { 'access-control-allow-origin': '*' } })
}
```

`app/.well-known/oauth-authorization-server/route.ts`:

```typescript
export async function GET(req: Request): Promise<Response> {
  const origin = process.env.MCP_SEED_PUBLIC_ORIGIN ?? new URL(req.url).origin
  return Response.json({
    issuer: origin,
    authorization_endpoint: `${origin}/api/mcp/seed/oauth/authorize`,
    token_endpoint: `${origin}/api/mcp/seed/oauth/token`,
    response_types: ['code'],
    grant_types: ['authorization_code', 'refresh_token'],
    code_challenge_methods: ['S256'],
    token_endpoint_auth_methods: ['client_secret_basic', 'client_secret_post'],
    scopes_supported: ['seed'],
  }, { headers: { 'access-control-allow-origin': '*' } })
}
```

- [ ] **Step 9: Jalankan test + typecheck**

Run: `pnpm test:unit tests/mcp-seed/oauth-core.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add db/migrations/20261107130000_mcp_seed_oauth.sql neon/migrations/20261107130000_mcp_seed_oauth.sql lib/db/db-types.ts lib/mcp-seed/oauth-core.ts lib/mcp-seed/oauth-store.server.ts lib/mcp-seed/oauth-consent.server.ts app/api/mcp/seed/oauth app/.well-known tests/mcp-seed/oauth-core.test.ts
git commit -m "feat(mcp-seed): oauth 2.1 authorize/token + metadata well-known"
```

---

### Task 6: Endpoint MCP JSON-RPC + dispatch tool — `app/api/mcp/seed/route.ts` + `lib/mcp-seed/dispatch.server.ts` + `lib/mcp-seed/tools.server.ts`

**Files:**
- Create: `lib/mcp-seed/dispatch.server.ts` (murni — diuji)
- Create: `lib/mcp-seed/tools.server.ts` (skema zod + deskriptor tool — murni — diuji)
- Create: `lib/mcp-seed/wiring.server.ts` (`server-only`: sambungkan pump DB nyata, loaders DB, store OAuth DB, provider 9Router)
- Create: `app/api/mcp/seed/route.ts`
- Test: `tests/mcp-seed/dispatch.test.ts`, `tests/mcp-seed/tools.test.ts`

**Interfaces:**
- Consumes: Task 2–5 semuanya; `createProviderFromExactRoutes` dari `@lakoku/ai-gateway/server`; `toAiModelRoute` + `M10_G_G1_9ROUTER_ROUTE_AUTHORITY` (fixture beku — lihat Step 3).
- Produces:
  - `export const SEED_TOOLS: ReadonlyArray<{ name: ToolName; description: string; inputSchema: object }>`
  - `export interface SeedToolHandlers { assignNovel(input: unknown): Promise<Record<string, unknown>>; getUnitSpec(input: unknown): Promise<Record<string, unknown>>; submitUnit(input: unknown): Promise<Record<string, unknown>>; getNovelStatus(input: unknown): Promise<Record<string, unknown>>; finalizeNovel(input: unknown): Promise<Record<string, unknown>> }`
  - `export async function handleMcpRpc(args: { body: unknown; sub: string | null; handlers: SeedToolHandlers; origin: string }): Promise<Response>` — JSON-RPC `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`.

- [ ] **Step 1: Tulis test yang gagal dulu**

`tests/mcp-seed/dispatch.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { handleMcpRpc } from '@/lib/mcp-seed/dispatch.server'
import { SEED_TOOLS } from '@/lib/mcp-seed/tools.server'

const handlers = {
  async assignNovel(input: unknown, _sub: string) { return { echo: input } },
  async getUnitSpec(_input: unknown, _sub: string) { return { prompt: 'x' } },
  async submitUnit(_input: unknown, _sub: string) { return { status: 'accepted' } },
  async getNovelStatus(_input: unknown, _sub: string) { return { status: 'drafting' } },
  async finalizeNovel(_input: unknown, _sub: string) { return { status: 'review' } },
}

function rpc(body: unknown, sub: string | null = 'user-1'): Promise<Response> {
  return handleMcpRpc({ body, sub, handlers, origin: 'https://lakoku.test' })
}

describe('handleMcpRpc', () => {
  it('initialize mengembalikan protocolVersion + capabilities', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    const json = await res.json() as { result: Record<string, unknown> }
    expect(json.result.protocolVersion).toBeTypeOf('string')
    expect(json.result.serverInfo).toMatchObject({ name: 'lakoku-seed' })
  })

  it('notifications tanpa id → 202 kosong', async () => {
    const res = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(res.status).toBe(202)
  })

  it('tools/list mengembalikan 5 tool dengan inputSchema', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const json = await res.json() as { result: { tools: Array<{ name: string }> } }
    expect(json.result.tools.map((t) => t.name)).toEqual([
      'seed_assign_novel',
      'seed_get_unit_spec',
      'seed_submit_unit',
      'seed_get_novel_status',
      'seed_finalize_novel',
    ])
    expect(json.result.tools).toHaveLength(SEED_TOOLS.length)
  })

  it('tools/call meneruskan arguments ke handler', async () => {
    const res = await rpc({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'seed_get_novel_status', arguments: { novel_id: 'catalog:uji' } },
    })
    const json = await res.json() as { result: { content: Array<{ text: string }>; isError?: boolean } }
    expect(json.result.isError).toBeFalsy()
    expect(JSON.parse(json.result.content[0]!.text)).toEqual({ status: 'drafting' })
  })

  it('tanpa sub → 401 + WWW-Authenticate resource metadata', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, null)
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata')
  })

  it('method tak dikenal → -32601', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 5, method: 'bukan/method' })
    const json = await res.json() as { error: { code: number } }
    expect(json.error.code).toBe(-32601)
  })

  it('tool unknown → error result', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'hack', arguments: {} } })
    const json = await res.json() as { result: { isError: boolean } }
    expect(json.result.isError).toBe(true)
  })

  it('handler melempar error → isError true dengan pesan', async () => {
    const failing = { ...handlers, async getNovelStatus(_input: unknown, _sub: string) { throw new Error('MCP_SEED_DISABLED: off') } }
    const res = await handleMcpRpc({
      body: { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'seed_get_novel_status', arguments: {} } },
      sub: 'user-1', handlers: failing, origin: 'https://lakoku.test',
    })
    const json = await res.json() as { result: { isError: boolean; content: Array<{ text: string }> } }
    expect(json.result.isError).toBe(true)
    expect(json.result.content[0]!.text).toContain('MCP_SEED_DISABLED')
  })
})
```

`tests/mcp-seed/tools.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { parseToolArguments, toolInputSchema } from '@/lib/mcp-seed/tools.server'

describe('parseToolArguments', () => {
  it('seed_assign_novel wajib genre, judul, premis, protagonis', () => {
    const schema = toolInputSchema('seed_assign_novel')
    const out = schema.parse({ genre: 'misteri', judul: 'Kamar 304', premis: 'Sebuah kamar berbisik.', protagonis: 'Laras' })
    expect(out.judul).toBe('Kamar 304')
    expect(() => schema.parse({ genre: 'misteri' })).toThrow()
  })

  it('seed_submit_unit wajib novel_id, unit_index 0-61, prose_markdown', () => {
    const schema = toolInputSchema('seed_submit_unit')
    const out = schema.parse({ novel_id: 'catalog:x', unit_index: 5, prose_markdown: '# Judul\n\nIsi.' })
    expect(out.unit_index).toBe(5)
    expect(() => schema.parse({ novel_id: 'catalog:x', unit_index: 62, prose_markdown: 'x' })).toThrow()
  })

  it('seed_get_unit_spec unit_index opsional', () => {
    const schema = toolInputSchema('seed_get_unit_spec')
    expect(schema.parse({ novel_id: 'catalog:x' }).unit_index).toBeUndefined()
  })
})
```

Run: `pnpm test:unit tests/mcp-seed/dispatch.test.ts tests/mcp-seed/tools.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implementasi `lib/mcp-seed/tools.server.ts`**

```typescript
import { z } from 'zod'

export type ToolName =
  | 'seed_assign_novel'
  | 'seed_get_unit_spec'
  | 'seed_submit_unit'
  | 'seed_get_novel_status'
  | 'seed_finalize_novel'

const assignSchema = z.object({
  genre: z.string().trim().min(2).max(40),
  judul: z.string().trim().min(3).max(120),
  tagline: z.string().trim().max(200).optional(),
  premis: z.string().trim().min(20).max(800),
  protagonis: z.string().trim().min(2).max(60),
  tropes: z.array(z.string().trim().min(2).max(60)).max(8).optional(),
})

const getUnitSpecSchema = z.object({
  novel_id: z.string().trim().min(1).max(120),
  unit_index: z.number().int().min(0).max(61).optional(),
})

const submitUnitSchema = z.object({
  novel_id: z.string().trim().min(1).max(120),
  unit_index: z.number().int().min(0).max(61),
  prose_markdown: z.string().min(200).max(40_000),
})

const novelRefSchema = z.object({
  novel_id: z.string().trim().min(1).max(120),
})

const SCHEMAS = {
  seed_assign_novel: assignSchema,
  seed_get_unit_spec: getUnitSpecSchema,
  seed_submit_unit: submitUnitSchema,
  seed_get_novel_status: novelRefSchema,
  seed_finalize_novel: novelRefSchema,
} as const

export function toolInputSchema(name: ToolName): z.ZodTypeAny {
  return SCHEMAS[name]
}

/** JSON Schema manual — mirror zod di atas untuk descriptor tools/list. */
function schemaOf(properties: Record<string, unknown>, required: string[]): object {
  return { type: 'object', properties, required, additionalProperties: false }
}

export const SEED_TOOLS: ReadonlyArray<{
  name: ToolName
  description: string
  inputSchema: object
  annotations: { readOnlyHint: boolean }
}> = [
  {
    name: 'seed_assign_novel',
    description: 'Buat draft novel katalog Lakoku baru dan mulai antrean generasi 62 unit. Panggil ini dulu.',
    annotations: { readOnlyHint: false },
    inputSchema: schemaOf({
      genre: { type: 'string', description: 'Salah satu: family_drama, romance, mystery, fantasy_kingdom, slice_of_life, survival_thriller (boleh label Indonesia)' },
      judul: { type: 'string', description: 'Judul novel' },
      tagline: { type: 'string', description: 'Tagline satu kalimat (opsional; default judul)' },
      premis: { type: 'string', description: 'Sinopsis premis 3-6 kalimat' },
      protagonis: { type: 'string', description: 'Nama tokoh utama' },
      tropes: { type: 'array', items: { type: 'string' }, description: 'Maks 8 trope (opsional)' },
    }, ['genre', 'judul', 'premis', 'protagonis']),
  },
  {
    name: 'seed_get_unit_spec',
    description: 'Ambil spesifikasi unit berikutnya yang harus ditulis (prompt lengkap + aturan format). Balas dengan seed_submit_unit.',
    annotations: { readOnlyHint: true },
    inputSchema: schemaOf({
      novel_id: { type: 'string' },
      unit_index: { type: 'integer', minimum: 0, maximum: 61, description: 'Kosong = unit wajib berikutnya' },
    }, ['novel_id']),
  },
  {
    name: 'seed_submit_unit',
    description: 'Kirim prosa unit (judul baris pertama dengan "# ", paragraf dipisah baris kosong). Server memvalidasi; bila ditolak perbaiki lalu kirim ulang.',
    annotations: { readOnlyHint: false },
    inputSchema: schemaOf({
      novel_id: { type: 'string' },
      unit_index: { type: 'integer', minimum: 0, maximum: 61 },
      prose_markdown: { type: 'string' },
    }, ['novel_id', 'unit_index', 'prose_markdown']),
  },
  {
    name: 'seed_get_novel_status',
    description: 'Progres 62 unit novel katalog: unit tersimpan, berikutnya, dan blocker.',
    annotations: { readOnlyHint: true },
    inputSchema: schemaOf({ novel_id: { type: 'string' } }, ['novel_id']),
  },
  {
    name: 'seed_finalize_novel',
    description: 'Selesaikan novel ke status review bila seluruh 62 unit tersimpan. Publish TIDAK dilakukan oleh tool ini.',
    annotations: { readOnlyHint: false },
    inputSchema: schemaOf({ novel_id: { type: 'string' } }, ['novel_id']),
  },
]
```

- [ ] **Step 3: Implementasi `lib/mcp-seed/dispatch.server.ts`**

```typescript
/**
 * JSON-RPC MCP streamable-HTTP tulisan tangan (tanpa dependency SDK):
 * initialize / notifications/initialized / ping / tools/list / tools/call.
 * Handler tool bisa melempar Error; pesan error diteruskan ke agent agar
 * bisa memperbaiki diri (pesan berkode, sisi admin — bukan sisi pembaca).
 */
import { SEED_TOOLS, type ToolName } from '@/lib/mcp-seed/tools.server'

export interface SeedToolHandlers {
  assignNovel(input: unknown, sub: string): Promise<Record<string, unknown>>
  getUnitSpec(input: unknown, sub: string): Promise<Record<string, unknown>>
  submitUnit(input: unknown, sub: string): Promise<Record<string, unknown>>
  getNovelStatus(input: unknown, sub: string): Promise<Record<string, unknown>>
  finalizeNovel(input: unknown, sub: string): Promise<Record<string, unknown>>
}

const HANDLER_BY_TOOL: Record<ToolName, keyof SeedToolHandlers> = {
  seed_assign_novel: 'assignNovel',
  seed_get_unit_spec: 'getUnitSpec',
  seed_submit_unit: 'submitUnit',
  seed_get_novel_status: 'getNovelStatus',
  seed_finalize_novel: 'finalizeNovel',
}

function jsonRpcResult(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id, result })
}

function jsonRpcError(id: unknown, code: number, message: string): Response {
  return Response.json({ jsonrpc: '2.0', id, error: { code, message } })
}

function toolText(id: unknown, result: Record<string, unknown>, isError = false): Response {
  return jsonRpcResult(id, {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    ...(isError ? { isError: true } : {}),
  })
}

export async function handleMcpRpc(args: {
  body: unknown
  sub: string | null
  handlers: SeedToolHandlers
  origin: string
}): Promise<Response> {
  const { body, sub, handlers } = args
  if (!body || typeof body !== 'object') {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }, { status: 400 })
  }
  const record = body as { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown }
  if (record.jsonrpc !== '2.0' || typeof record.method !== 'string') {
    return Response.json({ jsonrpc: '2.0', id: record.id ?? null, error: { code: -32600, message: 'Invalid Request' } }, { status: 400 })
  }
  const id = record.id
  const isNotification = id === undefined || id === null

  if (record.method === 'initialize') {
    return jsonRpcResult(id, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'lakoku-seed', version: '1.0.0' },
      instructions: 'Server seeding novel katalog Lakoku. Alur: seed_assign_novel → loop(seed_get_unit_spec → tulis → seed_submit_unit) → seed_finalize_novel.',
    })
  }
  if (record.method === 'notifications/initialized' || record.method.startsWith('notifications/')) {
    return new Response(null, { status: 202 })
  }
  if (record.method === 'ping') {
    return jsonRpcResult(id, {})
  }
  if (record.method === 'tools/list') {
    return jsonRpcResult(id, { tools: SEED_TOOLS })
  }
  if (record.method === 'tools/call') {
    if (!sub) {
      return Response.json(
        { jsonrpc: '2.0', id: id ?? null, error: { code: -32001, message: 'Unauthorized' } },
        { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${args.origin}/.well-known/oauth-protected-resource"` } },
      )
    }
    const params = (record.params ?? {}) as { name?: unknown; arguments?: unknown }
    const name = typeof params.name === 'string' ? params.name : ''
    const descriptor = SEED_TOOLS.find((tool) => tool.name === name)
    if (!descriptor) {
      return jsonRpcResult(id, { content: [{ type: 'text', text: `Tool tidak dikenal: ${name}` }], isError: true })
    }
    try {
      const handler = handlers[HANDLER_BY_TOOL[descriptor.name]]
      const result = await handler(params.arguments, sub)
      return toolText(id, result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return jsonRpcResult(id, { content: [{ type: 'text', text: message }], isError: true })
    }
  }
  if (isNotification) return new Response(null, { status: 202 })
  return jsonRpcError(id, -32601, `Method not found: ${record.method}`)
}
```

- [ ] **Step 4: Implementasi `lib/mcp-seed/wiring.server.ts` (server-only)**

```typescript
import 'server-only'
import { getDb, single } from '@lakoku/db'
import { createProviderFromExactRoutes, DEFAULT_RUNTIME_POLICY } from '@lakoku/ai-gateway/server'
import type { GenerationProvider } from '@lakoku/ai-gateway'
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

const pump = createMcpSeedPump({
  writer: createDbCatalogWriter(),
  inner: innerProvider(),
  proseTimeoutMs,
})

const loaders: SeedVolumeLoaders = {
  async novelsThisMonth(source, monthStart) {
    const db = getDb()
    const rows = await db.selectFrom('catalog_stories')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('source', '=', source)
      .where('created_at', '>=', monthStart.toISOString())
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
    if (!existing.error && !existing.data) return candidate
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
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const instruction = pump.store.instruction(key)
    if (instruction && instruction.storyId === storyId) return instruction
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
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
  const db = getDb()
  const approvedRows = await db.selectFrom('catalog_chapter_reviews')
    .select(['chapter_number', 'status'])
    .where('story_id', '=', storyId)
    .execute()
  const approved = new Set(
    approvedRows
      .filter((row) => String(row.status) === 'approved')
      .map((row) => Number(row.chapter_number)),
  )
  const units: UnitProgress[] = mapUnits(contract).map((unit: MappedUnit) => {
    const committed = pump.commits.committed(storyId, keyOf(unit))
    const isApproved = approved.has(unit.number)
    return {
      unit_index: unit.index,
      number: unit.number,
      ending_key: unit.endingKey,
      state: (isApproved ? 'approved' : committed ? 'stored' : 'missing') as UnitProgress['state'],
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
      const contract = await pump.loadContract(input.novel_id)
      const target = input.unit_index === undefined
        ? pump.nextRequiredUnit(input.novel_id, contract)
        : unitIndexToTarget(contract, input.unit_index)
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
      if (pumpError) throw new Error(`MCP_UNIT_REJECTED:${pumpError} — panggil seed_get_unit_spec untuk percobaan perbaikan`)
      throw new Error('MCP_UNIT_REJECTED: validasi bab gagal — ambil ulang seed_get_unit_spec untuk instruksi perbaikan (repairFindings)')
    },
    async getNovelStatus(raw, sub) {
      guard(sub)
      const input = raw as { novel_id: string }
      assertCatalogStoryId(input.novel_id)
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
```

- [ ] **Step 5: Route `app/api/mcp/seed/route.ts`**

```typescript
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
  const sub = token ? verifyAccessToken(token, oauthSecret(), Math.floor(Date.now() / 1000))?.sub ?? null : null
  if (token && !sub) {
    return Response.json(
      { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Invalid token' } },
      { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"` } },
    )
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
```

- [ ] **Step 6: Jalankan seluruh test mcp-seed + typecheck + lint**

Run: `pnpm test:unit tests/mcp-seed && pnpm typecheck && pnpm lint`
Expected: PASS semua. Jika ESLint menolak import `../../fixtures/...` dari lib, pindahkan konstanta `M10_G_G1_9ROUTER_ROUTE_AUTHORITY` ke `lib/narrative-qa/contracts/m10-g-g1-route-authority.data.ts` (salin verbatim + komentar sumber) dan re-export dari fixtures agar skrip lama tetap jalan.

- [ ] **Step 7: Commit**

```bash
git add lib/mcp-seed/dispatch.server.ts lib/mcp-seed/tools.server.ts lib/mcp-seed/wiring.server.ts lib/mcp-seed/pump.server.ts tests/mcp-seed/dispatch.test.ts tests/mcp-seed/tools.test.ts app/api/mcp/seed/route.ts
git commit -m "feat(mcp-seed): endpoint json-rpc mcp + 5 tool terhubung pump"
```

---

### Task 7: Smoke end-to-end deterministic — `scripts/mcp-seed-smoke.ts`

**Files:**
- Create: `scripts/mcp-seed-smoke.ts`
- Modify: `package.json` (script `smoke:mcp-seed`)

**Interfaces:**
- Consumes: `createMcpSeedPump` + `createAutoResponderProseStore` + handler assign versi smoke (pump ditulis langsung tanpa HTTP); `createDeterministicProvider` sebagai inner; `createCatalogDraft` DB nyata (env-gated).
- Produces: bukti jalur penuh assign → 62 unit → status `review` dengan nol kuota.

- [ ] **Step 1: Tulis script**

```typescript
/**
 * Smoke MCP Seed: jalur penuh assign → pump → 62 unit → review.
 *
 * Wajib env eksplisit (menulis DB):
 *   MCP_SEED_SMOKE=1 CATALOG_GENERATE_DB=1 DATABASE_URL=... \
 *   pnpm smoke:mcp-seed
 *
 * Prosa & pilihan pakai provider deterministic (nol biaya). Novel hasil
 * smoke DIARSIPKAN (status archived) di akhir run.
 */
import fs from 'node:fs'
import path from 'node:path'

for (const name of ['.env.local', '.env']) {
  const envPath = path.resolve(process.cwd(), name)
  if (!fs.existsSync(envPath)) continue
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*['"]?(.*?)['"]?\s*$/)
    if (match?.[1] && match[2] !== undefined && !process.env[match[1]]) {
      process.env[match[1]] = match[2]
    }
  }
}

if (process.env.MCP_SEED_SMOKE !== '1' || process.env.CATALOG_GENERATE_DB !== '1' || !process.env.DATABASE_URL) {
  console.error('MCP_SEED_SMOKE_REQUIRED: set MCP_SEED_SMOKE=1 CATALOG_GENERATE_DB=1 DATABASE_URL=...')
  process.exit(1)
}

import { createDeterministicProvider, DEFAULT_RUNTIME_POLICY } from '@lakoku/ai-gateway'
import { createCatalogDraft, createDbCatalogWriter } from '../lib/catalog/generator-db.server'
import { createMcpSeedPump, mapUnits } from '../lib/mcp-seed/pump.server'
import { createAutoResponderProseStore } from '../lib/mcp-seed/agent-provider.server'
import { getDb, result } from '@lakoku/db'

const STORY_TITLE = 'Smoke MCP Seed'

async function main(): Promise<void> {
  const storyId = `catalog:smoke-mcp-${Date.now()}`
  console.log(`[smoke-mcp] draf: ${storyId}`)
  await createCatalogDraft({
    storyId,
    title: STORY_TITLE,
    tagline: STORY_TITLE,
    synopsis: 'Smoke test MCP seed: cerita uji deterministik untuk memastikan jalur agent-pump tuntas.',
    protagonistName: 'Uji',
    tropes: ['Smoke Test'],
    genreId: 'mystery',
    provider: createDeterministicProvider(DEFAULT_RUNTIME_POLICY),
    source: 'gemini-agent',
  })
  const pump = createMcpSeedPump({
    writer: createDbCatalogWriter(),
    inner: createDeterministicProvider(DEFAULT_RUNTIME_POLICY),
    store: createAutoResponderProseStore(),
    proseTimeoutMs: 60_000,
  })
  pump.kick(storyId)
  const deadline = Date.now() + 10 * 60 * 1000
  while (Date.now() < deadline) {
    if (!pump.isRunning(storyId)) break
    await new Promise((r) => setTimeout(r, 1_000))
  }
  const error = pump.lastError(storyId)
  if (error) throw new Error(`PUMP_ERROR:${error}`)
  const contract = await (async () => {
    const db = getDb()
    const rows = await db.selectFrom('catalog_stories')
      .select('contract_json')
      .where('story_id', '=', storyId)
      .limit(1).execute()
    return JSON.parse(String(rows[0]!.contract_json))
  })()
  const totalUnits = mapUnits(contract).length
  const committed = mapUnits(contract).filter((unit) =>
    pump.commits.committed(storyId, unit.endingKey === null ? `spine#${unit.number}` : `${unit.endingKey}#${unit.number}`),
  ).length
  console.log(`[smoke-mcp] unit commit: ${committed}/${totalUnits}`)
  if (committed !== totalUnits) throw new Error(`UNIT_INCOMPLETE:${committed}/${totalUnits}`)
  await pump.markReview(storyId)

  // Arsipkan smoke story agar katalog bersih.
  const db = getDb()
  await result(db.updateTable('catalog_stories').set({ status: 'archived', updated_at: new Date().toISOString() }).where('story_id', '=', storyId).execute())
  await result(db.updateTable('stories').set({ status: 'ARSIP' }).where('id', '=', storyId).execute())
  console.log(`[smoke-mcp] PASS: ${storyId} (diarsipkan)`)
}

main().catch((err) => {
  console.error('[smoke-mcp] GAGAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})
```

Catatan: status `'ARSIP'` pada tabel `stories` — cek constraint `stories_status_check` dulu (`psql -c "\d stories"`); bila nilai validnya berbeda, pakai nilai arsip yang sah. Opsi `store?` pada `createMcpSeedPump` (Task 3) sudah mendukung auto-responder ini.

Tambahkan di `package.json` scripts:

```json
"smoke:mcp-seed": "node scripts/run-smoke.cjs scripts/mcp-seed-smoke.ts"
```

- [ ] **Step 2: Jalankan smoke**

Run: `MCP_SEED_SMOKE=1 CATALOG_GENERATE_DB=1 pnpm smoke:mcp-seed` (DATABASE_URL dev lokal)
Expected: `[smoke-mcp] PASS: catalog:smoke-mcp-... (diarsipkan)` — 62/62 commit.

- [ ] **Step 3: Gate penuh sebelum commit**

Run: `pnpm test:unit && pnpm typecheck && pnpm lint`
Expected: PASS semua.

- [ ] **Step 4: Commit**

```bash
git add scripts/mcp-seed-smoke.ts package.json lib/mcp-seed/pump.server.ts
git commit -m "feat(mcp-seed): smoke e2e deterministic 62 unit ke review"
```

---

### Task 8: Deploy VPS + env + verifikasi offline

**Files:**
- Modify: env VPS (via SSH, ikuti `docs/VPS_DEPLOY.md`)

**Interfaces:**
- Consumes: build produksi (`LAKOKU_DEPLOY=vps`), pitfall env: file `.env` wajib `chown ubuntu:ubuntu` setelah edit (memory pitfall ownership).
- Produces: endpoint hidup di produksi dengan `tools/list` merespons 401 tanpa token (belum dihubungkan Gemini).

- [ ] **Step 1: Generate kredensial OAuth lokal**

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Simpan sebagai `MCP_SEED_OAUTH_CLIENT_ID` dan `MCP_SEED_OAUTH_CLIENT_SECRET` (jangan commit).

- [ ] **Step 2: Ambil user id PM**

```bash
psql "$DATABASE_URL" -c "select id, email from better_auth_user where email = '<email-PM>';"
```

Catat `id` untuk `MCP_SEED_ALLOWED_USER_IDS`. (Cek nama tabel user Better Auth dulu: `psql "$DATABASE_URL" -c "\dt" | grep -i user`.)

- [ ] **Step 3: Deploy build + env**

Ikuti `docs/VPS_DEPLOY.md` (tarball git archive → ekstrak → build `LAKOKU_DEPLOY=vps`). Tambahkan ke `.env` VPS:

```
MCP_SEED_ENABLED=1
MCP_SEED_OAUTH_CLIENT_ID=<dari Step 1>
MCP_SEED_OAUTH_CLIENT_SECRET=<dari Step 1>
MCP_SEED_ALLOWED_USER_IDS=<user id PM>
MCP_SEED_PUBLIC_ORIGIN=https://<domain-produksi>
```

Wajib: `chown ubuntu:ubuntu .env` setelah edit (memory: env hilang diam-diam tanpa ini). Verifikasi `NINEROUTER_BASE_URL`/`NINEROUTER_API_KEY` ada di env VPS — tambahkan bila belum (nilai: lihat `.env.local` lokal).

- [ ] **Step 4: Terapkan migration produksi & verifikasi**

```bash
pnpm db:migrate   # DATABASE_URL produksi — kedua migration 20261107120000 & 20261107130000
psql "$PROD_DATABASE_URL" -c "select column_name from information_schema.columns where table_name='catalog_stories' and column_name='source';"
psql "$PROD_DATABASE_URL" -c "select to_regclass('public.mcp_seed_oauth');"
```

Expected: `source` ada; `mcp_seed_oauth` terdaftar.

- [ ] **Step 5: Verifikasi endpoint offline (tanpa menulis DB)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<domain>/api/mcp/seed -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
curl -s https://<domain>/.well-known/oauth-protected-resource | head -5
curl -s https://<domain>/.well-known/oauth-authorization-server | head -5
```

Expected: `401` untuk tools/list tanpa token; dua metadata mengembalikan JSON.

- [ ] **Step 6: Rollback plan** — bila apapun bermasalah setelah deploy: set `MCP_SEED_ENABLED=0` di `.env` VPS (+ `chown ubuntu:ubuntu .env`) dan restart container; semua tool call otomatis ditolak `MCP_SEED_DISABLED` tanpa deploy ulang.

- [ ] **Step 7: Commit (jika ada perubahan repo)** & catat hasil di laporan akhir

```bash
git add -A docs/VPS_DEPLOY.md 2>/dev/null || true
git diff --cached --quiet || git commit -m "docs(vps): catat env mcp-seed"
```

---

### Task 9: Hubungkan Gemini web + pilot (langkah manusia terpandu)

**Files:** tidak ada perubahan kode (operasional).

- [ ] **Step 1: Sambungkan connector** — Gemini web → Settings → Connected Apps → + Custom → isi MCP Server URL `https://<domain>/api/mcp/seed`, Client ID & Secret dari Task 8 → Next → buka URL authorize yang diminta → login PM → klik **Izinkan**.
- [ ] **Step 2: Uji Developer Mode** — buka `gemini.google.com/devmode`, pilih app, Sync schema, verifikasi 5 tool muncul; jalankan `seed_get_novel_status` read-only via chat ("cek status novel catalog:kamar-304") dan pastikan respons masuk.
- [ ] **Step 3: Pilot 1 unit** — komando: "Ambil seed_get_unit_spec untuk novel baru" → periksa instruction → minta Gemini menulis 1 bab → `seed_submit_unit` → verifikasi baris `chapters` masuk DB berprovenance `gemini-agent` dan guard tidak menolak.
- [ ] **Step 4: Pilot 1 novel penuh** — komando: "seed 1 novel mystery di Lakoku" → biarkan agent menuntaskan 62 unit (pantau via `seed_get_novel_status`) → `seed_finalize_novel` → status `review`.
- [ ] **Step 5: QC admin** — alur `/admin/katalog` yang sudah ada: review 62 unit → publish manual. Ukur friction: hitung berapa konfirmasi manual write action Gemini yang benar-benar muncul per unit (catat di laporan; jika ≥2 per unit, pertimbangkan `seed_submit_batch` sebagai iterasi berikut — anotasi tetap jujur).
- [ ] **Step 6: Verifikasi DB** — `psql "$PROD_DATABASE_URL" -c "select story_id, status, source from catalog_stories where source='gemini-agent' order by created_at desc limit 5;"`

---

### Task 10: Gemini Skill "Lakoku Seed" (v1.5)

**Files:** dibuat di UI Gemini web (bukan repo) — konten di bawah dipaste ke tab **Skills**.

- [ ] **Step 1: Buat skill** — Gemini web → Skills → New → nama `Lakoku Seed`, trigger: kata "seed" / "novel lakoku". Konten:

```markdown
# Lakoku Seed — prosedur seeding novel katalog

Kamu adalah operator seeding novel katalog Lakoku. Ikuti prosedur ini TANPA menyimpang.

## Alur wajib
1. `seed_assign_novel` — satu novel dalam satu waktu. Isi premis 3-6 kalimat yang orisinal, protagonis bernama, genre dari daftar yang valid.
2. Ulangi sampai selesai (62 unit):
   a. `seed_get_unit_spec` (tanpa unit_index = unit berikutnya)
   b. Baca instruction: patuhi plannedBeats, mandatoryBeats, forbiddenReveals, dan formatRules. Panjang {targetWordsMin}-{targetWordsMax} kata.
   c. Tulis prosa: baris pertama `# Judul Bab`, paragraf pendek (1-3 kalimat) dipisah baris kosong, dialog natural, cliffhanger di akhir.
   d. `seed_submit_unit` dengan unit_index yang sama.
   e. Jika status "rejected": baca pesan error, perbaiki prosa, submit ulang unit yang sama. Jangan pindah unit.
3. Tiap 10 unit ter-commit: laporkan ringkas satu baris (unit terakhir + judul).
4. Setelah 62/62: `seed_finalize_novel`, lalu laporkan bahwa novel menunggu QC admin.

## Larangan keras
- JANGAN mencoba publish atau mengubah harga.
- JANGAN mengarang unit di luar hasil seed_get_unit_spec.
- JANGAN memakai kata: AI, Narraza, RAG, token, skor, bias, ending, pembaca, rute di dalam prosa.
- JANGAN melanjutkan ke unit berikutnya sebelum unit saat ini accepted.
```

- [ ] **Step 2: Uji skill** — komando baru: "seed 1 novel family_drama di Lakoku" → pastikan agent mengikuti alur skill tanpa diingatkan manual.
- [ ] **Step 3: Catat hasil** di laporan akhir (skill bekerja / perlu penyesuaian prompt).

---

## Self-Review (dijalankan penulis plan)

1. **Spec coverage:** §3 arsitektur → Task 2/3/5/6; §4 tool surface → Task 6 (+ anotasi readOnly: kandidat berikutnya — lihat catatan di bawah); §5 auth → Task 5; §6 gate/biaya/provenance → Task 1/4 (+ E0 tetap via inner provider); §7 resumability → pump kick-idempoten + lastError + resume otomatis generateCatalogNovel; §8 skill → Task 10; §9 testing → Task 2-4,6,7 (smoke) + Task 9 (acceptance); §10 deployment → Task 8; §11 risiko (konfirmasi write, payload) → Task 9 Step 5. **Gap yang diakui & keputusan:** (a) anotasi `readOnlyHint` sudah masuk descriptor Task 6 (`seed_get_unit_spec` & `seed_get_novel_status` = true, sisanya false — anotasi jujur); (b) spesifikasi menulis "0-61" — dipertahankan via `mapUnits`; (c) penyimpangan dari spec §3 yang disengaja: TIDAK ada refactor ekstraksi `generator.server.ts` — mesin sudah punya seam `CatalogGeneratorDeps.provider`, sehingga jalur MCP cukup dekorator provider (Task 2) tanpa menyentuh generator (smoke katalog lama otomatis tetap hijau); spec §3/§12 sudah disinkronkan.
2. **Placeholder scan:** `createMcpSeedPump` di Task 3 sengaja menampilkan dua versi (stub ditandai JANGAN + final); wiring Task 6 Step 4 memiliki catatan implementasi wajib — semua tuntas tercantum eksplisit (loadContract/nextRequiredUnit/waitInstruction/progressOf/__sub). Tidak ada TBD.
3. **Konsistensi tipe:** `AgentWriteInstruction.unitKey` dipakai pump/wiring konsisten (`spine#n` / `<endingKey>#n`); `SeedToolHandlers` signature diperbarui ke `(input, sub)` di catatan wiring — test dispatch di Step 1 perlu argumen `sub` kedua saat implementasi (diingatkan di catatan); `CodeRow.codeChallenge` ditambahkan di Step 7 SQL final.
