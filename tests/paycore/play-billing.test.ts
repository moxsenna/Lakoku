import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  loadPlayBillingConfig,
  isGrantablePurchase,
  type PlayPurchaseState,
} from '@/lib/paycore/play-billing.server'

function purchase(overrides: Partial<PlayPurchaseState> = {}): PlayPurchaseState {
  return {
    purchaseState: 0,
    consumptionState: 0,
    acknowledgementState: 1,
    orderId: 'GPA.3300-1234-5678',
    kind: 1,
    ...overrides,
  }
}

describe('play billing config (fail-closed)', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    delete process.env.GOOGLE_PLAY_BILLING_ENABLED
    delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL
    delete process.env.GOOGLE_PLAY_PRIVATE_KEY
    delete process.env.GOOGLE_PLAY_PACKAGE_NAME
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('null ketika kill switch tidak aktif meski kredensial lengkap', () => {
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL = 'sa@lakoku.iam.gserviceaccount.com'
    process.env.GOOGLE_PLAY_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nX\n-----END PRIVATE KEY-----'
    expect(loadPlayBillingConfig()).toBeNull()
  })

  it('null ketika kill switch aktif tapi kredensial kurang', () => {
    process.env.GOOGLE_PLAY_BILLING_ENABLED = '1'
    expect(loadPlayBillingConfig()).toBeNull()
  })

  it('konfigurasi terbaca ketika lengkap, packageName default biz.lakoku.app', () => {
    process.env.GOOGLE_PLAY_BILLING_ENABLED = '1'
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL = 'sa@lakoku.iam.gserviceaccount.com'
    process.env.GOOGLE_PLAY_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nX\n-----END PRIVATE KEY-----'
    const config = loadPlayBillingConfig()
    expect(config).not.toBeNull()
    expect(config?.packageName).toBe('biz.lakoku.app')
    expect(config?.serviceAccountEmail).toBe('sa@lakoku.iam.gserviceaccount.com')
  })

  it('packageName custom dihormati', () => {
    process.env.GOOGLE_PLAY_BILLING_ENABLED = '1'
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL = 'sa@lakoku.iam.gserviceaccount.com'
    process.env.GOOGLE_PLAY_PRIVATE_KEY = 'k'
    process.env.GOOGLE_PLAY_PACKAGE_NAME = 'biz.lakoku.app.staging'
    expect(loadPlayBillingConfig()?.packageName).toBe('biz.lakoku.app.staging')
  })
})

describe('isGrantablePurchase (fail-closed)', () => {
  it('purchased + belum dikonsumsi + one-time = grantable', () => {
    expect(isGrantablePurchase(purchase())).toBe(true)
  })

  it('purchaseState bukan 0 ditolak (canceled/pending)', () => {
    expect(isGrantablePurchase(purchase({ purchaseState: 1 }))).toBe(false)
    expect(isGrantablePurchase(purchase({ purchaseState: 2 }))).toBe(false)
  })

  it('sudah dikonsumsi ditolak', () => {
    expect(isGrantablePurchase(purchase({ consumptionState: 1 }))).toBe(false)
  })

  it('bukan one-time product ditolak', () => {
    expect(isGrantablePurchase(purchase({ kind: 2 }))).toBe(false)
  })

  it('acknowledged atau belum sama-sama boleh (ack bukan syarat grant)', () => {
    expect(isGrantablePurchase(purchase({ acknowledgementState: 0 }))).toBe(true)
  })
})
