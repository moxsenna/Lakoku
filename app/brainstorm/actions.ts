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
import { createAdminClient } from '@lakoku/db'
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

function fail(err: unknown): ActionError {
  const message = err instanceof Error ? err.message : 'Terjadi kesalahan tak terduga.'
  const publicMessage = publicAuthoringErrorMessage(err)
  console.log('[v0] brainstorm action error:', message, { publicMessage })
  return { ok: false, error: publicMessage }
}

export async function actProposePremises(idea: string): Promise<ActionResult<{ proposals: PremiseDraft[] }>> {
  try {
    const { proposals } = await proposePremises(idea)
    return { ok: true, proposals }
  } catch (e) {
    return fail(e)
  }
}

export async function actRefinePremise(current: PremiseDraft, feedback: string): Promise<ActionResult<{ premise: PremiseDraft }>> {
  try {
    const { premise } = await refinePremise(current, feedback)
    return { ok: true, premise }
  } catch (e) {
    return fail(e)
  }
}

export async function actProposeCast(premise: PremiseDraft, feedback?: string, previous?: CastDraft): Promise<ActionResult<{ cast: CastDraft }>> {
  try {
    const { cast } = await proposeCast(premise, feedback, previous)
    return { ok: true, cast }
  } catch (e) {
    return fail(e)
  }
}

export async function actProposeMystery(premise: PremiseDraft, cast: CastDraft, feedback?: string, previous?: MysteryDraft): Promise<ActionResult<{ mystery: MysteryDraft }>> {
  try {
    const { mystery } = await proposeMystery(premise, cast, feedback, previous)
    return { ok: true, mystery }
  } catch (e) {
    return fail(e)
  }
}

export async function actProposeWorld(premise: PremiseDraft, cast: CastDraft, mystery: MysteryDraft, feedback?: string, previous?: WorldDraft): Promise<ActionResult<{ world: WorldDraft }>> {
  try {
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

    const { storyId } = await persistStoryBible(opening.compiled)
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
    const result = await generateNextChapterReal(storyId, 1)
    if (!result.ok && result.reason !== 'CHAPTER_EXISTS' && result.reason !== 'LEASE_HELD') {
      console.log('[v0] startFirstChapter gagal:', result.reason, result.detail)
      return { ok: false, error: 'Bab pertama gagal disiapkan. Coba lagi sebentar.' }
    }

    // Majukan posisi story ke bab 1 (demo/global state; reader-state per-user
    // akan menimpanya saat pembaca login & mulai membaca).
    const db = createAdminClient()
    const { error } = await db
      .from('stories')
      .update({ status: 'BERJALAN', current_chapter: 1 })
      .eq('id', storyId)
    if (error) throw new Error(`update story status: ${error.message}`)

    return { ok: true, chapterNumber: 1 }
  } catch (e) {
    return fail(e)
  }
}
