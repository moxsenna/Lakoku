/**
 * Opening Package (T7.2) — NTM G5-VOICE, bagian SERVER-ONLY (LLM).
 *
 * Factory `makeVoiceSheetAuthor()` menghasilkan `VoiceSheetAuthorFn` berbasis
 * model authoring JSON-capable (lihat `model.ts`). Ia MENGARANG voice sheet kaya
 * untuk tokoh pembuka — register khas, kebiasaan bicara, kata terlarang, dan
 * contoh dialog — agar suara tiap tokoh berbeda tajam sejak Bab 1.
 *
 * Kontrak keluaran divalidasi dua lapis:
 *   1. bentuk (Zod, di sini) sebelum dipakai,
 *   2. semantik/aman-pembaca (`validateAuthoredVoice`, di `opening.ts`) saat merge.
 * Bila gagal/menolak → caller pertahankan voice dasar (fallback).
 */
import 'server-only'
import { z } from 'zod'
import { authorObject } from './model'
import type {
  AuthoredVoice,
  OpeningPackageContext,
  VoiceSheetAuthorFn,
} from './opening'

const OpeningVoiceSchema = z.object({
  voices: z
    .array(
      z.object({
        characterId: z.string().min(1).describe('Id tokoh PERSIS seperti diberikan pada konteks.'),
        register: z
          .string()
          .min(6)
          .max(140)
          .describe('Register/nada bicara khas, mis. "tenang tapi menusuk, hemat kata".'),
        speechHabits: z
          .array(z.string().min(2).max(120))
          .min(2)
          .max(6)
          .describe('Kebiasaan bicara konkret yang membedakan tokoh ini.'),
        forbiddenWords: z
          .array(z.string().min(1).max(40))
          .max(10)
          .describe('Kata/ungkapan yang TAK PERNAH diucapkan tokoh ini.'),
        sampleLines: z
          .array(z.string().min(4).max(200))
          .min(2)
          .max(4)
          .describe('Contoh dialog otentik yang menunjukkan suara tokoh.'),
      }),
    )
    .min(1)
    .describe('Satu entri voice per tokoh pembuka pada konteks.'),
})

const SYSTEM = [
  'Kamu pengarah suara (voice director) drama serial Bahasa Indonesia.',
  'Tugasmu MENGARANG "voice sheet" yang kaya dan KHAS untuk tiap tokoh pembuka,',
  'agar dialog tiap tokoh langsung terasa berbeda sejak bab pertama.',
  'Gunakan Bahasa Indonesia yang natural dan sinematik.',
  'JANGAN menyebut istilah teknis apa pun (model, prompt, token, AI, sistem) — hanya bahasa cerita.',
  'Setiap tokoh HARUS punya suara yang jelas berbeda dari tokoh lain (register, ritme, diksi).',
  'Patuhi skema keluaran dengan tepat; pakai characterId PERSIS seperti yang diberikan.',
].join(' ')

function buildPrompt(ctx: OpeningPackageContext): string {
  const chars = ctx.characters
    .map((c) =>
      [
        `- characterId: ${c.characterId}`,
        `  nama: ${c.canonicalName}`,
        `  peran: ${c.role}`,
        `  motivasi: ${c.motivation}`,
        `  suara dasar (perkaya, jangan sekadar salin): register="${c.baseVoice.register}", ` +
          `kebiasaan=[${c.baseVoice.speechHabits.join('; ')}], ` +
          `contoh=[${c.baseVoice.sampleLines.join(' / ')}]`,
      ].join('\n'),
    )
    .join('\n')

  return [
    `Cerita: "${ctx.title}" — ${ctx.tagline}`,
    `Sinopsis: ${ctx.synopsis}`,
    '',
    'Tokoh pembuka (yang tampil di Bab 1):',
    chars,
    '',
    'Untuk SETIAP tokoh di atas, kembalikan voice sheet yang diperkaya:',
    '- register: nada bicara khas dan spesifik (bukan generik).',
    '- speechHabits: 2–6 kebiasaan bicara konkret yang membedakan tokoh.',
    '- forbiddenWords: kata/ungkapan yang tak pernah ia pakai (boleh kosong bila tak relevan).',
    '- sampleLines: 2–4 contoh dialog otentik yang membuat suaranya langsung dikenali.',
    'Pastikan suara antar-tokoh JELAS berbeda. Pakai characterId persis seperti di atas.',
  ].join('\n')
}

/**
 * Factory VoiceSheetAuthorFn berbasis LLM authoring. Diinjeksi ke
 * `enrichOpeningVoiceSheets` oleh server action `lockStoryBible`.
 */
export function makeVoiceSheetAuthor(): VoiceSheetAuthorFn {
  return async (ctx: OpeningPackageContext): Promise<AuthoredVoice[] | null> => {
    try {
      const { object } = await authorObject({
        schema: OpeningVoiceSchema,
        system: SYSTEM,
        prompt: buildPrompt(ctx),
      })
      // Hanya pertahankan entri untuk tokoh pembuka yang dikenal (id valid).
      const validIds = new Set(ctx.characters.map((c) => c.characterId))
      const voices = object.voices.filter((v) => validIds.has(v.characterId))
      return voices.length ? voices : null
    } catch (err) {
      console.log('[v0] makeVoiceSheetAuthor gagal:', (err as Error)?.message)
      return null
    }
  }
}
