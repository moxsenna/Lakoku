import { z } from 'zod'

/**
 * Lakoku — Kontrak push notification (pure, tanpa side-effect).
 *
 * Satu kontrak untuk web & android: backend mengirim via FCM, client hanya
 * mendaftarkan/mencabut token lewat seam `lib/api/`.
 */

export const PushPlatformSchema = z.enum(['web', 'android'])
export type PushPlatform = z.infer<typeof PushPlatformSchema>

export const SubscribePushSchema = z.object({
  fcmToken: z.string().min(10).max(2000),
  platform: PushPlatformSchema,
})
export type SubscribePushInput = z.infer<typeof SubscribePushSchema>

export const UnsubscribePushSchema = z.object({
  fcmToken: z.string().min(10).max(2000),
})
export type UnsubscribePushInput = z.infer<typeof UnsubscribePushSchema>

export const PushAudienceSchema = z.union([
  z.literal('all'),
  z.literal('web'),
  z.literal('android'),
  z.string().regex(/^user:[0-9a-f-]{36}$/i),
])
export type PushAudience = z.infer<typeof PushAudienceSchema>

export const AdminSendPushSchema = z.object({
  title: z.string().min(1).max(60),
  body: z.string().min(1).max(160),
  audience: PushAudienceSchema,
  deepLink: z
    .string()
    .regex(/^\/[a-z0-9\-/_]*$/i)
    .optional(),
})
export type AdminSendPushInput = z.infer<typeof AdminSendPushSchema>

export interface PushPayload {
  title: string
  body: string
  deepLink?: string
}

/** Bentuk data FCM yang dikirim ke device (tanpa istilah internal). */
export function buildPushData(payload: PushPayload): Record<string, string> {
  const data: Record<string, string> = {}
  if (payload.deepLink) data.deep_link = payload.deepLink
  return data
}
