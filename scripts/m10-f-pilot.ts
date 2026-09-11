/**
 * M10-F engineering pilot — satu run 1→50 REAL provider di DB lokal terisolasi.
 *
 * Jalur yang dipiloti = jalur produksi pembaca (personalized_ai), persis
 * metodologi pasangan terhitung E1/E2: seedHarnessStory →
 * generateNextPersonalizedChapter (1..50) → submitHarnessChoice (1..49).
 * Provider nyata aktif via NARRATIVE_PROVIDER=gateway.
 *
 * Isolasi: assertIsolatedTarget() menolak non-loopback sebelum tulis apa pun;
 * tambahan guard LAKOKU_LOCAL_DB_TEST=1 di driver ini. Tidak menyentuh
 * hosted/linked/production.
 *
 * Jalankan:
 *   set -a && source /tmp/m10f-pilot.env && set +a
 *   node scripts/run-smoke.cjs scripts/m10-f-pilot.ts --chapters=50
 */
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { generateNextPersonalizedChapter } from '@lakoku/runtime'
import { scanForLeaks } from '@lakoku/ai-gateway'
import {
  assertIsolatedTarget,
  cleanupHarnessStory,
  ensureHarnessUser,
  HARNESS_USER_ID,
  seedHarnessStory,
} from '../lib/narrative-qa/harness/seed'
import { harnessProposalFor } from '../lib/narrative-qa/harness/fixture'
import { submitHarnessChoice } from '../lib/narrative-qa/harness/choice'
import { captureChapter } from '../lib/narrative-qa/harness/capture'
import {
  computeM10FLiveCaptureHash,
  evidenceCaptureChapterNumbers,
  type M10FLiveChapterCaptureRecord,
} from '../lib/narrative-qa/harness/m10-f-evidence-summary'
import { computeM10FChapterContentHash } from '../lib/narrative-qa/judges/m10-f-semantic-assembly'
import {
  classifyPilotChapterFailure,
  computePilotInvocationSummary,
  describePilotCaptureArtifacts,
  LiveChapterCaptureError,
  PilotGenerationFailure,
  PublishedChapterPostPublishError,
  requireExplicitPilotStoryId,
} from './m10-f-pilot-support'

let STORY: string
try {
  STORY = requireExplicitPilotStoryId(process.env.M10F_PILOT_STORY_ID)
} catch (error) {
  console.error(`[pilot] REFUSED: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
const MAX_ATTEMPTS_PER_CHAPTER = 3

function parseIntegerArg(name: string, fallback: number): number {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (!arg) return fallback
  const n = Number(arg.split('=')[1])
  if (!Number.isInteger(n) || n < 1 || n > 50) {
    console.error(`[pilot] --${name} harus integer 1..50`)
    process.exit(1)
  }
  return n
}

// --- Guard isolasi driver (di luar gate harness sendiri) ---
if (process.env.LAKOKU_LOCAL_DB_TEST !== '1') {
  console.error("[pilot] REFUSED: LAKOKU_LOCAL_DB_TEST=1 wajib diset (opt-in lokal).")
  process.exit(1)
}
if (process.env.NARRATIVE_PROVIDER === 'gateway') {
  console.log('[pilot] MODE: REAL provider (NARRATIVE_PROVIDER=gateway)')
} else {
  console.log('[pilot] MODE: DRY-RUN deterministic mock (NARRATIVE_PROVIDER tidak diset)')
}

function admin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY tak tersedia.')
  return createClient(url, key, { auth: { persistSession: false } })
}

async function main() {
  const totalChapters = parseIntegerArg('chapters', 50)
  const startChapter = parseIntegerArg('start', 1)
  if (startChapter > totalChapters) {
    console.error('[pilot] --start tidak boleh melebihi --chapters')
    process.exit(1)
  }
  const supabaseUrl = assertIsolatedTarget()
  console.log(
    `[pilot] target ${supabaseUrl.replace(/\/\/[^:]+:\d+/, '//127.0.0.1:<port>')}`,
  )
  const db = admin()
  await ensureHarnessUser(db)

  const runId = `m10-f-pilot-${crypto.randomUUID()}`
  const correlationId = crypto.randomUUID()
  const outDir = path.join('.zcode', 'artifacts', 'm10-f-pilot', `${process.env.NARRATIVE_PROVIDER === 'gateway' ? 'real' : 'dry'}-${runId}`)
  fs.mkdirSync(outDir, { recursive: true })
  const metricsPath = path.join(outDir, 'metrics.jsonl')
  const defectsPath = path.join(outDir, 'defects.jsonl')
  const capturesPath = path.join(outDir, 'chapter-captures.jsonl')
  const summaryPath = path.join(outDir, 'summary.json')

  const append = (file: string, obj: unknown) =>
    fs.appendFileSync(file, JSON.stringify(obj) + '\n')

  const liveCaptureChapters = new Set(
    evidenceCaptureChapterNumbers('LIVE_CHAPTER_LOCAL', totalChapters),
  )
  let triggerChoiceId: string | null = null
  let alreadyPublished = 0
  if (startChapter === 1) {
    // Seed bersih: hapus artefak lama lalu bootstrap story harness penuh
    // (contract, blueprints, characters, threads, reveals, reader_state).
    await cleanupHarnessStory(db, STORY)
    await seedHarnessStory({ admin: db, storyId: STORY })
    console.log(`[pilot] story ${STORY} di-seed.`)
  } else {
    const [{ count }, { data: reader }] = await Promise.all([
      db.from('chapters').select('*', { count: 'exact', head: true }).eq('story_id', STORY),
      db.from('reader_states').select('current_chapter,choice_history').eq('story_id', STORY).maybeSingle(),
    ])
    alreadyPublished = count ?? 0
    const history = Array.isArray(reader?.choice_history)
      ? (reader.choice_history as Array<{ chapterNumber?: unknown; choiceId?: unknown }>)
      : []
    const previous = history.find((entry) => entry.chapterNumber === startChapter - 1)
    if (
      alreadyPublished !== startChapter - 1 ||
      reader?.current_chapter !== startChapter ||
      typeof previous?.choiceId !== 'string'
    ) {
      console.error('[pilot] REFUSED: resume state tidak cocok dengan --start (fail-closed).')
      process.exit(1)
    }
    triggerChoiceId = previous.choiceId
    console.log(`[pilot] resume Bab ${startChapter}; ${alreadyPublished} bab sudah terbit.`)
  }

  const startedAt = Date.now()
  let publishedThisInvocation = 0
  let failedAttemptsThisInvocation = 0
  let liveCaptureCount = 0
  let totalWords = 0
  let leaksTotal = 0
  let terminalFailure: string | null = null

  pilotChapters: for (let n = startChapter; n <= totalChapters; n++) {
    let chapterCompleted = false
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_CHAPTER && !chapterCompleted; attempt += 1) {
      const t0 = Date.now()
      try {
        const attemptId = crypto.randomUUID()
        const result = await generateNextPersonalizedChapter({
          storyId: STORY,
          userId: HARNESS_USER_ID,
          chapterNumber: n,
          correlationId,
          attemptId,
          triggerChoiceId,
          stateProposal: harnessProposalFor(STORY, n),
        })
        if (!result.ok) throw new PilotGenerationFailure(result.reason, result.detail)

        // Publish sudah durable. Semua kegagalan berikut wajib abort; retry generator
        // dapat menyentuh ulang bab yang sudah terbit.
        try {
          const { data: ch, error: chapterReadError } = await db
            .from('chapters')
            .select('title, paragraphs, choices, choice_prompt')
            .eq('story_id', STORY)
            .eq('number', n)
            .maybeSingle()
          if (chapterReadError) throw chapterReadError
          if (!ch) throw new Error('PUBLISHED_CHAPTER_NOT_FOUND')
          const paragraphs = (ch.paragraphs as string[] | null) ?? []
          const words = paragraphs.join(' ').split(/\s+/).filter(Boolean).length
          const choices = Array.isArray(ch.choices) ? (ch.choices as unknown[]).length : 0
          const leaks = [ch.title ?? '', ...paragraphs, ch.choice_prompt ?? ''].flatMap((s) =>
            scanForLeaks(String(s)),
          )

          let acceptedChoiceId: string | null = null
          if (n < 50) {
            const submitted = await submitHarnessChoice({
              admin: db,
              userId: HARNESS_USER_ID,
              storyId: STORY,
              chapterNumber: n,
            })
            acceptedChoiceId = submitted.choiceId
            triggerChoiceId = submitted.choiceId
            append(metricsPath, {
              ts: new Date().toISOString(),
              chapter: n,
              ok: true,
              event: 'CHOICE_SUBMITTED',
              choiceId: submitted.choiceId,
            })
          }

          if (liveCaptureChapters.has(n)) {
            try {
              const captured = await captureChapter({
                admin: db,
                storyId: STORY,
                userId: HARNESS_USER_ID,
                chapterNumber: n,
                acceptedChoiceId,
              })
              const record: M10FLiveChapterCaptureRecord = {
                captureMode: 'LIVE_CHAPTER_LOCAL',
                storyId: STORY,
                runId,
                correlationId,
                contentHash: computeM10FChapterContentHash(String(ch.title), paragraphs),
                capture: { ...captured.capture, captureHash: '' },
                findings: captured.findings,
              }
              record.capture.captureHash = computeM10FLiveCaptureHash(record)
              append(capturesPath, record)
              liveCaptureCount += 1
            } catch (captureError) {
              throw new LiveChapterCaptureError(n, captureError)
            }
          }

          const durationMs = Date.now() - t0
          totalWords += words
          leaksTotal += leaks.length
          publishedThisInvocation += 1
          chapterCompleted = true
          append(metricsPath, {
            ts: new Date().toISOString(),
            chapter: n,
            attempt,
            ok: true,
            durationMs,
            words,
            choices,
            leakCount: leaks.length,
            leakSamples: leaks.slice(0, 5),
          })
          if (leaks.length > 0) {
            append(defectsPath, {
              ts: new Date().toISOString(),
              chapter: n,
              kind: 'BRAND_LEAK',
              findings: leaks,
            })
          }
          console.log(
            `[pilot] Bab ${n} OK ${durationMs}ms | ${words} kata | ${choices} pilihan${leaks.length ? ' | LEAK!' : ''}`,
          )
        } catch (postPublishError) {
          if (postPublishError instanceof LiveChapterCaptureError) throw postPublishError
          throw new PublishedChapterPostPublishError(n, postPublishError)
        }
      } catch (err) {
        const failure = classifyPilotChapterFailure(err)
        if (
          failure.disposition === 'ABORT_EVIDENCE_CAPTURE'
          || failure.disposition === 'ABORT_PUBLISHED_CHAPTER'
        ) throw failure.error
        failedAttemptsThisInvocation += 1
        const durationMs = Date.now() - t0
        const message = err instanceof Error ? err.message : String(err)
        append(defectsPath, {
          ts: new Date().toISOString(),
          chapter: n,
          attempt,
          kind: 'CHAPTER_FAILED',
          disposition: failure.disposition,
          message: message.slice(0, 4000),
          durationMs,
        })
        append(metricsPath, {
          ts: new Date().toISOString(),
          chapter: n,
          attempt,
          ok: false,
          durationMs,
          disposition: failure.disposition,
        })
        console.log(`[pilot] Bab ${n} GAGAL attempt ${attempt} setelah ${durationMs}ms: ${message.slice(0, 300)}`)
        if (failure.disposition !== 'RETRYABLE_CHAPTER_FAILURE') {
          terminalFailure = `${failure.disposition}:Bab ${n}:${message.slice(0, 300)}`
          break pilotChapters
        }
        if (attempt === MAX_ATTEMPTS_PER_CHAPTER) {
          terminalFailure = `PILOT_CHAPTER_RETRY_EXHAUSTED:Bab ${n}`
          break pilotChapters
        }
      }
    }
  }

  const published = alreadyPublished + publishedThisInvocation

  // --- Audit akhir run ---
  const { count: chapterCount } = await db
    .from('chapters')
    .select('*', { count: 'exact', head: true })
    .eq('story_id', STORY)
  const { count: outcomeCount } = await db
    .from('choice_outcomes')
    .select('*', { count: 'exact', head: true })
    .eq('story_id', STORY)
  const { count: retrievalCount } = await db
    .from('retrieval_logs')
    .select('*', { count: 'exact', head: true })
    .eq('story_id', STORY)
  const { data: events } = await db
    .from('story_events')
    .select('seq, type')
    .eq('story_id', STORY)
    .order('seq', { ascending: true })
  const seqs = (events ?? []).map((e) => e.seq as number)
  const monotonic = seqs.every((s, i) => i === 0 || s > seqs[i - 1])
  const publishEvents = (events ?? []).filter((e) => String(e.type).includes('PUBLISH')).length
  const { data: leases } = await db
    .from('generation_leases')
    .select('status')
    .eq('story_id', STORY)
  const activeLeases = (leases ?? []).filter((l) => l.status === 'ACTIVE').length

  const wallMs = Date.now() - startedAt
  const invocationSummary = computePilotInvocationSummary({
    startChapter,
    totalChapters,
    preexistingPublished: alreadyPublished,
    publishedThisInvocation,
    failedAttemptsThisInvocation,
    totalWordsThisInvocation: totalWords,
    finalPublishedTotal: published,
  })
  const summary = {
    runId,
    correlationId,
    mode: process.env.NARRATIVE_PROVIDER === 'gateway' ? 'REAL' : 'DRY_RUN',
    storyId: STORY,
    requestedChapters: totalChapters,
    published,
    failed: totalChapters - published,
    terminalFailure,
    ...invocationSummary,
    wallClockMs: wallMs,
    totalWords,
    leaksTotal,
    liveCaptureCount,
    audit: {
      chaptersInDb: chapterCount ?? 0,
      choiceOutcomes: outcomeCount ?? 0,
      retrievalLogs: retrievalCount ?? 0,
      eventsMonotonic: monotonic,
      publishEventCount: publishEvents,
      activeLeases,
    },
    artifacts: {
      metrics: metricsPath,
      defects: defectsPath,
      ...describePilotCaptureArtifacts({
        path: capturesPath,
        startChapter,
        totalChapters,
        captureCount: liveCaptureCount,
      }),
    },
  }
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n')

  console.log('\n[pilot] AUDIT:', JSON.stringify(summary.audit))
  console.log(
    `[pilot] SELESAI — ${published}/${totalChapters} terbit | ${wallMs}ms | ${totalWords} kata | leak=${leaksTotal}`,
  )
  console.log(`[pilot] summary → ${summaryPath}`)

  const auditFailures: string[] = []
  if ((chapterCount ?? 0) !== published) auditFailures.push('chapterCount != published')
  if ((outcomeCount ?? 0) < Math.max(0, published - 1) * 2)
    auditFailures.push('choice_outcomes < 2x bab non-terminal')
  if ((retrievalCount ?? 0) < published - 1) auditFailures.push('retrieval_logs < bab non-pertama')
  if (!monotonic) auditFailures.push('story_events seq tak monotonik')
  if (publishEvents < published) auditFailures.push('event PUBLISH < jumlah bab')
  if (activeLeases !== 0) auditFailures.push('lease ACTIVE tersisa')
  if (leaksTotal > 0) auditFailures.push(`brand guard bocor (${leaksTotal})`)
  if (startChapter === 1 && liveCaptureCount !== published) {
    auditFailures.push('live chapter-local captures != published')
  }

  if (terminalFailure) auditFailures.push(terminalFailure)
  if (auditFailures.length > 0 || published < totalChapters) {
    console.error(`[pilot] FAIL: ${auditFailures.join('; ')}`)
    process.exit(1)
  }
  if (invocationSummary.diagnosticOnly) {
    console.log('[pilot] DIAGNOSTIC_ONLY — resumed run bukan fresh pilot pass proof')
    return
  }
  console.log('[pilot] PASS')
}

main().catch((e) => {
  console.error('[pilot] error fatal:', e instanceof Error ? e.message : e)
  process.exit(1)
})
