import {
  MOBILE_DRAMA_RHYTHM,
  STYLE_PROFILE_ID,
  mobileDramaSystemPrompt,
} from '@/lib/prose/mobile-drama-style'
import type { BuildWriterPromptInput, WriterPromptParts } from './types'

function writerVisible(value: string, authorityIds: readonly string[]): string {
  let visible = value
  for (const authorityId of authorityIds) {
    visible = visible.split(authorityId).join('rahasia kanonik')
  }
  return visible
}

function buildChapterBriefV2Prompt(input: BuildWriterPromptInput): WriterPromptParts {
  const brief = input.brief
  if (!brief) throw new Error('CHAPTER_BRIEF_V2_BRIEF_REQUIRED')

  const { words, paragraphs } = MOBILE_DRAMA_RHYTHM
  const names = input.characterNames ?? []
  const beats = input.plannedBeats ?? []
  const cc = input.continuation
  const authorityIds = [
    ...brief.forbiddenRevealIds,
    ...brief.resolvedPlotDebtIds,
    ...brief.scheduledReveals.map((item) => item.authorityId),
    ...brief.plotDebtsToProgress.map((item) => item.authorityId),
    ...brief.plotDebtsToClose.map((item) => item.authorityId),
    ...(brief.lockedEndingKey === null ? [] : [brief.lockedEndingKey]),
  ]
  const safe = (value: string) => writerVisible(value, authorityIds)
  const lines = (values: readonly string[]) => values.map((value) => `- ${safe(value)}`)
  const obligationLines = (label: string, values: typeof brief.scheduledReveals) => (
    values.length > 0
      ? [label, ...values.map((item) => `- ${safe(item.writerDirective)}`)]
      : []
  )

  const p0 = [
    '=== [P0] INVARIAN CANON & KEAMANAN (MANDATORI / HARUS DIPATUHI) ===',
    names.length > 0 ? `- Tokoh yang boleh tampil (nama persis): ${names.join(', ')}.` : '',
    '- DILARANG memunculkan tokoh bernama baru yang tidak ada dalam daftar di atas.',
    brief.mustNotReveal.length > 0
      ? '- RAHASIA DILARANG UNTUK DIUNGKAP/DIBOCORKAN:'
      : '',
    ...lines(brief.mustNotReveal),
    '- DILARANG membocorkan istilah teknis atau metadata internal.',
  ].filter(Boolean).join('\n')

  const endingLines = brief.lockedEndingKey === null
    ? []
    : [
        '- ARAH AKHIR CERITA (ENDING TERKUNCI): Cerita telah mengunci arah resolusi menuju ending terpilih.',
        ...lines(brief.lockedEndingClosure),
        '- Semua tindakan, ketegangan, dan akibat adegan bab ini WAJIB mengarah ke penyelesaian tersebut.',
      ]
  const anchorLines = cc?.storyAnchors
    ? [
        cc.storyAnchors.corePromise ? `- Janji Inti Cerita: ${safe(cc.storyAnchors.corePromise)}` : '',
        cc.storyAnchors.mainConflict ? `- Konflik Utama: ${safe(cc.storyAnchors.mainConflict)}` : '',
        cc.storyAnchors.finalQuestion ? `- Pertanyaan Akhir Cerita: ${safe(cc.storyAnchors.finalQuestion)}` : '',
      ].filter(Boolean)
    : []
  const p1 = [
    '=== [P1] KEWAJIBAN NARATIF MANDATORI BAB INI ===',
    ...endingLines,
    ...obligationLines('- REVEAL / TITIK BALIK WAJIB:', brief.scheduledReveals),
    ...obligationLines('- HUTANG PLOT WAJIB DIMAJUKAN:', brief.plotDebtsToProgress),
    ...obligationLines('- HUTANG PLOT HARUS DITUTUP:', brief.plotDebtsToClose),
    ...anchorLines,
  ].join('\n')

  const previousEnding = cc?.previousChapter?.endingParagraphs
    .map((paragraph) => `> ${safe(paragraph)}`)
    .join('\n') ?? '-'
  const previousChoice = cc?.previousChoice
  const context = [
    '=== KONTEKS: RIWAYAT PEMBACA & AKIBAT PILIHAN ===',
    'Potongan Paragraf Akhir Bab Sebelumnya:',
    previousEnding,
    previousChoice ? `- Pilihan: "${safe(previousChoice.label)}"` : '- Pilihan: -',
    previousChoice
      ? `- Konsekuensi Kanonik: ${previousChoice.consequence.map(safe).join(' / ')}`
      : '- Konsekuensi Kanonik: -',
    previousChoice
      ? '- KONSEKUENSI DI ATAS TELAH TERJADI DAN MENGIKAT. Buka bab ini dengan menyambung langsung akibat tersebut. DILARANG menganulir atau membatalkan pilihan pembaca.'
      : '',
    brief.routeStateSummary ? `- Keadaan rute: ${safe(brief.routeStateSummary)}` : '',
  ].filter(Boolean).join('\n')

  const p2 = [
    '=== [P2] PENYELESAIAN DRAMATIS ADEGAN & RENCANA BAB ===',
    `- Tujuan Bab: ${safe(brief.chapterGoal)}`,
    beats.length > 0 ? '- Beat Wajib yang Harus Dijalani Tokoh:' : '',
    ...lines(beats),
    '- Tulis 2–4 adegan berkesinambungan di lokasi fisik nyata yang mengalir tanpa lompatan waktu drastis.',
    '- Terapkan Show, Don\'t Tell: fokus pada aksi fisik, reaksi emosional tubuh, dan subteks dialog.',
    '- Bangun penutupan dramatis yang tuntas pada akhir bab, mengerucut pada cliffhanger yang tajam dan bermakna.',
  ].filter(Boolean).join('\n')

  const p3 = [
    '=== [P3] OTORITAS PANJANG KATA ===',
    '- Target utama penulisan: 850–950 kata.',
    '- Batas penerimaan keras: 800–1000 kata.',
    '- Kembangkan interaksi sensorik dan dinamika dialog untuk mencapai rentang target; hindari ringkasan naratif tergesa-gesa.',
  ].join('\n')

  const p4 = [
    '=== [P4] SUARA TOKOH & KETERBACAAN MOBILE ===',
    '- Pertahankan sudut pandang orang pertama ("aku") secara konsisten.',
    input.voiceGuidance ? `- Panduan Suara Karakter:\n${safe(input.voiceGuidance)}` : '',
    '- Format pergantian ucapan tokoh dipisahkan dengan jelas agar pembaca mudah mengikuti percakapan.',
  ].filter(Boolean).join('\n')

  const p5 = [
    '=== [P5] RITME PARAGRAF KUALITATIF ===',
    'Gunakan paragraf yang nyaman dibaca di layar ponsel.',
    'Hindari dinding teks panjang.',
    'Pisahkan pergantian pembicara dan perubahan fokus dengan jelas.',
    'Biarkan panjang paragraf mengikuti kebutuhan aksi, reaksi, dialog, dan tensi adegan.',
  ].join('\n')

  const output = [
    '=== KONTRAK KELUARAN ===',
    'Keluaran WAJIB diawali dengan:',
    'JUDUL: <Judul Bab yang Menggugah>',
    '<Prosa lengkap...>',
  ].join('\n')

  return {
    system: mobileDramaSystemPrompt(),
    user: [p0, p1, context, p2, p3, p4, p5, output].join('\n\n'),
    styleProfileId: STYLE_PROFILE_ID,
    wordTarget: { ...words },
    paragraphTarget: { ...paragraphs },
  }
}

export function buildWriterPrompt(input: BuildWriterPromptInput): WriterPromptParts {
  if (!input.brief) throw new Error('CHAPTER_BRIEF_V2_BRIEF_REQUIRED')
  return buildChapterBriefV2Prompt(input)
}
