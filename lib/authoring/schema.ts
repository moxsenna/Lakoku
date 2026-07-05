/**
 * Skema authoring (T7.4) — kontrak JSON per-tahap brainstorm story bible.
 *
 * Semua output LLM authoring divalidasi ke skema Zod ini SEBELUM dirakit jadi
 * CanonSnapshot. Ini "pagar bentuk": memastikan model mengembalikan struktur
 * yang benar. Pagar SEMANTIK (posisi gate, referensi karakter, kebocoran
 * istilah) ada di `validate.ts`.
 *
 * Prinsip T7.4: STRUKTUR 50 bab, 8 act, dan posisi reveal gate (12/20/32/45)
 * TETAP dari template. AI hanya mengisi KONTEN: premis, karakter, rahasia,
 * thread, fakta.
 */
import { z } from 'zod'
import { REVEAL_GATE_CHAPTERS } from '@lakoku/narrative-core'

/** Gate reveal yang boleh dipakai (dikunci template). */
export const REVEAL_GATES = REVEAL_GATE_CHAPTERS as readonly number[]

// ---------- Tahap 1: Premis ----------

export const PremiseSchema = z.object({
  title: z.string().min(3).max(80).describe('Judul cerita, ringkas & menggugah.'),
  tagline: z.string().min(10).max(160).describe('Satu kalimat pemikat (logline).'),
  role: z.string().min(3).max(80).describe('Peran/sudut pandang pembaca sebagai tokoh utama, mis. "Rani, sang pewaris".'),
  synopsis: z.string().min(60).max(700).describe('Sinopsis 2–4 kalimat: dunia, luka tokoh, taruhan.'),
  tropes: z.array(z.string().min(2).max(40)).min(2).max(5).describe('2–5 trope/genre penanda.'),
})
export type PremiseDraft = z.infer<typeof PremiseSchema>

export const PremiseProposalsSchema = z.object({
  proposals: z.array(PremiseSchema).min(3).max(3).describe('Tepat 3 konsep premis berbeda.'),
})
export type PremiseProposals = z.infer<typeof PremiseProposalsSchema>

// ---------- Tahap 2: Cast (karakter) ----------

export const AuthoredCharacterSchema = z.object({
  canonicalName: z.string().min(2).max(60).describe('Nama kanonik karakter.'),
  role: z.string().min(2).max(60).describe('Peran naratif, mis. protagonis, antagonis, mentor.'),
  motivation: z.string().min(10).max(240).describe('Motivasi inti yang menggerakkan karakter.'),
  introducedChapter: z.number().int().min(1).max(50).describe('Bab perkenalan (1–50).'),
  aliases: z.array(z.object({
    alias: z.string().min(1).max(60),
    aliasType: z.enum(['NAME', 'NICKNAME', 'RELATION', 'TITLE']),
  })).max(4).describe('Nama panggilan/relasi/gelar (opsional).'),
  voice: z.object({
    register: z.string().min(3).max(80).describe('Register bicara, mis. "hangat namun waspada".'),
    speechHabits: z.array(z.string().min(2).max(80)).max(5),
    forbiddenWords: z.array(z.string().min(1).max(40)).max(8).describe('Kata yang tak pernah diucapkan karakter ini.'),
    sampleLines: z.array(z.string().min(3).max(160)).min(1).max(3),
  }),
})
export type AuthoredCharacter = z.infer<typeof AuthoredCharacterSchema>

export const CastSchema = z.object({
  characters: z.array(AuthoredCharacterSchema).min(3).max(8).describe('3–8 karakter inti; karakter pertama = protagonis.'),
})
export type CastDraft = z.infer<typeof CastSchema>

// ---------- Tahap 3: Mystery (rahasia + thread utama) ----------

export const AuthoredSecretSchema = z.object({
  description: z.string().min(15).max(300).describe('Deskripsi rahasia yang akan dibuka.'),
  revealGateChapter: z.number().int().describe(`Bab gate reveal; HARUS salah satu dari ${REVEAL_GATES.join(', ')}.`),
})
export type AuthoredSecret = z.infer<typeof AuthoredSecretSchema>

export const MysterySchema = z.object({
  mainMystery: z.object({
    title: z.string().min(5).max(120).describe('Judul misteri utama cerita.'),
    payoffWindow: z.number().int().min(1).max(50).nullable().describe('Bab target pembayaran (opsional).'),
  }),
  secrets: z.array(AuthoredSecretSchema).min(2).max(4).describe('2–4 rahasia terjadwal, dipetakan ke reveal gate.'),
})
export type MysteryDraft = z.infer<typeof MysterySchema>

// ---------- Tahap 4: Threads & facts ----------

export const AuthoredThreadSchema = z.object({
  title: z.string().min(5).max(120),
  openedChapter: z.number().int().min(1).max(50),
  payoffWindow: z.number().int().min(1).max(60).nullable(),
})
export type AuthoredThread = z.infer<typeof AuthoredThreadSchema>

export const AuthoredFactSchema = z.object({
  statement: z.string().min(8).max(240).describe('Fakta canon yang jadi pijakan cerita.'),
  subjectName: z.string().min(2).max(60).nullable().describe('Nama karakter subjek fakta (atau null).'),
  establishedChapter: z.number().int().min(1).max(50),
  salience: z.number().min(0).max(1).describe('Bobot penting 0–1.'),
  loadBearing: z.boolean().describe('true = fakta penyangga (tak boleh dibuang retrieval).'),
})
export type AuthoredFact = z.infer<typeof AuthoredFactSchema>

export const WorldSchema = z.object({
  threads: z.array(AuthoredThreadSchema).min(1).max(6).describe('Thread naratif tambahan (di luar misteri utama).'),
  facts: z.array(AuthoredFactSchema).min(3).max(12).describe('3–12 fakta pijakan cerita.'),
})
export type WorldDraft = z.infer<typeof WorldSchema>

// ---------- Story bible draft lengkap (agregat tahap) ----------

export interface StoryBibleDraft {
  premise: PremiseDraft
  cast: CastDraft
  mystery: MysteryDraft
  world: WorldDraft
}
