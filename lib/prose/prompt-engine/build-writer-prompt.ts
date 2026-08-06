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
    // M10-A closure: jangkar kisah global langsung di layer 1 (bukan tersirat
    // dari contract yang tak pernah sampai ke writer).
    cc?.storyAnchors
      ? [
          '',
          '=== [1a] SANGKAR KISAH (JANGKAR GLOBAL — JANGAN MELANGGAR) ===',
          cc.storyAnchors.corePromise
            ? `- Janji Inti Cerita: ${cc.storyAnchors.corePromise}`
            : '',
          cc.storyAnchors.mainConflict
            ? `- Konflik Utama (harus tetap terasa di bab ini): ${cc.storyAnchors.mainConflict}`
            : '',
          cc.storyAnchors.finalQuestion
            ? chapter >= 45
              ? `- PERTANYAAN AKHIR (WAJIB diarahkan ke jawaban, ending mendekat): ${cc.storyAnchors.finalQuestion}`
              : `- Pertanyaan akhir cerita yang menggantung: ${cc.storyAnchors.finalQuestion}`
            : '',
        ].filter(Boolean).join('\n')
      : '',
    // Ending lock dipancarkan EKSPLISIT begitu terkunci (Bab >= 45) — bukan
    // hanya diklaim di komentar (M10-A closure).
    cc?.lockedEndingKey
      ? `- ENDING SUDAH TERKUNCI pada "${cc.lockedEndingKey}". Semua pilihan/akibat bab ini harus mengarah ke ending tersebut.`
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

  // --- Lapis 3: KEADAAN CERITA & BUDGET CONTROL (total ≤ 4800 chars) ---
  let layer3StoryState = ''
  let layer3Eviction: WriterPromptParts['layer3Eviction']
  if (cc) {
    // Field spesifik, bukan objeknya: interpolasi objek menghasilkan
    // "[object Object]" dan menghapus seluruh fakta/kronologi dari prompt.
    const threadLines = cc.openThreads
      .map((t) => `- Thread Aktif: ${t.id} (${t.status})`)
    const factLines = cc.anchorFacts
      .map((f) => `- Fakta Mapan (Bab ${f.establishedChapter}): ${f.statement}`)
    const timelineLines = cc.recentTimeline
      .map((t) => `- Kronologi Pasti (Bab ${t.chapterNumber}): ${t.description}`)
    // M10-A closure: ringkasan babak yang sudah selesai turut dibawa ke writer
    // (dulu hanya ada di compiler, tak pernah sampai prompt = DEAD_PATH).
    const rollupLines = cc.actRollups.length
      ? ['Ringkasan Babak Terlewati:', ...cc.actRollups.map(
          (r) => `- Babak ${r.actNumber} (Bab 1-${r.coversToChapter}): ${r.summary}`,
        )]
      : []

    const sections: Array<{
      id: 'threads' | 'facts' | 'timeline' | 'rollups'
      header: string | null
      lines: string[]
    }> = [
      { id: 'threads' as const, header: 'Thread Aktif:', lines: threadLines },
      { id: 'facts' as const, header: 'Fakta Terbukti:', lines: factLines },
      { id: 'timeline' as const, header: 'Kronologi Terbaru:', lines: timelineLines },
      { id: 'rollups' as const, header: null, lines: rollupLines },
    ].filter((s) => s.lines.length > 0)

    const render = (): string => {
      const parts: string[] = [
        '=== [3] KEADAAN CERITA ===',
        `Rute & Status Pembaca: ${cc.routeStateSummary}`,
      ]
      for (const section of sections) {
        if (section.lines.length === 0) continue
        if (section.header) parts.push(section.header)
        parts.push(...section.lines)
      }
      return parts.join('\n')
    }

    // Trim GRANULAR per baris (tertua dibuang dulu), bukan whole-section:
    // urutan prioritas timeline -> facts -> threads -> rollups. Baris yang
    // dibuang dicatat untuk observability (layer3Eviction), tidak pernah
    // memotong excerpt/pilihan pembaca.
    const trimPriority: Array<typeof sections[number]['id']> = ['timeline', 'facts', 'threads', 'rollups']
    const evicted: WriterPromptParts['layer3Eviction'] = { timeline: 0, facts: 0, threads: 0, rollups: 0 }
    let content = render()
    while (content.length > 4800) {
      const target = trimPriority
        .map((id) => sections.find((s) => s.id === id))
        .find((s) => s && s.lines.length > 0)
      if (!target) break // patologi: semua seksi habis, terima overshoot minimal
      target.lines.pop()
      evicted[target.id] = (evicted[target.id] ?? 0) + 1
      content = render()
    }

    layer3StoryState = content
    layer3Eviction = evicted
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
    ...(layer3Eviction !== undefined ? { layer3Eviction } : {}),
  }
}
