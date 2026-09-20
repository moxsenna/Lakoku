'use server'

import { requireAdminUser } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminSendPushSchema } from '@/lib/notifications/index'
import { dispatchPush } from '@/lib/notifications/server'

/**
 * Aksi server halaman Siaran: dijaga RBAC admin (layout), bukan token browser.
 * Route /api/admin/push/send tetap ada untuk otomasi ops bertoken.
 */

export interface BroadcastResult {
  ok: boolean
  error?: string
  status?: string
  successCount?: number
  failureCount?: number
}

export async function sendBroadcast(input: unknown): Promise<BroadcastResult> {
  const admin = await requireAdminUser().catch(() => null)
  if (!admin) return { ok: false, error: 'Tidak diizinkan.' }

  const parsed = AdminSendPushSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Data siaran tidak valid.' }

  try {
    const result = await dispatchPush({
      audience: parsed.data.audience,
      payload: {
        title: parsed.data.title,
        body: parsed.data.body,
        deepLink: parsed.data.deepLink,
      },
      sentBy: admin.id,
    })
    return { ok: true, ...result }
  } catch {
    return { ok: false, error: 'Gagal mengirim siaran.' }
  }
}

export interface DeviceSummary {
  total: number
  web: number
  android: number
}

export async function getDeviceSummary(): Promise<DeviceSummary> {
  const admin = await requireAdminUser().catch(() => null)
  if (!admin) return { total: 0, web: 0, android: 0 }
  try {
    const client = createAdminClient()
    const { data } = await client.from('push_devices').select('platform')
    const rows = (data ?? []) as Array<{ platform: string }>
    return {
      total: rows.length,
      web: rows.filter((r) => r.platform === 'web').length,
      android: rows.filter((r) => r.platform === 'android').length,
    }
  } catch {
    return { total: 0, web: 0, android: 0 }
  }
}
