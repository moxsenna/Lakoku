import { describe, expect, it } from 'vitest'
import {
  READER_STATUS_COPY,
  choiceFingerprint,
  choiceJobIdempotencyKey,
  defaultCheckpointExpiry,
  isCheckpointUsableForChoiceRetry,
  proseFingerprint,
  publishIdempotencyKey,
  readerStatusFromCheckpoint,
} from '@/lib/runtime/chapter-generation-checkpoint'

describe('chapter generation checkpoint helpers', () => {
  it('prose fingerprint stable for same title/paragraphs', () => {
    const a = proseFingerprint('Judul', ['p1', 'p2'])
    const b = proseFingerprint('Judul', ['p1', 'p2'])
    const c = proseFingerprint('Judul', ['p1', 'p2x'])
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[a-f0-9]{32}$/)
  })

  it('choice retry uses same prose fingerprint in job key', () => {
    const fp = proseFingerprint('T', ['a'])
    const key1 = choiceJobIdempotencyKey({
      storyId: 's1',
      chapterNumber: 3,
      proseFingerprint: fp,
    })
    const key2 = choiceJobIdempotencyKey({
      storyId: 's1',
      chapterNumber: 3,
      proseFingerprint: fp,
    })
    expect(key1).toBe(key2)
    expect(key1).toContain(fp)
  })

  it('PROSE_READY / CHOICES_RETRY_WAIT usable until expiry', () => {
    const future = defaultCheckpointExpiry()
    expect(
      isCheckpointUsableForChoiceRetry({
        status: 'PROSE_READY',
        expiresAt: future,
        proseFingerprint: 'abc',
      }),
    ).toBe(true)
    expect(
      isCheckpointUsableForChoiceRetry({
        status: 'CHOICES_RETRY_WAIT',
        expiresAt: future,
        proseFingerprint: 'abc',
      }),
    ).toBe(true)
    expect(
      isCheckpointUsableForChoiceRetry({
        status: 'PUBLISHED',
        expiresAt: future,
        proseFingerprint: 'abc',
      }),
    ).toBe(false)
    expect(
      isCheckpointUsableForChoiceRetry({
        status: 'PROSE_READY',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        proseFingerprint: 'abc',
      }),
    ).toBe(false)
  })

  it('reader status maps preparing_choices without technical detail', () => {
    expect(readerStatusFromCheckpoint('PROSE_READY')).toBe('preparing_choices')
    expect(readerStatusFromCheckpoint('RUNNING_CHOICES')).toBe('preparing_choices')
    expect(readerStatusFromCheckpoint('PUBLISHED')).toBe('ready')
    expect(readerStatusFromCheckpoint('FAILED')).toBe('failed')
    expect(READER_STATUS_COPY.preparing_choices).toMatch(/pilihan/i)
    expect(READER_STATUS_COPY.failed).toMatch(/belum berhasil/i)
    expect(READER_STATUS_COPY.preparing_choices.toLowerCase()).not.toContain('provider')
    expect(READER_STATUS_COPY.preparing_choices.toLowerCase()).not.toContain('llm')
  })

  it('publish key combines prose + choice fingerprints', () => {
    const prose = proseFingerprint('T', ['p'])
    const choice = choiceFingerprint({
      choicePrompt: 'Apa langkahmu?',
      choices: [
        { id: 'chapter-1-choice-1', label: 'Buka pintu sekarang' },
        { id: 'chapter-1-choice-2', label: 'Sembunyikan surat dulu' },
      ],
      outcomes: [
        { choiceId: 'chapter-1-choice-1', consequence: ['A'] },
        { choiceId: 'chapter-1-choice-2', consequence: ['B'] },
      ],
    })
    const key = publishIdempotencyKey({
      storyId: 's1',
      chapterNumber: 1,
      proseFingerprint: prose,
      choiceFingerprint: choice,
    })
    expect(key).toContain(prose)
    expect(key).toContain(choice)
  })
})
