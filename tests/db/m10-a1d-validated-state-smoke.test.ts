// @vitest-environment node
/**
 * M10-A1d — Validated State Lifecycle intermediate smoke (A1d.3a).
 *
 * Deterministic (tanpa real model), jalur runtime SAMA dengan produksi
 * (`generateNextPersonalizedChapter` + RPC checkpoint fenced_v2/sync_v1 +
 * publisher V5/V3) terhadap Supabase lokal. Dua clone story living-canon v1
 * terisolasi (sync + worker) menjalankan SEQUENCE proposal deterministik yang
 * sama; diverifikasi: seluruh kategori state canon (facts.add/payoff,
 * knowledge.grant, timeline, character ALIVE→INACTIVE, thread non-debt
 * touch/transition, debt progress + thread debt-backed transition, secret
 * reveal), checkpoint resume idempoten (sync, tidak double-advance),
 * canon revision 0→N, dan parity sync/worker.
 *
 * Jalankan: LAKOKU_LOCAL_DB_TEST=1 pnpm exec vitest run tests/db/m10-a1d-validated-state-smoke.test.ts
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
import * as aiGatewayServerModule from '@lakoku/ai-gateway/server'

const SYNC_STORY = 'a1d3-sync'
const WORKER_STORY = 'a1d3-worker'
const USER_ID = '88888888-8888-4888-8888-888888888888'

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
    title: 'Brankas Rahasia',
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

function policyForChapter(
  storyId: string,
  chapterNumber: number,
  overrides?: DeepPartial<AllowedChapterStatePolicyV1>,
): AllowedChapterStatePolicyV1 {
  const base = buildBaselinePolicyForChapter({
    storyContract: buildContract(storyId),
    chapterNumber,
  })
  if (!overrides) return base
  const merged: AllowedChapterStatePolicyV1 = {
    ...base,
    facts: { ...base.facts, ...overrides.facts },
    knowledge: { ...base.knowledge, ...overrides.knowledge },
    secrets: { ...base.secrets, ...overrides.secrets },
    characters: { ...base.characters, ...overrides.characters },
    threads: { ...base.threads, ...overrides.threads },
    plotDebts: { ...base.plotDebts, ...overrides.plotDebts },
    actRollup: overrides.actRollup !== undefined ? overrides.actRollup : base.actRollup,
  }
  return merged
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
  return undefined
}

function proposalFor(storyId: string, chapterNumber: number): StructuredStateProposalV1 {
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
    actRollup: null,
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
  // Bab 3: secret reveal + debt:a milestone 3 (semua mustProgressBy lunas → PAYOFF_DUE).
  return {
    ...base,
    secrets: { revealIds: [`${storyId}:secret:brankas`] },
    plotDebts: { progress: [{ debtId: 'debt:a', milestoneChapter: 3 }], closures: [] },
  }
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
    title: 'Brankas Rahasia',
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

  // status ALIVE eksplisit (as_of_chapter 1) — V3 butuh row character_states
  // nyata utk preflight `from` (loader default ALIVE tanpa row, tapi DB tak punya).
  await admin.from('character_states').insert(
    CHARACTERS.map((c) => ({
      character_id: `${storyId}:${c.id}`,
      status: 'ALIVE',
      as_of_chapter: 0,
      attributes: {},
    })),
  )

  // Thread debt-backed (dibootstraps kontrakToCanonBootstrap juga) + 1 thread
  // non debt-backed untuk proof touch/transition di luar utang.
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
describe.skipIf(!process.env.LAKOKU_LOCAL_DB_TEST)('M10-A1d.3a Validated State Smoke (sync + worker)', () => {
  let admin: ReturnType<typeof createAdminClient>
  let selectProviderSpy: ReturnType<typeof vi.spyOn>

  beforeAll(async () => {
    selectProviderSpy = vi.spyOn(aiGatewayServerModule, 'selectProvider')
    admin = createAdminClient()
    await admin.auth.admin.createUser({
      id: USER_ID,
      email: 'a1d3@example.com',
      password: 'password123',
      email_confirm: true,
    }).catch(() => null)

    for (const storyId of [SYNC_STORY, WORKER_STORY]) {
      await cleanupStory(admin, storyId)
      await seedStory(admin, storyId)
    }
  })

  afterAll(async () => {
    for (const storyId of [SYNC_STORY, WORKER_STORY]) {
      await cleanupStory(admin, storyId)
    }
    await admin.auth.admin.deleteUser(USER_ID).catch(() => null)
  })

  // Rekam pilihan pembaca (choice_history) seperti applyPersonalizedChoice —
  // continuation context Bab N+1 butuh entry trigger di history reader.
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
          label: 'Buka brankas milik Raka Nusantara',
          consequence: ['Jejak baru terbuka.'],
          effectSummary: { flagsSet: [] },
          createdAt: new Date().toISOString(),
        },
      ],
    }).eq('user_id', USER_ID).eq('story_id', storyId)
  }

  async function runSyncChapter(
    storyId: string,
    chapterNumber: number,
    resumeAttemptId?: string,
  ) {
    const correlationId = resumeAttemptId ?? randomUUID()
    return generateNextPersonalizedChapter({
      storyId,
      userId: USER_ID,
      chapterNumber,
      correlationId,
      attemptId: correlationId,
      triggerChoiceId: chapterNumber > 1 ? 'buka-jejak' : null,
      stateProposal: proposalFor(storyId, chapterNumber),
    })
  }

  async function runWorkerChapter(storyId: string, chapterNumber: number) {
    const jobId = randomUUID()
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

    const claim = await claimGenerationJobById({ jobId, workerId: 'a1d3-smoke-worker' })
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
    return generateNextPersonalizedChapter({
      storyId,
      userId: job.userId,
      chapterNumber,
      correlationId: job.correlationId,
      attemptId: job.id,
      triggerChoiceId: job.triggerChoiceId ?? null,
      jobContext,
      stateProposal: proposalFor(storyId, chapterNumber),
    })
  }

  it('Bab 1–3 sync & worker: semua kategori state + revision 0→3 + checkpoint resume', async () => {
    for (const storyId of [SYNC_STORY, WORKER_STORY]) {
      const runner = storyId === SYNC_STORY ? runSyncChapter : runWorkerChapter

      const r1 = await runner(storyId, 1)
      expect(r1, JSON.stringify(r1)).toMatchObject({ ok: true, chapterNumber: 1 })
      await recordReaderChoice(storyId, 1)

      // Checkpoint resume (sync): re-run bab 2 dengan attempt/correlation SAMA
      // → schema-3 checkpoint ditemukan, V3 EXACT_REPLAY — tidak double-apply.
      // attemptId HARUS sama dgn bab 2 pertama (bukan UUID baru) supaya
      // lookup checkpoint ketemu.
      const resumeAttemptId = storyId === SYNC_STORY ? randomUUID() : undefined
      const r2 = resumeAttemptId
        ? await runSyncChapter(storyId, 2, resumeAttemptId)
        : await runner(storyId, 2)
      expect(r2, JSON.stringify(r2)).toMatchObject({ ok: true, chapterNumber: 2 })
      await recordReaderChoice(storyId, 2)

      if (storyId === SYNC_STORY) {
        const r2b = await runSyncChapter(storyId, 2, resumeAttemptId)
        expect(r2b, JSON.stringify(r2b)).toMatchObject({ ok: true, fromCheckpoint: true })
      }

      const r3 = await runner(storyId, 3)
      expect(r3, JSON.stringify(r3)).toMatchObject({ ok: true })

      // ---- Revision 0→N ----
      const { data: story } = await admin.from('stories').select('canon_state_revision').eq('id', storyId).single()
      expect(Number(story?.canon_state_revision)).toBe(3)

      // ---- Commits: tepat 1 per bab, base/committed berurutan ----
      const { data: commits } = await admin
        .from('chapter_state_commits')
        .select('chapter_number, committed_canon_revision, base_canon_revision, state_delta_schema_version, publication_result')
        .eq('story_id', storyId)
        .order('chapter_number', { ascending: true })
      expect(commits?.map((c) => c.chapter_number)).toEqual([1, 2, 3])
      expect(commits?.map((c) => Number(c.committed_canon_revision))).toEqual([1, 2, 3])
      expect(commits?.map((c) => Number(c.base_canon_revision))).toEqual([0, 1, 2])
      for (const c of commits ?? []) {
        expect(Number(c.state_delta_schema_version)).toBe(1)
        expect(c.publication_result?.ok).toBe(true)
      }

      // ---- Checkpoint schema-3 ----
      const { data: cps } = await admin
        .from('chapter_generation_checkpoints')
        .select('chapter_number, checkpoint_schema_version, state_delta_schema_version, state_delta_hash, base_canon_revision')
        .eq('story_id', storyId)
        .order('chapter_number', { ascending: true })
      expect(cps?.length).toBe(3)
      for (const cp of cps ?? []) {
        expect(Number(cp.checkpoint_schema_version)).toBe(3)
        expect(Number(cp.state_delta_schema_version)).toBe(1)
        expect(cp.state_delta_hash).toBeTruthy()
        expect(Number(cp.base_canon_revision)).toBe(Number(cp.chapter_number) - 1)
      }

      // ---- Fact add + payoff ----
      const factId = factIdFor(storyId)
      const { data: factRows } = await admin.from('facts_ledger').select('id, paid_off, established_chapter').eq('story_id', storyId)
      const factRow = factRows?.find((f) => f.id === factId)
      expect(factRow, `fact ${factId} ada`).toBeTruthy()
      expect(Number(factRow?.established_chapter)).toBe(1)
      expect(Boolean(factRow?.paid_off)).toBe(true)

      // ---- Knowledge grant ----
      const { data: kg } = await admin
        .from('knowledge_scopes')
        .select('fact_id')
        .eq('story_id', storyId)
        .eq('character_id', `${storyId}:char:hero`)
      expect((kg ?? []).map((k) => k.fact_id)).toEqual([factId])

      // ---- Timeline ----
      const { data: tl } = await admin.from('timeline_events').select('ordinal').eq('story_id', storyId)
      expect((tl ?? []).map((t) => Number(t.ordinal))).toEqual([0])

      // ---- Character ALIVE→INACTIVE (as_of bab 1) ----
      const { data: cst } = await admin
        .from('character_states')
        .select('character_id, status, as_of_chapter')
        .in('character_id', [`${storyId}:char:rival`, `${storyId}:char:hero`])
      expect(cst?.some((s) => s.character_id === `${storyId}:char:rival` && s.status === 'INACTIVE' && Number(s.as_of_chapter) === 1)).toBe(true)
      expect(cst?.some((s) => s.character_id === `${storyId}:char:hero` && s.status === 'ALIVE')).toBe(true)

      // ---- Threads: non-debt touch/transition + debt-backed derive ----
      const { data: th } = await admin.from('story_threads').select('id, status').eq('story_id', storyId)
      const byId = new Map((th ?? []).map((t) => [t.id, t]))
      expect(byId.get(`${storyId}:thread:conviction`)?.status).toBe('DEVELOPING')
      expect(byId.get(debtBackedThreadId(storyId, 'debt:a'))?.status).toBe('PAYOFF_DUE')
      expect(byId.get(debtBackedThreadId(storyId, 'main_mystery'))?.status).toBe('OPEN')

      // ---- Secret reveal ----
      const { data: sr } = await admin.from('secrets_reveals').select('revealed').eq('story_id', storyId)
      expect(sr?.length).toBe(1)
      expect(Boolean(sr?.[0]?.revealed)).toBe(true)

      // ---- Plot debt ledger ----
      const { data: prog } = await admin
        .from('reader_plot_debt_progress')
        .select('debt_id, milestone_chapter')
        .eq('story_id', storyId)
      expect((prog ?? []).map((p) => `${p.debt_id}:${p.milestone_chapter}`).sort()).toEqual(['debt:a:1', 'debt:a:3'])
    }

    expect(selectProviderSpy).toHaveBeenCalled()

    // ---- S/W parity: kanon semantic identik (strip id/provenance) ----
    for (const table of [
      'facts_ledger',
      'knowledge_scopes',
      'timeline_events',
      'character_states',
      'story_threads',
      'secrets_reveals',
      'reader_plot_debt_progress',
    ] as const) {
      const [sRes, wRes] = await Promise.all([
        admin.from(table).select('*').eq('story_id', SYNC_STORY),
        admin.from(table).select('*').eq('story_id', WORKER_STORY),
      ])
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
            if (['id', 'story_id', 'created_at', 'updated_at', 'source_job_id'].includes(k)) continue
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
      expect(stripStory(wRes.data ?? [])).toEqual(stripStory(sRes.data ?? []))
    }
    const [sR, wR] = await Promise.all([
      admin.from('stories').select('canon_state_revision').eq('id', SYNC_STORY).single(),
      admin.from('stories').select('canon_state_revision').eq('id', WORKER_STORY).single(),
    ])
    expect(Number(sR.data?.canon_state_revision)).toBe(Number(wR.data?.canon_state_revision))
  })
})
