/**
 * localStorage helper untuk Taste Profile guest.
 *
 * Dual-read: v2 key dulu, fallback v1. Baca selalu lewat normalize/migrate → V2.
 * Tulis selalu V2 JSON ke v2 key. Draft partial di key terpisah.
 */
import {
  normalizeTasteProfile,
  type TasteProfileV2,
} from './schema'

/** Canonical guest profile key (V2). */
export const TASTE_PROFILE_STORAGE_KEY = 'lakoku:taste-profile:v2'
/** Legacy guest profile key (V1) — dual-read only. */
export const TASTE_PROFILE_STORAGE_KEY_V1 = 'lakoku:taste-profile:v1'
/** Partial draft while user still filling onboarding. */
export const TASTE_PROFILE_DRAFT_KEY = 'lakoku:taste-profile-draft:v2'

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  return window.localStorage
}

function parseRaw(raw: string | null): unknown | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Baca profile guest dari localStorage.
 *
 * Dual-read: v2 → v1. Fail-safe: null untuk semua error.
 * normalizeTasteProfile auto-migrates V1 → V2.
 */
export function readGuestTasteProfile(): TasteProfileV2 | null {
  const storage = getStorage()
  if (!storage) return null

  try {
    const rawV2 = parseRaw(storage.getItem(TASTE_PROFILE_STORAGE_KEY))
    if (rawV2) {
      const profile = normalizeTasteProfile(rawV2)
      // Only treat as present if it has any completion/skip signal or prefs
      return profile
    }

    const rawV1 = parseRaw(storage.getItem(TASTE_PROFILE_STORAGE_KEY_V1))
    if (rawV1) {
      return normalizeTasteProfile(rawV1)
    }

    return null
  } catch {
    return null
  }
}

/** Simpan profile guest sebagai V2 JSON. */
export function saveGuestTasteProfile(profile: TasteProfileV2): void {
  const storage = getStorage()
  if (!storage) return

  try {
    const normalized = normalizeTasteProfile(profile)
    storage.setItem(TASTE_PROFILE_STORAGE_KEY, JSON.stringify(normalized))
    // Leave v1 in place so old tabs still dual-read until clear; new writes win on v2.
  } catch {
    // Best-effort.
  }
}

/** Hapus profile guest (v2 + v1) dari localStorage. */
export function clearGuestTasteProfile(): void {
  const storage = getStorage()
  if (!storage) return

  try {
    storage.removeItem(TASTE_PROFILE_STORAGE_KEY)
    storage.removeItem(TASTE_PROFILE_STORAGE_KEY_V1)
  } catch {
    // Best-effort.
  }
}

/**
 * Partial draft — boleh object belum lengkap.
 * Disimpan apa adanya; baca mengembalikan partial object (bukan full V2).
 */
export type TasteProfileDraft = Partial<TasteProfileV2> & {
  version?: 2
}

/** Baca draft partial. Null jika kosong/rusak. */
export function readTasteDraft(): TasteProfileDraft | null {
  const storage = getStorage()
  if (!storage) return null

  try {
    const raw = parseRaw(storage.getItem(TASTE_PROFILE_DRAFT_KEY))
    if (!raw || typeof raw !== 'object') return null
    return raw as TasteProfileDraft
  } catch {
    return null
  }
}

/** Simpan draft partial (overwrite). */
export function saveTasteDraft(draft: TasteProfileDraft): void {
  const storage = getStorage()
  if (!storage) return

  try {
    const payload = {
      ...draft,
      version: 2 as const,
      updatedAt: new Date().toISOString(),
    }
    storage.setItem(TASTE_PROFILE_DRAFT_KEY, JSON.stringify(payload))
  } catch {
    // Best-effort.
  }
}

/** Hapus draft partial. */
export function clearTasteDraft(): void {
  const storage = getStorage()
  if (!storage) return

  try {
    storage.removeItem(TASTE_PROFILE_DRAFT_KEY)
  } catch {
    // Best-effort.
  }
}
