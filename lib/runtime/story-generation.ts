import 'server-only'
import {
  acquireGenerationLease,
  publishChapter,
  releaseGenerationLease,
  type PublishOutcome,
  type PublishResult,
} from './lifecycle'
import {
  compileContext,
  buildBlueprints,
  TOTAL_CHAPTERS,
  type CanonSnapshot,
  type ChapterBlueprint,
} from '@lakoku/narrative-core'
import { loadCanonSnapshot, persistRetrievalLog } from '@lakoku/narrative-core/server'
import {
  generateChapter,
  toReaderSafe,
  assertConsumerSafe,
  scanForLeaks,
  type ThreadContext,
  type ChapterDraftParsed,
} from '@lakoku/ai-gateway'
import { selectProvider } from '@lakoku/ai-gateway/server'

/**
 * Workflow generasi bab NYATA (M2→M5 disatukan) — "jalur cerita AI end-to-end".
 *
 * Rantai:
 *   lease → loadCanonSnapshot → compileContext (+retrieval_logs)
 *         → generateChapter (plan→write→Layer A→Layer B→repair)
 *         → consumer-safe guard → map draft→publish → publish_chapter (atomik).
 *
 * Sifat:
 *  - Canon READ-ONLY selama generasi (invarian dijaga di generate.ts).
 *  - Idempoten & atomik (lewat RPC yang sama dengan fake workflow M2).
 *  - Provider-agnostik: mengganti otak penulis cukup di selectProvider().
 */

/** Idempotency key stabil per (story, chapter, scope) untuk jalur nyata. */
export function realGenerationKey(storyId: string, n: number, scope: string) {
  return `gen:real:${scope}:${storyId}:${n}`
}

export type RealGenerateResult =
  | { ok: true; chapterNumber: number; seq: number; repairAttempts: number }
  | {
      ok: false
      reason:
        | 'LEASE_HELD'
        | 'CHAPTER_EXISTS'
        | 'CANON_MISSING'
        | 'FAILED_REVIEW_REQUIRED'
      detail?: unknown
    }

/** Ambil blueprint versi tertinggi untuk bab; fallback turunkan dari template. */
function resolveBlueprint(
  snapshot: CanonSnapshot,
  chapterNumber: number,
): ChapterBlueprint | null {
  const fromCanon = snapshot.blueprints
    .filter((b) => b.chapterNumber === chapterNumber)
    .sort((a, b) => b.version - a.version)[0]
  if (fromCanon) return fromCanon

  // Fallback: turunkan blueprint template dari spine cerita (secrets + intro).
  const plannedIntroductions: Record<number, string[]> = {}
  for (const c of snapshot.characters) {
    if (c.introducedChapter > 1) {
      ;(plannedIntroductions[c.introducedChapter] ??= []).push(c.id)
    }
  }
  try {
    const derived = buildBlueprints({
      storyId: snapshot.storyId,
      secrets: snapshot.secrets,
      plannedIntroductions,
    })
    return derived.find((b) => b.chapterNumber === chapterNumber) ?? null
  } catch {
    return null // bab di luar rentang template
  }
}

/** Susun cabang pilihan reader-safe deterministik dari draft tervalidasi. */
function buildChoices(
  draft: ChapterDraftParsed,
  chapterNumber: number,
): {
  choicePrompt: string
  choices: { id: string; label: string }[]
  outcomes: PublishOutcome[]
} {
  const isEnding = chapterNumber >= TOTAL_CHAPTERS
  const next = isEnding ? null : chapterNumber + 1
  const choicePrompt = 'Apa yang kaulakukan sekarang?'
  const choices = [
    { id: 'maju', label: 'Melangkah maju menghadapi keadaan' },
    { id: 'tahan', label: 'Menahan diri dan mengamati' },
  ]
  const outcomes: PublishOutcome[] = [
    {
      choiceId: 'maju',
      consequence: isEnding
        ? ['Kau memilih menuntaskan semuanya; kisah menemukan penutupnya.']
        : ['Kau maju; konsekuensi dari langkah ini membuka babak berikutnya.'],
      nextChapterNumber: next,
      isEnding,
    },
    {
      choiceId: 'tahan',
      consequence: isEnding
        ? ['Kau memilih melepaskan; kisah mengendap dalam keheningan.']
        : ['Kau menahan diri; namun arus cerita tetap menyeretmu ke depan.'],
      nextChapterNumber: next,
      isEnding,
    },
  ]
  return { choicePrompt, choices, outcomes }
}

/**
 * Jalankan satu putaran generasi bab nyata dan publish secara atomik.
 * Aman dipanggil berulang (idempoten); pada kegagalan review, lease dilepas
 * agar retry tidak terblokir hingga TTL habis.
 */
export async function generateNextChapterReal(
  storyId: string,
  chapterNumber: number,
): Promise<RealGenerateResult> {
  // 1) Lease (idempoten). Menolak bila ada generasi lain aktif.
  const lease = await acquireGenerationLease({
    storyId,
    chapterNumber,
    holder: 'story-generation',
    idempotencyKey: realGenerationKey(storyId, chapterNumber, 'lease'),
  })
  if (!lease.ok) return { ok: false, reason: lease.reason }

  try {
    // 2) Muat canon (read-only) resolved sampai bab target.
    const snapshot = await loadCanonSnapshot(storyId, chapterNumber)
    const blueprint = resolveBlueprint(snapshot, chapterNumber)
    if (!blueprint || snapshot.characters.length === 0) {
      await releaseGenerationLease({ storyId, leaseId: lease.lease_id })
      return { ok: false, reason: 'CANON_MISSING' }
    }

    // 3) Kompilasi konteks + catat jejak retrieval (best-effort observability).
    const packet = compileContext(snapshot, chapterNumber)
    await persistRetrievalLog(storyId, chapterNumber, packet)

    // 4) Konteks thread untuk lifecycle check (state hidup di canon, bukan draft).
    const threadContext: ThreadContext = {
      threads: snapshot.threads,
      advancedThreadIds: [],
      opensNewThread: false,
    }

    // 5) Generasi tervalidasi: plan → write → Layer A → Layer B → repair.
    const result = await generateChapter(
      { provider: selectProvider() },
      { snapshot, blueprint, chapterNumber, threadContext },
    )

    if (result.status !== 'PUBLISHED' || !result.draft) {
      await releaseGenerationLease({ storyId, leaseId: lease.lease_id })
      return {
        ok: false,
        reason: 'FAILED_REVIEW_REQUIRED',
        detail: {
          failedLayer: result.failedLayer,
          findings: result.findings,
          reason: result.reason,
        },
      }
    }

    const draft = result.draft

    // 6) Boundary consumer-safe: tak ada istilah internal yang bocor ke pembaca.
    const readerSafe = toReaderSafe(draft)
    assertConsumerSafe(readerSafe)

    // 7) Susun cabang pilihan & petakan ke input publish atomik.
    const branch = buildChoices(draft, chapterNumber)
    const leakInChoices = [
      branch.choicePrompt,
      ...branch.choices.map((c) => c.label),
      ...branch.outcomes.flatMap((o) => o.consequence),
    ]
      .flatMap(scanForLeaks)
    if (leakInChoices.length) {
      await releaseGenerationLease({ storyId, leaseId: lease.lease_id })
      throw new Error(`Kebocoran istilah internal pada cabang pilihan: ${leakInChoices.join(', ')}`)
    }

    // 8) Publish atomik (chapter + outcomes + event + release lease).
    const published: PublishResult = await publishChapter({
      storyId,
      chapterNumber,
      title: readerSafe.title,
      paragraphs: readerSafe.paragraphs,
      choicePrompt: branch.choicePrompt,
      choices: branch.choices,
      outcomes: branch.outcomes,
      leaseId: lease.lease_id,
      idempotencyKey: realGenerationKey(storyId, chapterNumber, 'publish'),
    })

    if (!published.ok) return { ok: false, reason: published.reason }
    return {
      ok: true,
      chapterNumber: published.chapter_number,
      seq: published.seq,
      repairAttempts: result.attempts,
    }
  } catch (err) {
    // Kegagalan tak terduga: lepas lease agar tak mengunci story.
    await releaseGenerationLease({ storyId, leaseId: lease.lease_id }).catch(() => {})
    throw err
  }
}
