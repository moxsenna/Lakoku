/**
 * G4 — Story Thread Lifecycle (NCS §4).
 *
 * Semua aturan di sini DETERMINISTIK (tanpa LLM):
 *  - Status machine: OPEN → DEVELOPING → PAYOFF_DUE → RESOLVED | ABANDONED_APPROVED.
 *  - Budget: maksimal 7 thread aktif (OPEN/DEVELOPING/PAYOFF_DUE).
 *  - Mulai Bab 41: dilarang membuka thread baru; tiap bab wajib memajukan ≥ 1 PAYOFF_DUE.
 *  - Stale: tak disentuh 6 bab → flag stale; wajib callback dalam 3 bab berikutnya.
 *  - Publish Bab 48 diblokir bila mystery utama masih non-RESOLVED.
 */

import type { Finding, StoryThread, ThreadStatus } from './types'

export const MAX_ACTIVE_THREADS = 7
export const NO_NEW_THREAD_FROM_CHAPTER = 41
export const STALE_AFTER_CHAPTERS = 6
export const STALE_CALLBACK_WINDOW = 3
export const MAIN_MYSTERY_BLOCK_CHAPTER = 48

const ACTIVE_STATUSES: readonly ThreadStatus[] = ['OPEN', 'DEVELOPING', 'PAYOFF_DUE']

/** Transisi status yang legal (status machine G4.1). */
const LEGAL_TRANSITIONS: Record<ThreadStatus, readonly ThreadStatus[]> = {
  OPEN: ['DEVELOPING', 'PAYOFF_DUE', 'ABANDONED_APPROVED'],
  DEVELOPING: ['PAYOFF_DUE', 'RESOLVED', 'ABANDONED_APPROVED'],
  PAYOFF_DUE: ['RESOLVED', 'ABANDONED_APPROVED'],
  RESOLVED: [],
  ABANDONED_APPROVED: [],
}

export function isActive(t: StoryThread): boolean {
  return ACTIVE_STATUSES.includes(t.status)
}

export function canTransition(from: ThreadStatus, to: ThreadStatus): boolean {
  if (from === to) return true
  return LEGAL_TRANSITIONS[from].includes(to)
}

/**
 * Terapkan transisi status dengan aturan audit:
 *  - ABANDONED_APPROVED hanya boleh via checkpoint (approvedByCheckpoint=true).
 *  - Transisi ilegal ditolak (lempar) — mencegah thread hilang diam-diam.
 */
export function transitionThread(
  thread: StoryThread,
  to: ThreadStatus,
  opts: { approvedByCheckpoint?: boolean } = {},
): StoryThread {
  if (!canTransition(thread.status, to)) {
    throw new Error(
      `Transisi thread ilegal: ${thread.id} ${thread.status} → ${to}`,
    )
  }
  if (to === 'ABANDONED_APPROVED' && !opts.approvedByCheckpoint) {
    throw new Error(
      `Thread ${thread.id} hanya boleh ABANDONED_APPROVED via reconciliation checkpoint.`,
    )
  }
  return { ...thread, status: to }
}

/** Sentuh thread pada bab tertentu: reset staleness, majukan lastTouched. */
export function touchThread(thread: StoryThread, chapter: number): StoryThread {
  return {
    ...thread,
    lastTouchedChapter: Math.max(thread.lastTouchedChapter, chapter),
    stale: false,
    staleSinceChapter: null,
  }
}

/**
 * Perbarui flag staleness untuk seluruh thread pada bab `chapter`.
 * Thread aktif yang tak disentuh ≥ STALE_AFTER_CHAPTERS bab → stale.
 */
export function refreshStaleness(
  threads: StoryThread[],
  chapter: number,
): StoryThread[] {
  return threads.map((t) => {
    if (!isActive(t)) return t
    const gap = chapter - t.lastTouchedChapter
    if (gap >= STALE_AFTER_CHAPTERS && !t.stale) {
      return { ...t, stale: true, staleSinceChapter: chapter }
    }
    return t
  })
}

/** Apakah boleh membuka thread baru pada bab `chapter`? (budget + gate Bab 41) */
export function canOpenNewThread(
  threads: StoryThread[],
  chapter: number,
): { ok: boolean; reason?: string } {
  if (chapter >= NO_NEW_THREAD_FROM_CHAPTER) {
    return {
      ok: false,
      reason: `Dilarang membuka thread baru mulai Bab ${NO_NEW_THREAD_FROM_CHAPTER}.`,
    }
  }
  const active = threads.filter(isActive).length
  if (active >= MAX_ACTIVE_THREADS) {
    return {
      ok: false,
      reason: `Budget thread penuh (${active}/${MAX_ACTIVE_THREADS}).`,
    }
  }
  return { ok: true }
}

/**
 * Validasi lifecycle thread untuk sebuah bab yang akan dipublish.
 * `advancedThreadIds` = thread yang dimajukan/disentuh oleh draft bab ini.
 * Mengembalikan findings (severity sesuai NCS): dipakai Layer A/checkpoint.
 */
export function validateThreadLifecycle(args: {
  threads: StoryThread[]
  chapter: number
  advancedThreadIds: string[]
  opensNewThread?: boolean
}): Finding[] {
  const { threads, chapter, advancedThreadIds, opensNewThread } = args
  const findings: Finding[] = []
  const advanced = new Set(advancedThreadIds)

  // Budget aktif tak boleh melebihi 7.
  const active = threads.filter(isActive)
  if (active.length > MAX_ACTIVE_THREADS) {
    findings.push({
      code: 'THREAD_BUDGET_EXCEEDED',
      severity: 'MAJOR',
      message: `Thread aktif ${active.length} melebihi maksimum ${MAX_ACTIVE_THREADS}.`,
    })
  }

  // Dilarang buka thread baru bila penuh atau ≥ Bab 41.
  if (opensNewThread) {
    const gate = canOpenNewThread(threads, chapter)
    if (!gate.ok) {
      findings.push({
        code: 'THREAD_NEW_FORBIDDEN',
        severity: 'MAJOR',
        message: gate.reason ?? 'Tidak boleh membuka thread baru.',
      })
    }
  }

  // Stale wajib di-callback dalam STALE_CALLBACK_WINDOW bab.
  for (const t of threads) {
    if (t.stale && t.staleSinceChapter != null) {
      const overdue = chapter - t.staleSinceChapter
      if (overdue >= STALE_CALLBACK_WINDOW && !advanced.has(t.id)) {
        findings.push({
          code: 'THREAD_STALE_UNADDRESSED',
          severity: 'MAJOR',
          message: `Thread stale "${t.id}" belum di-callback dalam ${STALE_CALLBACK_WINDOW} bab.`,
          detail: { threadId: t.id, staleSince: t.staleSinceChapter },
        })
      }
    }
  }

  // Act 6+ (≥ Bab 41): wajib memajukan ≥ 1 thread PAYOFF_DUE.
  if (chapter >= NO_NEW_THREAD_FROM_CHAPTER) {
    const payoffDue = threads.filter((t) => t.status === 'PAYOFF_DUE')
    if (payoffDue.length > 0) {
      const advancedPayoff = payoffDue.some((t) => advanced.has(t.id))
      if (!advancedPayoff) {
        findings.push({
          code: 'THREAD_PAYOFF_NOT_ADVANCED',
          severity: 'MAJOR',
          message: `Bab ${chapter} (Act akhir) wajib memajukan ≥ 1 thread PAYOFF_DUE.`,
        })
      }
    }
  }

  return findings
}

/**
 * Gate keras publish Bab 48+ (deterministik):
 * diblokir bila ada thread mystery utama berstatus non-RESOLVED.
 *
 * Bab closure (48) sendiri TIDAK diblokir dari snapshot pra-bab: pada Bab 48
 * closure mystery justru dikomit DI state bab itu (status thread debt-backed
 * → RESOLVED lewat operasi closure). Authority kebenaran closure = ledger
 * plot-debt (`resolveDebtClosures`: MAIN_MYSTERY_UNRESOLVED on chapter >= 48
 * terhadap proyeksi yang memuat closure bab ini) — gate thread ini adalah
 * proxy deterministik untuk bab-bab SETELAH bab resolusi (49+).
 */
export function checkChapter48Block(
  threads: StoryThread[],
  chapter: number,
): Finding[] {
  if (chapter <= MAIN_MYSTERY_BLOCK_CHAPTER) return []
  const unresolvedMain = threads.filter(
    (t) => t.isMainMystery && t.status !== 'RESOLVED',
  )
  if (unresolvedMain.length === 0) return []
  return [
    {
      code: 'MAIN_MYSTERY_UNRESOLVED_AT_48',
      severity: 'CRITICAL',
      message: `Publish Bab ${chapter} diblokir: mystery utama belum RESOLVED (${unresolvedMain
        .map((t) => t.id)
        .join(', ')}).`,
      detail: { threadIds: unresolvedMain.map((t) => t.id) },
    },
  ]
}
