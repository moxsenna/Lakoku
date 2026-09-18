import { describe, expect, it } from 'vitest'

import {
  buildVerifyBody,
  interpretOrderError,
  interpretVerifyResponse,
  purchaseResultMessage,
} from '@/lib/play-billing/purchase-client'

describe('buildVerifyBody', () => {
  it('membawa productId + purchaseToken, orderId opsional', () => {
    expect(
      buildVerifyBody({ productId: 'lakoku_credits_starter', purchaseToken: 'tok_123', orderId: 'GPA.1' }),
    ).toEqual({ productId: 'lakoku_credits_starter', purchaseToken: 'tok_123', orderId: 'GPA.1' })
  })

  it('menghilangkan orderId kosong (tidak mengirim field liar)', () => {
    const body = buildVerifyBody({ productId: 'lakoku_credits_pro', purchaseToken: 'tok_9', orderId: null })
    expect(body).toEqual({ productId: 'lakoku_credits_pro', purchaseToken: 'tok_9' })
    expect('orderId' in body).toBe(false)
  })

  it('memangkas spasi productId', () => {
    expect(
      buildVerifyBody({ productId: '  lakoku_credits_max  ', purchaseToken: 't', orderId: null }).productId,
    ).toBe('lakoku_credits_max')
  })
})

describe('interpretVerifyResponse', () => {
  it('sukses dengan total + alreadyGranted', () => {
    expect(
      interpretVerifyResponse({ ok: true, totalCredits: 130, alreadyGranted: true }),
    ).toEqual({ ok: true, totalCredits: 130, alreadyGranted: true })
  })

  it('sukses tanpa alreadyGranted = false', () => {
    expect(interpretVerifyResponse({ ok: true, totalCredits: 30 })).toEqual({
      ok: true,
      totalCredits: 30,
      alreadyGranted: false,
    })
  })

  it('gagal membawa kode error server', () => {
    expect(interpretVerifyResponse({ ok: false, error: 'purchase_not_grantable' })).toEqual({
      ok: false,
      error: 'purchase_not_grantable',
    })
  })

  it('respons malformed ditolak (bukan sukses vakum)', () => {
    expect(interpretVerifyResponse(null)).toEqual({ ok: false, error: 'invalid_response' })
    expect(interpretVerifyResponse({ ok: true })).toEqual({ ok: false, error: 'verification_failed' })
    expect(interpretVerifyResponse('ok')).toEqual({ ok: false, error: 'invalid_response' })
  })
})

describe('interpretOrderError', () => {
  it('cancel terdeteksi dari berbagai bentuk kode', () => {
    expect(interpretOrderError('PAYMENT_CANCELLED')).toEqual({ ok: false, error: 'cancelled' })
    expect(interpretOrderError('user cancelled')).toEqual({ ok: false, error: 'cancelled' })
  })

  it('selain cancel = failed', () => {
    expect(interpretOrderError('BILLING_UNAVAILABLE')).toEqual({ ok: false, error: 'failed' })
    expect(interpretOrderError(null)).toEqual({ ok: false, error: 'failed' })
    expect(interpretOrderError(undefined)).toEqual({ ok: false, error: 'failed' })
  })
})

describe('purchaseResultMessage', () => {
  it('sukses menampilkan jumlah kredit', () => {
    expect(purchaseResultMessage({ ok: true, totalCredits: 130, alreadyGranted: false })).toContain('+130')
  })

  it('replay dijelaskan tanpa grant ganda', () => {
    expect(purchaseResultMessage({ ok: true, totalCredits: 130, alreadyGranted: true })).toContain('sebelumnya')
  })

  it('cancel = diam (null)', () => {
    expect(purchaseResultMessage({ ok: false, error: 'cancelled' })).toBeNull()
  })

  it('gagal verifikasi/jaringan/umum punya pesan', () => {
    expect(purchaseResultMessage({ ok: false, error: 'verification_failed' })).toBeTruthy()
    expect(purchaseResultMessage({ ok: false, error: 'network_error' })).toBeTruthy()
    expect(purchaseResultMessage({ ok: false, error: 'failed' })).toBeTruthy()
  })
})
