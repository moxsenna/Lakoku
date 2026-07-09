/**
 * Lakoku Mobile Drama Prose — kontrak gaya bersama (PRD §9).
 *
 * Dipakai:
 * - prompt writer LLM (`lib/ai-gateway/gateway-provider.ts`)
 * - seed demo reader (`scripts/seed-selasa-demo.ts`)
 * - provider deterministik (paragraf pendek + dialog)
 *
 * Bukan meniru penulis berhak cipta. Ciri generik serial drama mobile /
 * web novel Indonesia: paragraf pendek, dialog padat, show-don't-tell.
 */

export const STYLE_PROFILE_ID = 'lakoku_mobile_drama_v1' as const

export const PROSE_WORD_MIN = 500
export const PROSE_WORD_MAX = 800
export const PROSE_PARAGRAPH_MIN = 18
export const PROSE_PARAGRAPH_MAX = 32
/** Mayoritas paragraf 1–3 kalimat; hindari dinding teks. */
export const PROSE_MAX_SENTENCES_PER_PARA = 3
/** Paragraf >45 kata: maks 2 per bab, tidak berturut-turut. */
export const PROSE_LONG_PARA_WORD_LIMIT = 45
export const PROSE_LONG_PARA_MAX = 2
/** Target dialog di scene aktif (bukan investigasi murni). */
export const PROSE_DIALOGUE_DENSITY = '35-55%'

/**
 * Blok system-prompt untuk writer LLM.
 * Bahasa Indonesia, POV orang pertama "aku" (tokoh utama = pembaca).
 */
export function mobileDramaSystemPrompt(): string {
  return [
    'Kamu penulis serial drama mobile / web novel Indonesia.',
    'Tulis HANYA prosa cerita untuk pembaca akhir.',
    'DILARANG menyebut AI, model, prompt, token, sistem, instruksi, atau meta-komentar.',
    'DILARANG menyapa pembaca di luar narasi ("di bab ini kamu akan…").',
    '',
    'GAYA WAJIB (Lakoku Mobile Drama):',
    `- POV: orang pertama "aku" (tokoh utama).`,
    `- ${PROSE_WORD_MIN}–${PROSE_WORD_MAX} kata bersih per bab.`,
    `- ${PROSE_PARAGRAPH_MIN}–${PROSE_PARAGRAPH_MAX} paragraf. Satu baris kosong antar paragraf.`,
    `- Mayoritas paragraf 1–3 kalimat pendek. Mudah discroll di ponsel.`,
    `- Maks ${PROSE_LONG_PARA_MAX} paragraf >${PROSE_LONG_PARA_WORD_LIMIT} kata; jangan berurutan.`,
    `- Dialog ${PROSE_DIALOGUE_DENSITY} di scene aktif. Dialog punya tujuan (konflik/info/emosi).`,
    '- SHOW, jangan TELL: aksi, dialog, detail sensorik kecil. Hindari "aku merasa sedih/marah" polos — tunjukkan lewat tubuh, nada, tindakan.',
    '- Satu beat utama per paragraf. Jangan campur banyak ide dalam satu blok.',
    '- Hook dalam ±100 kata pertama. Penutup: cliffhanger / konfrontasi / ancaman / pilihan / reveal kecil (kecuali bab akhir).',
    '- Bahasa Indonesia modern, natural, emosional. Bukan puitis berat. Bukan lore dump.',
    '- Setiap tokoh bicara beda (register, kebiasaan). Jangan semua sama suaranya.',
    '',
    'DILARANG:',
    '- Dinding teks / paragraf panjang berturut-turut.',
    '- Eksposisi "seolah menjelaskan plot" ke pembaca.',
    '- Metafora AI generik berulang.',
    '- Dialog yang hanya mengulang info yang sudah diketahui pembaca.',
    '- Frasa seperti "pilihan menunggumu", "bab berikutnya", "keputusan itu milikmu".',
  ].join('\n')
}

/** Instruksi format keluaran + ringkas target gaya untuk user prompt. */
export function mobileDramaOutputFormat(): string {
  return [
    'FORMAT KELUARAN (WAJIB):',
    'Baris pertama tepat: JUDUL: <judul bab tanpa nomor bab>',
    'Satu baris kosong, lalu prosa.',
    `Pisahkan SETIAP paragraf dengan satu baris kosong (target ${PROSE_PARAGRAPH_MIN}–${PROSE_PARAGRAPH_MAX} paragraf).`,
    'Mayoritas paragraf 1–3 kalimat. Banyak dialog dalam tanda kutip.',
    'Jangan markdown, bullet, atau label lain.',
  ].join('\n')
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export function paragraphWordCount(paragraph: string): number {
  return countWords(paragraph)
}

/** Heuristik kasar: baris yang mengandung kutipan dialog. */
export function looksLikeDialogue(paragraph: string): boolean {
  return /["“][^"”]+["”]/.test(paragraph) || /^["“]/.test(paragraph.trim())
}
