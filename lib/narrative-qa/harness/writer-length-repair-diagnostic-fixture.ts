import { buildFixtureSnapshot } from '@/fixtures/narrative/fixture-50'
import { buildContinuationContext, compileContext } from '@lakoku/narrative-core'
import { buildPreProseChapterBrief } from '@/lib/story-engine/pre-prose-brief'

export function buildWriterLengthRepairDiagnosticFixture(chapterNumber: number) {
  const snapshot = buildFixtureSnapshot()
  const blueprint = snapshot.blueprints[chapterNumber - 1]
  if (!blueprint) throw new Error('CAUSAL_DIAGNOSTIC_FIXTURE_BLUEPRINT_MISSING')

  const packet = compileContext(snapshot, chapterNumber)
  const isOpeningChapter = chapterNumber === 1
  const forgedWillRevealAllowed = chapterNumber >= 12
  const previousChoice = isOpeningChapter
    ? null
    : forgedWillRevealAllowed
      ? {
          chapterNumber: chapterNumber - 1,
          choiceId: 'diagnostic-buka-brankas',
          label: 'Buka brankas notaris bersama Dimas',
          consequence: [
            'Rani menemukan salinan wasiat yang berbeda',
            'Dimas setuju membantu Rani menghadapi Ratna',
          ],
          effectSummary: {
            truth: 2,
            risk: 1,
            flagsSet: ['wasiat_copy_found'],
          },
          createdAt: '2026-08-31T12:00:00.000Z',
        }
      : {
          chapterNumber: chapterNumber - 1,
          choiceId: 'diagnostic-temui-notaris',
          label: 'Temui Pak Hendra bersama Dimas',
          consequence: [
            'Rani memastikan surat wasiat disimpan di brankas notaris',
            'Dimas setuju membantu Rani mencari sejarah warisan keluarga',
          ],
          effectSummary: {
            truth: 1,
            risk: 1,
            flagsSet: ['notary_meeting_complete'],
          },
          createdAt: '2026-08-31T12:00:00.000Z',
        }
  const previousChapterRow = isOpeningChapter
    ? null
    : forgedWillRevealAllowed
      ? {
          number: chapterNumber - 1,
          title: 'Kunci di Tangan Notaris',
          paragraphs: [
            'Aku menahan napas ketika kunci tua itu akhirnya berputar.',
            'Di dalam brankas, dua lembar wasiat membawa tanggal yang sama tetapi tanda tangan berbeda.',
            'Dimas berdiri di sampingku dan berjanji tidak akan membiarkan Ratna mengambil bukti itu.',
            'Langkah Ratna terdengar dari lorong ketika aku menyelipkan salinan wasiat ke balik jaket.',
          ],
        }
      : {
          number: chapterNumber - 1,
          title: 'Pesan dari Pak Hendra',
          paragraphs: [
            'Pak Hendra meminta kami datang sebelum kantor notaris tutup.',
            'Ia memastikan satu surat wasiat keluarga tersimpan di dalam brankas kantornya.',
            'Dimas mencatat nama saksi lama yang mungkin tahu sejarah rumah di desa.',
            'Aku pulang dengan lebih banyak pertanyaan tentang warisan keluargaku.',
          ],
        }
  const continuation = buildContinuationContext({
    storyId: snapshot.storyId,
    targetChapterNumber: chapterNumber,
    snapshot,
    packet,
    previousChapterRow,
    previousChoice,
    routeStateSummary: isOpeningChapter
      ? 'Rani baru memulai pencarian tentang warisan keluarganya.'
      : forgedWillRevealAllowed
        ? 'Rani memilih jalur kebenaran dengan risiko meningkat dan kepercayaan Dimas menguat.'
        : 'Rani mengikuti petunjuk sah tentang warisan keluarga sambil membangun kepercayaan dengan Dimas.',
    lockedEndingKey: null,
    storyAnchors: {
      corePromise: 'Rani membongkar kebenaran warisan keluarganya tanpa kehilangan dirinya.',
      mainConflict: forgedWillRevealAllowed
        ? 'Rani melawan Ratna untuk membuktikan pemalsuan wasiat.'
        : 'Rani menghadapi Ratna untuk mengungkap kebenaran warisan keluarga.',
      finalQuestion: 'Apakah kebenaran warisan akan memerdekakan atau menghancurkan keluarga Rani?',
    },
  })
  const brief = buildPreProseChapterBrief({
    storyId: snapshot.storyId,
    chapterNumber,
    snapshot,
    blueprint,
    continuation,
    chapterBrief: null,
  })

  return {
    snapshot,
    blueprint,
    continuation,
    brief,
    previousChapterNumber: continuation.previousChapter?.number ?? null,
    contextSafety: isOpeningChapter
      ? 'OPENING_NO_PREVIOUS'
      : forgedWillRevealAllowed ? 'REVEAL_AWARE' : 'PRE_GATE_NOTARY_ONLY',
    completedActRollupCount: snapshot.actRollups.filter(
      (rollup) => rollup.coversToChapter < chapterNumber,
    ).length,
  } as const
}
