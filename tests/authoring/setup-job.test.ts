import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CastDraft, MysteryDraft, PremiseDraft, WorldDraft } from '@/lib/authoring/schema'
import {
  startStorySetupJob,
  runStorySetupJob,
  type StorySetupJobRecord,
  type StorySetupJobRepo,
} from '@/lib/authoring/setup-job.server'
import type { AuthoringLockResult } from '@/lib/api/authoring-lock.server'

vi.mock('server-only', () => ({}))
// lockStoryBibleForUser selalu diinjeksi via authors — mock modul aslinya agar
// rantai import-nya (lib/auth → getAuthPool) tidak menyentuh DB saat load.
vi.mock('@/lib/api/authoring-lock.server', () => ({
  lockStoryBibleForUser: vi.fn(),
}))

const PREMISE: PremiseDraft = {
  title: 'Rahasia Kamar 304',
  tagline: 'Kamar itu menyimpan nama yang tidak boleh dipanggil.',
  role: 'Rani, penyewa baru yang penasaran',
  synopsis:
    'Rani pindah ke kos tua yang selalu sepi di lantai tiga. Kamar 304 tak pernah disewa dan tak pernah dikosongkan. Malam pertama, ia menemukan catatan dengan namanya sendiri. Semakin dalam ia menggali, semakin dekat rahasia itu ke keluarganya.',
  tropes: ['Misteri', 'Thriller'],
}

const CAST = { protagonist: { name: 'Sinta' } } as unknown as CastDraft
const MYSTERY = { mainMystery: 'rahasia uji' } as unknown as MysteryDraft
const WORLD = { setting: 'kota uji' } as unknown as WorldDraft

/** Repo in-memory — permukaan minimal yang dipakai runner/start. */
function makeMemoryRepo() {
  const jobs = new Map<string, StorySetupJobRecord>()
  const repo: StorySetupJobRepo & { jobs: Map<string, StorySetupJobRecord> } = {
    jobs,
    async supersedeActiveJobs(userId, exceptJobId) {
      let n = 0
      for (const [id, job] of jobs) {
        if (job.userId === userId && id !== exceptJobId && ['queued', 'running'].includes(job.status)) {
          job.status = 'failed'
          job.errorCode = 'superseded'
          n += 1
        }
      }
      return n
    },
    async insertJob(input) {
      jobs.set(input.id, {
        id: input.id,
        userId: input.userId,
        status: 'queued',
        stage: input.stage,
        errorCode: null,
        errorMessage: null,
        premise: input.premise,
        creativeDirection: input.creativeDirection,
        castResult: input.castResult,
        mysteryResult: input.mysteryResult,
        worldResult: input.worldResult,
        storyId: null,
      })
    },
    async getJob(id) {
      return jobs.get(id) ?? null
    },
    async updateJob(id, patch) {
      const job = jobs.get(id)
      if (!job) return
      if (patch.status !== undefined) job.status = patch.status
      if (patch.stage !== undefined) job.stage = patch.stage
      if (patch.errorCode !== undefined) job.errorCode = patch.errorCode
      if (patch.errorMessage !== undefined) job.errorMessage = patch.errorMessage
      if (patch.castResult !== undefined) job.castResult = patch.castResult
      if (patch.mysteryResult !== undefined) job.mysteryResult = patch.mysteryResult
      if (patch.worldResult !== undefined) job.worldResult = patch.worldResult
      if (patch.storyId !== undefined) job.storyId = patch.storyId
    },
  }
  return repo
}

function makeAuthors(overrides?: Partial<Parameters<typeof makeDefaultAuthors>[0]>) {
  return makeDefaultAuthors(overrides)
}

function makeDefaultAuthors(overrides?: {
  castError?: unknown
  mysteryError?: unknown
  worldError?: unknown
  lockResult?: AuthoringLockResult
  lockError?: unknown
}) {
  return {
    proposeCast: overrides?.castError
      ? vi.fn().mockRejectedValue(overrides.castError)
      : vi.fn().mockResolvedValue({ cast: CAST, usedModel: 'fake' }),
    proposeMystery: overrides?.mysteryError
      ? vi.fn().mockRejectedValue(overrides.mysteryError)
      : vi.fn().mockResolvedValue({ mystery: MYSTERY, usedModel: 'fake' }),
    proposeWorld: overrides?.worldError
      ? vi.fn().mockRejectedValue(overrides.worldError)
      : vi.fn().mockResolvedValue({ world: WORLD, usedModel: 'fake' }),
    lockStoryBibleForUser: overrides?.lockError
      ? vi.fn().mockRejectedValue(overrides.lockError)
      : vi.fn().mockResolvedValue(
          overrides?.lockResult ?? { ok: true, storyId: 'story-uji-1', resolvedBy: 'ladder', transforms: [] },
        ),
  }
}

const USER_ID = '11111111-1111-4111-8111-111111111111'

async function startQueuedJob(repo: ReturnType<typeof makeMemoryRepo>) {
  const res = await startStorySetupJob(
    { userId: USER_ID, premise: PREMISE },
    { repo, authors: makeAuthors() },
  )
  if (!res.ok) throw new Error(res.error)
  return res
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('startStorySetupJob', () => {
  it('menolak premis tidak valid', async () => {
    const repo = makeMemoryRepo()
    const res = await startStorySetupJob(
      { userId: USER_ID, premise: { haphazard: true } },
      { repo, authors: makeAuthors() },
    )
    expect(res.ok).toBe(false)
  })

  it('membuat job queued di tahap cast tanpa menjalankan apa pun', async () => {
    const repo = makeMemoryRepo()
    const res = await startQueuedJob(repo)
    expect(res.ok).toBe(true)
    const job = repo.jobs.get(res.jobId)!
    expect(job.status).toBe('queued')
    expect(job.stage).toBe('cast')
  })

  it('menyemai hasil tahap dari job yang di-resume (milik user sama)', async () => {
    const repo = makeMemoryRepo()
    const first = await startQueuedJob(repo)
    const prev = repo.jobs.get(first.jobId)!
    prev.status = 'failed'
    prev.errorCode = 'world_failed'
    prev.castResult = CAST
    prev.mysteryResult = MYSTERY

    const res = await startStorySetupJob(
      { userId: USER_ID, premise: PREMISE, resumeJobId: first.jobId },
      { repo, authors: makeAuthors() },
    )
    expect(res.ok).toBe(true)
    const job = repo.jobs.get((res as { jobId: string }).jobId)!
    expect(job.stage).toBe('world')
    expect(job.castResult).toEqual(CAST)
    expect(job.mysteryResult).toEqual(MYSTERY)
  })

  it('mengabaikan resume milik user lain', async () => {
    const repo = makeMemoryRepo()
    const first = await startQueuedJob(repo)
    const prev = repo.jobs.get(first.jobId)!
    prev.userId = '22222222-2222-4222-8222-222222222222'
    prev.castResult = CAST

    const res = await startStorySetupJob(
      { userId: USER_ID, premise: PREMISE, resumeJobId: first.jobId },
      { repo, authors: makeAuthors() },
    )
    expect(res.ok).toBe(true)
    const job = repo.jobs.get((res as { jobId: string }).jobId)!
    expect(job.castResult).toBeNull()
    expect(job.stage).toBe('cast')
  })
})

describe('runStorySetupJob', () => {
  it('mengeksekusi semua tahap sampai succeeded dan persist hasil per tahap', async () => {
    const repo = makeMemoryRepo()
    const authors = makeAuthors()
    const { jobId } = await startQueuedJob(repo)

    await runStorySetupJob(jobId, { repo, authors })

    const job = repo.jobs.get(jobId)!
    expect(job.status).toBe('succeeded')
    expect(job.storyId).toBe('story-uji-1')
    expect(job.castResult).toEqual(CAST)
    expect(job.mysteryResult).toEqual(MYSTERY)
    expect(job.worldResult).toEqual(WORLD)
    expect(authors.lockStoryBibleForUser).toHaveBeenCalledWith(
      expect.objectContaining({ premise: PREMISE, cast: CAST, mystery: MYSTERY, world: WORLD }),
      USER_ID,
    )
  })

  it('menandai failed dengan kode tahap saat propose gagal', async () => {
    const repo = makeMemoryRepo()
    const authors = makeAuthors({ mysteryError: new Error('provider mati') })
    const { jobId } = await startQueuedJob(repo)

    await runStorySetupJob(jobId, { repo, authors })

    const job = repo.jobs.get(jobId)!
    expect(job.status).toBe('failed')
    expect(job.errorCode).toBe('mystery_failed')
    // Pesan untuk pembaca — bukan pesan teknis mentah.
    expect(job.errorMessage).not.toContain('provider mati')
    expect(job.errorMessage).toContain('Terjadi kesalahan tak terduga')
  })

  it('kode busy dipertahankan (bukan dikonversi ke kode tahap)', async () => {
    const repo = makeMemoryRepo()
    const { AuthoringBusyError } = await import('@/lib/authoring/model')
    const authors = makeAuthors({ castError: new AuthoringBusyError() })
    const { jobId } = await startQueuedJob(repo)

    await runStorySetupJob(jobId, { repo, authors })

    const job = repo.jobs.get(jobId)!
    expect(job.status).toBe('failed')
    expect(job.errorCode).toBe('busy')
    expect(job.errorMessage).toContain('Layanan cerita sedang sibuk')
  })

  it('lanjut dari tahap yang sudah tersimpan (resume tanpa panggil ulang)', async () => {
    const repo = makeMemoryRepo()
    const authors = makeAuthors()
    const { jobId } = await startQueuedJob(repo)
    const seeded = repo.jobs.get(jobId)!
    seeded.castResult = CAST
    seeded.mysteryResult = MYSTERY

    await runStorySetupJob(jobId, { repo, authors })

    expect(authors.proposeCast).not.toHaveBeenCalled()
    expect(authors.proposeMystery).not.toHaveBeenCalled()
    expect(authors.proposeWorld).toHaveBeenCalledTimes(1)
    const job = repo.jobs.get(jobId)!
    expect(job.status).toBe('succeeded')
  })

  it('idempoten: job succeeded tidak diproses ulang', async () => {
    const repo = makeMemoryRepo()
    const authors = makeAuthors()
    const { jobId } = await startQueuedJob(repo)
    await runStorySetupJob(jobId, { repo, authors })
    await runStorySetupJob(jobId, { repo, authors })
    expect(authors.proposeCast).toHaveBeenCalledTimes(1)
  })

  it('needs_author dari lock dipetakan ke kode needs_author', async () => {
    const repo = makeMemoryRepo()
    const authors = makeAuthors({
      lockResult: { ok: false, needsAuthor: true, findings: [], transforms: [] },
    })
    const { jobId } = await startQueuedJob(repo)

    await runStorySetupJob(jobId, { repo, authors })

    const job = repo.jobs.get(jobId)!
    expect(job.status).toBe('failed')
    expect(job.errorCode).toBe('needs_author')
  })

  it('supersede job aktif sebelumnya saat job baru dibuat', async () => {
    const repo = makeMemoryRepo()
    const first = await startQueuedJob(repo)
    const second = await startQueuedJob(repo)
    const prev = repo.jobs.get(first.jobId)!
    expect(prev.status).toBe('failed')
    expect(prev.errorCode).toBe('superseded')
    expect(repo.jobs.get(second.jobId)!.status).toBe('queued')
  })
})
