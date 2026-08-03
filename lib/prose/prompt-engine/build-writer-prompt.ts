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
 *
 * HIERARKI PROMPT KONTRAK CONTINUITY:
 * [1] INVARIAN CANON (Nama persis, forbidden reveals, ending terkunci)
 * [2] RIWAYAT PEMBACA (Akhir Bab N-1 3–5 paragraf, pilihan, konsekuensi)
 * [3] KEADAAN CERITA (Route state, active threads, facts, timeline)
 * [4] SASARAN BAB (Chapter goal CC-aware, planned beats)
 * [5] KERANGKA & GAYA (Fase, word count, output format, repair block)
 */
export function buildWriterPrompt(input: BuildWriterPromptInput): WriterPromptParts {
  const { words, paragraphs } = MOBILE_DRAMA_RHYTHM
  const chapter = input.chapterNumber
  const scenes = Math.min(Math.max(input.sceneCount ?? 3, 2), 4)
  const names = input.characterNames ?? []
  const beats = input.plannedBeats ?? []
  const cc = input.continuation

  const system = mobileDramaSystemPrompt()

  // --- Lapis 1: INVARIAN CANON ---
  const layer1CanonInvariants = [
    '=== [1] INVARIAN CANON (MANDATORI / HARUS DIPATUHI) ===',
    names.length ? `- Tokoh yang boleh tampil (nama persis): ${names.join(', ')}.` : '',
    '- JANGAN memperkenalkan tokoh bernama baru di luar daftar.',
    '- JANGAN membocorkan rahasia yang belum waktunya / belum terungkap.',
    cc?.mustNotReveal?.length
      ? `- RAHASIA DILARANG UNTUK DIKONTAMINASI/DIUNGKAP: ${cc.mustNotReveal.join(', ')}`
      : '',
  ].filter(Boolean).join('\n')

  // --- Lapis 2: RIWAYAT PEMBACA ---
  let layer2ReaderHistory = ''
  if (cc && cc.previousChapter) {
    const prevEnding = cc.previousChapter.endingParagraphs.map((p) => `> ${p}`).join('\n')
    const choiceBlock = cc.previousChoice
      ? [
          `- Pilihan Pembaca di Bab ${cc.previousChapter.number} [${cc.previousChoice.choiceId}]: "${cc.previousChoice.label}"`,
          `- Konsekuensi Kanonik Pilihan: ${cc.previousChoice.consequence.join(' / ')}`,
          cc.previousChoice.effectSummary ? `- Ringkasan Efek: ${JSON.stringify(cc.previousChoice.effectSummary)}` : '',
          // Tanpa ini model memperlakukan konsekuensi sebagai saran dan sering
          // MEMBATALKAN pilihan pembaca di paragraf awal (mis. "tunda laporan"),
          // sehingga cabang A dan B menyatu kembali.
          '- KONSEKUENSI DI ATAS SUDAH TERJADI DAN MENGIKAT. Bab ini menuliskan AKIBATNYA.',
          '  DILARANG membatalkan, menunda, atau membalik pilihan itu. DILARANG membuat tokoh',
          '  berubah pikiran sehingga cerita kembali ke jalur pilihan yang TIDAK diambil.',
        ].filter(Boolean).join('\n')
      : `- (Bab ${cc.previousChapter.number} tidak memiliki pilihan pembaca / linear)`

    layer2ReaderHistory = [
      '=== [2] RIWAYAT PEMBACA & AKHIR BAB SEBELUMNYA ===',
      `Potongan Paragraf Terakhir Bab ${cc.previousChapter.number} ("${cc.previousChapter.title}"):`,
      prevEnding,
      '',
      choiceBlock,
    ].join('\n')
  }

  // --- Lapis 3: KEADAAN CERITA & BUDGET CONTROL (1200 token budget proxy ~4800 chars) ---
  let layer3StoryState = ''
  if (cc) {
    let threads = cc.openThreads.map((t) => `- Thread Aktif: ${t.id} (${t.status})`).join('\n')
    // Field spesifik, bukan objeknya: interpolasi objek menghasilkan
    // "[object Object]" dan menghapus seluruh fakta/kronologi dari prompt.
    let facts = cc.anchorFacts
      .map((f) => `- Fakta Mapan (Bab ${f.establishedChapter}): ${f.statement}`)
      .join('\n')
    let timeline = cc.recentTimeline
      .map((t) => `- Kronologi Pasti (Bab ${t.chapterNumber}): ${t.description}`)
      .join('\n')

    let blockContent = [
      '=== [3] KEADAAN CERITA ===',
      `Rute & Status Pembaca: ${cc.routeStateSummary}`,
      threads ? `Thread Aktif:\n${threads}` : '',
      facts ? `Fakta Terbukti:\n${facts}` : '',
      timeline ? `Kronologi Terbaru:\n${timeline}` : '',
    ].filter(Boolean).join('\n')

    // Proxy budget ~4800 karakter. Jika berlebih: pangkas timeline -> facts -> threads (excerpt/choice tidak tersentuh)
    if (blockContent.length > 4800 && timeline) {
      timeline = ''
      blockContent = [
        '=== [3] KEADAAN CERITA ===',
        `Rute & Status Pembaca: ${cc.routeStateSummary}`,
        threads ? `Thread Aktif:\n${threads}` : '',
        facts ? `Fakta Terbukti:\n${facts}` : '',
      ].filter(Boolean).join('\n')
    }
    if (blockContent.length > 4800 && facts) {
      facts = ''
      blockContent = [
        '=== [3] KEADAAN CERITA ===',
        `Rute & Status Pembaca: ${cc.routeStateSummary}`,
        threads ? `Thread Aktif:\n${threads}` : '',
      ].filter(Boolean).join('\n')
    }
    if (blockContent.length > 4800 && threads) {
      threads = ''
      blockContent = [
        '=== [3] KEADAAN CERITA ===',
        `Rute & Status Pembaca: ${cc.routeStateSummary}`,
      ].filter(Boolean).join('\n')
    }

    layer3StoryState = blockContent
  }

  // --- Lapis 4: SASARAN BAB ---
  const layer4ChapterGoal = [
    '=== [4] SASARAN BAB & ALUR BEAT ===',
    `Tulis Bab ${chapter} drama interaktif berbahasa Indonesia.`,
    'POV: orang pertama "aku" sebagai tokoh utama (protagonis di daftar nama bila ada).',
    input.goal
      ? `Tujuan Bab (hubungkan langsung dengan akibat pilihan pembaca): ${input.goal}`
      : '',
    input.chapterMode ? `Mode adegan dominan: ${input.chapterMode}.` : '',
    beats.length
      ? `Beat Wajib — tunjukkan lewat adegan & aksi konkret, bukan deskripsi ringkas:\n${beats.map((b) => `- ${b}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n')

  // --- Lapis 5: KERANGKA & GAYA ---
  const layer5FrameworkAndStyle = [
    '=== [5] KERANGKA, RITME & FORMAT OUTPUT ===',
    input.phase ? `Fase cerita: ${input.phase}.` : '',
    input.voiceGuidance ?? '',
    `Tulis ${scenes} adegan PENUH yang mengalir di lokasi konkret; tiap adegan minimal ~${Math.round(words.softMin / scenes)} kata dengan dialog panjang, deskripsi indrawi, dan monolog batin tokoh.`,
    `PANJANG WAJIB minimal ${words.softMin} kata (target ${words.softMin}–${words.softMax}; jangan lewat ${words.hardMax}). JANGAN meringkas atau mempercepat alur — jika terasa kurang dari ${words.softMin} kata, tambahkan adegan atau perpanjang dialog, bukan filler.`,
    `Jumlah paragraf ${paragraphs.softMin}–${paragraphs.softMax} (wajib ${paragraphs.hardMin}–${paragraphs.hardMax}).`,
    'Buka dengan alur langsung yang menyambung dari paragraf terakhir / akibat pilihan.',
    'Tutup dengan 3–5 paragraf cliffhanger pendek (kecuali bab akhir cerita).',
    repairBlock(input.repairFindings),
    mobileDramaOutputFormat(),
  ].filter(Boolean).join('\n')

  const user = [
    layer1CanonInvariants,
    layer2ReaderHistory,
    layer3StoryState,
    layer4ChapterGoal,
    layer5FrameworkAndStyle,
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
