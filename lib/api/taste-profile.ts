/**
 * API server-side untuk Taste Profile — baca/tulis ke Supabase.
 *
 * Fungsi di sini menerima `userId` dari pemanggil (server action/route)
 * yang sudah mendapatkan session user. Tidak menerima raw input dari client.
 *
 * Guest tidak punya baris di tabel ini — guest pakai localStorage fallback.
 */
import { createClient } from '@/lib/supabase/server'
import { TasteProfileSchema, type TasteProfile } from '@/lib/taste-profile/schema'

interface TasteProfileRow {
  taste_json: TasteProfile
}

function parseRow(row: TasteProfileRow | null): TasteProfile | null {
  if (!row) return null
  const parsed = TasteProfileSchema.safeParse(row.taste_json)
  return parsed.success ? parsed.data : null
}

/**
 * Ambil profile selera untuk user tertentu.
 * Return null jika user belum pernah menyimpan / data rusak.
 */
export async function getTasteProfileForUser(
  userId: string,
): Promise<TasteProfile | null> {
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
 * Simpan profile selera untuk user tertentu.
 * Upsert berdasarkan user_id — insert jika belum ada, update jika sudah ada.
 */
export async function saveTasteProfileForUser(
  userId: string,
  profile: TasteProfile,
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
