/**
 * Kontrak provider internal + adapter deterministik (fake).
 *
 * Provider mengembalikan output MENTAH (`unknown`); gateway yang memvalidasi
 * via schema. Adapter fake ini menghasilkan plan & draft deterministik dari
 * blueprint + snapshot canon, cukup untuk membuktikan jalur generasi lolos
 * Layer A + repair tanpa memanggil model nyata (itu M5/soak).
 *
 * PENTING: nama provider & metadata internal TIDAK PERNAH masuk ke output
 * yang menyentuh pembaca. Boundary consumer-safe ditegakkan di gateway.ts.
 */

import type { CanonSnapshot, ChapterBlueprint, Finding } from '@lakoku/narrative-core'

export interface PlanInput {
  snapshot: CanonSnapshot
  blueprint: ChapterBlueprint
  chapterNumber: number
}

export interface WriteInput {
  snapshot: CanonSnapshot
  plan: unknown // ChapterPlan tervalidasi (gateway sudah cek), diteruskan apa adanya
  /** Findings dari validasi sebelumnya (repair). Kosong = attempt pertama. */
  repairFindings?: Finding[]
  /** Simulasikan cacat awal (untuk uji repair). Dihapus saat repair. */
  injectDefects?: DraftDefect[]
}

export type DraftDefect =
  | 'SHORT'
  | 'NO_CHOICE'
  | 'TOO_MANY_SCENES'
  // Cacat Layer B (model-based) — dibersihkan saat repair.
  | 'VOICE_BAD'
  | 'SOFT_CONTRA'
  | 'EMOTION_BAD'

export interface GenerationProvider {
  /** Nama internal — untuk log/korelasi, tak pernah ke pembaca. */
  readonly name: string
  generatePlan(input: PlanInput): Promise<unknown>
  writeChapter(input: WriteInput): Promise<unknown>
}

/** Policy runtime generasi (target kata & scene). Diambil dari generation_policy DB. */
export interface GenerationRuntimePolicy {
  targetWordsMin: number
  targetWordsMax: number
  targetScenes: number
}

export const DEFAULT_RUNTIME_POLICY: GenerationRuntimePolicy = {
  targetWordsMin: 800,
  targetWordsMax: 1000,
  targetScenes: 3,
}

// ---------- Adapter deterministik ----------

/** Pilih karakter yang valid tampil di bab target (hidup & sudah diperkenalkan). */
function activeCharacters(snapshot: CanonSnapshot, chapter: number) {
  return snapshot.characters.filter(
    (c) => c.status !== 'DEAD' && c.introducedChapter <= chapter,
  )
}

/**
 * Prosa deterministik bergaya mobile drama: paragraf pendek (1–2 kalimat),
 * seling dialog, show-don't-tell kasar — cukup untuk smoke/validator, bukan
 * kualitas editorial. Seed demo reader punya generator sendiri.
 */
function buildParagraphs(
  beats: string[],
  names: string[],
  targetWords: number,
): string[] {
  const lead = names[0] ?? 'Aku'
  const other = names[1] ?? 'dia'
  const pool: string[] = [
    ...beats.map((b) => {
      const clean = b.toLowerCase().replace(/\.$/, '')
      return `Aku menelan ludah. ${clean.charAt(0).toUpperCase()}${clean.slice(1)} tak bisa ditunda lagi.`
    }),
    `Aku berdiri di ambang pintu.`,
    `Jari-jariku mengepal.`,
    `${other} menatapku tanpa bicara.`,
    `"Kamu yakin?" tanya ${other}.`,
    `Aku mengangguk pelan.`,
    `"Kalau salah, kita bayar mahal," katanya.`,
    `Suara di luar meredup.`,
    `Aku melangkah maju.`,
    `Nafas ${other} terdengar pendek.`,
    `"Bilang sekarang," desakku.`,
    `${other} memalingkan wajah.`,
    `Dadaku sesak, tapi aku tidak mundur.`,
    `Lantai di bawah kakiku terasa dingin.`,
    `"Cukup," bisikku.`,
    `${other} menatapku lagi—kali ini lebih tajam.`,
    `Aku menahan diri agar tidak meledak.`,
    `Satu detik. Dua.`,
    `Keputusan itu sudah di ujung lidah.`,
  ]

  const paragraphs: string[] = []
  let words = 0
  let idx = 0
  while (words < targetWords) {
    const s = pool[idx % pool.length]!
    paragraphs.push(s)
    words += s.split(/\s+/).filter(Boolean).length
    idx++
    // Jaga minimal ~18 paragraf gaya mobile bila target penuh.
    if (paragraphs.length >= 40 && words >= targetWords) break
  }
  // Pastikan lead name muncul (beberapa kalimat pakai "Aku" generik).
  if (!paragraphs.some((p) => p.includes(lead)) && lead !== 'Aku') {
    paragraphs[0] = `${lead} berdiri di ambang pintu.`
  }
  return paragraphs
}

function countWords(paragraphs: string[]): number {
  return paragraphs.join(' ').split(/\s+/).filter(Boolean).length
}

/** Susun dialog yang sengaja melanggar voice sheet (untuk uji Layer B). */
function forbiddenWordFor(snapshot: CanonSnapshot, characterId: string): string {
  const sheet = snapshot.voiceSheets.find((v) => v.characterId === characterId)
  const word = sheet?.forbiddenWords[0] ?? 'terlarang'
  return `Terus terang, ${word} sekali situasinya.`
}

/**
 * Provider fake deterministik. Menghasilkan output valid; bila `injectDefects`
 * diberikan DAN tak ada repairFindings, sisipkan cacat yang bisa diperbaiki.
 */
export function createDeterministicProvider(
  policy: GenerationRuntimePolicy = DEFAULT_RUNTIME_POLICY,
): GenerationProvider {
  const targetWordCount = Math.round((policy.targetWordsMin + policy.targetWordsMax) / 2)
  const targetScenes = policy.targetScenes

  return {
    name: 'deterministic-fake-v1',

    async generatePlan({ blueprint, chapterNumber, snapshot }): Promise<unknown> {
      const revealsNow = snapshot.secrets
        .filter((s) => s.revealGateChapter === chapterNumber)
        .map((s) => s.id)
      // proposedStateDelta = subset kunci allowed (ambil semua kunci yang ada).
      const allowedKeys = Object.keys(blueprint.allowedStateDelta)
      const proposedStateDelta: Record<string, unknown> = {}
      if (allowedKeys.length) proposedStateDelta[allowedKeys[0]] = true

      return {
        storyId: snapshot.storyId,
        chapterNumber,
        phase: blueprint.phase,
        chapterGoal: blueprint.chapterGoal,
        plannedBeats: blueprint.mandatoryBeats.length
          ? blueprint.mandatoryBeats
          : [`Kembangkan fase "${blueprint.phase}".`],
        targetWordCount,
        targetSceneCount: targetScenes,
        opensThreadId: null,
        usesReveals: revealsNow,
        proposedStateDelta,
        introducesCharacters: blueprint.introducesCharacters,
      }
    },

    async writeChapter({ snapshot, plan, repairFindings, injectDefects }): Promise<unknown> {
      const p = plan as {
        chapterNumber: number
        phase: string
        plannedBeats: string[]
        usesReveals: string[]
        proposedStateDelta: Record<string, unknown>
        introducesCharacters: string[]
      }
      const chapter = p.chapterNumber
      const chars = activeCharacters(snapshot, chapter)
      const names = chars.map((c) => c.canonicalName)

      // Cacat hanya pada attempt pertama (repairFindings kosong).
      const defects = repairFindings?.length ? [] : (injectDefects ?? [])
      const writeTargetWords = defects.includes('SHORT') ? 120 : targetWordCount
      const writeSceneCount = defects.includes('TOO_MANY_SCENES') ? 6 : targetScenes
      const hasChoiceOrGate = !defects.includes('NO_CHOICE')

      const paragraphs = buildParagraphs(p.plannedBeats, names, writeTargetWords)

      // Events: satu event per karakter aktif utama (maks 3), monotonic.
      const events = chars.slice(0, 3).map((c, i) => ({
        characterMention: c.canonicalName,
        description: `${c.canonicalName} mengambil langkah pada babak "${p.phase}".`,
        ordinal: i,
        occursAt: chapter * 10 + i,
        isFlashback: false,
      }))

      // Knowledge assertions: hanya fakta yang memang sudah diketahui karakter.
      const knowledgeAssertions = snapshot.knowledge
        .filter((k) => k.knownFromChapter <= chapter)
        .filter((k) => chars.some((c) => c.id === k.characterId))
        .slice(0, 2)
        .map((k) => ({
          characterMention:
            chars.find((c) => c.id === k.characterId)?.canonicalName ?? k.characterId,
          factId: k.factId,
        }))

      // ---- Sinyal Layer B (bersih secara default; cacat hanya bila diinjeksi) ----
      const speaker = chars[0]
      const dialogue = speaker
        ? [
            {
              characterId: speaker.id,
              text: defects.includes('VOICE_BAD')
                ? forbiddenWordFor(snapshot, speaker.id)
                : 'Aku akan menghadapi ini sampai selesai.',
            },
          ]
        : []

      const emotionBeats =
        chars.length >= 2
          ? [
              {
                characterId: chars[0].id,
                targetCharacterId: chars[1].id,
                valence: (defects.includes('EMOTION_BAD') ? 'warm' : 'neutral') as
                  | 'warm'
                  | 'neutral'
                  | 'cold'
                  | 'hostile',
              },
            ]
          : []

      // Klaim lunak atas fakta relevan yang sudah established.
      const relevantFact = snapshot.facts.find((f) => f.establishedChapter <= chapter)
      const softClaims = relevantFact
        ? [
            {
              characterId: chars[0]?.id ?? relevantFact.subjectCharacterId ?? 'unknown',
              factId: relevantFact.id,
              agrees: !defects.includes('SOFT_CONTRA'),
            },
          ]
        : []

      return {
        storyId: snapshot.storyId,
        chapterNumber: chapter,
        title: `Bab ${chapter}: ${p.phase}`,
        paragraphs,
        wordCount: countWords(paragraphs),
        sceneCount: writeSceneCount,
        hasChoiceOrGate,
        events,
        knowledgeAssertions,
        reveals: p.usesReveals.map((secretId) => ({ secretId })),
        proposedStateDelta: p.proposedStateDelta,
        newNamedCharacters: p.introducesCharacters,
        dialogue,
        emotionBeats,
        softClaims,
      }
    },
  }
}
