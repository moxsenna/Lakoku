import 'server-only'

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'

const VERSION = 1 as const
const AES_KEY_INFO = Buffer.from('lakoku/choice-invalid-capture/aes-256-gcm/v1', 'utf8')
const HMAC_KEY_INFO = Buffer.from('lakoku/choice-invalid-capture/label-hmac/v1', 'utf8')
const EMPTY_SALT = Buffer.alloc(0)

export type ChoiceInvalidCaptureIdentity = Readonly<{
  id: string
  correlationId: string
  storyId: string
  chapterNumber: number
  index: number
  stage: 'FINAL_BRANCH_SCHEMA'
  code: 'CHOICE_NOT_ACTIONABLE'
  expiresAt: string
}>

export type EncryptedChoiceLexicalEvidence = ChoiceInvalidCaptureIdentity & Readonly<{
  incidentKey: string
  version: number
  nonce: string
  ciphertext: string
  authTag: string
  labelFingerprint: string
}>

function canonicalTimestamp(value: string): string {
  return new Date(value).toISOString()
}

function aad(identity: ChoiceInvalidCaptureIdentity): Buffer {
  return Buffer.from(JSON.stringify({
    version: VERSION,
    id: identity.id,
    correlationId: identity.correlationId,
    storyId: identity.storyId,
    chapterNumber: identity.chapterNumber,
    index: identity.index,
    stage: identity.stage,
    code: identity.code,
    expiresAt: canonicalTimestamp(identity.expiresAt),
  }), 'utf8')
}

function deriveKey(masterKey: Uint8Array, info: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, EMPTY_SALT, info, 32))
}

export function decryptChoiceLexicalEvidence(args: Readonly<{
  masterKey: Uint8Array
  record: EncryptedChoiceLexicalEvidence
}>): string | null {
  if (args.masterKey.byteLength !== 32 || args.record.version !== VERSION) return null
  try {
    const nonce = Buffer.from(args.record.nonce, 'base64')
    const authTag = Buffer.from(args.record.authTag, 'base64')
    if (nonce.length !== 12 || authTag.length !== 16) return null
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(args.masterKey, AES_KEY_INFO), nonce, { authTagLength: 16 })
    decipher.setAAD(aad(args.record))
    decipher.setAuthTag(authTag)
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(args.record.ciphertext, 'base64')),
      decipher.final(),
    ])
    const parsed: unknown = JSON.parse(plaintext.toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || typeof (parsed as { label?: unknown }).label !== 'string') return null
    const label = (parsed as { label: string }).label
    const expected = createHmac('sha256', deriveKey(args.masterKey, HMAC_KEY_INFO)).update(label, 'utf8').digest()
    const actual = Buffer.from(args.record.labelFingerprint, 'base64')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
    return label
  } catch {
    return null
  }
}

export function encryptChoiceLexicalEvidence(args: Readonly<{
  masterKey: Uint8Array
  identity: ChoiceInvalidCaptureIdentity
  label: string
  nonce?: Uint8Array
}>): EncryptedChoiceLexicalEvidence {
  if (args.masterKey.byteLength !== 32) throw new Error('CHOICE_INVALID_CAPTURE_KEY_INVALID')
  const nonce = args.nonce === undefined ? randomBytes(12) : Buffer.from(args.nonce)
  if (nonce.byteLength !== 12) throw new Error('CHOICE_INVALID_CAPTURE_NONCE_INVALID')

  const encryptionKey = deriveKey(args.masterKey, AES_KEY_INFO)
  const fingerprintKey = deriveKey(args.masterKey, HMAC_KEY_INFO)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce, { authTagLength: 16 })
  cipher.setAAD(aad(args.identity))
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ label: args.label }), 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()
  if (authTag.byteLength !== 16) throw new Error('CHOICE_INVALID_CAPTURE_TAG_INVALID')

  return {
    incidentKey: createHmac('sha256', fingerprintKey).update(JSON.stringify({
      version: VERSION,
      storyId: args.identity.storyId,
      chapterNumber: args.identity.chapterNumber,
      stage: args.identity.stage,
      code: args.identity.code,
    }), 'utf8').digest('base64url'),
    version: VERSION,
    ...args.identity,
    nonce: nonce.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: authTag.toString('base64'),
    labelFingerprint: createHmac('sha256', fingerprintKey).update(args.label, 'utf8').digest('base64'),
  }
}
