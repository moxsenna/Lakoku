import {
  MOBILE_DRAMA_RHYTHM,
  STYLE_PROFILE_ID,
  mobileDramaOutputFormat,
  mobileDramaSystemPrompt,
} from '@/lib/prose/mobile-drama-style'
import type { BuildWriterPromptInput, WriterPromptParts } from './types'

function repairBlock(
  findings: BuildWriterPromptInput['repairFindings'],
): string {
  if (!findings?.length) return ''
  const lines = findings
    .filter((f) => f.severity === 'CRITICAL' || f.severity === 'MAJOR' || !f.severity)
    .map((f) => `- ${f.message}`)
  if (!lines.length) return ''
  return [
    'PERBAIKAN WAJIB (revisi sebelumnya bermasalah):',
    ...lines,
    'Jika bab kurang kata: tulis ulang JAUH lebih panjang — tiap adegan minimal ~250 kata dengan dialog panjang, deskripsi indrawi, dan monolog batin. JANGAN meringkas; tambah adegan bila perlu, bukan filler.',
  ].join('\n')
}

/**
 * Satu pintu system + user prompt writer prosa.
 * Angka ritme hanya dari MOBILE_DRAMA_RHYTHM.
 */
export function buildWriterPrompt(input: BuildWriterPromptInput): WriterPromptParts {
  const { words, paragraphs } = MOBILE_DRAMA_RHYTHM
  const chapter = input.chapterNumber
  const scenes = Math.min(Math.max(input.sceneCount ?? 3, 2), 4)
  const names = input.characterNames ?? []
  const beats = input.plannedBeats ?? []

  const system = mobileDramaSystemPrompt()

  const user = [
    `Tulis Bab ${chapter} drama interaktif berbahasa Indonesia.`,
    'POV: orang pertama "aku" sebagai tokoh utama (protagonis di daftar nama bila ada).',
    input.phase ? `Fase cerita: ${input.phase}.` : '',
    input.goal
      ? `Tujuan bab (jalankan lewat aksi & dialog, jangan dieksposisi mentah): ${input.goal}`
      : '',
    input.chapterMode ? `Mode adegan dominan: ${input.chapterMode}.` : '',
    names.length ? `Tokoh yang boleh tampil (nama persis): ${names.join(', ')}.` : '',
    input.voiceGuidance ?? '',
    beats.length
      ? `Beat wajib — tunjukkan lewat adegan, bukan ringkasan:\n${beats.map((b) => `- ${b}`).join('\n')}`
      : '',
    `Tulis ${scenes} adegan PENUH yang mengalir di lokasi konkret; tiap adegan minimal ~${Math.round(words.softMin / scenes)} kata dengan dialog panjang, deskripsi indrawi, dan monolog batin tokoh.`,
    `PANJANG WAJIB minimal ${words.softMin} kata (target ${words.softMin}–${words.softMax}; jangan lewat ${words.hardMax}). JANGAN meringkas atau mempercepat alur — jika terasa kurang dari ${words.softMin} kata, tambahkan adegan atau perpanjang dialog, bukan filler.`,
    `Jumlah paragraf ${paragraphs.softMin}–${paragraphs.softMax} (wajib ${paragraphs.hardMin}–${paragraphs.hardMax}).`,
    'Buka dengan konflik/lanjutan dalam ±100 kata pertama.',
    'Tutup dengan 3–5 paragraf cliffhanger pendek (kecuali bab akhir cerita).',
    'Jangan memperkenalkan tokoh bernama baru di luar daftar.',
    'Jangan membocorkan rahasia yang belum waktunya.',
    repairBlock(input.repairFindings),
    mobileDramaOutputFormat(),
  ]
    .filter(Boolean)
    .join('\n\n')

  return {
    system,
    user,
    styleProfileId: STYLE_PROFILE_ID,
    wordTarget: {
      hardMin: words.hardMin,
      hardMax: words.hardMax,
      softMin: words.softMin,
      softMax: words.softMax,
    },
    paragraphTarget: {
      hardMin: paragraphs.hardMin,
      hardMax: paragraphs.hardMax,
      softMin: paragraphs.softMin,
      softMax: paragraphs.softMax,
    },
  }
}
