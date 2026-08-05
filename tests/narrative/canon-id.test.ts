/**
 * M10-A1a — canon-id (plan §10): ID deterministik domain-separated.
 */

import { describe, expect, it } from 'vitest'
import {
  canonicalIdFor,
  debtBackedThreadId,
  isRuntimeFactId,
  RUNTIME_FACT_DIGEST_LENGTH,
  RUNTIME_FACT_ID_PREFIX,
  runtimeFactId,
} from '@lakoku/narrative-core'

describe('canonicalIdFor / debtBackedThreadId', () => {
  it('canonicalIdFor = storyId:localId', () => {
    expect(canonicalIdFor('story:abc', 'fact:x')).toBe('story:abc:fact:x')
  })

  it('debtBackedThreadId = storyId:thread:debtId (pola contract-persistence)', () => {
    expect(debtBackedThreadId('story:abc', 'main_mystery')).toBe('story:abc:thread:main_mystery')
  })

  it('deterministik: input sama → output sama', () => {
    expect(canonicalIdFor('s', 'l')).toBe(canonicalIdFor('s', 'l'))
    expect(debtBackedThreadId('s', 'd')).toBe(debtBackedThreadId('s', 'd'))
  })
})

describe('runtimeFactId', () => {
  const base = {
    storyId: 'story:abc',
    chapterNumber: 7,
    subjectCharacterId: 'char:rani',
    statement: 'Rani menemukan catatan di brankas.',
  }

  it('deterministik: input sama → ID sama (retry-stable)', () => {
    const first = runtimeFactId(base)
    const second = runtimeFactId(base)
    expect(second).toBe(first)
  })

  it('format: storyId:fact:runtime:<digest pendek sha256>', () => {
    const id = runtimeFactId(base)
    expect(id.startsWith('story:abc:')).toBe(true)
    expect(id).toContain(`:${RUNTIME_FACT_ID_PREFIX}:`)
    const digestPart = id.split(`${RUNTIME_FACT_ID_PREFIX}:`)[1]
    expect(digestPart.length).toBe(RUNTIME_FACT_DIGEST_LENGTH)
  })

  it('perubahan isi → ID berbeda', () => {
    const changed = runtimeFactId({ ...base, statement: 'Rani menemukan kotak kosong.' })
    expect(changed).not.toBe(runtimeFactId(base))
  })

  it('perubahan bab → ID berbeda (scope per bab)', () => {
    const nextChapter = runtimeFactId({ ...base, chapterNumber: 8 })
    expect(nextChapter).not.toBe(runtimeFactId(base))
  })

  it('isRuntimeFactId mengenali ID runtime dan menolak ID lain', () => {
    expect(isRuntimeFactId(runtimeFactId(base))).toBe(true)
    expect(isRuntimeFactId('story:abc:fact:main-conflict')).toBe(false)
  })
})
