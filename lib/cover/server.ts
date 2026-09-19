import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Seam uang untuk sampul cerita.
 *
 * Mengikuti pola yang sudah dipakai buka bab: reserve -> capture/release.
 * Reservasi dipilih karena generate gambar bisa gagal di tengah; dengan
 * reserve, kegagalan penyedia mengembalikan Lakoin utuh tanpa perlu logika
 * refund terpisah.
 *
 * Nomor percobaan (`attempt`) DITURUNKAN DI DB, tidak pernah dari klien.
 * Kalau klien yang mengirim, tombol terklik dua kali jadi dua tagihan.
 */

export type ReserveCoverResult =
  | { ok: true; ref: string; cost: number; attempt: number }
  | { ok: false; reason: 'NOT_STORY_OWNER' | 'FEATURE_DISABLED' | 'INSUFFICIENT_CREDITS'; available?: number; required?: number }

type ReserveRpcPayload = {
  ok: boolean
  reason?: string
  ref?: string
  cost?: number
  attempt?: number
  available?: number
  required?: number
}

/** Tahan Lakoin sebelum memanggil penyedia. */
export async function reserveStoryCover(userId: string, storyId: string): Promise<ReserveCoverResult> {
  const db = createAdminClient()
  const { data, error } = await db.rpc('reserve_story_cover_v1', {
    p_user_id: userId,
    p_story_id: storyId,
  })
  if (error) throw new Error(`reserveStoryCover: ${error.message}`)

  const payload = data as ReserveRpcPayload
  if (payload.ok && payload.ref && typeof payload.cost === 'number' && typeof payload.attempt === 'number') {
    return { ok: true, ref: payload.ref, cost: payload.cost, attempt: payload.attempt }
  }

  const reason = payload.reason
  if (reason === 'NOT_STORY_OWNER' || reason === 'FEATURE_DISABLED' || reason === 'INSUFFICIENT_CREDITS') {
    return { ok: false, reason, available: payload.available, required: payload.required }
  }
  throw new Error(`reserveStoryCover: hasil tak terduga ${JSON.stringify(payload)}`)
}

export type CaptureCoverResult = 'ok' | 'duplicate' | 'expired' | 'not_found' | 'not_active' | 'wrong_kind'

/** Tagih reservasi setelah gambar benar-benar tersimpan. */
export async function captureStoryCover(ref: string): Promise<CaptureCoverResult> {
  const db = createAdminClient()
  const { data, error } = await db.rpc('capture_story_cover_reservation_v1', { p_ref: ref })
  if (error) throw new Error(`captureStoryCover: ${error.message}`)

  const status = String(data)
  if (
    status === 'ok' || status === 'duplicate' || status === 'expired' ||
    status === 'not_found' || status === 'not_active' || status === 'wrong_kind'
  ) {
    return status
  }
  throw new Error(`captureStoryCover: hasil tak terduga ${status}`)
}

/**
 * Kembalikan Lakoin saat generate gagal.
 *
 * Sengaja tidak melempar: dipanggil dari jalur penanganan error, dan kegagalan
 * release tidak boleh menutupi kesalahan aslinya. Reservasi yang tertinggal
 * tetap kedaluwarsa sendiri lewat TTL.
 */
export async function releaseStoryCover(ref: string): Promise<void> {
  try {
    const db = createAdminClient()
    await db.rpc('release_credit_reservation_v1', { p_ref: ref })
  } catch (error) {
    console.error('releaseStoryCover gagal', { ref, error })
  }
}

/** Pasang URL sampul baru; penjaga pemilik diulang di klausa update. */
export async function setStoryCover(storyId: string, userId: string, coverUrl: string): Promise<boolean> {
  const db = createAdminClient()
  const { error, count } = await db
    .from('stories')
    .update({ cover: coverUrl }, { count: 'exact' })
    .eq('id', storyId)
    .eq('owner_user_id', userId)

  if (error) throw new Error(`setStoryCover: ${error.message}`)
  return (count ?? 0) > 0
}

export type StoryCoverPolicy = { cost: number; enabled: boolean }

/**
 * Harga sampul dari feature_credit_costs, untuk ditampilkan apa adanya di UI.
 * Sumber kebenarannya satu: baris yang juga diedit dari dashboard admin.
 */
export async function getStoryCoverPolicy(): Promise<StoryCoverPolicy> {
  try {
    const db = createAdminClient()
    const { data } = await db
      .from('feature_credit_costs')
      .select('credits_required,is_active')
      .eq('feature_key', 'story_cover')
      .maybeSingle()

    if (!data || !data.is_active) return { cost: 0, enabled: false }
    return { cost: Number(data.credits_required), enabled: true }
  } catch (error) {
    console.error('getStoryCoverPolicy gagal', { error })
    return { cost: 0, enabled: false }
  }
}
