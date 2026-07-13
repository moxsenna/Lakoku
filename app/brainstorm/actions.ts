'use server'

/**
 * Server actions brainstorm (T7.4) — jembatan client wizard ↔ engine authoring.
 *
 * Tiap tahap membungkus fungsi brainstorm (server-only, LLM). `lockStoryBible`
 * menjalankan TANGGA KEGAGALAN: validate → AI repair (1x) → validate →
 * deterministic transform → validate → escalate ke author. Spine (act/gate/ending)
 * tak pernah diubah — hanya konten trajectory/canon.
 */
import {
  proposePremises,
  refinePremise,
  proposeCast,
  proposeMystery,
  proposeWorld,
} from '@/lib/authoring/server'
import {
  persistStoryBible,
  makeVoiceSheetAuthor,
  publicAuthoringErrorMessage,
} from '@/lib/authoring/server'
import { runLockLadder, type AiRepairFn } from '@/lib/authoring/repair'
import { enrichOpeningVoiceSheets } from '@/lib/authoring'
import { generateNextChapterReal } from '@lakoku/runtime'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureReaderStateStarted } from '@/lib/api/user-state'
import {
  AUTHORING_AUTH_REQUIRED_ERROR,
  requireAuthoringSessionUser,
} from '@/lib/authoring/action-auth'
import type {
  PremiseDraft,
  CastDraft,
  MysteryDraft,
  WorldDraft,
  StoryBibleDraft,
} from '@/lib/authoring/schema'
import type { Finding } from '@lakoku/narrative-core'

export interface ActionError {
  ok: false
  error: string
}
export type ActionResult<T> = ({ ok: true } & T) | ActionError

const STORY_NOT_FOUND_ERROR = 'Cerita tidak ditemukan.'

function fail(err: unknown): ActionError {
  const message = err instanceof Error ? err.message : 'Terjadi kesalahan tak terduga.'
  const publicMessage = message === AUTHORING_AUTH_REQUIRED_ERROR
    ? AUTHORING_AUTH_REQUIRED_ERROR
    : publicAuthoringErrorMessage(err)
  console.log('[v0] brainstorm action error:', message, { publicMessage })
  return { ok: false, error: publicMessage }
}

export async function actProposePremises(idea: string): Promise<ActionResult<{ proposals: PremiseDraft[] }>> {
  try {
    await requireAuthoringSessionUser()
    const { proposals } = await proposePremises(idea)
    return { ok: true, proposals }
  } catch (e) {
    return fail(e)
  }
}

export async function actRefinePremise(current: PremiseDraft, feedback: string): Promise<ActionResult<{ premise: PremiseDraft }>> {
  try {
    await requireAuthoringSessionUser()
    const { premise } = await refinePremise(current, feedback)
    return { ok: true, premise }
  } catch (e) {
    return fail(e)
  }
}

export async function actProposeCast(premise: PremiseDraft, feedback?: string, previous?: CastDraft): Promise<ActionResult<{ cast: CastDraft }>> {
  try {
    await requireAuthoringSessionUser()
    const { cast } = await proposeCast(premise, feedback, previous)
    return { ok: true, cast }
  } catch (e) {
    return fail(e)
  }
}

export async function actProposeMystery(premise: PremiseDraft, cast: CastDraft, feedback?: string, previous?: MysteryDraft): Promise<ActionResult<{ mystery: MysteryDraft }>> {
  try {
    await requireAuthoringSessionUser()
    const { mystery } = await proposeMystery(premise, cast, feedback, previous)
    return { ok: true, mystery }
  } catch (e) {
    return fail(e)
  }
}

export async function actProposeWorld(premise: PremiseDraft, cast: CastDraft, mystery: MysteryDraft, feedback?: string, previous?: WorldDraft): Promise<ActionResult<{ world: WorldDraft }>> {
  try {
    await requireAuthoringSessionUser()
    const { world } = await proposeWorld(premise, cast, mystery, feedback, previous)
    return { ok: true, world }
  } catch (e) {
    return fail(e)
  }
}

/** Ubah temuan validator jadi instruksi revisi berbahasa cerita untuk AI repair. */
function findingsToFeedback(findings: Finding[]): string {
  const lines = findings
    .filter((f) => f.severity === 'CRITICAL')
    .map((f) => `- ${f.message}`)
  return [
    'Story bible melanggar aturan berikut. Perbaiki HANYA konten agar patuh, jangan ubah struktur bab/act:',
    ...lines,
    'Ingat: setiap rahasia hanya boleh dibuka pada bab 12, 20, 32, atau 45. Misteri utama harus terbayar sebelum bab 48. Subjek fakta harus salah satu nama karakter atau kosong. Jangan pakai istilah teknis internal.',
  ].join('\n')
}

/**
 * Kunci story bible: jalankan tangga kegagalan, lalu persist bila LOCKED.
 * aiRepair meregenerasi tahap misteri & world dengan umpan-balik dari validator.
 */
export async function lockStoryBible(draft: StoryBibleDraft): Promise<
  ActionResult<{ storyId: string; resolvedBy: string; transforms: string[] }>
  | ({ ok: false; needsAuthor: true; findings: Finding[]; transforms: string[] })
> {
  try {
    const user = await requireAuthoringSessionUser()

    const aiRepair: AiRepairFn = async (d, findings) => {
      const feedback = findingsToFeedback(findings)
      const [{ mystery }, worldBase] = [
        await proposeMystery(d.premise, d.cast, feedback, d.mystery),
        d,
      ]
      const { world } = await proposeWorld(d.premise, d.cast, mystery, feedback, worldBase.world)
      return { premise: d.premise, cast: d.cast, mystery, world }
    }

    const result = await runLockLadder(draft, { aiRepair })
    if (result.status === 'NEEDS_AUTHOR') {
      return { ok: false, needsAuthor: true, findings: result.findings, transforms: result.transforms }
    }

    // T7.2 (G5-VOICE) — Opening Package: perkaya voice sheet tokoh pembuka agar
    // suaranya khas sejak Bab 1. Best-effort: bila author gagal/menolak, voice
    // dasar (turunan cast) dipertahankan sehingga alur kunci→Bab 1 tak buntu.
    const opening = await enrichOpeningVoiceSheets(result.compiled, makeVoiceSheetAuthor())
    if (opening.enrichedIds.length || opening.fallbackIds.length) {
      console.log('[v0] opening package voice — diperkaya:', opening.enrichedIds, 'fallback:', opening.fallbackIds)
    }

    const { storyId } = await persistStoryBible(opening.compiled, user.id)
    // Library personal muncul sejak lock (AMENDMENTS v0.5).
    await ensureReaderStateStarted(storyId, 1, 'BARU')

    // T-SHARE-3: bila user datang dari share landing, ikat story baru ke start row.
    // Client menyimpan startId di sessionStorage; optional header/cookie tidak dipakai.
    // Dipanggil best-effort lewat attachShareStartIfAny di client setelah lock — server
    // action terpisah. Di sini hanya persist story.

    return { ok: true, storyId, resolvedBy: result.resolvedBy, transforms: result.transforms }
  } catch (e) {
    return fail(e)
  }
}

/**
 * Picu generasi Bab 1 nyata untuk story yang baru dikunci, lalu tandai story
 * BERJALAN pada bab 1 agar reader (tamu maupun login) langsung menemukannya.
 *
 * Idempoten: bila Bab 1 sudah ada (CHAPTER_EXISTS) atau generasi lain sedang
 * memegang lease (LEASE_HELD), dianggap sukses — reader tetap diarahkan ke bab 1.
 */
export async function startFirstChapter(
  storyId: string,
): Promise<ActionResult<{ chapterNumber: number }>> {
  try {
    const user = await requireAuthoringSessionUser()

    const admin = createAdminClient()
    const { data: ownedStory, error: ownerError } = await admin
      .from('stories')
      .select('id')
      .eq('id', storyId)
      .eq('owner_user_id', user.id)
      .maybeSingle()
    if (ownerError || !ownedStory) {
      return { ok: false, error: STORY_NOT_FOUND_ERROR }
    }

    const { after } = await import('next/server')
    after(async () => {
      const result = await generateNextChapterReal(storyId, 1)
      if (!result.ok && result.reason !== 'CHAPTER_EXISTS' && result.reason !== 'LEASE_HELD') {
        console.log('[v0] startFirstChapter gagal:', result.reason, result.detail)
      }
    })

    // Progress personal login (AMENDMENTS v0.5). Kolom demo global di `stories`
    // tidak lagi diandalkan sebagai status personal untuk semua pengunjung.
    await ensureReaderStateStarted(storyId, 1)

    return { ok: true, chapterNumber: 1 }
  } catch (e) {
    return fail(e)
  }
}
