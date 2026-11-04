import 'server-only'

/**
 * Job latar belakang perakitan story bible (T-setup-fix).
 *
 * Menggantikan server action tunggal `actAssembleAndLockStory` yang merakit
 * cast → mystery → world → lock dalam SATU request. Pola lama membuat request
 * menunggu 1-4 menit sehingga proxy produksi (Cloudflare ±100s) memotongnya
 * dengan 524 di depan pembaca — user melihat error generik padahal server
 * masih bekerja, dan tidak ada yang bisa di-resume.
 *
 * Sekarang: POST membuat baris `story_setup_jobs` lalu runner in-process
 * mengeksekusi tahap demi tahap. Hasil tiap tahap dipersist, jadi retry
 * ("Coba lagi") melanjutkan dari tahap yang gagal tanpa membakar ulang
 * panggilan yang sudah sukses.
 *
 * Runner menerima `repo` + `authors` yang dapat diinjeksi agar unit test
 * berjalan tanpa DB dan tanpa provider AI nyata.
 */
import { randomUUID } from 'node:crypto'
import { PremiseSchema, type CastDraft, type MysteryDraft, type PremiseDraft, type WorldDraft } from './schema'
import { proposeCast, proposeMystery, proposeWorld, type AuthoringDirectionOpts } from './brainstorm'
import {
  AuthoringBusyError,
  PublicAuthoringError,
  publicAuthoringErrorMessage,
} from './model'
import {
  lockStoryBibleForUser,
  type AuthoringLockResult,
} from '@/lib/api/authoring-lock.server'
import type { StoryCreativeDirection } from '@/lib/onboarding/creative-direction'
import type {
  StorySetupJobErrorCode,
  StorySetupJobStage,
} from '@lakoku/contracts'

// ── Tipe job (camelCase — repo Kysely yang memetakan kolom snake_case) ──

export interface StorySetupJobRecord {
  id: string
  userId: string
  status: string
  stage: string
  errorCode: string | null
  errorMessage: string | null
  premise: unknown
  creativeDirection: unknown
  castResult: unknown
  mysteryResult: unknown
  worldResult: unknown
  storyId: string | null
}

export interface StorySetupJobPatch {
  status?: string
  stage?: StorySetupJobStage
  errorCode?: string | null
  errorMessage?: string | null
  premise?: unknown
  creativeDirection?: unknown
  castResult?: unknown
  mysteryResult?: unknown
  worldResult?: unknown
  storyId?: string | null
  startedAt?: Date | null
  finishedAt?: Date | null
}

export interface StorySetupJobRepo {
  /** Nonaktifkan semua job aktif milik user (idempotensi: satu job aktif). */
  supersedeActiveJobs(userId: string, exceptJobId: string): Promise<number>
  insertJob(input: {
    id: string
    userId: string
    premise: unknown
    creativeDirection: unknown
    castResult: unknown
    mysteryResult: unknown
    worldResult: unknown
    stage: StorySetupJobStage
  }): Promise<void>
  getJob(id: string): Promise<StorySetupJobRecord | null>
  updateJob(id: string, patch: StorySetupJobPatch): Promise<void>
}

// ── Author deps (injeksi untuk test) ────────────────────────────────

export interface StorySetupAuthors {
  proposeCast: (
    premise: PremiseDraft,
    feedback?: string,
    previous?: CastDraft,
    opts?: AuthoringDirectionOpts,
  ) => Promise<{ cast: CastDraft; usedModel: string }>
  proposeMystery: (
    premise: PremiseDraft,
    cast: CastDraft,
    feedback?: string,
    previous?: MysteryDraft,
    opts?: AuthoringDirectionOpts,
  ) => Promise<{ mystery: MysteryDraft; usedModel: string }>
  proposeWorld: (
    premise: PremiseDraft,
    cast: CastDraft,
    mystery: MysteryDraft,
    feedback?: string,
    previous?: WorldDraft,
    opts?: AuthoringDirectionOpts,
  ) => Promise<{ world: WorldDraft; usedModel: string }>
  lockStoryBibleForUser: (draft: unknown, userId: string) => Promise<AuthoringLockResult>
}

const defaultAuthors: StorySetupAuthors = {
  proposeCast,
  proposeMystery,
  proposeWorld,
  lockStoryBibleForUser,
}

// ── Repo Kysely default ─────────────────────────────────────────────

function rowToRecord(row: {
  id: string
  user_id: string
  status: string
  stage: string
  error_code: string | null
  error_message: string | null
  premise: unknown
  creative_direction: unknown
  cast_result: unknown
  mystery_result: unknown
  world_result: unknown
  story_id: string | null
}): StorySetupJobRecord {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    stage: row.stage,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    premise: row.premise,
    creativeDirection: row.creative_direction,
    castResult: row.cast_result,
    mysteryResult: row.mystery_result,
    worldResult: row.world_result,
    storyId: row.story_id,
  }
}

export function createKyselyStorySetupJobRepo() {
  return {
    async supersedeActiveJobs(userId: string, exceptJobId: string): Promise<number> {
      const { getDb } = await import('@lakoku/db')
      const db = getDb()
      const res = await db
        .updateTable('story_setup_jobs')
        .set({
          status: 'failed',
          errorCode: 'superseded',
          errorMessage: 'Digantikan percobaan baru.',
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where('user_id', '=', userId)
        .where('status', 'in', ['queued', 'running'])
        .where('id', '!=', exceptJobId)
        .executeTakeFirst()
      return Number(res.numUpdatedRows ?? 0)
    },

    async insertJob(input: {
      id: string
      userId: string
      premise: unknown
      creativeDirection: unknown
      castResult: unknown
      mysteryResult: unknown
      worldResult: unknown
      stage: StorySetupJobStage
    }): Promise<void> {
      const { getDb } = await import('@lakoku/db')
      const db = getDb()
      await db
        .insertInto('story_setup_jobs')
        .values({
          id: input.id,
          userId: input.userId,
          status: 'queued',
          stage: input.stage,
          premise: input.premise as never,
          creativeDirection: (input.creativeDirection ?? null) as never,
          castResult: (input.castResult ?? null) as never,
          mysteryResult: (input.mysteryResult ?? null) as never,
          worldResult: (input.worldResult ?? null) as never,
        })
        .execute()
    },

    async getJob(id: string): Promise<StorySetupJobRecord | null> {
      const { getDb } = await import('@lakoku/db')
      const db = getDb()
      const rows = await db
        .selectFrom('story_setup_jobs')
        .selectAll()
        .where('id', '=', id)
        .limit(1)
        .execute()
      const row = rows[0]
      return row ? rowToRecord(row) : null
    },

    async updateJob(id: string, patch: StorySetupJobPatch): Promise<void> {
      const { getDb } = await import('@lakoku/db')
      const db = getDb()
      await db
        .updateTable('story_setup_jobs')
        .set({
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.stage !== undefined ? { stage: patch.stage } : {}),
          ...(patch.errorCode !== undefined ? { errorCode: patch.errorCode } : {}),
          ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
          ...(patch.premise !== undefined ? { premise: patch.premise as never } : {}),
          ...(patch.creativeDirection !== undefined
            ? { creativeDirection: (patch.creativeDirection ?? null) as never }
            : {}),
          ...(patch.castResult !== undefined
            ? { castResult: (patch.castResult ?? null) as never }
            : {}),
          ...(patch.mysteryResult !== undefined
            ? { mysteryResult: (patch.mysteryResult ?? null) as never }
            : {}),
          ...(patch.worldResult !== undefined
            ? { worldResult: (patch.worldResult ?? null) as never }
            : {}),
          ...(patch.storyId !== undefined ? { storyId: patch.storyId } : {}),
          ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
          ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute()
    },
  }
}

const defaultRepo = createKyselyStorySetupJobRepo()

// ── Klasifikasi error → kode + pesan ramah pembaca ─────────────────

function classifyStageError(err: unknown): {
  code: StorySetupJobErrorCode
  message: string
} {
  if (err instanceof AuthoringBusyError) {
    return { code: 'busy', message: err.message }
  }
  if (err instanceof PublicAuthoringError) {
    return { code: 'unknown', message: err.message }
  }
  return { code: 'unknown', message: publicAuthoringErrorMessage(err) }
}

function stageErrorCode(stage: StorySetupJobStage): StorySetupJobErrorCode {
  switch (stage) {
    case 'cast':
      return 'cast_failed'
    case 'mystery':
      return 'mystery_failed'
    case 'world':
      return 'world_failed'
    case 'lock':
      return 'lock_failed'
  }
}

// ── Runner ──────────────────────────────────────────────────────────

export interface RunStorySetupJobOptions {
  repo?: StorySetupJobRepo
  authors?: StorySetupAuthors
}

/**
 * Eksekusi job setup sampai selesai/gagal. Aman dipanggil ulang (idempoten):
 * job yang sudah succeeded/failed diabaikan. Tiap tahap dipersist sebelum
 * lanjut, sehingga proses mati di tengah menyisakan progress yang bisa
 * dilanjutkan lewat job baru dengan seed tahap yang sudah sukses.
 */
export async function runStorySetupJob(
  jobId: string,
  options: RunStorySetupJobOptions = {},
): Promise<void> {
  const repo = options.repo ?? defaultRepo
  const authors = options.authors ?? defaultAuthors

  const job = await repo.getJob(jobId)
  if (!job) {
    console.log(`[setup-job] job hilang id=${jobId}`)
    return
  }
  if (job.status === 'succeeded' || job.status === 'failed') {
    return
  }

  const premiseParsed = PremiseSchema.safeParse(job.premise)
  if (!premiseParsed.success) {
    console.log(`[setup-job] premis tidak valid id=${jobId}`)
    await repo.updateJob(jobId, {
      status: 'failed',
      errorCode: 'unknown',
      errorMessage: 'Pilihan ceritamu tidak valid. Coba ulangi dari pertanyaan.',
      finishedAt: new Date(),
    })
    return
  }
  const premise: PremiseDraft = premiseParsed.data
  const direction =
    job.creativeDirection != null ? (job.creativeDirection as StoryCreativeDirection) : null
  const opts: AuthoringDirectionOpts | undefined = direction ? { direction } : undefined

  await repo.updateJob(jobId, {
    status: 'running',
    ...(job.status === 'queued' ? { startedAt: new Date() } : {}),
  })

  let cast: CastDraft
  let mystery: MysteryDraft
  let world: WorldDraft

  // Tahap 1: cast — lewati bila sudah ada hasil dari job sebelumnya (resume).
  if (job.castResult != null) {
    cast = job.castResult as CastDraft
    console.log(`[setup-job] resume cast id=${jobId}`)
  } else {
    const stage: StorySetupJobStage = 'cast'
    const t0 = Date.now()
    await repo.updateJob(jobId, { stage })
    try {
      const res = await authors.proposeCast(premise, undefined, undefined, opts)
      cast = res.cast
      console.log(`[setup-job] stage=cast ok id=${jobId} ms=${Date.now() - t0}`)
      await repo.updateJob(jobId, { castResult: cast })
    } catch (err) {
      await failStage(repo, jobId, stage, err, t0)
      return
    }
  }

  // Tahap 2: mystery.
  if (job.mysteryResult != null) {
    mystery = job.mysteryResult as MysteryDraft
    console.log(`[setup-job] resume mystery id=${jobId}`)
  } else {
    const stage: StorySetupJobStage = 'mystery'
    const t0 = Date.now()
    await repo.updateJob(jobId, { stage })
    try {
      const res = await authors.proposeMystery(premise, cast, undefined, undefined, opts)
      mystery = res.mystery
      console.log(`[setup-job] stage=mystery ok id=${jobId} ms=${Date.now() - t0}`)
      await repo.updateJob(jobId, { mysteryResult: mystery })
    } catch (err) {
      await failStage(repo, jobId, stage, err, t0)
      return
    }
  }

  // Tahap 3: world.
  if (job.worldResult != null) {
    world = job.worldResult as WorldDraft
    console.log(`[setup-job] resume world id=${jobId}`)
  } else {
    const stage: StorySetupJobStage = 'world'
    const t0 = Date.now()
    await repo.updateJob(jobId, { stage })
    try {
      const res = await authors.proposeWorld(premise, cast, mystery, undefined, undefined, opts)
      world = res.world
      console.log(`[setup-job] stage=world ok id=${jobId} ms=${Date.now() - t0}`)
      await repo.updateJob(jobId, { worldResult: world })
    } catch (err) {
      await failStage(repo, jobId, stage, err, t0)
      return
    }
  }

  // Tahap 4: lock (validator ladder + persist) — pekerjaan terberat di sini.
  const lockStage: StorySetupJobStage = 'lock'
  const lockT0 = Date.now()
  await repo.updateJob(jobId, { stage: lockStage })
  try {
    const result = await authors.lockStoryBibleForUser(
      {
        premise,
        cast,
        mystery,
        world,
        creativeDirection: direction ?? undefined,
      },
      job.userId,
    )
    if (!result.ok) {
      const needsAuthor = 'needsAuthor' in result && result.needsAuthor
      await repo.updateJob(jobId, {
        status: 'failed',
        errorCode: needsAuthor ? 'needs_author' : 'lock_failed',
        errorMessage:
          result.error ??
          'Gagal mengunci cerita. Coba lagi — tahap yang sudah jadi tidak diulang.',
        finishedAt: new Date(),
      })
      console.log(
        `[setup-job] stage=lock fail id=${jobId} ms=${Date.now() - lockT0} code=${needsAuthor ? 'needs_author' : 'lock_failed'}`,
      )
      return
    }
    await repo.updateJob(jobId, {
      status: 'succeeded',
      storyId: result.storyId,
      finishedAt: new Date(),
    })
    console.log(
      `[setup-job] succeeded id=${jobId} story=${result.storyId} lockMs=${Date.now() - lockT0}`,
    )
  } catch (err) {
    await failStage(repo, jobId, lockStage, err, lockT0)
  }
}

async function failStage(
  repo: StorySetupJobRepo,
  jobId: string,
  stage: StorySetupJobStage,
  err: unknown,
  startedAtMs: number,
): Promise<void> {
  const busy = err instanceof AuthoringBusyError
  const classified = classifyStageError(err)
  const code: StorySetupJobErrorCode = busy ? classified.code : stageErrorCode(stage)
  await repo.updateJob(jobId, {
    status: 'failed',
    errorCode: code,
    errorMessage: classified.message,
    finishedAt: new Date(),
  })
  console.log(
    `[setup-job] stage=${stage} fail id=${jobId} ms=${Date.now() - startedAtMs} code=${code}`,
  )
}

// ── Start job (dipanggil API route) ─────────────────────────────────

export interface StartStorySetupJobInput {
  userId: string
  premise: unknown
  creativeDirection?: unknown
  /** Job gagal sebelumnya — hasil tahap yang sudah sukses disemai ke job baru. */
  resumeJobId?: string
}

export interface StartStorySetupJobOptions extends RunStorySetupJobOptions {}

export type StartStorySetupJobResult =
  | { ok: true; jobId: string; stage: StorySetupJobStage }
  | { ok: false; error: string }

/** Ambil satu job untuk route GET — pemanggil wajib cek ownership sendiri. */
export async function getStorySetupJobById(
  id: string,
  options: RunStorySetupJobOptions = {},
): Promise<StorySetupJobRecord | null> {
  const repo = options.repo ?? defaultRepo
  return repo.getJob(id)
}

/**
 * Buat job setup baru untuk user. Satu user satu job aktif: job lama yang
 * masih queued/running dinonaktifkan (superseded). Bila `resumeJobId` merujuk
 * job milik user yang sama, hasil tahap yang sudah sukses disemai agar retry
 * tidak mengulang dari nol.
 */
export async function startStorySetupJob(
  input: StartStorySetupJobInput,
  options: StartStorySetupJobOptions = {},
): Promise<StartStorySetupJobResult> {
  const repo = options.repo ?? defaultRepo

  const premiseParsed = PremiseSchema.safeParse(input.premise)
  if (!premiseParsed.success) {
    return { ok: false, error: 'Pilihan ceritamu tidak valid. Coba ulangi dari pertanyaan.' }
  }

  // Seed hasil tahap dari job yang di-resume — hanya milik user yang sama.
  let seed: Pick<StorySetupJobRecord, 'premise' | 'creativeDirection' | 'castResult' | 'mysteryResult' | 'worldResult'> = {
    premise: input.premise,
    creativeDirection: input.creativeDirection ?? null,
    castResult: null,
    mysteryResult: null,
    worldResult: null,
  }
  if (input.resumeJobId) {
    const prev = await repo.getJob(input.resumeJobId)
    if (prev && prev.userId === input.userId) {
      seed = {
        premise: prev.premise,
        creativeDirection: prev.creativeDirection,
        castResult: prev.castResult,
        mysteryResult: prev.mysteryResult,
        worldResult: prev.worldResult,
      }
    }
  }

  const stage = initialStageFromSeed(seed)
  const jobId = randomUUID()

  await repo.insertJob({
    id: jobId,
    userId: input.userId,
    premise: seed.premise,
    creativeDirection: seed.creativeDirection,
    castResult: seed.castResult,
    mysteryResult: seed.mysteryResult,
    worldResult: seed.worldResult,
    stage,
  })
  const superseded = await repo.supersedeActiveJobs(input.userId, jobId)
  if (superseded > 0) {
    console.log(`[setup-job] superseded=${superseded} by=${jobId}`)
  }

  console.log(`[setup-job] queued id=${jobId} stage=${stage} resume=${input.resumeJobId ?? '-'}`)

  return { ok: true, jobId, stage }
}

function initialStageFromSeed(seed: {
  castResult: unknown
  mysteryResult: unknown
  worldResult: unknown
}): StorySetupJobStage {
  if (seed.castResult == null) return 'cast'
  if (seed.mysteryResult == null) return 'mystery'
  if (seed.worldResult == null) return 'world'
  return 'lock'
}
