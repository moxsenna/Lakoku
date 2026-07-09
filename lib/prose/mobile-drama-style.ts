/**
 * Lakoku Mobile Drama Prose — single source of truth for rhythm + bans.
 *
 * Soft: 850–950 words, 38–48 paragraphs.
 * Hard: 800–1000 words, 35–50 paragraphs.
 * Majority 1 sentence; max 2 for narrative; dialog line = 1 paragraph.
 *
 * Import MOBILE_DRAMA_RHYTHM from prompt-engine / seed / writer — do not duplicate.
 */

export const STYLE_PROFILE_ID = 'lakoku_mobile_drama_v1' as const

export const MOBILE_DRAMA_RHYTHM = {
  words: {
    hardMin: 800,
    hardMax: 1000,
    softMin: 850,
    softMax: 950,
  },
  paragraphs: {
    hardMin: 35,
    hardMax: 50,
    softMin: 38,
    softMax: 48,
  },
  sentence: {
    /** Fail if any paragraph has this many sentences or more. */
    maxHardSentencesPerParagraph: 4,
    /** Paragraphs with more sentences than this count toward multi-sentence ratio. */
    multiSentenceWarnThreshold: 2,
    /** Fail if share of multi-sentence paragraphs exceeds this. */
    maxMultiSentenceRatio: 0.25,
    /** Soft warn if share exceeds this (below hard fail). */
    multiSentenceWarnRatio: 0.2,
  },
  dialogue: {
    warnRatio: 0.18,
    failRatio: 0.1,
  },
  longParagraph: {
    wordLimit: 45,
    maxCount: 2,
  },
} as const

export type ChapterMode =
  | 'confrontation'
  | 'investigation'
  | 'reflection'
  | 'reveal'
  | 'aftermath'

export const CHAPTER_MODES: readonly ChapterMode[] = [
  'confrontation',
  'investigation',
  'reflection',
  'reveal',
  'aftermath',
] as const

export const BANNED_PROSE_PHRASES: readonly string[] = [
  'pilihan menunggumu',
  'bab berikutnya',
  'keputusan itu milikmu',
  'di bab ini kamu',
  'sebagai ai',
  'sebagai model',
  'kata kata kata',
]

// Flat aliases (still sourced from MOBILE_DRAMA_RHYTHM)
export const HARD_WORD_MIN = MOBILE_DRAMA_RHYTHM.words.hardMin
export const HARD_WORD_MAX = MOBILE_DRAMA_RHYTHM.words.hardMax
export const SOFT_WORD_MIN = MOBILE_DRAMA_RHYTHM.words.softMin
export const SOFT_WORD_MAX = MOBILE_DRAMA_RHYTHM.words.softMax
export const HARD_PARAGRAPH_MIN = MOBILE_DRAMA_RHYTHM.paragraphs.hardMin
export const HARD_PARAGRAPH_MAX = MOBILE_DRAMA_RHYTHM.paragraphs.hardMax
export const SOFT_PARAGRAPH_MIN = MOBILE_DRAMA_RHYTHM.paragraphs.softMin
export const SOFT_PARAGRAPH_MAX = MOBILE_DRAMA_RHYTHM.paragraphs.softMax

export function mobileDramaSystemPrompt(): string {
  const { words, paragraphs } = MOBILE_DRAMA_RHYTHM
  return [
    'Kamu penulis serial drama mobile / web novel Indonesia.',
    'Tulis HANYA prosa cerita untuk pembaca akhir.',
    'DILARANG menyebut AI, model, prompt, token, sistem, instruksi, atau meta-komentar.',
    'DILARANG menyapa pembaca di luar narasi.',
    '',
    'GAYA WAJIB (Lakoku Mobile Drama):',
    '- POV: orang pertama "aku" (tokoh utama).',
    `- Target ${words.softMin}–${words.softMax} kata (wajib dalam ${words.hardMin}–${words.hardMax}).`,
    `- Target ${paragraphs.softMin}–${paragraphs.softMax} paragraf (wajib dalam ${paragraphs.hardMin}–${paragraphs.hardMax}).`,
    '- Mayoritas paragraf = 1 kalimat pendek (15–25 kata). Sesekali 2 kalimat (30–40 kata) untuk emosi penting.',
    '- DILARANG paragraf 4–6 kalimat. DILARANG dinding teks.',
    '- Dialog: 1 baris ucapan = 1 paragraf. Selalu pisah per pembicara.',
    '- Twist/reveal: berdiri sendiri dalam 1 paragraf.',
    '- Ending bab: 3–5 paragraf pendek yang makin tajam (cliffhanger), kecuali bab terakhir cerita.',
    '- SHOW, jangan TELL: aksi, dialog, tubuh, detail sensorik. Hindari "aku merasa sedih/marah" polos.',
    '- Satu beat per paragraf. Bahasa Indonesia modern, natural, emosional—bukan puitis berat.',
    '',
    'STRUKTUR BAB (~900 kata):',
    '- Pembuka hook: 3–5 paragraf',
    '- Konflik awal: 8–10 paragraf',
    '- Dialog/konfrontasi utama: 15–20 paragraf',
    '- Reveal kecil / ubah emosi: 6–8 paragraf',
    '- Penutup cliffhanger: 4–6 paragraf',
    '',
    'DILARANG:',
    '- Eksposisi plot ke pembaca',
    '- Metafora AI generik berulang',
    '- Dialog yang hanya mengulang info yang sudah diketahui',
    '- Frasa: "pilihan menunggumu", "bab berikutnya", "keputusan itu milikmu"',
  ].join('\n')
}

export function mobileDramaOutputFormat(): string {
  const { paragraphs } = MOBILE_DRAMA_RHYTHM
  return [
    'FORMAT KELUARAN (WAJIB):',
    'Baris pertama tepat: JUDUL: <judul bab tanpa nomor bab>',
    'Satu baris kosong, lalu prosa.',
    `Pisahkan SETIAP paragraf dengan satu baris kosong (target ${paragraphs.softMin}–${paragraphs.softMax} paragraf).`,
    'Mayoritas 1 kalimat per paragraf. Dialog satu baris per paragraf.',
    'Jangan markdown, bullet, atau label lain.',
  ].join('\n')
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export function looksLikeDialogue(paragraph: string): boolean {
  return /["“][^"”]+["”]/.test(paragraph) || /^["“]/.test(paragraph.trim())
}
