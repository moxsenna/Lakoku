/**
 * M10-A1 — Typed blueprint state policy (`AllowedChapterStatePolicyV1`).
 *
 * Pengganti `allowed_state_delta: {}` untuk cerita stateful (version 1):
 * policy ber-typed, tanpa escape hatch `extra: Record<string, unknown>`.
 * Setiap operasi pada ChapterStateDeltaV1 harus lolos policy ini sebelum
 * boleh masuk checkpoint/publikasi.
 *
 * Policy dibangun deterministik dari Story Contract terkunci (bukan dari
 * prose, bukan dari LLM). Kategori tanpa sumber aman → tetap kosong.
 */

import { z } from 'zod'
import type { StoryContract } from '../story-engine/story-contract'
import { debtBackedThreadId } from './canon-id'
import type { ChapterStateDeltaV1 } from './chapter-state-delta'

export const ALLOWED_CHAPTER_STATE_POLICY_SCHEMA_VERSION = 1 as const

const max256 = z.string().trim().min(1).max(256)
const max20 = z.array(max256).max(20)

export const AllowedChapterStatePolicyV1Schema = z.object({
  schemaVersion: z.literal(ALLOWED_CHAPTER_STATE_POLICY_SCHEMA_VERSION),
  storyId: max256,
  facts: z.object({
    allowAdd: z.boolean(),
    payableFactIds: max20,
  }).strict(),
  knowledge: z.object({
    allowGrants: z.boolean(),
  }).strict(),
  secrets: z.object({
    revealIds: max20,
  }).strict(),
  characters: z.object({
    statusChangeCharacterIds: max20,
  }).strict(),
  threads: z.object({
    touchIds: max20,
    transitionIds: max20,
  }).strict(),
  plotDebts: z.object({
    progressIds: max20,
    closureIds: max20,
  }).strict(),
  actRollup: z.boolean(),
}).strict()

export type AllowedChapterStatePolicyV1 = z.infer<
  typeof AllowedChapterStatePolicyV1Schema
>

export interface BuildBaselinePolicyInput {
  storyContract: StoryContract
  chapterNumber: number
}

/**
 * Policy baseline deterministic dari Story Contract terkunci (plan §13).
 *
 * - facts.allowAdd = false sampai ada sumber faktur terstruktur (authoring).
 * - knowledge.allowGrants = false sampai ada sumber gain terstruktur.
 * - secrets.revealIds = secret canon yang gate-nya sudah terbuka bab ini
 *   (tidak pernah memajukan reveal lebih awal dari gate).
 * - thread touch/transition = thread debt-backed dalam window
 *   `introducedAt <= chapter <= mustCloseBy`.
 * - plot-debt progress = debt dengan milestone `mustProgressBy` tepat bab ini
 *   (milestone tidak dianggap selesai hanya karena babnya lewat).
 * - plot-debt closure = debt dalam window introduksi..deadline.
 * - actRollup = true hanya bila bab ini adalah ujung act (`actPlan.toChapter`).
 */
export function buildBaselinePolicyForChapter(
  input: BuildBaselinePolicyInput,
): AllowedChapterStatePolicyV1 {
  const { storyContract, chapterNumber } = input
  const chapter = chapterNumber

  const secrets = storyContract.revealRunway
    .filter((reveal) => reveal.revealGateChapter <= chapter)
    .map((reveal) => `${storyContract.storyId}:${reveal.secretId}`)

  const threadWindowIds = storyContract.plotDebts
    .filter((debt) => debt.introducedAt <= chapter && chapter <= debt.mustCloseBy)
    .map((debt) => debtBackedThreadId(storyContract.storyId, debt.id))

  const progressIds = storyContract.plotDebts
    .filter((debt) => debt.mustProgressBy.includes(chapter))
    .map((debt) => debt.id)

  const closureIds = storyContract.plotDebts
    .filter((debt) => debt.introducedAt <= chapter && chapter <= debt.mustCloseBy)
    .map((debt) => debt.id)

  const actRollup = storyContract.actPlan.some((act) => act.toChapter === chapter)

  return {
    schemaVersion: ALLOWED_CHAPTER_STATE_POLICY_SCHEMA_VERSION,
    storyId: storyContract.storyId,
    facts: { allowAdd: false, payableFactIds: [] },
    knowledge: { allowGrants: false },
    secrets: { revealIds: secrets },
    characters: { statusChangeCharacterIds: [] },
    threads: { touchIds: threadWindowIds, transitionIds: threadWindowIds },
    plotDebts: { progressIds, closureIds },
    actRollup,
  }
}

export interface PolicyViolation {
  category: string
  detail: string
}

/** Cek delta terhadap policy — pure, mengembalikan daftar pelanggaran. */
export function checkDeltaAgainstPolicy(
  delta: ChapterStateDeltaV1,
  policy: AllowedChapterStatePolicyV1,
): PolicyViolation[] {
  const violations: PolicyViolation[] = []
  const d = delta

  if (d.facts.add.length > 0 && !policy.facts.allowAdd) {
    violations.push({
      category: 'facts.add',
      detail: 'facts.allowAdd=false: tidak ada sumber faktur terstruktur.',
    })
  }
  for (const factId of d.facts.markPaidOff) {
    if (!policy.facts.payableFactIds.includes(factId)) {
      violations.push({ category: 'facts.markPaidOff', detail: `fact ${factId} tidak payable.` })
    }
  }
  if (d.knowledge.grants.length > 0 && !policy.knowledge.allowGrants) {
    violations.push({
      category: 'knowledge.grants',
      detail: 'knowledge.allowGrants=false: tidak ada sumber gain terstruktur.',
    })
  }
  for (const secretId of d.secrets.revealIds) {
    if (!policy.secrets.revealIds.includes(secretId)) {
      violations.push({ category: 'secrets.revealIds', detail: `secret ${secretId} tidak eligible bab ini.` })
    }
  }
  for (const change of d.characters.statusChanges) {
    if (!policy.characters.statusChangeCharacterIds.includes(change.characterId)) {
      violations.push({
        category: 'characters.statusChanges',
        detail: `karakter ${change.characterId} tidak terotorisasi status change.`,
      })
    }
  }
  for (const threadId of d.threads.touches) {
    if (!policy.threads.touchIds.includes(threadId)) {
      violations.push({ category: 'threads.touches', detail: `thread ${threadId} di luar window.` })
    }
  }
  for (const transition of d.threads.transitions) {
    if (!policy.threads.transitionIds.includes(transition.threadId)) {
      violations.push({
        category: 'threads.transitions',
        detail: `thread ${transition.threadId} tidak eligible transition.`,
      })
    }
  }
  for (const progress of d.plotDebts.progress) {
    if (!policy.plotDebts.progressIds.includes(progress.debtId)) {
      violations.push({
        category: 'plotDebts.progress',
        detail: `debt ${progress.debtId} tidak punya milestone bab ini.`,
      })
    }
  }
  for (const closure of d.plotDebts.closures) {
    if (!policy.plotDebts.closureIds.includes(closure.debtId)) {
      violations.push({
        category: 'plotDebts.closures',
        detail: `debt ${closure.debtId} di luar window closure.`,
      })
    }
  }
  if (d.actRollup != null && !policy.actRollup) {
    violations.push({
      category: 'actRollup',
      detail: 'Bukan act boundary — rollup tidak diizinkan bab ini.',
    })
  }
  return violations
}
