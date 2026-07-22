/**
 * Brainstorm engine (T7.4) — dialog multi-turn AI↔user untuk merakit story bible.
 *
 * Alur tahap: premis → cast → mystery → world (threads/facts). Tiap tahap punya
 * fungsi "propose" (usulan awal) dan "refine" (revisi berdasar masukan user).
 * Semua memakai model authoring JSON-capable (lihat model.ts) dan skema Zod
 * (schema.ts). Konten yang dihasilkan adalah NARASI (aman-pembaca); struktur
 * 50 bab & reveal gate tetap dikunci template di tahap compile.
 */
import 'server-only'
import { authorObject } from './model'
import {
  PremiseProposalsSchema,
  PremiseSchema,
  CastSchema,
  MysterySchema,
  WorldSchema,
  REVEAL_GATES,
  type PremiseDraft,
  type CastDraft,
  type MysteryDraft,
  type WorldDraft,
} from './schema'
import type { StoryCreativeDirection } from '@/lib/onboarding/creative-direction'
import {
  buildCreativeDirectionPromptBlock,
  stageDirectionHints,
} from './creative-direction'

export type AuthoringDirectionOpts = {
  direction?: StoryCreativeDirection | null
}

const SYSTEM = [
  'Kamu adalah penulis drama serial Bahasa Indonesia yang berpengalaman.',
  'Tugasmu MEMBANTU merancang "story bible" untuk cerita 50 bab bergaya drama kebangkitan.',
  'Selalu tulis dalam Bahasa Indonesia yang natural dan sinematik.',
  'Untuk sinopsis, pakai kalimat-kalimat pendek dan jelas (hindari kalimat majemuk panjang) agar enak dibaca di ponsel.',
  'JANGAN menyebut istilah teknis apa pun (model, prompt, token, AI, sistem) — hanya bahasa cerita.',
  'Patuhi skema keluaran yang diminta dengan tepat.',
].join(' ')

/** Tahap 1a — usulkan 3 premis berbeda dari ide awal user. */
export async function proposePremises(idea: string): Promise<{ proposals: PremiseDraft[]; usedModel: string }> {
  const { object, usedModel } = await authorObject({
    schema: PremiseProposalsSchema,
    system: SYSTEM,
    prompt: [
      `Ide awal dari pengguna: "${idea || 'bebas — usulkan drama kebangkitan yang kuat'}".`,
      'Usulkan TEPAT 3 konsep premis yang berbeda arah (bukan variasi tipis).',
      'Tiap premis harus punya luka tokoh yang jelas dan taruhan yang meningkat.',
      'Keluaran wajib objek JSON dengan field proposals berisi tepat 3 item.',
      'Setiap item wajib punya title, tagline, role, synopsis, dan tropes.',
      'Synopsis 3-5 kalimat pendek; tropes 2-5 string pendek.',
    ].join('\n'),
  })
  return { proposals: object.proposals, usedModel }
}

/** Tahap 1b — refine satu premis terpilih berdasar masukan user. */
export async function refinePremise(current: PremiseDraft, feedback: string): Promise<{ premise: PremiseDraft; usedModel: string }> {
  const { object, usedModel } = await authorObject({
    schema: PremiseSchema,
    system: SYSTEM,
    prompt: [
      `Premis saat ini:\n${JSON.stringify(current, null, 2)}`,
      `Masukan pengguna untuk revisi: "${feedback}".`,
      'Kembalikan SATU premis hasil revisi yang tetap koheren.',
    ].join('\n'),
  })
  return { premise: object, usedModel }
}

function directionBlock(
  stage: 'cast' | 'mystery' | 'world',
  opts?: AuthoringDirectionOpts,
): string {
  if (!opts?.direction) return ''
  const base = buildCreativeDirectionPromptBlock(opts.direction)
  const hints = stageDirectionHints(stage, opts.direction)
  return [base, ...hints].filter(Boolean).join('\n')
}

/** Tahap 2 — usulkan/revisi cast dari premis (opsional masukan + cast sebelumnya + direction). */
export async function proposeCast(
  premise: PremiseDraft,
  feedback?: string,
  previous?: CastDraft,
  opts?: AuthoringDirectionOpts,
): Promise<{ cast: CastDraft; usedModel: string }> {
  const { object, usedModel } = await authorObject({
    schema: CastSchema,
    system: SYSTEM,
    prompt: [
      `Premis final:\n${JSON.stringify(premise, null, 2)}`,
      directionBlock('cast', opts),
      previous ? `Cast sebelumnya:\n${JSON.stringify(previous, null, 2)}` : '',
      feedback ? `Masukan pengguna: "${feedback}".` : '',
      'Rancang 3–8 karakter inti. Karakter PERTAMA wajib protagonis yang sesuai peran pembaca.',
      'Beri tiap karakter voice sheet (register, kebiasaan bicara, kata terlarang, contoh dialog).',
      'Sebar introducedChapter secara wajar (protagonis di bab 1).',
      'Hard boundaries tidak boleh masuk ke backstory sebagai kejadian utama.',
    ].filter(Boolean).join('\n'),
  })
  return { cast: object, usedModel }
}

/** Tahap 3 — usulkan/revisi misteri utama + rahasia terjadwal ke reveal gate. */
export async function proposeMystery(
  premise: PremiseDraft,
  cast: CastDraft,
  feedback?: string,
  previous?: MysteryDraft,
  opts?: AuthoringDirectionOpts,
): Promise<{ mystery: MysteryDraft; usedModel: string }> {
  const { object, usedModel } = await authorObject({
    schema: MysterySchema,
    system: SYSTEM,
    prompt: [
      `Premis:\n${JSON.stringify(premise, null, 2)}`,
      directionBlock('mystery', opts),
      `Karakter:\n${cast.characters.map((c) => `- ${c.canonicalName} (${c.role})`).join('\n')}`,
      previous ? `Misteri sebelumnya:\n${JSON.stringify(previous, null, 2)}` : '',
      feedback ? `Masukan pengguna: "${feedback}".` : '',
      `PENTING: setiap rahasia HARUS dijadwalkan pada salah satu reveal gate berikut: ${REVEAL_GATES.join(', ')}.`,
      'Buat 2–4 rahasia yang saling menumpuk menuju pembayaran misteri utama. Jangan pakai bab gate di luar daftar.',
    ].filter(Boolean).join('\n'),
  })
  return { mystery: object, usedModel }
}

/** Tahap 4 — usulkan/revisi thread tambahan + fakta pijakan. */
export async function proposeWorld(
  premise: PremiseDraft,
  cast: CastDraft,
  mystery: MysteryDraft,
  feedback?: string,
  previous?: WorldDraft,
  opts?: AuthoringDirectionOpts,
): Promise<{ world: WorldDraft; usedModel: string }> {
  const { object, usedModel } = await authorObject({
    schema: WorldSchema,
    system: SYSTEM,
    prompt: [
      `Premis:\n${JSON.stringify(premise, null, 2)}`,
      directionBlock('world', opts),
      `Karakter:\n${cast.characters.map((c) => `- ${c.canonicalName}`).join('\n')}`,
      `Misteri utama: ${mystery.mainMystery.title}`,
      previous ? `World sebelumnya:\n${JSON.stringify(previous, null, 2)}` : '',
      feedback ? `Masukan pengguna: "${feedback}".` : '',
      'Rancang 1–6 thread naratif tambahan dan 3–12 fakta pijakan.',
      'Fakta loadBearing=true untuk fakta yang menopang misteri utama. subjectName harus salah satu nama karakter atau null.',
      'Jangan mengubah struktur 50 bab atau posisi reveal gate.',
    ].filter(Boolean).join('\n'),
  })
  return { world: object, usedModel }
}
