/**
 * Opening Package (T7.2) — NTM G5-VOICE, bagian LOGIKA MURNI (tanpa server-only).
 *
 * "Paket pembuka" adalah langkah authoring yang MEMPERKAYA `character_voice_sheets`
 * untuk tokoh yang tampil di pembuka cerita (Bab 1), lalu menuliskannya ke canon
 * agar suara tiap tokoh KHAS sejak bab pertama. Voice hasil paket ini kemudian
 * MASUK T0 (dipakai penulis prosa) sehingga "opening → Bab 1 utuh".
 *
 * Alur runtime (di server action `lockStoryBible`):
 *   compile → enrichOpeningVoiceSheets(author LLM) → persist → generate Bab 1.
 *
 * Modul ini sengaja MURNI (orkestrasi + validasi + merge) agar dapat diuji tanpa
 * jaringan; fungsi authoring berbasis LLM diinjeksikan lewat `VoiceSheetAuthorFn`
 * (factory server-only ada di `opening-model.ts`). Bila author gagal/menolak,
 * voice sheet dasar (turunan cast) DIPERTAHANKAN — paket pembuka tak pernah buntu.
 */
import type { VoiceSheet } from '@lakoku/narrative-core'
import { scanForLeaks } from '@lakoku/ai-gateway'
import type { CompileResult } from './compile'

/** Voice sheet kaya untuk satu tokoh pembuka (dikembalikan author). */
export interface AuthoredVoice {
  characterId: string
  register: string
  speechHabits: string[]
  forbiddenWords: string[]
  sampleLines: string[]
}

/** Konteks satu tokoh pembuka yang dikirim ke author. */
export interface OpeningCharacterContext {
  characterId: string
  canonicalName: string
  role: string
  motivation: string
  /** Voice dasar (turunan cast) sebagai titik awal untuk diperkaya. */
  baseVoice: VoiceSheet
}

/** Konteks paket pembuka untuk author (read-only). */
export interface OpeningPackageContext {
  storyId: string
  title: string
  tagline: string
  synopsis: string
  characters: OpeningCharacterContext[]
}

/**
 * Fungsi authoring voice (DI). Mengembalikan voice kaya per tokoh pembuka, atau
 * null bila menolak/gagal (→ caller pertahankan voice dasar).
 */
export type VoiceSheetAuthorFn = (
  ctx: OpeningPackageContext,
) => Promise<AuthoredVoice[] | null>

/**
 * Pilih tokoh yang tampil di pembuka: introducedChapter ≤ 1 (protagonis + tokoh
 * bab 1). Bila tak ada satu pun (edge case data), fallback ke karakter pertama
 * (protagonis) agar paket pembuka selalu punya minimal satu subjek.
 */
export function selectOpeningCharacters(
  compiled: CompileResult,
): OpeningCharacterContext[] {
  const { snapshot } = compiled
  const voiceById = new Map(snapshot.voiceSheets.map((v) => [v.characterId, v]))
  let opening = snapshot.characters.filter((c) => c.introducedChapter <= 1)
  if (opening.length === 0 && snapshot.characters.length > 0) {
    opening = [snapshot.characters[0]]
  }
  return opening
    .map((c) => {
      const baseVoice = voiceById.get(c.id)
      if (!baseVoice) return null
      return {
        characterId: c.id,
        canonicalName: c.canonicalName,
        role: c.role,
        motivation: c.motivation,
        baseVoice,
      }
    })
    .filter((x): x is OpeningCharacterContext => x !== null)
}

/**
 * Validasi satu voice kaya terhadap pagar aman-pembaca & bentuk.
 * @returns VoiceSheet bersih bila lolos, atau null bila ditolak (→ pakai dasar).
 */
export function validateAuthoredVoice(
  authored: AuthoredVoice,
  base: VoiceSheet,
): VoiceSheet | null {
  const register = authored.register?.trim() ?? ''
  if (register.length < 3) return null

  const speechHabits = (authored.speechHabits ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
  const forbiddenWords = (authored.forbiddenWords ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
  const sampleLines = (authored.sampleLines ?? [])
    .map((s) => s.trim())
    .filter(Boolean)

  // Butuh substansi: minimal ada kebiasaan bicara & contoh dialog.
  if (speechHabits.length === 0 || sampleLines.length === 0) return null

  // Pagar aman-pembaca: tak boleh ada istilah teknis internal yang bocor.
  const blob = [register, ...speechHabits, ...forbiddenWords, ...sampleLines].join('\n')
  if (scanForLeaks(blob).length > 0) return null

  return {
    characterId: base.characterId,
    register,
    speechHabits,
    forbiddenWords,
    sampleLines,
  }
}

export interface EnrichResult {
  compiled: CompileResult
  /** characterId yang voice-nya benar-benar diperkaya author. */
  enrichedIds: string[]
  /** characterId pembuka yang jatuh ke voice dasar (author menolak/gagal). */
  fallbackIds: string[]
}

/**
 * Jalankan paket pembuka: perkaya voice sheet tokoh pembuka via `author` (LLM),
 * validasi tiap hasil, lalu MERGE ke snapshot (immutable — kembalikan
 * CompileResult baru). Voice tokoh non-pembuka tak disentuh.
 *
 * Deterministik terhadap output author: input sama → hasil sama. Bila author
 * mengembalikan null / melempar / hasil ditolak validasi, voice dasar
 * dipertahankan (fallback), sehingga alur kunci→Bab 1 tak pernah buntu.
 */
export async function enrichOpeningVoiceSheets(
  compiled: CompileResult,
  author: VoiceSheetAuthorFn,
): Promise<EnrichResult> {
  const openingChars = selectOpeningCharacters(compiled)
  const openingIds = new Set(openingChars.map((c) => c.characterId))
  if (openingChars.length === 0) {
    return { compiled, enrichedIds: [], fallbackIds: [] }
  }

  const ctx: OpeningPackageContext = {
    storyId: compiled.storyId,
    title: compiled.meta.title,
    tagline: compiled.meta.tagline,
    synopsis: compiled.meta.synopsis,
    characters: openingChars,
  }

  let authored: AuthoredVoice[] | null = null
  try {
    authored = await author(ctx)
  } catch (err) {
    console.log('[v0] opening package author gagal:', (err as Error)?.message)
    authored = null
  }

  const authoredById = new Map<string, AuthoredVoice>()
  for (const a of authored ?? []) {
    if (a && openingIds.has(a.characterId)) authoredById.set(a.characterId, a)
  }

  const enrichedIds: string[] = []
  const fallbackIds: string[] = []
  const baseById = new Map(compiled.snapshot.voiceSheets.map((v) => [v.characterId, v]))

  const nextVoiceSheets: VoiceSheet[] = compiled.snapshot.voiceSheets.map((base) => {
    if (!openingIds.has(base.characterId)) return base
    const cand = authoredById.get(base.characterId)
    const validated = cand ? validateAuthoredVoice(cand, base) : null
    if (validated) {
      enrichedIds.push(base.characterId)
      return validated
    }
    fallbackIds.push(base.characterId)
    return base
  })

  // Jaga urutan/isi tokoh non-pembuka; hanya voiceSheets yang berubah.
  void baseById
  const nextCompiled: CompileResult = {
    ...compiled,
    snapshot: {
      ...compiled.snapshot,
      voiceSheets: nextVoiceSheets,
    },
  }

  return {
    compiled: nextCompiled,
    enrichedIds: enrichedIds.sort(),
    fallbackIds: fallbackIds.sort(),
  }
}
