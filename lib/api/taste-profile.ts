/**
 * API server-side untuk Taste Profile — baca/tulis ke Supabase (V2).
 *
 * Fungsi di sini menerima `userId` dari pemanggil (server action/route)
 * yang sudah mendapatkan session user. Tidak menerima raw input dari client.
 *
 * Guest tidak punya baris di tabel ini — guest pakai localStorage fallback.
 *
 * Migration-on-read: saat membaca dari DB, V1 profile di-migrate ke V2
 * sebelum dikembalikan. Penyimpanan selalu V2.
 */
import { createClient } from '@/lib/supabase/server'
import {
  normalizeTasteProfile,
  TasteProfileV2Schema,
  type TasteProfileV2,
} from '@/lib/taste-profile/schema'

interface TasteProfileRow {
  taste_json: unknown
}

function parseRow(row: TasteProfileRow | null): TasteProfileV2 | null {
  if (!row) return null
  // normalizeTasteProfile auto-migrates V1 to V2
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
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('reader_taste_profiles')
    .select('taste_json')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('[taste-profile] getTasteProfileForUser error:', error.message)
    return null
  }

  return parseRow(data as TasteProfileRow | null)
}

/**
 * Simpan profile selera untuk user tertentu (V2).
 * Upsert berdasarkan user_id — insert jika belum ada, update jika sudah ada.
 */
export async function saveTasteProfileForUser(
  userId: string,
  profile: TasteProfileV2,
): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('reader_taste_profiles')
    .upsert(
      {
        user_id: userId,
        taste_json: profile as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )

  if (error) {
    console.error('[taste-profile] saveTasteProfileForUser error:', error.message)
  }
}
