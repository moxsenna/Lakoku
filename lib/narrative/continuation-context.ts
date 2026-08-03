/**
 * ContinuationContext — konteks kelanjutan deterministik yang menjadi sumber
 * kebenaran untuk Bab N. Dibangun dari:
 *   - reader_states.choice_history (historical truth) via triggerChoiceId
 *   - chapters(N-1) untuk ending excerpt verbatim
 *   - compileContext() packet untuk facts/threads (projection, tanpa ranking baru)
 *
 * BUKAN rebuilt ranking: hanya projection + cap atas ChapterContextPacket existing.
 * Fakta yang belum melewati reveal gate TIDAK pernah masuk sebagai fakta aktif —
 * hanya masuk blok larangan (mustNotReveal).
 */

import type {
  CanonSnapshot,
  Fact,
  StoryThread,
  TimelineEvent,
} from './types'
import type { ChapterContextPacket } from './compiler'
import type { ChoiceHistoryEntry } from '@/lib/story-engine/chapter-brief'
import { buildEndingParagraphs } from './ending-excerpt'

/** Satu item fakta mapan yang sudah terbuka (established ≤ N-1). */
export interface ContinuationFact {
  id: string
  statement: string
  establishedChapter: number
  loadBearing: boolean
}

/** Thread yang sedang terbuka. */
export interface ContinuationThread {
  id: string
  title: string
  status: StoryThread['status']
  openedChapter: number
  lastTouchedChapter: number
}

/** Kejadian timeline terakhir (established only, bukan flashback). */
export interface ContinuationTimelineEvent {
  chapterNumber: number
  ordinal: number
  description: string
}

/** Referensi ending Bab N-1 (verbatim 3..5 paragraf terakhir). */
export interface PreviousChapterRef {
  number: number
  title: string
  /** 3..5 paragraf terakhir BAB SEBELUMNYA, apa adanya (verbatim). */
  endingParagraphs: string[]
}

/**
 * Konteks kelanjutan Bab N. Semua field sudah di-bounding.
 * previousChoice null sah hanya bila Bab N-1 memang tanpa pilihan
 * (legacy non-choice) atau Bab 1. Untuk Bab dengan choice, previousChoice wajib ada.
 */
export interface ContinuationContext {
  storyId: string
  targetChapterNumber: number
  /** Null hanya untuk Bab 1. */
  previousChapter: PreviousChapterRef | null
  /** Null sah hanya bila Bab N-1 terbukti tidak memiliki choices. */
  previousChoice: ChoiceHistoryEntry | null
  /** Ringkasan route state siap-prompt. */
  routeStateSummary: string
  openThreads: ContinuationThread[]
  /** Fakta mapan, established ≤ N-1, reader-safe. */
  anchorFacts: ContinuationFact[]
  recentTimeline: ContinuationTimelineEvent[]
  /** Rahasia yang BELUM boleh dibocorkan (gate > N). Hanya larangan, bukan fakta. */
  mustNotReveal: string[]
}

const CAP_FACTS = 6
const CAP_THREADS = 6
const CAP_TIMELINE = 5

function projectFact(f: Fact): ContinuationFact {
  return {
    id: f.id,
    statement: f.statement,
    establishedChapter: f.establishedChapter,
    loadBearing: f.loadBearing,
  }
}

function projectThread(t: StoryThread): ContinuationThread {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    openedChapter: t.openedChapter,
    lastTouchedChapter: t.lastTouchedChapter,
  }
}

function projectTimeline(e: TimelineEvent): ContinuationTimelineEvent {
  return {
    chapterNumber: e.chapterNumber,
    ordinal: e.ordinal,
    description: e.description,
  }
}

export interface BuildContinuationContextInput {
  storyId: string
  /** Bab target yang akan ditulis. */
  targetChapterNumber: number
  snapshot: CanonSnapshot
  /** Hasil compileContext(snapshot, targetChapterNumber). */
  packet: ChapterContextPacket
  /** Row Bab N-1 (title + paragraphs). Null untuk Bab 1. */
  previousChapterRow: { number: number; title: string; paragraphs: string[] } | null
  /** Entry choice_history terpilih via triggerChoiceId. Null bila sah tanpa pilihan. */
  previousChoice: ChoiceHistoryEntry | null
  routeStateSummary: string
  lockedEndingKey: string | null
}

/**
 * Builder murni (tanpa IO). Deterministik terhadap input.
 * Tidak memanggul logika fail-closed — itu di server loader.
 */
export function buildContinuationContext(
  input: BuildContinuationContextInput,
): ContinuationContext {
  const n = input.targetChapterNumber

  const previousChapter: PreviousChapterRef | null = input.previousChapterRow
    ? {
        number: input.previousChapterRow.number,
        title: input.previousChapterRow.title,
        endingParagraphs: buildEndingParagraphs(
          input.previousChapterRow.paragraphs,
          input.previousChapterRow.title,
        ),
      }
    : null

  // Projection dari packet — TIDAK ranking baru.
  const anchorFacts = [...input.packet.loadBearingFacts, ...input.packet.relevantFacts]
    .filter((f) => f.establishedChapter <= n - 1)
    .map(projectFact)
    .slice(0, CAP_FACTS)

  const openThreads = input.packet.currentState.activeThreads
    .map(projectThread)
    .slice(0, CAP_THREADS)

  const recentTimeline = input.snapshot.timeline
    .filter((t) => t.chapterNumber <= n - 1 && !t.isFlashback)
    .sort((a, b) => (b.chapterNumber - a.chapterNumber) || (b.ordinal - a.ordinal))
    .slice(0, CAP_TIMELINE)
    .map(projectTimeline)

  // Rahasia terkunci: hanya yang gate-nya > N. Masuk sebagai larangan.
  const mustNotReveal = input.snapshot.secrets
    .filter((s) => s.revealGateChapter > n)
    .map((s) => s.description)

  return {
    storyId: input.storyId,
    targetChapterNumber: n,
    previousChapter,
    previousChoice: input.previousChoice,
    routeStateSummary: input.routeStateSummary,
    openThreads,
    anchorFacts,
    recentTimeline,
    mustNotReveal,
  }
}
