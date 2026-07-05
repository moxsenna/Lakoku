import 'server-only'
import { createAdminClient } from '@lakoku/db'
import { loadCanonSnapshot } from '@/lib/narrative/loader'
import type { ReportCategory } from './types'

/**
 * Referensi kanonik yang DITAUTKAN ke sebuah laporan pembaca (T7.3).
 *
 * Inti fitur (ARCH §7.9/§11.1): laporan "menautkan referensi kanonik", BUKAN
 * mengandalkan screenshot pengguna. Saat pembaca melaporkan Bab N, server
 * menurunkan jangkar kanon bab tsb dari `CanonSnapshot` sehingga tim penulis
 * bisa menelusuri inkonsistensi tanpa meminta bukti tambahan ke pembaca.
 *
 * Ini bersifat OPS-FACING: disimpan bersama laporan, tak pernah dikembalikan
 * ke pembaca (jadi tak ada risiko bocornya spoiler/istilah teknis ke UI).
 */
export interface CanonicalRefs {
  storyId: string
  chapterNumber: number
  /** versi blueprint bab (bila ada) — menautkan ke state canon yang berlaku. */
  blueprintVersion: number | null
  chapterGoal: string | null
  /** tokoh yang sudah tampil sampai bab ini (id + nama kanonik). */
  activeCharacters: { id: string; name: string }[]
  /** rahasia yang SUDAH terungkap sampai bab ini (gate <= N & revealed). */
  revealedSecrets: { id: string; description: string; gate: number }[]
  /** fakta load-bearing yang berlaku sampai bab ini. */
  loadBearingFacts: { id: string; statement: string }[]
  /** utas cerita yang masih aktif (belum RESOLVED) sampai bab ini. */
  activeThreads: { id: string; title: string; isMainMystery: boolean }[]
}

/**
 * Turunkan referensi kanonik untuk sebuah bab dari snapshot canon.
 * Best-effort: bila canon belum ada (mis. cerita fixture tanpa canon),
 * kembalikan kerangka minimal agar laporan tetap bisa dikirim.
 */
export async function buildCanonicalRefs(
  storyId: string,
  chapterNumber: number,
): Promise<CanonicalRefs> {
  const base: CanonicalRefs = {
    storyId,
    chapterNumber,
    blueprintVersion: null,
    chapterGoal: null,
    activeCharacters: [],
    revealedSecrets: [],
    loadBearingFacts: [],
    activeThreads: [],
  }

  try {
    const snap = await loadCanonSnapshot(storyId, chapterNumber)

    const bp = snap.blueprints.find((b) => b.chapterNumber === chapterNumber)
    base.blueprintVersion = bp ? bp.version : null
    base.chapterGoal = bp ? bp.chapterGoal : null

    base.activeCharacters = snap.characters
      .filter((c) => c.introducedChapter <= chapterNumber)
      .map((c) => ({ id: c.id, name: c.canonicalName }))

    base.revealedSecrets = snap.secrets
      .filter((s) => s.revealed && s.revealGateChapter <= chapterNumber)
      .map((s) => ({ id: s.id, description: s.description, gate: s.revealGateChapter }))

    base.loadBearingFacts = snap.facts
      .filter((f) => f.loadBearing && f.establishedChapter <= chapterNumber)
      .map((f) => ({ id: f.id, statement: f.statement }))

    base.activeThreads = snap.threads
      .filter((t) => t.openedChapter <= chapterNumber && t.status !== 'RESOLVED')
      .map((t) => ({ id: t.id, title: t.title, isMainMystery: t.isMainMystery }))
  } catch (err) {
    console.log('[v0] buildCanonicalRefs: canon tak tersedia, pakai kerangka minimal:', (err as Error)?.message)
  }

  return base
}

/**
 * Kirim laporan pembaca untuk sebuah bab. Menautkan referensi kanonik lalu
 * mencatatnya lewat RPC atomik (`record_content_report_v1`) yang juga menulis
 * story_events(REPORT_FILED). Tulisan lewat service-role (server-only).
 */
export async function submitContentReport(args: {
  storyId: string
  chapterNumber: number
  category: ReportCategory
  note?: string | null
  reporterId?: string | null
}): Promise<{ reportId: string }> {
  const { storyId, chapterNumber, category } = args
  const note = args.note?.trim() ? args.note.trim().slice(0, 2000) : null
  const canonicalRefs = await buildCanonicalRefs(storyId, chapterNumber)

  const db = createAdminClient()
  const { data, error } = await db.rpc('record_content_report_v1', {
    p_story_id: storyId,
    p_chapter_number: chapterNumber,
    p_reporter_id: args.reporterId ?? null,
    p_category: category,
    p_note: note,
    p_canonical_refs: canonicalRefs,
  })
  if (error) throw new Error(`submitContentReport: ${error.message}`)

  return { reportId: String(data) }
}
