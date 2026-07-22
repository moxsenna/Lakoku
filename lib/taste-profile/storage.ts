/**
 * localStorage helper untuk Taste Profile guest.
 *
 * Key versioned to avoid conflicts. Profile disimpan sebagai JSON mentah;
 * validasi terjadi saat dibaca (normalizeTasteProfile auto-migrates V1).
 */
import { TasteProfileV2Schema, normalizeTasteProfile, type TasteProfileV2 } from './schema'

export const TASTE_PROFILE_STORAGE_KEY = 'lakoku:taste-profile:v2'

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  return window.localStorage
}

/**
 * Baca profile guest dari localStorage.
 *
 * Fail-safe: return null untuk SEMUA kasus error — localStorage rusak,
 * JSON invalid, schema tidak cocok, field tidak lengkap. Jangan pernah
 * biarkan parse error menjatuhkan /mulai. Onboarding tetap jalan normal.
 */
export function readGuestTasteProfile(): TasteProfileV2 | null {
  const storage = getStorage()
  if (!storage) return null

  try {
    const raw = storage.getItem(TASTE_PROFILE_STORAGE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null

    // normalizeTasteProfile handles both V1 and V2, auto-migrating
    const profile = normalizeTasteProfile(parsed)
    return profile.version === 2 ? profile : null
  } catch {
    // JSON rusak, key corrupt, dsb. — jangan ganggu UX.
    return null
  }
}

/** Simpan profile guest ke localStorage. */
export function saveGuestTasteProfile(profile: TasteProfileV2): void {
  const storage = getStorage()
  if (!storage) return

  try {
    storage.setItem(TASTE_PROFILE_STORAGE_KEY, JSON.stringify(profile))
  } catch {
    // Best-effort: jangan blokir UX jika storage penuh/tidak tersedia.
  }
}

/** Hapus profile guest dari localStorage. */
export function clearGuestTasteProfile(): void {
  const storage = getStorage()
  if (!storage) return

  try {
    storage.removeItem(TASTE_PROFILE_STORAGE_KEY)
  } catch {
    // Best-effort.
  }
}
