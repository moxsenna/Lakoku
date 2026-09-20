import { describe, expect, it } from 'vitest'
import {
  AdminSendPushSchema,
  PushAudienceSchema,
  PushPlatformSchema,
  SubscribePushSchema,
  buildPushData,
} from './index'

describe('push contracts', () => {
  it('menerima platform web dan android, menolak selain itu', () => {
    expect(PushPlatformSchema.safeParse('web').success).toBe(true)
    expect(PushPlatformSchema.safeParse('android').success).toBe(true)
    expect(PushPlatformSchema.safeParse('ios').success).toBe(false)
  })

  it('menolak token kosong dan platform tak dikenal saat subscribe', () => {
    expect(SubscribePushSchema.safeParse({ fcmToken: 'x', platform: 'web' }).success).toBe(
      false,
    )
    expect(
      SubscribePushSchema.safeParse({ fcmToken: 'token-valid-12345', platform: 'sms' })
        .success,
    ).toBe(false)
    expect(
      SubscribePushSchema.safeParse({ fcmToken: 'token-valid-12345', platform: 'web' })
        .success,
    ).toBe(true)
  })

  it('audiens user memakai format user:<uuid>', () => {
    expect(PushAudienceSchema.safeParse('all').success).toBe(true)
    expect(
      PushAudienceSchema.safeParse('user:123e4567-e89b-12d3-a456-426614174000').success,
    ).toBe(true)
    expect(PushAudienceSchema.safeParse('user:bukan-uuid').success).toBe(false)
  })

  it('siaran admin menolak judul/isi kosong dan tautan absolut', () => {
    const base = { title: 'Halo', body: 'Ada kabar', audience: 'all' as const }
    expect(AdminSendPushSchema.safeParse(base).success).toBe(true)
    expect(
      AdminSendPushSchema.safeParse({ ...base, title: '' }).success,
    ).toBe(false)
    expect(
      AdminSendPushSchema.safeParse({ ...base, deepLink: 'https://x.com/y' }).success,
    ).toBe(false)
    expect(
      AdminSendPushSchema.safeParse({ ...base, deepLink: '/baca/abc/1' }).success,
    ).toBe(true)
  })

  it('data FCM hanya membawa deep_link, tanpa istilah internal', () => {
    expect(buildPushData({ title: 't', body: 'b' })).toEqual({})
    expect(
      buildPushData({ title: 't', body: 'b', deepLink: '/kredit' }),
    ).toEqual({ deep_link: '/kredit' })
  })
})
