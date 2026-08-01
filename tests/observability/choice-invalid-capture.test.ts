import { createDecipheriv, hkdfSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/observability/choice-invalid-capture-db.server', () => ({
  writeEncryptedChoiceInvalidCapture: vi.fn(),
}))

import {
  CHOICE_INVALID_CAPTURE_ENV,
  loadChoiceInvalidCaptureConfig,
} from '@/lib/observability/choice-invalid-capture-config.server'
import {
  decryptChoiceLexicalEvidence,
  encryptChoiceLexicalEvidence,
} from '@/lib/observability/choice-invalid-capture-crypto.server'
import { captureChoiceInvalidEvidence } from '@/lib/observability/choice-invalid-capture.server'

const now = new Date('2026-07-31T12:00:00.000Z')
const masterKey = new Uint8Array(Array.from({ length: 32 }, (_, index) => index))
const encodedKey = Buffer.from(masterKey).toString('base64')

function validEnv(): Record<string, string | undefined> {
  return {
    [CHOICE_INVALID_CAPTURE_ENV.enabled]: 'on',
    [CHOICE_INVALID_CAPTURE_ENV.storyId]: 'story-exact',
    [CHOICE_INVALID_CAPTURE_ENV.chapterNumber]: '12',
    [CHOICE_INVALID_CAPTURE_ENV.until]: '2026-07-31T12:30:00.000Z',
    [CHOICE_INVALID_CAPTURE_ENV.key]: encodedKey,
  }
}

describe('choice invalid capture config', () => {
  it('loads only exact enabled, identity-bound, future bounded config with canonical 32-byte base64 key', () => {
    expect(loadChoiceInvalidCaptureConfig(validEnv(), now)).toEqual({
      storyId: 'story-exact',
      chapterNumber: 12,
      expiresAt: '2026-07-31T12:30:00.000Z',
      masterKey,
    })
  })

  it.each([
    [CHOICE_INVALID_CAPTURE_ENV.enabled, 'true'],
    [CHOICE_INVALID_CAPTURE_ENV.storyId, ' story-exact'],
    [CHOICE_INVALID_CAPTURE_ENV.chapterNumber, '12.0'],
    [CHOICE_INVALID_CAPTURE_ENV.until, '2026-07-31T13:00:00.001Z'],
    [CHOICE_INVALID_CAPTURE_ENV.until, '2026-07-31T12:00:00.000Z'],
    [CHOICE_INVALID_CAPTURE_ENV.key, Buffer.alloc(31).toString('base64')],
    [CHOICE_INVALID_CAPTURE_ENV.key, `${encodedKey}\n`],
  ])('fails closed for invalid %s', (key, value) => {
    expect(loadChoiceInvalidCaptureConfig({ ...validEnv(), [key]: value }, now)).toBeNull()
  })
})

describe('choice invalid capture crypto', () => {
  it('uses 12-byte nonce, 16-byte tag, AAD-bound AES-256-GCM, and keyed label fingerprint', () => {
    const identity = {
      id: 'capture-1', correlationId: 'correlation-1', storyId: 'story-exact',
      chapterNumber: 12, index: 1, stage: 'FINAL_BRANCH_SCHEMA' as const,
      code: 'CHOICE_NOT_ACTIONABLE' as const, expiresAt: '2026-07-31T12:30:00.000Z',
    }
    const encrypted = encryptChoiceLexicalEvidence({
      masterKey,
      identity,
      label: 'Pikirkan pilihan terbaik',
      nonce: new Uint8Array(12).fill(7),
    })
    expect(Buffer.from(encrypted.nonce, 'base64')).toHaveLength(12)
    expect(Buffer.from(encrypted.authTag, 'base64')).toHaveLength(16)
    expect(encrypted.labelFingerprint).not.toContain('Pikirkan')
    const sameIncident = encryptChoiceLexicalEvidence({
      masterKey,
      identity: { ...identity, id: 'capture-2', correlationId: 'correlation-2', index: 2 },
      label: 'Label berbeda',
      nonce: new Uint8Array(12).fill(8),
    })
    expect(sameIncident.incidentKey).toBe(encrypted.incidentKey)
    expect(sameIncident.labelFingerprint).not.toBe(encrypted.labelFingerprint)
    expect(decryptChoiceLexicalEvidence({ masterKey, record: encrypted }))
      .toBe('Pikirkan pilihan terbaik')
    expect(decryptChoiceLexicalEvidence({
      masterKey,
      record: { ...encrypted, expiresAt: '2026-07-31T12:30:00+00:00' },
    })).toBe('Pikirkan pilihan terbaik')
    expect(decryptChoiceLexicalEvidence({
      masterKey,
      record: { ...encrypted, labelFingerprint: Buffer.alloc(32).toString('base64') },
    })).toBeNull()

    const key = Buffer.from(hkdfSync(
      'sha256', masterKey, Buffer.alloc(0),
      Buffer.from('lakoku/choice-invalid-capture/aes-256-gcm/v1'), 32,
    ))
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.nonce, 'base64'), { authTagLength: 16 })
    decipher.setAAD(Buffer.from(JSON.stringify({ version: 1, ...identity })))
    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8')
    expect(JSON.parse(plaintext)).toEqual({ label: 'Pikirkan pilihan terbaik' })

    const tampered = createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.nonce, 'base64'), { authTagLength: 16 })
    tampered.setAAD(Buffer.from(JSON.stringify({ version: 1, ...identity, index: 2 })))
    tampered.setAuthTag(Buffer.from(encrypted.authTag, 'base64'))
    expect(() => Buffer.concat([
      tampered.update(Buffer.from(encrypted.ciphertext, 'base64')),
      tampered.final(),
    ])).toThrow()
  })

  it('writes only when exact story and chapter match', async () => {
    const writer = vi.fn()
    const config = loadChoiceInvalidCaptureConfig(validEnv(), now)!
    const context = {
      userId: '10000000-0000-4000-8000-000000000001', storyId: 'story-exact', chapterNumber: 12,
      generationKind: 'standard' as const, jobId: null,
      correlationId: '20000000-0000-4000-8000-000000000002', attemptNumber: null,
    }
    await captureChoiceInvalidEvidence(context, {
      choices: [
        { index: 0, label: 'Pikirkan pilihan terbaik' },
        { index: 1, label: 'Label kedua tidak boleh ditulis' },
      ],
    }, { writer, loadConfig: () => config, createId: () => 'capture-1' })
    expect(writer).toHaveBeenCalledOnce()
    const writtenRecord = writer.mock.calls[0]?.[0]
    expect(writtenRecord).not.toHaveProperty('label')
    expect(decryptChoiceLexicalEvidence({ masterKey, record: writtenRecord }))
      .toBe('Pikirkan pilihan terbaik')

    await captureChoiceInvalidEvidence({ ...context, storyId: 'story-other' }, {
      choices: [{ index: 0, label: 'Rahasia' }],
    }, { writer, loadConfig: () => config })
    expect(writer).toHaveBeenCalledOnce()
  })
})
