import 'server-only'
import { getDb, rpcOne, single } from '@lakoku/db'
import { coverKeyFromPublicUrl, resolveStoryCover } from '@/lib/cover/url'

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
  | { ok: true; ref: string; cost: number; attempt: number; replayed?: boolean }
  | { ok: false; reason: 'NOT_STORY_OWNER' | 'FEATURE_DISABLED' | 'INSUFFICIENT_CREDITS'; available?: number; required?: number }

type ReserveRpcPayload = {
  ok: boolean
  reason?: string
  ref?: string
  cost?: number
  attempt?: number
  available?: number
  required?: number
  replayed?: boolean
}

/** Tahan Lakoin sebelum memanggil penyedia. */
export async function reserveStoryCover(userId: string, storyId: string): Promise<ReserveCoverResult> {
  // RLS_AUDIT: reserve_story_cover_v1 memvalidasi kepemilikan cerita dan menahan saldo pengguna
  const db = getDb()
  const { data, error } = await single(
    rpcOne(db, 'reserve_story_cover_v1', {
      p_user_id: userId,
      p_story_id: storyId,
    }).execute()
  )
  if (error) throw new Error(`reserveStoryCover: ${error.message}`)

  const raw = (data as Record<string, unknown> | null)?.fn ?? data
  const payload = raw as ReserveRpcPayload
  if (payload.ok && payload.ref && typeof payload.cost === 'number' && typeof payload.attempt === 'number') {
    return {
      ok: true,
      ref: payload.ref,
      cost: payload.cost,
      attempt: payload.attempt,
      replayed: Boolean(payload.replayed),
    }
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
  // RLS_AUDIT: capture_story_cover_reservation_v1 menyelesaikan tagihan reservasi
  const db = getDb()
  const { data, error } = await single(
    rpcOne(db, 'capture_story_cover_reservation_v1', { p_ref: ref }).execute()
  )
  if (error) throw new Error(`captureStoryCover: ${error.message}`)

  const raw = (data as Record<string, unknown> | null)?.fn ?? data
  const status = String(raw)
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
    // RLS_AUDIT: release_credit_reservation_v1 mengembalikan reservasi yang gagal
    const db = getDb()
    await rpcOne(db, 'release_credit_reservation_v1', { p_ref: ref }).execute()
  } catch (error) {
    console.error('releaseStoryCover gagal', { ref, error })
  }
}

/**
 * Pasang sampul baru; penjaga pemilik diulang di klausa update.
 * Input bisa object key (dari putCover) atau URL publik (dari kandidat);
 * URL milik base publik kita dinormalisasi kembali menjadi key supaya
 * stories.cover selalu konsisten menyimpan key.
 */
export async function setStoryCover(storyId: string, userId: string, coverPath: string): Promise<boolean> {
  const db = getDb()
  const cover = coverKeyFromPublicUrl(coverPath) ?? coverPath
  // RLS_AUDIT: stories diupdate oleh pemilik cerita (owner_user_id = userId)
  const result = await db
    .updateTable('stories')
    .set({ cover })
    .where('id', '=', storyId)
    .where('owner_user_id', '=', userId)
    .executeTakeFirst()

  return Number(result.numUpdatedRows) > 0
}

export type StoryCoverCandidate = {
  id: string
  url: string
  preset: string
  createdAt: string
  expiresAt: string
}

/** Catat kandidat sampul baru, pangkas expired, dan tahan maksimal 3 sampul per cerita. */
export async function recordStoryCoverCandidate(
  storyId: string,
  userId: string,
  payload: { url: string; preset?: string },
): Promise<void> {
  try {
    // RLS_AUDIT: record_story_cover_candidate_v1 menyimpan kandidat sampul cerita
    const db = getDb()
    const { error } = await single(
      rpcOne(db, 'record_story_cover_candidate_v1', {
        p_story_id: storyId,
        p_user_id: userId,
        p_url: payload.url,
        p_preset: payload.preset || 'sinematik',
      }).execute()
    )
    if (error) {
      console.error('recordStoryCoverCandidate rpc error', { storyId, error: error.message })
    }
  } catch (error) {
    console.error('recordStoryCoverCandidate gagal', { storyId, error })
  }
}

/** Ambil hingga 3 kandidat sampul yang belum kedaluwarsa. */
export async function getStoryCoverCandidates(
  storyId: string,
  userId: string,
): Promise<StoryCoverCandidate[]> {
  try {
    // RLS_AUDIT: story_cover_candidates difilter per story_id dan user_id
    const db = getDb()
    const rows = await db
      .selectFrom('story_cover_candidates')
      .select(['id', 'url', 'preset', 'created_at', 'expires_at'])
      .where('story_id', '=', storyId)
      .where('user_id', '=', userId)
      .where('expires_at', '>', new Date())
      .orderBy('created_at', 'desc')
      .limit(3)
      .execute()

    return rows.map((r) => ({
      id: String(r.id),
      url: resolveStoryCover(String(r.url)),
      preset: String(r.preset),
      createdAt: String(r.created_at),
      expiresAt: String(r.expires_at),
    }))
  } catch (error) {
    console.error('getStoryCoverCandidates gagal', { storyId, error })
    return []
  }
}

export type StoryCoverPolicy = {
  cost: number
  enabled: boolean
  basePromptOverride?: string
}

/**
 * Harga sampul dari feature_credit_costs, untuk ditampilkan apa adanya di UI.
 * Sumber kebenarannya satu: baris yang juga diedit dari dashboard admin.
 */
export async function getStoryCoverPolicy(): Promise<StoryCoverPolicy> {
  try {
    // RLS_AUDIT: feature_credit_costs konfigurasi publik biaya fitur
    const db = getDb()
    const { data } = await single(
      db
        .selectFrom('feature_credit_costs')
        .select(['credits_required', 'is_active', 'metadata'])
        .where('feature_key', '=', 'story_cover')
        .execute()
    )

    if (!data || !data.is_active) return { cost: 0, enabled: false }
    const meta = data.metadata as { basePromptOverride?: string } | null
    return {
      cost: Number(data.credits_required),
      enabled: true,
      basePromptOverride: typeof meta?.basePromptOverride === 'string' ? meta.basePromptOverride : undefined,
    }
  } catch (error) {
    console.error('getStoryCoverPolicy gagal', { error })
    return { cost: 0, enabled: false }
  }
}
