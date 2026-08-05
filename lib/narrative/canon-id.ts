/**
 * M10-A1 — Canonical ID helpers (pure, deterministic).
 *
 * Semua ID canon story-local dan retry-stable. Tidak ada ID acak saat
 * publikasi: konten kanonik identik pada retry harus menghasilkan ID sama.
 * Konvensi scoped ID mengikuti `contract-persistence.server.ts :: scopedId`
 * (`${storyId}:${localId}`) agar tidak ada dua representasi string.
 */

import { createHash } from 'node:crypto'

export const RUNTIME_FACT_DOMAIN_SEPARATOR = 'lakoku:runtime-fact:v1'
export const RUNTIME_FACT_ID_PREFIX = 'fact:runtime'
export const RUNTIME_FACT_DIGEST_LENGTH = 12

/** `storyId:localId` — bentuk canonical untuk seluruh referensi canon. */
export function canonicalIdFor(storyId: string, localId: string): string {
  return `${storyId}:${localId}`
}

/**
 * ID thread yang dibacking oleh plot debt — satu-satunya sumber mapping
 * debt→thread (lihat `contract-persistence.server.ts :: contractToCanonBootstrap`:
 * `thread:${debt.id}`). Jangan rekonstruksi string ini di modul lain.
 */
export function debtBackedThreadId(storyId: string, debtId: string): string {
  return canonicalIdFor(storyId, `thread:${debtId}`)
}

/** Apakah id merupakan runtime-fact id (bukan id authoring/contract). */
export function isRuntimeFactId(id: string): boolean {
  return id.includes(`:${RUNTIME_FACT_ID_PREFIX}:`)
}

export interface RuntimeFactIdInput {
  storyId: string
  chapterNumber: number
  subjectCharacterId: string | null
  statement: string
}

/**
 * ID faktur runtime deterministik dari konten kanoniknya:
 * `${storyId}:fact:runtime:<short_sha256>`.
 *
 * Digest domain-separated (`lakoku:runtime-fact:v1`) sehingga retry dengan
 * statement/subjek/bab yang sama menghasilkan ID sama; isi berbeda → ID beda.
 */
export function runtimeFactId(input: RuntimeFactIdInput): string {
  const { storyId, chapterNumber, subjectCharacterId, statement } = input
  const digest = createHash('sha256')
    .update(
      [
        RUNTIME_FACT_DOMAIN_SEPARATOR,
        storyId,
        String(chapterNumber),
        subjectCharacterId ?? '',
        statement,
      ].join('|'),
    )
    .digest('hex')
  return canonicalIdFor(
    storyId,
    `${RUNTIME_FACT_ID_PREFIX}:${digest.slice(0, RUNTIME_FACT_DIGEST_LENGTH)}`,
  )
}
