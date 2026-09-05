import { z } from 'zod'
import type { M10FStorySurfaceManifest } from '../contracts/m10-f-semantic-contract'

const StructuralThreadStatusSchema = z.enum([
  'OPEN',
  'DEVELOPING',
  'PAYOFF_DUE',
  'RESOLVED',
  'ABANDONED_APPROVED',
])

export interface M10FStructuralRows {
  storyContract: Record<string, unknown>
  plotDebts: unknown[]
  endingLock: Record<string, unknown>
  lockedEndingKey: string | null
  threads: Array<{
    id: string
    title: string
    status: string
    payoffWindow: number | null
  }>
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`M10-F canonical ${field} missing`)
  }
  return value.trim()
}

function payoffChapter(value: Record<string, unknown>, index: number): number {
  const raw = value.payoffChapter ?? value.payoff_window ?? value.mustCloseBy
  if (!Number.isInteger(raw) || Number(raw) < 1 || Number(raw) > 50) {
    throw new Error(`M10-F canonical plot debt ${index + 1} payoff chapter malformed`)
  }
  return Number(raw)
}

export function projectM10FStructuralContext(
  rows: M10FStructuralRows,
): M10FStorySurfaceManifest['structuralContext'] {
  const threads = rows.threads.map((thread, index) => ({
    id: requiredText(thread.id, `thread ${index + 1} id`),
    title: requiredText(thread.title, `thread ${index + 1} title`),
    status: StructuralThreadStatusSchema.parse(thread.status),
    payoffWindow: thread.payoffWindow,
  })).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)

  for (const [index, thread] of threads.entries()) {
    if (thread.payoffWindow !== null
      && (!Number.isInteger(thread.payoffWindow) || thread.payoffWindow < 1 || thread.payoffWindow > 50)) {
      throw new Error(`M10-F canonical thread ${index + 1} payoff window malformed`)
    }
  }

  const debts = rows.plotDebts.map((debt, index) => {
    if (!debt || typeof debt !== 'object' || Array.isArray(debt)) {
      throw new Error(`M10-F canonical plot debt ${index + 1} malformed`)
    }
    const value = debt as Record<string, unknown>
    return {
      id: requiredText(value.id, `plot debt ${index + 1} id`),
      payoffChapter: payoffChapter(value, index),
    }
  }).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)

  const endingKey = rows.lockedEndingKey
    ?? (typeof rows.endingLock.key === 'string' ? rows.endingLock.key : null)
  const summary = (thread: typeof threads[number]) =>
    `${thread.id} | ${thread.title} | ${thread.status}`

  return {
    storyPromise: requiredText(rows.storyContract.corePromise, 'corePromise'),
    mainConflict: requiredText(rows.storyContract.mainConflict, 'mainConflict'),
    finalQuestion: requiredText(rows.storyContract.finalQuestion, 'finalQuestion'),
    activeThreadSummaries: threads
      .filter((thread) => !['RESOLVED', 'ABANDONED_APPROVED'].includes(thread.status))
      .map(summary),
    resolvedThreadSummaries: threads
      .filter((thread) => ['RESOLVED', 'ABANDONED_APPROVED'].includes(thread.status))
      .map(summary),
    payoffSchedule: debts.map((debt) => `${debt.id} | payoffChapter=${debt.payoffChapter}`),
    lockedEndingKey: requiredText(endingKey, 'lockedEndingKey'),
    actPosition: 'Horizon kanonis lengkap Bab 1-50; posisi akhir ACT_3.',
  }
}
