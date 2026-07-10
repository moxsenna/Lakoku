'use server'

/**
 * Server actions untuk /onboarding/selera — simpan, baca, skip, merge Taste Profile.
 */
import {
  getTasteProfileForUser,
  saveTasteProfileForUser,
} from '@/lib/api/taste-profile'
import {
  TasteProfileSchema,
  createDefaultTasteProfile,
  mergeTasteProfiles,
  type TasteProfile,
} from '@/lib/taste-profile/schema'
import { readGuestTasteProfile } from '@/lib/taste-profile/storage'

type ActionOk = { ok: true }
type ActionError = { ok: false; error: string }
type ActionResult = ActionOk | ActionError

// ── Simpan profile penuh ──────────────────────────────────────────

export async function actSaveTasteProfile(
  rawInput: unknown,
): Promise<ActionResult> {
  try {
    const profile = TasteProfileSchema.parse(rawInput)

    const { getSessionUser } = await import('@/lib/api/user-state')
    const user = await getSessionUser()

    if (!user) {
      return { ok: false, error: 'Harus masuk untuk menyimpan selera.' }
    }

    const toSave: TasteProfile = {
      ...profile,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await saveTasteProfileForUser(user.id, toSave)
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal menyimpan selera.'
    return { ok: false, error: message }
  }
}

// ── Ambil profile server ──────────────────────────────────────────

export async function actGetTasteProfile(): Promise<
  { ok: true; profile: TasteProfile | null } | ActionError
> {
  try {
    const { getSessionUser } = await import('@/lib/api/user-state')
    const user = await getSessionUser()

    if (!user) {
      return { ok: true, profile: null }
    }

    const profile = await getTasteProfileForUser(user.id)
    return { ok: true, profile }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal membaca selera.'
    return { ok: false, error: message }
  }
}

// ── Skip (simpan profile kosong + skippedAt) ─────────────────────

export async function actSkipTasteProfile(): Promise<ActionResult> {
  try {
    const { getSessionUser } = await import('@/lib/api/user-state')
    const user = await getSessionUser()

    if (!user) {
      return { ok: false, error: 'Harus masuk untuk melewati.' }
    }

    const skipped: TasteProfile = {
      ...createDefaultTasteProfile(),
      skippedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await saveTasteProfileForUser(user.id, skipped)
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal melewati.'
    return { ok: false, error: message }
  }
}

// ── Merge guest profile ke server saat login ─────────────────────

export async function actMergeGuestTasteProfile(
  _guestProfile: unknown,
): Promise<{ ok: true; merged: boolean } | ActionError> {
  try {
    const { getSessionUser } = await import('@/lib/api/user-state')
    const user = await getSessionUser()

    if (!user) {
      return { ok: false, error: 'Harus masuk untuk menggabung selera.' }
    }

    const serverProfile = await getTasteProfileForUser(user.id)

    // Kalau server sudah punya profile, jangan overwrite.
    if (serverProfile && serverProfile.completedAt) {
      return { ok: true, merged: false }
    }

    // Ambil guest profile dari localStorage.
    const guestProfile = readGuestTasteProfile()
    if (!guestProfile || !guestProfile.completedAt) {
      return { ok: true, merged: false }
    }

    const { profile, usedGuest } = mergeTasteProfiles({
      server: serverProfile,
      guest: guestProfile,
    })

    if (!usedGuest) {
      return { ok: true, merged: false }
    }

    const toSave: TasteProfile = {
      ...profile,
      updatedAt: new Date().toISOString(),
    }

    await saveTasteProfileForUser(user.id, toSave)
    return { ok: true, merged: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal menggabung selera.'
    return { ok: false, error: message }
  }
}
