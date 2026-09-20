import {
  SubscribePushSchema,
  UnsubscribePushSchema,
  type PushPlatform,
} from '@/lib/notifications/index'

/**
 * Lakoku — Seam push sisi BROWSER (bagian dari LD-CONTRACT-SEAM).
 *
 * Komponen hanya memanggil dua fungsi ini. Token FCM diperoleh dari
 * Firebase JS SDK (web) atau bridge native (android), lalu didaftarkan
 * ke backend. Tidak ada secret di sini.
 */

const API_BASE = '/api'

export type SubscribePushResult = { ok: true } | { ok: false; error: string }

/** Daftarkan token perangkat milik user yang sedang login. */
export async function subscribePush(
  fcmToken: string,
  platform: PushPlatform,
): Promise<SubscribePushResult> {
  const parsed = SubscribePushSchema.safeParse({ fcmToken, platform })
  if (!parsed.success) return { ok: false, error: 'Data perangkat tidak valid.' }
  const res = await fetch(`${API_BASE}/push/subscribe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parsed.data),
  })
  if (!res.ok) return { ok: false, error: 'Gagal menyalakan pengingat.' }
  return { ok: true }
}

/** Cabut token perangkat (mis. saat logout atau izin dicabut). */
export async function unsubscribePush(fcmToken: string): Promise<SubscribePushResult> {
  const parsed = UnsubscribePushSchema.safeParse({ fcmToken })
  if (!parsed.success) return { ok: false, error: 'Data perangkat tidak valid.' }
  const res = await fetch(`${API_BASE}/push/unsubscribe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parsed.data),
  })
  if (!res.ok) return { ok: false, error: 'Gagal mematikan pengingat.' }
  return { ok: true }
}
