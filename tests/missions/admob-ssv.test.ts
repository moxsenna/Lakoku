import { describe, it, expect } from 'vitest'
import { createSign, generateKeyPairSync } from 'node:crypto'
import {
  extractSignedMessage,
  parseSsvQuery,
  readRawParam,
  verifySignature,
} from '@/lib/missions/admob-ssv'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

function sign(message: string): string {
  const signer = createSign('SHA256')
  signer.update(message)
  signer.end()
  return signer.sign(privateKey).toString('base64url')
}

function buildQuery(over: Record<string, string> = {}): string {
  const base: Record<string, string> = {
    ad_network: '5450213213286189855',
    ad_unit: '1234567890',
    custom_data: 'lakoku',
    reward_amount: '1',
    reward_item: 'kredit',
    timestamp: '1758182400000',
    transaction_id: 'abc123def456',
    user_id: '11111111-1111-4111-8111-111111111111',
    key_id: '3335741209',
    ...over,
  }
  const message = Object.entries(base)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')
  return `${message}&signature=${sign(message)}`
}

describe('extractSignedMessage', () => {
  it('memotong tepat sebelum &signature=', () => {
    expect(extractSignedMessage('a=1&b=2&signature=XYZ')).toBe('a=1&b=2')
  })

  it('mengembalikan null bila tanda tangan tidak ada', () => {
    expect(extractSignedMessage('a=1&b=2')).toBeNull()
  })

  it('mengembalikan null bila querystring diawali signature', () => {
    expect(extractSignedMessage('&signature=XYZ')).toBeNull()
  })

  it('mempertahankan encoding mentah apa adanya', () => {
    const raw = 'custom_data=a%2Bb%20c&timestamp=1&signature=Z'
    expect(extractSignedMessage(raw)).toBe('custom_data=a%2Bb%20c&timestamp=1')
  })
})

describe('readRawParam', () => {
  it('membaca nilai dan mendekode persen', () => {
    expect(readRawParam('custom_data=a%20b&x=1', 'custom_data')).toBe('a b')
  })

  it('mengembalikan null untuk kunci yang tidak ada', () => {
    expect(readRawParam('a=1', 'b')).toBeNull()
  })

  it('tidak salah cocok pada awalan kunci', () => {
    expect(readRawParam('user_id_extra=9&user_id=7', 'user_id')).toBe('7')
  })
})

describe('verifySignature', () => {
  it('menerima tanda tangan sah', () => {
    const raw = buildQuery()
    const message = extractSignedMessage(raw)
    expect(message).not.toBeNull()
    expect(
      verifySignature({
        message: message as string,
        signatureBase64Url: readRawParam(raw, 'signature') as string,
        publicKeyPem,
      }),
    ).toBe(true)
  })

  it('menolak saat pesan diubah satu karakter', () => {
    const raw = buildQuery()
    const message = extractSignedMessage(raw) as string
    expect(
      verifySignature({
        message: message.replace('reward_amount=1', 'reward_amount=9'),
        signatureBase64Url: readRawParam(raw, 'signature') as string,
        publicKeyPem,
      }),
    ).toBe(false)
  })

  it('menolak tanda tangan palsu', () => {
    const raw = buildQuery()
    expect(
      verifySignature({
        message: extractSignedMessage(raw) as string,
        signatureBase64Url: Buffer.from('palsu').toString('base64url'),
        publicKeyPem,
      }),
    ).toBe(false)
  })

  it('menolak kunci publik yang salah bentuk tanpa melempar', () => {
    const raw = buildQuery()
    expect(
      verifySignature({
        message: extractSignedMessage(raw) as string,
        signatureBase64Url: readRawParam(raw, 'signature') as string,
        publicKeyPem: 'bukan-pem',
      }),
    ).toBe(false)
  })

  it('menolak tanda tangan dari kunci lain', () => {
    const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const otherPem = other.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const raw = buildQuery()
    expect(
      verifySignature({
        message: extractSignedMessage(raw) as string,
        signatureBase64Url: readRawParam(raw, 'signature') as string,
        publicKeyPem: otherPem,
      }),
    ).toBe(false)
  })
})

describe('parseSsvQuery', () => {
  it('mengurai callback lengkap', () => {
    const result = parseSsvQuery(buildQuery())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.callback.transactionId).toBe('abc123def456')
    expect(result.callback.userId).toBe('11111111-1111-4111-8111-111111111111')
    expect(result.callback.adUnit).toBe('1234567890')
    expect(result.callback.rewardAmount).toBe(1)
    expect(result.callback.timestampMs).toBe(1758182400000)
    expect(result.callback.keyId).toBe('3335741209')
  })

  it('menandai querystring tanpa tanda tangan sebagai malformed', () => {
    const result = parseSsvQuery('a=1&b=2')
    expect(result).toEqual({ ok: false, reason: 'malformed' })
  })

  it('menandai field wajib yang hilang', () => {
    const result = parseSsvQuery('ad_unit=1&timestamp=2&signature=Z')
    expect(result).toEqual({ ok: false, reason: 'missing_fields' })
  })

  it('pesan tertandatangani yang diurai dapat diverifikasi', () => {
    const raw = buildQuery()
    const result = parseSsvQuery(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(
      verifySignature({
        message: result.signedMessage,
        signatureBase64Url: result.callback.signature,
        publicKeyPem,
      }),
    ).toBe(true)
  })
})
