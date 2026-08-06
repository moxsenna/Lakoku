// @vitest-environment node
/**
 * M10-A1d — Validated State Lifecycle FULL parity test (A1d.3b).
 *
 * Deterministic (tanpa real model), jalur runtime SAMA dengan produksi
 * (`generateNextPersonalizedChapter` + RPC checkpoint fenced_v2/sync_v1 +
 * publisher V5/V3) terhadap Supabase lokal. Dua clone story living-canon v1
 * terisolasi (sync + worker) menjalankan SEQUENCE proposal deterministik 50 BAB;
 * diverifikasi:
 * - Seluruh 50 bab (Bab 1 -> 50) tereksekusi tanpa skip
 * - Fact add, fact payoff, knowledge grant, timeline, character ALIVE->INACTIVE
 * - Thread status/touch/debt-backed transition
 * - Secret reveal
 * - Plot progress dan closures ('debt:a' tutup di Bab 8, 'main_mystery' progress 12/32/45 & tutup di Bab 48)
 * - Act boundary rollup exact (Bab 5, 12, 50)
 * - Bab 45 ending lock
 * - Bab 50 completion
 * - Canon revision freshness (0 -> 50)
 * - Checkpoint resume idempoten mid-sequence (Bab 20 re-run)
 * - Parity semantic canon sync/worker (fact, knowledge, timeline, character, thread, secret, debt progress/closure, revision)
 * - Negative regression Bab 48/49: delta Bab 48 tanpa closure main_mystery
 *   ditolak STATE_DELTA_POLICY_VIOLATION sebelum publication (sync + worker);
 *   Bab 49 unresolved hard-fail via continuation fail-closed runtime
 *   (PREV_CHAPTER_MISSING) + otoritas ledger resolveDebtClosures di Bab 49.
 *
 * Jalankan: LAKOKU_LOCAL_DB_TEST=1 pnpm exec vitest run tests/db/m10-a1d-validated-state-full-parity.test.ts
 */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest'

vi.mock('server-only', () => ({}))

// ---------------------------------------------------------------------------
// Local Supabase bootstrap
// ---------------------------------------------------------------------------
function getLocalStatus() {
  try {
    const raw = process.platform === 'win32'
      ? execFileSync('cmd.exe', ['/d', '/s', '/c', 'pnpm exec supabase status -o json'], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      : execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const jsonStr = raw.match(/{[\s\S]*}/)?.[0] ?? raw
    const parsed = JSON.parse(jsonStr) as Record<string, string>
    return {
      url: parsed.API_URL ?? 'http://127.0.0.1:54321',
      key: parsed.SERVICE_ROLE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
    }
  } catch {
    return {
      url: 'http://127.0.0.1:54321',
      key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
    }
  }
}

const status = getLocalStatus()
process.env.SUPABASE_URL = status.url
process.env.SUPABASE_SERVICE_ROLE_KEY = status.key

import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildBaselinePolicyForChapter,
  debtBackedThreadId,
  runtimeFactId,
  type AllowedChapterStatePolicyV1,
  type StructuredStateProposalV1,
} from '@lakoku/narrative-core'
import type { StoryContract } from '@/lib/story-engine/story-contract'
import { generateNextPersonalizedChapter } from '@/lib/runtime/personalized-generation'
import {
  acquireGenerationJobLease,
  claimGenerationJobById,
} from '@/lib/runtime/generation-jobs'
import { claimedJobToPartialContext } from '@/lib/runtime/generation-job-execution'
import { ChapterStateResolverError } from '@/lib/narrative/chapter-state-resolver'
import { resolveDebtClosures } from '@/lib/story-engine/plot-debt-closure'
import * as aiGatewayServerModule from '@lakoku/ai-gateway/server'

const SYNC_STORY = 'a1d3b-sync'
const WORKER_STORY = 'a1d3b-worker'
// Cerita ketiga khusus negative regression Bab 48/49 (tidak dipublish penuh).
const NEG_STORY = 'a1d3b-neg'
const USER_ID = '99999999-9999-4999-9999-999999999999'

const ACT = [
  { actNumber: 1, fromChapter: 1, toChapter: 5, goal: 'Etablish dunia + misteri utama.' },
  { actNumber: 2, fromChapter: 6, toChapter: 12, goal: 'Eskalasi konflik + utang plot.' },
  { actNumber: 3, fromChapter: 13, toChapter: 50, goal: 'Resolusi + kunci babak akhir.' },
]

const PLOT_DEBTS = [
  {
    id: 'main_mystery',
    question: 'Siapa yang membuka brankas rahasia di lantai basement?',
    introducedAt: 1,
    mustProgressBy: [12, 32, 45],
    mustCloseBy: 48,
    status: 'open' as const,
  },
  {
    id: 'debt:a',
    question: 'Apa isi surat yang baru ditemukan di brankas?',
    introducedAt: 1,
    mustProgressBy: [1, 3],
    mustCloseBy: 8,
    status: 'open' as const,
  },
]

const ENDINGS = [
  { key: 'ending-open', name: 'Jalan Terbuka', condition: 'Surat terbaca', requiredClosure: ['debt:a'] },
  { key: 'ending-gelap', name: 'Rahasia Terkubur', condition: 'Surat ditutup', requiredClosure: ['main_mystery'] },
]

const REVEALS = [{ secretId: 'secret:brankas', revealGateChapter: 3 }]

const CHARACTERS = [
  { id: 'char:hero', name: 'Aku', role: 'Protagonis', introducedChapter: 1 },
  { id: 'char:rival', name: 'Raka', role: 'Rival', introducedChapter: 1 },
]

const CH1_FACT_STATEMENT = 'Surat tak bernama ditemukan di balik brankas basemen.'

function factIdFor(storyId: string, chapterNumber = 1): string {
  return runtimeFactId({
    storyId,
    chapterNumber,
    subjectCharacterId: `${storyId}:char:hero`,
    statement: CH1_FACT_STATEMENT,
  })
}

function buildContract(storyId: string): StoryContract {
  const chapterTargets = Array.from({ length: 50 }, (_, i) => ({
    chapterNumber: i + 1,
    phase: i < 5 ? 'BABAK_1' : i < 12 ? 'BABAK_2' : 'BABAK_3',
    goal: `Babat ${i + 1}: gerak maju misteri brankas.`,
    mustInclude: ['beat-utama'],
    mustNotReveal: [],
    emotionalTurn: 'Ketegangan naik.',
    expectedThreadMovement: ['thread:main'],
  }))
  return {
    storyId,
    totalChapters: 50,
    title: 'Brankas Rahasia 50 Bab',
    genre: 'misteri',
    tone: 'gelap',
    styleProfile: 'lakoku_mobile_drama_v1',
    mainCharacter: {
      name: 'Aku',
      role: 'penjaga brankas',
      wound: 'kehilangan saudara',
      desire: 'tahu isi brankas',
    },
    mainConflict: 'Brankas menyimpan rahasia yang mengubur masa lalu.',
    finalQuestion: 'Siapa yang menutup surat terakhir?',
    corePromise: 'Satu surat, satu kebenaran bab-per-bab.',
    actPlan: ACT,
    chapterTargets,
    endingCandidates: ENDINGS,
    plotDebts: PLOT_DEBTS,
    revealRunway: REVEALS,
    closureRunway: {
      noNewMajorConflictAfter: 35,
      noNewThreadAfter: 40,
      endingLockChapter: 45,
      mainMysteryResolveBy: 48,
      emotionalResolutionChapter: 49,
      finalEndingChapter: 50,
    },
  }
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K]
}

function deepMerge<T>(base: T, override?: DeepPartial<T>): T {
  if (override === undefined) return base
  if (Array.isArray(base) || Array.isArray(override)) {
    return (override as unknown) as T
  }
  if (base && typeof base === 'object' && override && typeof override === 'object') {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
    for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
      out[k] = v !== undefined ? deepMerge(out[k], v as never) : out[k]
    }
    return out as T
  }
  return (override as unknown) as T
}

function policyForChapter(
  storyId: string,
  chapterNumber: number,
  overrides?: DeepPartial<AllowedChapterStatePolicyV1>,
): AllowedChapterStatePolicyV1 {
  const base = buildBaselinePolicyForChapter({
    storyContract: buildContract(storyId),
    chapterNumber,
  })
  return deepMerge(base, overrides)
}

function blueprintOverrides(storyId: string, n: number): DeepPartial<AllowedChapterStatePolicyV1> | undefined {
  if (n === 1) {
    return {
      facts: { allowAdd: true, payableFactIds: [] },
      knowledge: { allowGrants: true },
      characters: { statusChangeCharacterIds: [`${storyId}:char:rival`] },
      threads: { touchIds: [debtBackedThreadId(storyId, 'main_mystery'), debtBackedThreadId(storyId, 'debt:a'), `${storyId}:thread:conviction`] },
    }
  }
  if (n === 2) {
    return {
      facts: { allowAdd: false, payableFactIds: [factIdFor(storyId)] },
      threads: {
        touchIds: [debtBackedThreadId(storyId, 'main_mystery'), debtBackedThreadId(storyId, 'debt:a'), `${storyId}:thread:conviction`],
        transitionIds: [debtBackedThreadId(storyId, 'main_mystery'), debtBackedThreadId(storyId, 'debt:a'), `${storyId}:thread:conviction`],
      },
    }
  }
  if (n === 8) {
    return {
      plotDebts: { closureIds: ['debt:a'] },
    }
  }
  if (n === 48) {
    return {
      plotDebts: { closureIds: ['main_mystery'] },
    }
  }
  return undefined
}

function proposalFor(storyId: string, chapterNumber: number): StructuredStateProposalV1 {
  const isActBoundary = chapterNumber === 5 || chapterNumber === 12 || chapterNumber === 50
  const actRollup = isActBoundary
    ? {
        summary: null,
      }
    : null

  const base: StructuredStateProposalV1 = {
    schemaVersion: 1,
    storyId,
    chapterNumber,
    facts: { add: [], markPaidOff: [] },
    knowledge: { grants: [] },
    secrets: { revealIds: [] },
    timeline: { append: [] },
    characters: { statusChanges: [] },
    threads: { touches: [], transitions: [] },
    plotDebts: { progress: [], closures: [] },
    actRollup,
  }

  if (chapterNumber === 1) {
    return {
      ...base,
      facts: {
        add: [{ statement: CH1_FACT_STATEMENT, subjectCharacterId: `${storyId}:char:hero`, salience: 0.8 }],
        markPaidOff: [],
      },
      knowledge: {
        grants: [{ characterId: `${storyId}:char:hero`, factId: factIdFor(storyId) }],
      },
      timeline: {
        append: [{
          ordinal: 0,
          description: 'Brankas terbuka dan surat ditemukan di lantai basement.',
          characterId: `${storyId}:char:hero`,
          occursAt: 10,
          isFlashback: false,
        }],
      },
      characters: { statusChanges: [{ characterId: `${storyId}:char:rival`, to: 'INACTIVE' }] },
      threads: { touches: [`${storyId}:thread:conviction`], transitions: [] },
      plotDebts: { progress: [{ debtId: 'debt:a', milestoneChapter: 1 }], closures: [] },
    }
  }
  if (chapterNumber === 2) {
    return {
      ...base,
      facts: { add: [], markPaidOff: [factIdFor(storyId)] },
      threads: {
        touches: [`${storyId}:thread:conviction`],
        transitions: [{ threadId: `${storyId}:thread:conviction`, to: 'DEVELOPING' }],
      },
    }
  }
  if (chapterNumber === 3) {
    return {
      ...base,
      secrets: { revealIds: [`${storyId}:secret:brankas`] },
      plotDebts: { progress: [{ debtId: 'debt:a', milestoneChapter: 3 }], closures: [] },
    }
  }
  if (chapterNumber === 8) {
    return {
      ...base,
      plotDebts: { progress: [], closures: [{ debtId: 'debt:a', closureForm: 'RESOLVED' }] },
    }
  }
  if (chapterNumber === 12) {
    return {
      ...base,
      plotDebts: { progress: [{ debtId: 'main_mystery', milestoneChapter: 12 }], closures: [] },
    }
  }
  if (chapterNumber === 32) {
    return {
      ...base,
      plotDebts: { progress: [{ debtId: 'main_mystery', milestoneChapter: 32 }], closures: [] },
    }
  }
  if (chapterNumber === 45) {
    return {
      ...base,
      plotDebts: { progress: [{ debtId: 'main_mystery', milestoneChapter: 45 }], closures: [] },
    }
  }
  // Bab 46-47: main_mystery sudah PAYOFF_DUE (progress final di Bab 45).
  // G4: Bab >= 41 wajib memajukan >= 1 thread PAYOFF_DUE — sentuh thread
  // debt-backed (tanpa transisi; closure tetap di Bab 48).
  if (chapterNumber === 46 || chapterNumber === 47) {
    return {
      ...base,
      threads: {
        touches: [debtBackedThreadId(storyId, 'main_mystery')],
        transitions: [],
      },
    }
  }
  if (chapterNumber === 48) {
    return {
      ...base,
      plotDebts: { progress: [], closures: [{ debtId: 'main_mystery', closureForm: 'RESOLVED' }] },
    }
  }

  return base
}

/**
 * Varian negative regression: proposal deterministik SAMA, tetapi tanpa
 * closure plot-debt di bab yang diberikan. Dipakai untuk membuktikan Bab 48
 * TIDAK lolos bila delta-nya tidak menutup main_mystery (dan Bab 49+ tetap
 * hard-fail selama mystery belum RESOLVED).
 */
function proposalForNeg(storyId: string, chapterNumber: number): StructuredStateProposalV1 {
  const base = proposalFor(storyId, chapterNumber)
  return { ...base, plotDebts: { ...base.plotDebts, closures: [] } }
}

// ---------------------------------------------------------------------------
// Seed / cleanup
// ---------------------------------------------------------------------------
async function cleanupStory(admin: ReturnType<typeof createAdminClient>, storyId: string) {
  await admin.from('chapter_state_commits').delete().eq('story_id', storyId)
  await admin.from('chapter_generation_checkpoints').delete().eq('story_id', storyId)
  await admin.from('reader_plot_debt_closures').delete().eq('story_id', storyId)
  await admin.from('reader_plot_debt_progress').delete().eq('story_id', storyId)
  await admin.from('choice_outcomes').delete().eq('story_id', storyId)
  await admin.from('chapters').delete().eq('story_id', storyId)
  await admin.from('generation_jobs').delete().eq('story_id', storyId)
  await admin.from('timeline_events').delete().eq('story_id', storyId)
  await admin.from('knowledge_scopes').delete().eq('story_id', storyId)
  await admin.from('facts_ledger').delete().eq('story_id', storyId)
  await admin.from('secrets_reveals').delete().eq('story_id', storyId)
  await admin.from('story_threads').delete().eq('story_id', storyId)
  await admin.from('character_states').delete().eq('story_id', storyId)
  await admin.from('characters').delete().eq('story_id', storyId)
  await admin.from('reader_states').delete().eq('story_id', storyId)
  await admin.from('chapter_blueprints').delete().eq('story_id', storyId)
  await admin.from('story_generation_contracts').delete().eq('story_id', storyId)
  await admin.from('stories').delete().eq('id', storyId)
}

async function seedStory(admin: ReturnType<typeof createAdminClient>, storyId: string) {
  const contract = buildContract(storyId)
  await admin.from('stories').insert({
    id: storyId,
    title: 'Brankas Rahasia 50 Bab',
    cover: '/cover.webp',
    tagline: 'Misteri brankas basement',
    role: 'Protector',
    tropes: ['misteri'],
    total_chapters: 50,
    synopsis: 'Synopsis deterministik.',
    status: 'BERJALAN',
    current_chapter: 0,
    owner_user_id: USER_ID,
    jejak: [],
    visibility: 'private',
    story_mode: 'personalized_ai',
    generation_status: 'ready',
    story_contract_version: 1,
    living_canon_version: 1,
    canon_state_revision: 0,
  })

  await admin.from('story_generation_contracts').insert({
    story_id: storyId,
    mode: 'personalized_ai',
    total_chapters: 50,
    contract_source: 'llm_repaired',
    onboarding_json: { hero: 'char:hero' },
    story_contract_json: contract,
    route_schema_json: {},
    plot_debts_json: PLOT_DEBTS,
    ending_candidates_json: ENDINGS,
    ending_lock_json: {},
    quality_profile: 'lakoku_mobile_drama_v1',
    story_contract_version: 1,
  })

  const blueprints = Array.from({ length: 50 }, (_, i) => {
    const n = i + 1
    return {
      story_id: storyId,
      chapter_number: n,
      version: 1,
      phase: n <= 5 ? 'ACT_1' : n <= 12 ? 'ACT_2' : 'ACT_3',
      chapter_goal: `Goal ${n}`,
      mandatory_beats: ['beat-1'],
      forbidden_reveals: [],
      allowed_state_delta: policyForChapter(storyId, n, blueprintOverrides(storyId, n)),
      introduces_characters: [],
    }
  })
  await admin.from('chapter_blueprints').insert(blueprints)

  await admin.from('characters').insert(
    CHARACTERS.map((c) => ({
      id: `${storyId}:${c.id}`,
      story_id: storyId,
      canonical_name: c.name,
      role: c.role,
      introduced_chapter: c.introducedChapter,
    })),
  )

  await admin.from('character_states').insert(
    CHARACTERS.map((c) => ({
      character_id: `${storyId}:${c.id}`,
      status: 'ALIVE',
      as_of_chapter: 0,
      attributes: {},
    })),
  )

  await admin.from('story_threads').insert([
    {
      id: debtBackedThreadId(storyId, 'main_mystery'),
      story_id: storyId,
      title: 'Misteri brankas',
      status: 'OPEN',
      opened_chapter: 1,
      last_touched_chapter: 1,
      payoff_window: 48,
      is_main_mystery: true,
      stale: false,
      stale_since_chapter: null,
    },
    {
      id: debtBackedThreadId(storyId, 'debt:a'),
      story_id: storyId,
      title: 'Surat di brankas',
      status: 'OPEN',
      opened_chapter: 1,
      last_touched_chapter: 1,
      payoff_window: 8,
      is_main_mystery: false,
      stale: false,
      stale_since_chapter: null,
    },
    {
      id: `${storyId}:thread:conviction`,
      story_id: storyId,
      title: 'Keyakinan Raka',
      status: 'OPEN',
      opened_chapter: 1,
      last_touched_chapter: 1,
      payoff_window: null,
      is_main_mystery: false,
      stale: false,
      stale_since_chapter: null,
    },
  ])

  await admin.from('secrets_reveals').insert(
    REVEALS.map((r) => ({
      story_id: storyId,
      id: `${storyId}:${r.secretId}`,
      description: `Rahasia ${r.secretId}`,
      reveal_gate_chapter: r.revealGateChapter,
      revealed: false,
    })),
  )

  await admin.from('reader_states').insert({
    user_id: USER_ID,
    story_id: storyId,
    status: 'BERJALAN',
    current_chapter: 1,
    route_state: {},
    choice_history: [],
    jejak: [],
    locked_ending_key: null,
  })
}

// ---------------------------------------------------------------------------
describe.skipIf(!process.env.LAKOKU_LOCAL_DB_TEST)('M10-A1d.3b Validated State Full Parity (Bab 1–50 sync + worker)', () => {
  let admin: ReturnType<typeof createAdminClient>
  let selectProviderSpy: ReturnType<typeof vi.spyOn>

  beforeAll(async () => {
    selectProviderSpy = vi.spyOn(aiGatewayServerModule, 'selectProvider')
    admin = createAdminClient()
    await admin.auth.admin.createUser({
      id: USER_ID,
      email: 'a1d3b@example.com',
      password: 'password123',
      email_confirm: true,
    }).catch(() => null)

    for (const storyId of [SYNC_STORY, WORKER_STORY, NEG_STORY]) {
      await cleanupStory(admin, storyId)
      await seedStory(admin, storyId)
    }
  }, 30000)

  afterAll(async () => {
    for (const storyId of [SYNC_STORY, WORKER_STORY, NEG_STORY]) {
      await cleanupStory(admin, storyId)
    }
    await admin.auth.admin.deleteUser(USER_ID).catch(() => null)
  }, 30000)

  async function recordReaderChoice(storyId: string, chapterNumber: number) {
    const { data: reader } = await admin
      .from('reader_states')
      .select('choice_history')
      .eq('user_id', USER_ID)
      .eq('story_id', storyId)
      .single()
    const history = Array.isArray(reader?.choice_history) ? reader.choice_history : []
    await admin.from('reader_states').update({
      choice_history: [
        ...history,
        {
          chapterNumber,
          choiceId: 'buka-jejak',
          label: `Pilihan bab ${chapterNumber}`,
          consequence: ['Jejak baru terbuka.'],
          effectSummary: { flagsSet: [] },
          createdAt: new Date().toISOString(),
        },
      ],
    }).eq('user_id', USER_ID).eq('story_id', storyId)
  }

  async function assertNoPublication(storyId: string, chapterNumber: number, expectedRevision: number, expectedReaderChapter: number) {
    // Tidak ada commit state, tidak ada kenaikan revision, tidak ada checkpoint
    // dan progres reader tidak maju — bukti gagal SEBELUM publication.
    const { data: commits } = await admin
      .from('chapter_state_commits')
      .select('chapter_number')
      .eq('story_id', storyId)
      .eq('chapter_number', chapterNumber)
    expect(commits ?? []).toHaveLength(0)
    const { data: checkpoints } = await admin
      .from('chapter_generation_checkpoints')
      .select('chapter_number')
      .eq('story_id', storyId)
      .eq('chapter_number', chapterNumber)
    expect(checkpoints ?? []).toHaveLength(0)
    const { data: story } = await admin.from('stories').select('canon_state_revision').eq('id', storyId).single()
    expect(Number(story?.canon_state_revision)).toBe(expectedRevision)
    const { data: reader } = await admin
      .from('reader_states')
      .select('status, current_chapter')
      .eq('user_id', USER_ID)
      .eq('story_id', storyId)
      .single()
    // Bab gagal = tidak boleh menuntaskan progres reader: status tetap
    // BERJALAN dan current_chapter tidak boleh beranjak ke bab yang dicoba.
    expect(reader?.status).toBe('BERJALAN')
    expect(Number(reader?.current_chapter)).toBe(expectedReaderChapter)
  }

  async function runSyncChapter(
    storyId: string,
    chapterNumber: number,
    resumeAttemptId?: string,
    proposal: StructuredStateProposalV1 = proposalFor(storyId, chapterNumber),
  ) {
    const correlationId = resumeAttemptId ?? randomUUID()
    return generateNextPersonalizedChapter({
      storyId,
      userId: USER_ID,
      chapterNumber,
      correlationId,
      attemptId: correlationId,
      triggerChoiceId: chapterNumber > 1 ? 'buka-jejak' : null,
      stateProposal: proposal,
    })
  }

  async function runWorkerChapter(
    storyId: string,
    chapterNumber: number,
    proposal: StructuredStateProposalV1 = proposalFor(storyId, chapterNumber),
    jobId: string = randomUUID(),
  ) {
    const { data: jobRow, error: jobErr } = await admin.from('generation_jobs').insert({
      id: jobId,
      story_id: storyId,
      chapter_number: chapterNumber,
      user_id: USER_ID,
      generation_kind: 'personalized',
      story_contract_version: 1,
      trigger_choice_id: chapterNumber > 1 ? 'buka-jejak' : null,
      status: 'QUEUED',
      max_attempts: 4,
      deadline_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      publication_idempotency_key: `generation-job:${jobId}:publish:${chapterNumber}`,
    }).select('id').single()
    if (!jobRow || jobErr) throw new Error(`worker job insert failed: ${JSON.stringify(jobErr)}`)

    const claim = await claimGenerationJobById({ jobId, workerId: 'a1d3b-smoke-worker' })
    if (!claim.claimed || !('job' in claim) || !claim.job) {
      throw new Error(`worker claim failed for job ${jobId}`)
    }
    const job = claim.job
    const lease = await acquireGenerationJobLease({
      jobId: job.id,
      workerId: job.workerId,
      claimToken: job.claimToken,
      ttlSeconds: 300,
    })
    if (!lease.ok) throw new Error(`worker lease failed: ${lease.reason}`)
    const jobContext = claimedJobToPartialContext(job, lease.leaseId, new AbortController().signal)
    const res = await generateNextPersonalizedChapter({
      storyId,
      userId: job.userId,
      chapterNumber,
      correlationId: job.correlationId,
      attemptId: job.id,
      triggerChoiceId: job.triggerChoiceId ?? null,
      jobContext,
      stateProposal: proposal,
    })
    return { res, jobId }
  }

  it('Bab 1–50 sync & worker: full lifecycle, checkpoint resume bab 20, act rollups, bab 45 ending lock, bab 50 completion, & exact semantic parity', async () => {
    const syncResumeAttempt20 = randomUUID()

    // Eksekusi sync 1..50 dengan resume test pada bab 20
    for (let ch = 1; ch <= 50; ch++) {
      const attemptId = ch === 20 ? syncResumeAttempt20 : undefined
      const res = await runSyncChapter(SYNC_STORY, ch, attemptId)
      if (!res.ok) console.error(`SYNC_BAB_${ch}_ERROR`, JSON.stringify(res, null, 2))
      expect(res, `Sync Bab ${ch} failed`).toMatchObject({ ok: true, chapterNumber: ch })

      if (ch === 20) {
        // Re-run bab 20 dengan attemptId sama -> dari checkpoint, no double-apply
        const resResume = await runSyncChapter(SYNC_STORY, 20, syncResumeAttempt20)
        expect(resResume, 'Sync Bab 20 checkpoint resume failed').toMatchObject({ ok: true, fromCheckpoint: true })
      }

      await recordReaderChoice(SYNC_STORY, ch)
    }

    // Eksekusi worker 1..50
    for (let ch = 1; ch <= 50; ch++) {
      const { res } = await runWorkerChapter(WORKER_STORY, ch)
      if (!res.ok) console.error(`WORKER_BAB_${ch}_ERROR`, JSON.stringify(res, null, 2))
      expect(res, `Worker Bab ${ch} failed`).toMatchObject({ ok: true, chapterNumber: ch })
      await recordReaderChoice(WORKER_STORY, ch)
    }

    // ---- Verification 1: Revision 0 -> 50 + Bab 50 completion ----
    for (const storyId of [SYNC_STORY, WORKER_STORY]) {
      const { data: story } = await admin.from('stories').select('canon_state_revision').eq('id', storyId).single()
      expect(Number(story?.canon_state_revision)).toBe(50)
      // Surfac progres/status pembaca tinggal di reader_states (server.ts overlay);
      // stories.current_chapter adalah field shell/seed, bukan progres berjalan.
      const { data: reader } = await admin
        .from('reader_states')
        .select('status, current_chapter, locked_ending_key')
        .eq('user_id', USER_ID)
        .eq('story_id', storyId)
        .single()
      expect(reader?.status).toBe('SELESAI')
      expect(Number(reader?.current_chapter)).toBe(50)
      expect(reader?.locked_ending_key).toBeTruthy()
    }

    // ---- Verification 2: Commits (50 rows) ----
    for (const storyId of [SYNC_STORY, WORKER_STORY]) {
      const { data: commits } = await admin
        .from('chapter_state_commits')
        .select('chapter_number, committed_canon_revision, base_canon_revision')
        .eq('story_id', storyId)
        .order('chapter_number', { ascending: true })
      expect(commits?.length).toBe(50)
      expect(commits?.map((c) => c.chapter_number)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1))
      expect(commits?.map((c) => Number(c.committed_canon_revision))).toEqual(Array.from({ length: 50 }, (_, i) => i + 1))
      expect(commits?.map((c) => Number(c.base_canon_revision))).toEqual(Array.from({ length: 50 }, (_, i) => i))
    }

    // ---- Verification 3: Act Rollup Checkpoints ----
    // Bab 5 (Act 1), Bab 12 (Act 2), Bab 50 (Act 3): commit delta wajib
    // membawa actRollup eksak sesuai actPlan (deskriptor = actEntry boundary).
    // Kolom delta commit bernama state_delta_json (bukan state_delta).
    const ACT_BOUNDARY_EXPECTATIONS = [
      { chapter: 5, actNumber: 1, from: 1, to: 5 },
      { chapter: 12, actNumber: 2, from: 6, to: 12 },
      { chapter: 50, actNumber: 3, from: 13, to: 50 },
    ] as const
    for (const storyId of [SYNC_STORY, WORKER_STORY]) {
      for (const exp of ACT_BOUNDARY_EXPECTATIONS) {
        const { data: commitRow } = await admin
          .from('chapter_state_commits')
          .select('state_delta_json')
          .eq('story_id', storyId)
          .eq('chapter_number', exp.chapter)
          .single()
        const delta = commitRow?.state_delta_json as Record<string, unknown> | null
        expect(delta, `Bab ${exp.chapter} commit delta ada`).toBeTruthy()
        const rollup = delta?.actRollup as Record<string, unknown> | null
        expect(rollup, `Bab ${exp.chapter} actRollup ada`).toBeTruthy()
        expect(rollup?.actNumber).toBe(exp.actNumber)
        expect(rollup?.coversFromChapter).toBe(exp.from)
        expect(rollup?.coversToChapter).toBe(exp.to)
        expect(rollup?.summary).toBeTruthy()
        expect(rollup?.stateDelta).toBeTruthy()
      }
      // Applier juga menulis rollup terpisah ke act_rollups (deskriptor sama).
      const { data: rollups } = await admin
        .from('act_rollups')
        .select('act_number, covers_from_chapter, covers_to_chapter')
        .eq('story_id', storyId)
        .order('act_number', { ascending: true })
      expect(rollups?.map((r) => r.act_number)).toEqual([1, 2, 3])
      expect(rollups?.map((r) => r.covers_to_chapter)).toEqual([5, 12, 50])
    }

    // ---- Verification 4: Plot Debts Closure ----
    // 'debt:a' closed at ch 8, 'main_mystery' closed at ch 48
    for (const storyId of [SYNC_STORY, WORKER_STORY]) {
      const { data: closures } = await admin.from('reader_plot_debt_closures').select('debt_id, closed_at_chapter').eq('story_id', storyId)
      expect(closures?.find((c) => c.debt_id === 'debt:a')?.closed_at_chapter).toBe(8)
      expect(closures?.find((c) => c.debt_id === 'main_mystery')?.closed_at_chapter).toBe(48)
    }

    // ---- Verification 5: Bab 45 Ending Lock ----
    // persist_ending_lock_v1 menulis ending_lock_json = {key, name,
    // lockedAtChapter} (bukan lockedEndingKey) secara atomik di Bab 45.
    for (const storyId of [SYNC_STORY, WORKER_STORY]) {
      const { data: contractRow } = await admin.from('story_generation_contracts').select('ending_lock_json').eq('story_id', storyId).single()
      const lockJson = contractRow?.ending_lock_json as Record<string, unknown>
      expect(lockJson?.key).toBeTruthy()
      expect(lockJson?.name).toBeTruthy()
      expect(Number(lockJson?.lockedAtChapter)).toBe(45)
    }

    // ---- Verification 6: S/W Semantic Canon Parity ----
    const normalizeStory = (val: unknown): unknown => {
      if (typeof val === 'string') {
        return val
          .replaceAll(WORKER_STORY, SYNC_STORY)
          .replace(/:fact:runtime:[a-f0-9]+/g, ':fact:runtime:HASH')
      }
      if (Array.isArray(val)) return val.map(normalizeStory)
      if (val && typeof val === 'object') {
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
          if (['id', 'story_id', 'created_at', 'updated_at', 'source_job_id', 'closed_by_job_id'].includes(k)) continue
          out[k] = normalizeStory(v)
        }
        return out
      }
      return val
    }

    const stripStory = (rows: unknown[]) =>
      (rows ?? [])
        .map(normalizeStory)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))

    for (const table of [
      'facts_ledger',
      'knowledge_scopes',
      'timeline_events',
      'story_threads',
      'secrets_reveals',
      'reader_plot_debt_progress',
      'reader_plot_debt_closures',
    ] as const) {
      const [sRes, wRes] = await Promise.all([
        admin.from(table).select('*').eq('story_id', SYNC_STORY),
        admin.from(table).select('*').eq('story_id', WORKER_STORY),
      ])
      expect(stripStory(wRes.data ?? []), `Table ${table} parity failed`).toEqual(stripStory(sRes.data ?? []))
    }

    // Special check for character_states (queries by character_id since story_id isn't a column on character_states)
    const [sCharRes, wCharRes] = await Promise.all([
      admin.from('character_states').select('*').in('character_id', CHARACTERS.map((c) => `${SYNC_STORY}:${c.id}`)),
      admin.from('character_states').select('*').in('character_id', CHARACTERS.map((c) => `${WORKER_STORY}:${c.id}`)),
    ])
    expect(stripStory(wCharRes.data ?? []), 'Table character_states parity failed').toEqual(stripStory(sCharRes.data ?? []))

    expect(selectProviderSpy).toHaveBeenCalled()
  }, 120000)

  it('Bab 48/49 negative regression: main mystery WAJIB ditutup di Bab 48, 49+ unresolved hard-fail — gagal SEBELUM publication (sync + worker)', async () => {
    // Jalankan NEG_STORY sync 1..47 dengan sequence deterministik yang SAMA
    // dengan parity utama hingga pra-Bab 48: canon revision 47, main_mystery
    // belum ditutup (thread debt-backed PAYOFF_DUE sejak milestone final Bab
    // 45).
    for (let ch = 1; ch <= 47; ch++) {
      const res = await runSyncChapter(NEG_STORY, ch)
      expect(res, `NEG sync Bab ${ch} failed`).toMatchObject({ ok: true, chapterNumber: ch })
      await recordReaderChoice(NEG_STORY, ch)
    }
    // Pre-state Bab 48: otoritas progres berjalan = canon_state_revision 47
    // (reader_states.current_chapter hanya seed; naik ke 50 saat SELESAI).
    const { data: preState } = await admin
      .from('stories')
      .select('canon_state_revision')
      .eq('id', NEG_STORY)
      .single()
    expect(Number(preState?.canon_state_revision)).toBe(47)
    const { data: preMainMystery } = await admin
      .from('story_threads')
      .select('status')
      .eq('id', debtBackedThreadId(NEG_STORY, 'main_mystery'))
      .single()
    expect(preMainMystery?.status).toBe('PAYOFF_DUE')

    // B (sync): delta Bab 48 TIDAK menutup main_mystery -> otoritas ledger
    // resolveDebtClosures melaporkan MAIN_MYSTERY_UNRESOLVED (chapter >=
    // resolve-by 48) -> resolver melempar STATE_DELTA_POLICY_VIOLATION
    // SEBELUM checkpoint/publish. Tanpa bahwa, perubahan M5 "48 tidak diblok
    // dari pra-bab" akan membuka lubang satu bab.
    const bSyncErr = await runSyncChapter(NEG_STORY, 48, undefined, proposalForNeg(NEG_STORY, 48))
      .catch((e: unknown) => e)
    expect(bSyncErr).toBeInstanceOf(ChapterStateResolverError)
    expect((bSyncErr as ChapterStateResolverError).code).toBe('STATE_DELTA_POLICY_VIOLATION')
    expect((bSyncErr as ChapterStateResolverError).details.join('\n')).toContain('MAIN_MYSTERY_UNRESOLVED')
    await assertNoPublication(NEG_STORY, 48, 47, 1)

    // C (sync): Bab 49 — main_mystery masih unresolved. Runtime TIDAK sampai
    // ke validator karena continuation fail-closed (commit Bab 48 tidak ada →
    // PREV_CHAPTER_MISSING): hard FAIL dengan tanpa publication apa pun.
    // Ini menutup lubang satu bab: cerita tidak bisa "loncat" ke Bab 49
    // dengan mystery tergantung.
    const cSyncErr = await runSyncChapter(NEG_STORY, 49, undefined, proposalForNeg(NEG_STORY, 49))
      .catch((e: unknown) => e)
    expect(cSyncErr).toMatchObject({ ok: false, reason: 'TRANSIENT', detail: 'PREV_CHAPTER_MISSING' })
    await assertNoPublication(NEG_STORY, 49, 47, 1)

    // C (otoritas resolver): walau kontinuitas dipaksa (Bab 48 dikomit tanpa
    // closure — skenario wiring rusak), otoritas ledger resolveDebtClosures
    // tetap hard-fail di Bab 49 via branch yang SAMA dengan Bab 48
    // (`chapter >= resolve-by 48`) — dipanggil langsung dengan fixture cerita
    // ini: main_mystery open, debt:a sudah ditutup di Bab 8. Bab 49 juga
    // melewati mustCloseBy → DEBT_DEADLINE_VIOLATION ikut muncul; kode pertama
    // findings, tapi yang membuktikan gate mystery adalah MAIN_MYSTERY_UNRESOLVED.
    const cLedger = resolveDebtClosures({
      chapterNumber: 49,
      debts: PLOT_DEBTS,
      closedDebtIds: ['debt:a'],
      proposals: [],
    })
    expect(cLedger.ok).toBe(false)
    expect(cLedger.findings.map((f) => f.code)).toContain('MAIN_MYSTERY_UNRESOLVED')

    // B (worker): jalur produksi V5 — job worker Bab 48 tanpa closure juga
    // gagal sebelum publication (shared boundary yang sama). Job + lease
    // dibersihkan setelahnya agar tidak mencemari suite DB lain.
    const wJobId = randomUUID()
    const bWorkerErr = await runWorkerChapter(NEG_STORY, 48, proposalForNeg(NEG_STORY, 48), wJobId)
      .catch((e: unknown) => e)
    await admin.from('generation_leases').delete().eq('job_id', wJobId)
    await admin.from('generation_jobs').delete().eq('id', wJobId)
    expect(bWorkerErr).toBeInstanceOf(ChapterStateResolverError)
    expect((bWorkerErr as ChapterStateResolverError).code).toBe('STATE_DELTA_POLICY_VIOLATION')
    expect((bWorkerErr as ChapterStateResolverError).details.join('\n')).toContain('MAIN_MYSTERY_UNRESOLVED')
    await assertNoPublication(NEG_STORY, 48, 47, 1)
  }, 120000)
})
