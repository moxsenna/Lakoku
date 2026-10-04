/**
 * API server-side untuk Taste Profile — baca/tulis ke Supabase (V2).
 *
 * Fungsi di sini menerima `userId` dari pemanggil (server action/route)
 * yang sudah mendapatkan session user. Tidak menerima raw input dari client.
 *
 * Guest tidak punya baris di tabel ini — guest pakai localStorage fallback.
 *
 * Migration-on-read: saat membaca dari DB, V1 profile di-migrate ke V2
 * sebelum dikembalikan. Penyimpanan selalu V2 JSON.
 */
import { getDb, single, result } from '@lakoku/db'
import type { Json } from '@/lib/supabase/db-types'
import {
  normalizeTasteProfile,
  type TasteProfileV2,
} from '@/lib/taste-profile/schema'

interface TasteProfileRow {
  taste_json: unknown
}

/**
 * Parse DB row → V2. Migration-on-read for V1-shaped taste_json.
 * Invalid/empty row → null (not empty profile).
 */
function parseRow(row: TasteProfileRow | null): TasteProfileV2 | null {
  if (!row || row.taste_json == null) return null
  const profile = normalizeTasteProfile(row.taste_json)
  return profile.version === 2 ? profile : null
}

/**
 * Ambil profile selera untuk user tertentu.
 * Auto-migrates V1 → V2 on read. Return null jika user belum pernah menyimpan / data rusak.
 */
export async function getTasteProfileForUser(
  userId: string,
): Promise<TasteProfileV2 | null> {
  const db = getDb()

  // RLS_AUDIT: reader_taste_profiles_select_self
  const { data, error } = await single(
    db
      .selectFrom('reader_taste_profiles')
      .select('taste_json')
      .where('user_id', '=', userId)
      .limit(1)
      .execute(),
  )

  if (error) {
    console.error('[taste-profile] getTasteProfileForUser error:', error.message)
    return null
  }

  return parseRow(data as TasteProfileRow | null)
}

/**
 * Simpan profile selera untuk user tertentu (V2).
 * Normalize first so accidental V1 payload still stored as V2.
 * Upsert berdasarkan user_id — insert jika belum ada, update jika sudah ada.
 */
export async function saveTasteProfileForUser(
  userId: string,
  profile: TasteProfileV2,
): Promise<void> {
  const db = getDb()
  const toStore = normalizeTasteProfile(profile)

  // RLS_AUDIT: reader_taste_profiles_insert_self, reader_taste_profiles_update_self
  const { error } = await result(
    db
      .insertInto('reader_taste_profiles')
      .values({
        user_id: userId,
        taste_json: toStore as unknown as Json,
        updated_at: new Date().toISOString(),
      })
      .onConflict((oc) =>
        oc.column('user_id').doUpdateSet({
          taste_json: toStore as unknown as Json,
          updated_at: new Date().toISOString(),
        }),
      )
      .execute(),
  )

  if (error) {
    console.error('[taste-profile] saveTasteProfileForUser error:', error.message)
  }
}
