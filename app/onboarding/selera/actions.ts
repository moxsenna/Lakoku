'use server'

/**
 * Server actions untuk /onboarding/selera — simpan, baca, skip, merge Taste Profile (V2).
 */
import {
  getTasteProfileForUser,
  saveTasteProfileForUser,
} from '@/lib/api/taste-profile'
import {
  TasteProfileV2Schema,
  createEmptyTasteProfile,
  mergeTasteProfiles,
  normalizeTasteProfile,
  type TasteProfileV2,
} from '@/lib/taste-profile/schema'

type ActionOk = { ok: true }
type ActionError = { ok: false; error: string }
type ActionResult = ActionOk | ActionError

// ── Simpan profile penuh ──────────────────────────────────────────

export async function actSaveTasteProfile(
  rawInput: unknown,
): Promise<ActionResult> {
  try {
    // Accept V2 directly, or V1 and auto-migrate
    let profile: TasteProfileV2
    const v2Result = TasteProfileV2Schema.safeParse(rawInput)
    if (v2Result.success) {
      profile = v2Result.data
    } else {
      profile = normalizeTasteProfile(rawInput)
    }

    const { getSessionUser } = await import('@/lib/api/user-state')
    const user = await getSessionUser()

    if (!user) {
      return { ok: false, error: 'Harus masuk untuk menyimpan selera.' }
    }

    const toSave: TasteProfileV2 = {
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
  { ok: true; profile: TasteProfileV2 | null } | ActionError
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

    const skipped: TasteProfileV2 = {
      ...createEmptyTasteProfile(),
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
  rawGuestProfile: unknown,
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

    // Parse guest profile (accepts both V1 and V2)
    const guestProfile = normalizeTasteProfile(rawGuestProfile)

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

    const toSave: TasteProfileV2 = {
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
