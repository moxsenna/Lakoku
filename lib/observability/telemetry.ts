/**
 * Telemetri konsistensi (M8/T8.1) — sisi SERVER.
 *
 * Dua tanggung jawab:
 *  1) EMIT `GENERATION_ATTEMPT` ke `story_events` (append best-effort) tiap kali
 *     satu putaran generasi bab selesai — sumber continuity/repair/review rate.
 *  2) MUAT input ternormalisasi (attempts + threads + reports + published) untuk
 *     diberi ke engine murni `aggregateConsistencyMetrics`.
 *
 * `story_events` adalah event log observability yang, per aturan admin client,
 * boleh disentuh langsung lewat service-role. Emisi bersifat NON-KRITIS: dibungkus
 * try/catch agar TAK PERNAH menggagalkan jalur generasi/publish.
 */
import 'server-only'
import { createAdminClient } from '@lakoku/db'
import type { Finding } from '@lakoku/narrative-core'
import {
  aggregateConsistencyMetrics,
  type ConsistencyInputs,
  type ConsistencyMetrics,
  type GenerationAttemptTelemetry,
  type GenerationOutcome,
  type ThreadStalenessInput,
  type ReaderReportInput,
  type PublishedChapterInput,
} from './metrics'

export const GENERATION_ATTEMPT_EVENT = 'GENERATION_ATTEMPT' as const

type Db = ReturnType<typeof createAdminClient>

function chapterOf(payload: unknown): number | null {
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>
    const raw = p.chapter_number ?? p.chapter
    if (typeof raw === 'number') return raw
    if (typeof raw === 'string' && raw.trim() !== '' && !Number.isNaN(Number(raw))) return Number(raw)
  }
  return null
}

function countBySeverity(findings: Finding[]): {
  criticalRemaining: number
  majorRemaining: number
  minorRemaining: number
} {
  let criticalRemaining = 0
  let majorRemaining = 0
  let minorRemaining = 0
  for (const f of findings) {
    if (f.severity === 'CRITICAL') criticalRemaining += 1
    else if (f.severity === 'MAJOR') majorRemaining += 1
    else minorRemaining += 1
  }
  return { criticalRemaining, majorRemaining, minorRemaining }
}

/**
 * Append satu event story ber-seq monoton per story. Best-effort: dipanggil di
 * boundary SETELAH publish/lease-release sehingga tak ada penulis lain yang
 * berlomba (lease menjamin satu generasi aktif per story).
 */
async function appendStoryEvent(
  db: Db,
  storyId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { data, error: eRead } = await db
    .from('story_events')
    .select('seq')
    .eq('story_id', storyId)
    .order('seq', { ascending: false })
    .limit(1)
  if (eRead) throw new Error(eRead.message)
  const nextSeq = ((data?.[0]?.seq as number | undefined) ?? 0) + 1
  const { error } = await db.from('story_events').insert({
    story_id: storyId,
    seq: nextSeq,
    type,
    payload,
  })
  if (error) throw new Error(error.message)
}

/**
 * Catat hasil satu putaran generasi bab. NON-KRITIS & idempotensi-longgar:
 * kegagalan emisi hanya di-log, tak pernah dilempar ke pemanggil.
 */
export async function recordGenerationAttempt(input: {
  storyId: string
  chapter: number
  outcome: GenerationOutcome
  repairAttempts: number
  findings: Finding[]
}): Promise<void> {
  try {
    const db = createAdminClient()
    const sev = countBySeverity(input.findings)
    await appendStoryEvent(db, input.storyId, GENERATION_ATTEMPT_EVENT, {
      chapter_number: input.chapter,
      outcome: input.outcome,
      repair_attempts: input.repairAttempts,
      critical_remaining: sev.criticalRemaining,
      major_remaining: sev.majorRemaining,
      minor_remaining: sev.minorRemaining,
      // Bounded codes only (severity:code). No finding message/prose.
      finding_codes: input.findings.slice(0, 12).map((f) => `${f.severity}:${f.code}`),
    })
  } catch (err) {
    console.log('[v0] recordGenerationAttempt gagal (non-kritis):', (err as Error)?.message)
  }
}

interface StoryEventRow {
  story_id: string
  type: string
  payload: Record<string, unknown> | null
  created_at: string
}

interface ThreadRow {
  story_id: string
  id: string
  title: string
  status: string
  stale: boolean | null
  stale_since_chapter: number | null
  is_main_mystery: boolean | null
}

/**
 * Muat input ternormalisasi untuk dashboard. Bila `storyId` diberikan, hanya
 * story tersebut; jika tidak, seluruh story (tampilan ops global).
 */
export async function loadConsistencyInputs(storyId?: string): Promise<ConsistencyInputs> {
  const db = createAdminClient()

  let eventsQuery = db
    .from('story_events')
    .select('story_id, type, payload, created_at')
    .in('type', [GENERATION_ATTEMPT_EVENT, 'REPORT_FILED', 'CHAPTER_PUBLISHED'])
  if (storyId) eventsQuery = eventsQuery.eq('story_id', storyId)

  let threadsQuery = db
    .from('story_threads')
    .select('story_id, id, title, status, stale, stale_since_chapter, is_main_mystery')
  if (storyId) threadsQuery = threadsQuery.eq('story_id', storyId)

  const [{ data: eventRows, error: eEvents }, { data: threadRows, error: eThreads }] =
    await Promise.all([eventsQuery, threadsQuery])
  if (eEvents) throw new Error(`loadConsistencyInputs events: ${eEvents.message}`)
  if (eThreads) throw new Error(`loadConsistencyInputs threads: ${eThreads.message}`)

  const attempts: GenerationAttemptTelemetry[] = []
  const reports: ReaderReportInput[] = []
  const published: PublishedChapterInput[] = []

  for (const row of (eventRows ?? []) as StoryEventRow[]) {
    const chapter = chapterOf(row.payload)
    if (row.type === GENERATION_ATTEMPT_EVENT) {
      if (chapter == null) continue
      const p = row.payload ?? {}
      attempts.push({
        storyId: row.story_id,
        chapter,
        outcome: (p.outcome === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : 'PUBLISHED') as GenerationOutcome,
        repairAttempts: Number(p.repair_attempts ?? 0),
        criticalRemaining: Number(p.critical_remaining ?? 0),
        majorRemaining: Number(p.major_remaining ?? 0),
        minorRemaining: Number(p.minor_remaining ?? 0),
        at: row.created_at,
      })
    } else if (row.type === 'REPORT_FILED') {
      if (chapter == null) continue
      reports.push({ storyId: row.story_id, chapter, at: row.created_at })
    } else if (row.type === 'CHAPTER_PUBLISHED') {
      if (chapter == null) continue
      published.push({ storyId: row.story_id, chapter })
    }
  }

  const threads: ThreadStalenessInput[] = ((threadRows ?? []) as ThreadRow[]).map((t) => ({
    storyId: t.story_id,
    threadId: t.id,
    title: t.title,
    status: t.status,
    stale: Boolean(t.stale),
    staleSinceChapter: t.stale_since_chapter,
    isMainMystery: Boolean(t.is_main_mystery),
  }))

  return { attempts, threads, reports, published }
}

/** Muat + agregasi metrik dalam satu panggilan (dipakai dashboard & API). */
export async function loadConsistencyMetrics(storyId?: string): Promise<ConsistencyMetrics> {
  const inputs = await loadConsistencyInputs(storyId)
  return aggregateConsistencyMetrics(inputs)
}
