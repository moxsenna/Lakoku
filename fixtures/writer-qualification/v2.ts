import type {
  CanonSnapshot,
  ChapterBlueprint,
  ContinuationContext,
} from '@lakoku/narrative-core'
import { buildProductionChapterWriterPrompt } from '@/lib/ai-gateway/chapter-writer-contract'
import { generatePlan } from '@/lib/ai-gateway/gateway'
import type { ChapterPlan } from '@/lib/ai-gateway/schemas'
import { createDeterministicProvider } from '@/lib/ai-gateway/provider'
import { buildContractFixture } from '@/fixtures/contracts/build-contract-fixture'
import { misteriDramaContract } from '@/fixtures/contracts/misteri-drama'
import { buildPremiumBilikKetujuhV2Snapshot } from '@/fixtures/narrative/premium-bilik-ketujuh-v2'
import { latestBlueprintForChapter } from '@/lib/narrative/blueprint'
import { buildContinuationContext } from '@/lib/narrative/continuation-context'
import { compileContext } from '@/lib/narrative/compiler'
import { ChapterBriefSchema, buildChapterBrief } from '@/lib/story-engine/chapter-brief'
import {
  PreProseChapterBriefSchema,
  buildPreProseChapterBrief,
  type PreProseChapterBrief,
} from '@/lib/story-engine/pre-prose-brief'
import { computeSha256, stableStringify } from '@/lib/narrative-qa/scoring/canonical-serializer'
import { parseStoryContract, StoryContractSchema, type StoryContract } from '@/lib/story-engine/story-contract'

export const WRITER_QUALIFICATION_FIXTURE_V2_KEYS = [
  'EARLY',
  'DIALOGUE',
  'MYSTERY',
  'EMOTIONAL',
  'LATER_ACT',
] as const

export type QualificationFixtureV2Key = (typeof WRITER_QUALIFICATION_FIXTURE_V2_KEYS)[number]

export type QualificationPositiveChannel =
  | 'goal'
  | 'beats'
  | 'previousProse'
  | 'choiceConsequence'
  | 'facts'
  | 'timeline'
  | 'routeSummary'
  | 'storyAnchors'

export type QualificationSecretAuthority = Readonly<{
  secretId: string
  meaning: string
  revealGateChapter: number
  explicitLeakMarker: string
}>

export type QualificationProductionSourceChannel =
  | 'blueprintGoal'
  | 'blueprintBeat'
  | 'characterName'
  | 'voiceGuidance'
  | 'previousProse'
  | 'choiceLabel'
  | 'choiceConsequence'
  | 'routeState'
  | 'thread'
  | 'fact'
  | 'timeline'
  | 'rollup'
  | 'storyAnchor'

export type QualificationAuditedProjectionChannel = QualificationProductionSourceChannel
  | 'planChapterGoal'
  | 'planPlannedBeats'
  | 'writerSystem'
  | 'writerPrompt'

export interface QualificationSourceAuthorityOverride {
  fixtureKey: QualificationFixtureV2Key
  channel: QualificationProductionSourceChannel
  value: string
}

export type BuilderStage =
  | 'StoryContractSchema'
  | 'parseStoryContract'
  | 'latestBlueprintForChapter'
  | 'buildChapterBrief'
  | 'compileContext'
  | 'buildContinuationContext'
  | 'buildPreProseChapterBrief'
  | 'generatePlan'
  | 'buildProductionChapterWriterPrompt'

const COMMON_BUILDER_STAGES: readonly BuilderStage[] = [
  'StoryContractSchema',
  'parseStoryContract',
  'latestBlueprintForChapter',
  'buildChapterBrief',
  'compileContext',
]

function expectedBuilderStages(key: QualificationFixtureV2Key): readonly BuilderStage[] {
  return [
    ...COMMON_BUILDER_STAGES,
    ...(key === 'EARLY' ? [] : ['buildContinuationContext' as const]),
    'buildPreProseChapterBrief',
    'generatePlan',
    'buildProductionChapterWriterPrompt',
  ]
}

export interface QualificationFixtureV2ValidationRow {
  key: QualificationFixtureV2Key
  chapterNumber: number
  source: {
    phaseKind: 'OPENING' | 'EARLY' | 'SCHEDULED_REVEAL' | 'MIDSTORY' | 'LATER_ACT'
    remainingChapters: number
    beats: string[]
    forbiddenRevealIds: string[]
    forbiddenRevealMeanings: string[]
    scheduledReveal: { secretId: string; gateChapter: number; obligation: string } | null
    selectedEndingMeaning: string | null
    secretAuthorities: QualificationSecretAuthority[]
    positiveChannels: Record<QualificationPositiveChannel, string[]>
    prohibitionChannel: string[]
  }
  continuity: {
    previousChapterNumber: number | null
    previousChoiceChapter: number | null
    visibleEstablishedChapters: number[]
    visibleTimelineChapters: number[]
  }
  projection: {
    scheduledRevealObligationConcrete: boolean
    scheduledRevealWriterVisible: boolean
    futureRevealLeaks: string[]
    auditedPositiveChannels: Record<QualificationAuditedProjectionChannel, string[]>
    prohibitionChannel: string[]
    exactPlanChapterGoal: string
    exactPlanPlannedBeats: string[]
    exactPlanProposedStateDeltaKeys: string[]
    productionSelectedEndingLock: boolean
    writerVisibleEndingLock: boolean
    writerVisibleEndingMeaning: string | null
    writerVisibleEndingRawKey: string | null
    authorityBinding: {
      fixtureHash: string
      chapterBriefHash: string
      preProseBriefHash: string
      planHash: string
      authorityMode: 'CHAPTER_BRIEF_V2'
      briefBindingHash: string
      projectedObligationAuthorityIds: string[]
      writerDirectiveHashes: string[]
      forbiddenRevealIdentityHashes: string[]
      endingAuthorityProjectionHash: string | null
      writerVisibleInternalIdCount: number
      legacyFallbackUsed: false
    }
    semanticEvidence: {
      proposedStateDelta: { keys: string[]; nonempty: boolean }
      writerVisibleFindings: Array<{
        channel: 'chapterGoal' | 'plannedBeat'
        normalizedValue: string
        artifactHash: string
      }>
      characterOccurrences: Array<{
        characterName: string
        inPlannedBeats: boolean
        inWriterProjection: boolean
        artifactHash: string
      }>
      scheduledReveal: {
        secretId: string
        presentInExactPlan: boolean
        presentInWriterSemanticProjection: boolean
      } | null
      continuation: {
        present: boolean
        outputHash: string | null
        previousChapterNumber: number | null
        previousChoiceChapter: number | null
      }
      artifactBindings: {
        plan: {
          stageOutputHash: string
          safeArtifact: {
            normalizedChapterGoal: string
            normalizedPlannedBeats: string[]
            proposedStateDeltaKeys: string[]
            characterNamesInPlannedBeats: string[]
            scheduledRevealSecretIds: string[]
          }
          safeArtifactHash: string
        }
        writer: {
          stageOutputHash: string
          safeArtifact: {
            authorityMode: 'CHAPTER_BRIEF_V2'
            briefBindingHash: string
            visibleFindings: Array<{
              channel: 'chapterGoal' | 'plannedBeat'
              normalizedValue: string
            }>
            characterNamesInProjection: string[]
            projectedObligationAuthorityIds: string[]
            scheduledRevealSecretIds: string[]
            writerDirectiveHashes: string[]
            endingAuthorityProjectionHash: string | null
            writerVisibleInternalIdCount: number
            legacyFallbackUsed: false
          }
          safeArtifactHash: string
        }
        continuation: {
          stageOutputHash: string | null
          safeArtifact: {
            present: boolean
            previousChapterNumber: number | null
            previousChoiceChapter: number | null
          }
          safeArtifactHash: string
        }
      }
    }
  }
  provenance: {
    stages: BuilderStage[]
    stageEvidence: Array<{ stage: BuilderStage; outputHash: string }>
    artifactAuthorityHash: string
    notApplicableStages: Array<{
      stage: BuilderStage
      reason: 'BAB_1_PRODUCTION_CONTINUATION_IS_NULL'
    }>
    productionRequiredBriefFieldsPresent: boolean
    latestBlueprintVersion: number
  }
  privacy: {
    metadataValues: string[]
  }
  proof: {
    storyContractParsed: boolean
    chapterBriefParsed: boolean
    preProseBriefParsed: boolean
    planParsed: boolean
    writerProjectionBuilt: boolean
    continuationWasNullForPreProse: boolean
    continuationWasNullForPlan: boolean
    continuationWasNullForWriter: boolean
  }
}

export interface QualificationFixtureV2ValidationInput {
  fixtures: QualificationFixtureV2ValidationRow[]
}

export type QualificationFixtureV2IssueCode =
  | 'FIXTURE_SOURCE_GENERIC_PLACEHOLDER'
  | 'FIXTURE_SOURCE_DUPLICATE_SEMANTIC_BEAT'
  | 'FIXTURE_SOURCE_PREMATURE_REVEAL'
  | 'FIXTURE_SOURCE_ANACHRONISTIC_CONTINUITY'
  | 'PRODUCTION_PROJECTION_SCHEDULED_REVEAL_NOT_WRITER_VISIBLE'
  | 'PRODUCTION_PROJECTION_FUTURE_REVEAL_LEAK'
  | 'PRODUCTION_PROJECTION_ENDING_LOCK_NOT_WRITER_VISIBLE'
  | 'PRODUCTION_PROJECTION_REQUIRED_BRIEF_FIELD_MISSING'
  | 'PRODUCTION_PROJECTION_SEMANTIC_EVIDENCE_INVALID'
  | 'BUILDER_PROVENANCE_STAGE_BYPASSED'
  | 'PRIVACY_PRIVATE_IDENTIFIER'

export interface QualificationFixtureV2Issue {
  code: QualificationFixtureV2IssueCode
  fixtureKey: QualificationFixtureV2Key
  channel?: QualificationPositiveChannel | QualificationAuditedProjectionChannel
  secretId?: string
}

const CHAPTERS: Readonly<Record<QualificationFixtureV2Key, number>> = {
  EARLY: 1,
  DIALOGUE: 8,
  MYSTERY: 12,
  EMOTIONAL: 25,
  LATER_ACT: 45,
}

const REFERENCE_CLASS: Readonly<Record<QualificationFixtureV2Key, string>> = {
  EARLY: 'OPENING_PRODUCTION_LIKE',
  DIALOGUE: 'DIALOGUE_PRODUCTION_LIKE',
  MYSTERY: 'SCHEDULED_REVEAL_PRODUCTION_LIKE',
  EMOTIONAL: 'MIDSTORY_EMOTIONAL_PRODUCTION_LIKE',
  LATER_ACT: 'ENDING_LOCK_PRODUCTION_LIKE',
}

const PHASE_KIND: Readonly<Record<QualificationFixtureV2Key, QualificationFixtureV2ValidationRow['source']['phaseKind']>> = {
  EARLY: 'OPENING',
  DIALOGUE: 'EARLY',
  MYSTERY: 'SCHEDULED_REVEAL',
  EMOTIONAL: 'MIDSTORY',
  LATER_ACT: 'LATER_ACT',
}

const TARGET_CONTENT: Readonly<Record<QualificationFixtureV2Key, Readonly<{
  phase: string
  goal: string
  mustInclude: readonly string[]
  emotionalTurn: string
  movement: string
  blueprintBeat: string
}>>> = {
  EARLY: {
    phase: 'Pijakan',
    goal: 'Sinta menerima buku besar kedai ibunya dan menemukan satu halaman yang sengaja disobek.',
    mustInclude: ['Sinta membuka kedai setelah pemakaman dan memeriksa buku besar yang ditinggalkan ibunya.'],
    emotionalTurn: 'Duka Sinta berubah menjadi kecurigaan saat bekas sobekan terasa masih baru.',
    movement: 'Misteri buku besar dibuka melalui benda nyata, tanpa menetapkan siapa penulis catatan rahasia.',
    blueprintBeat: 'Tutup bab ketika Sinta menemukan bekas tinta biru pada tepi halaman yang hilang.',
  },
  DIALOGUE: {
    phase: 'Retak',
    goal: 'Sinta meminta penjelasan Arga tentang kuitansi gudang tanpa menuduhnya sebagai pemalsu.',
    mustInclude: ['Percakapan Sinta dan Arga beralih dari kerja sama menjadi saling menguji soal kuitansi gudang.'],
    emotionalTurn: 'Kepercayaan Sinta goyah ketika Arga mengenali cap gudang terlalu cepat.',
    movement: 'Hubungan Sinta dan Arga retak, sementara identitas penulis buku besar tetap tertutup.',
    blueprintBeat: 'Arga menyerahkan kunci loker, tetapi menolak menjelaskan dari siapa ia menerimanya.',
  },
  MYSTERY: {
    phase: 'Retak',
    goal: 'Sinta membuka loker stasiun dan membuktikan siapa yang menulis catatan rahasia dalam buku besar.',
    mustInclude: ['Buka rahasia terjadwal secret:ledger-author melalui kartu pos bertanda tangan Surya di dalam loker.'],
    emotionalTurn: 'Kemenangan Sinta menemukan bukti berubah menjadi takut karena Surya mengetahui penyelidikannya.',
    movement: 'Identitas penulis buku besar terbayar secara konkret dan mengarahkan penyelidikan ke pengiriman malam.',
    blueprintBeat: 'Buka rahasia terjadwal secret:ledger-author melalui kartu pos bertanda tangan Surya di dalam loker.',
  },
  EMOTIONAL: {
    phase: 'Titik Balik',
    goal: 'Sinta mengaku kepada Arga bahwa kecurigaannya telah merusak persahabatan mereka.',
    mustInclude: ['Sinta mengembalikan kunci loker kepada Arga dan meminta maaf tanpa menuntut pengampunan.'],
    emotionalTurn: 'Rasa bersalah Sinta berubah menjadi keberanian menerima jawaban Arga yang belum pasti.',
    movement: 'Hubungan mereka bergerak dari pengkhianatan menuju kemungkinan kerja sama yang bersyarat.',
    blueprintBeat: 'Arga menunjukkan surat ibunya yang membuktikan alasan ia menyembunyikan asal kunci.',
  },
  LATER_ACT: {
    phase: 'Krisis',
    goal: 'Sinta memilih cara membuka bukti penggelapan yang menentukan bentuk hidupnya setelah kedai terselamatkan.',
    mustInclude: ['Sinta membawa buku besar asli ke pertemuan warga dan menolak tawaran Surya untuk membakarnya.'],
    emotionalTurn: 'Ketakutan kehilangan kedai berubah menjadi tekad mempertahankan rumah bersama warga.',
    movement: 'Misteri utama memasuki pembayaran akhir dan pilihan Sinta mengunci akhir Rumah yang Dijaga Bersama.',
    blueprintBeat: 'Warga menandatangani pernyataan bersama sebelum Surya tiba untuk merebut buku besar.',
  },
}

function overrideFor(
  overrides: readonly QualificationSourceAuthorityOverride[],
  key: QualificationFixtureV2Key,
  channel: QualificationProductionSourceChannel,
): string | undefined {
  return overrides.find((override) => (
    override.fixtureKey === key && override.channel === channel
  ))?.value
}

function storyContract(
  overrides: readonly QualificationSourceAuthorityOverride[] = [],
): {
  contract: StoryContract
  schemaEvidence: { stage: BuilderStage; outputHash: string }
  parserEvidence: { stage: BuilderStage; outputHash: string }
} {
  const initial = buildContractFixture({
    storyId: 'fixture:kedai-hujan-v2',
    title: 'Kedai Setelah Hujan',
    genre: 'Misteri drama keluarga',
    tone: 'Intim, tegang, dan membumi',
    mainCharacter: {
      name: 'Sinta',
      role: 'Pengelola kedai dan penyelidik warisan ibunya',
      wound: 'Sinta menyesal tidak pulang sebelum ibunya meninggal.',
      desire: 'Menjaga kedai tetap hidup sambil memahami keputusan terakhir ibunya.',
    },
    mainConflict: 'Sinta melawan Surya yang menutupi penggelapan koperasi melalui catatan pengiriman kedai.',
    finalQuestion: 'Apakah Sinta akan menjaga kedai sebagai ruang bersama atau meninggalkannya setelah kebenaran terbuka?',
    corePromise: 'Penyelidikan benda-benda sehari-hari memaksa Sinta memilih antara kepemilikan, kebenaran, dan keluarga pilihan.',
    endingCandidates: [
      {
        key: 'rumah-bersama', name: 'Rumah yang Dijaga Bersama', kind: 'main',
        condition: 'Empati dan bukti publik menguat.',
        requiredClosure: ['Warga ikut menjaga kedai setelah bukti dibuka.'],
        requiredPlotDebtIds: ['main_mystery'], blockingConditions: [],
      },
      {
        key: 'jalan-baru', name: 'Jalan Baru di Luar Kedai', kind: 'main',
        condition: 'Kebenaran terbuka tetapi Sinta memilih pergi.',
        requiredClosure: ['Sinta menyerahkan kedai kepada koperasi baru.'],
        requiredPlotDebtIds: ['main_mystery'], blockingConditions: [],
      },
      {
        key: 'surat-ibu', name: 'Surat Terakhir Ibu', kind: 'secret',
        condition: 'Seluruh surat dan jejak pengiriman ditemukan.',
        requiredClosure: ['Pesan terakhir Ibu menjelaskan alasan kedai dipertahankan.'],
        requiredPlotDebtIds: ['main_mystery', 'debt:letter'], blockingConditions: [],
      },
    ],
    plotDebts: [
      { id: 'main_mystery', question: 'Siapa menulis catatan rahasia dan mengapa pengiriman disembunyikan?', introducedAt: 1, mustProgressBy: [8, 12, 25, 45], mustCloseBy: 48, status: 'progressing' },
      { id: 'debt:letter', question: 'Apa isi surat terakhir Ibu?', introducedAt: 6, mustProgressBy: [25, 45], mustCloseBy: 49, status: 'progressing' },
    ],
    revealRunway: [
      { secretId: 'secret:ledger-author', revealGateChapter: 12 },
      { secretId: 'secret:mother-letter', revealGateChapter: 32 },
    ],
    motifs: {
      stakes: 'masa depan kedai dan nama baik Ibu',
      relationship: 'kepercayaan Sinta kepada Arga',
      mystery: 'catatan pengiriman tersembunyi',
    },
  })

  const raw = structuredClone(initial)
  for (const key of WRITER_QUALIFICATION_FIXTURE_V2_KEYS) {
    const chapterNumber = CHAPTERS[key]
    const content = TARGET_CONTENT[key]
    raw.chapterTargets[chapterNumber - 1] = {
      chapterNumber,
      phase: content.phase,
      goal: overrideFor(overrides, key, 'blueprintGoal') ?? content.goal,
      mustInclude: [overrideFor(overrides, key, 'blueprintBeat') ?? content.mustInclude[0]!],
      mustNotReveal: raw.revealRunway
        .filter((reveal) => reveal.revealGateChapter > chapterNumber)
        .map((reveal) => reveal.secretId),
      emotionalTurn: content.emotionalTurn,
      expectedThreadMovement: [content.movement],
    }
  }
  const schemaParsed = StoryContractSchema.parse(raw)
  const contract = parseStoryContract(schemaParsed)
  return {
    contract,
    schemaEvidence: {
      stage: 'StoryContractSchema',
      outputHash: domainHash('BUILDER_STAGE_STORY_CONTRACT_SCHEMA', schemaParsed),
    },
    parserEvidence: {
      stage: 'parseStoryContract',
      outputHash: domainHash('BUILDER_STAGE_PARSE_STORY_CONTRACT', contract),
    },
  }
}

function phaseForChapter(chapterNumber: number): string {
  if (chapterNumber <= 5) return 'Pijakan'
  if (chapterNumber <= 12) return 'Retak'
  if (chapterNumber <= 20) return 'Terseret'
  if (chapterNumber <= 32) return 'Titik Balik'
  if (chapterNumber <= 40) return 'Menanjak'
  if (chapterNumber <= 45) return 'Krisis'
  if (chapterNumber <= 48) return 'Puncak'
  return 'Bangkit'
}

function snapshot(
  contract: StoryContract,
  overrides: readonly QualificationSourceAuthorityOverride[] = [],
): CanonSnapshot {
  const storyId = contract.storyId
  const selectedByChapter = new Map(
    WRITER_QUALIFICATION_FIXTURE_V2_KEYS.map((key) => [CHAPTERS[key], TARGET_CONTENT[key]]),
  )
  const blueprints: ChapterBlueprint[] = Array.from({ length: 50 }, (_, index) => {
    const chapterNumber = index + 1
    const selected = selectedByChapter.get(chapterNumber)
    return {
      chapterNumber,
      version: 1,
      phase: selected?.phase ?? phaseForChapter(chapterNumber),
      chapterGoal: selected
        ? overrideFor(overrides, WRITER_QUALIFICATION_FIXTURE_V2_KEYS.find(
            (key) => CHAPTERS[key] === chapterNumber,
          )!, 'blueprintGoal') ?? selected.goal
        : `Sinta mengikuti akibat bukti yang ditemukan pada Bab ${Math.max(1, chapterNumber - 1)}.`,
      mandatoryBeats: [selected
        ? overrideFor(overrides, WRITER_QUALIFICATION_FIXTURE_V2_KEYS.find(
            (key) => CHAPTERS[key] === chapterNumber,
          )!, 'blueprintBeat') ?? selected.blueprintBeat
        : `Sinta menguji jejak pengiriman yang tersedia pada Bab ${chapterNumber}.`],
      forbiddenReveals: contract.revealRunway
        .filter((reveal) => reveal.revealGateChapter > chapterNumber)
        .map((reveal) => reveal.secretId),
      allowedStateDelta: { [`chapter_${chapterNumber}_advanced`]: true },
      introducesCharacters: [],
      reconciledFromVersion: null,
      reconciliationReason: null,
    }
  })
  for (const key of WRITER_QUALIFICATION_FIXTURE_V2_KEYS) {
    const chapterNumber = CHAPTERS[key]
    const content = TARGET_CONTENT[key]
    blueprints.push({
      ...blueprints[chapterNumber - 1]!,
      version: 2,
      mandatoryBeats: [overrideFor(overrides, key, 'blueprintBeat') ?? content.blueprintBeat],
      reconciledFromVersion: 1,
      reconciliationReason: 'Fixture V2 production-like target selected by latest blueprint authority.',
    })
  }

  const canon: CanonSnapshot = {
    storyId,
    characters: [
      { id: 'char:sinta', storyId, canonicalName: 'Sinta', role: 'protagonis', motivation: 'Menjaga kedai sambil membuka kebenaran tentang ibunya', introducedChapter: 1, status: 'ALIVE' },
      { id: 'char:arga', storyId, canonicalName: 'Arga', role: 'sekutu yang diragukan', motivation: 'Melindungi keluarganya tanpa membiarkan Sinta sendirian', introducedChapter: 2, status: 'ALIVE' },
      { id: 'char:surya', storyId, canonicalName: 'Surya', role: 'antagonis', motivation: 'Menutup jejak penggelapan koperasi', introducedChapter: 7, status: 'ALIVE' },
    ],
    aliases: [{ characterId: 'char:surya', alias: 'Pak Surya', aliasType: 'TITLE' }],
    voiceSheets: [
      { characterId: 'char:sinta', register: 'langsung tetapi menahan emosi', speechHabits: ['bertanya setelah mengamati benda'], forbiddenWords: [], sampleLines: ['Aku perlu tahu kenapa kuitansi ini disembunyikan.'] },
      { characterId: 'char:arga', register: 'tenang dan hemat kata', speechHabits: ['menjawab dengan detail praktis'], forbiddenWords: [], sampleLines: ['Kuncinya benar, tetapi asalnya belum bisa kuceritakan.'] },
    ],
    facts: [
      { id: 'fact:torn-page', storyId, statement: 'Satu halaman buku besar kedai disobek setelah pemakaman Ibu.', subjectCharacterId: 'char:sinta', establishedChapter: 1, salience: 0.9, loadBearing: true, paidOff: false },
      { id: 'fact:warehouse-receipt', storyId, statement: 'Kuitansi gudang memuat cap koperasi dan tanggal pengiriman malam.', subjectCharacterId: 'char:arga', establishedChapter: 7, salience: 0.8, loadBearing: true, paidOff: false },
      { id: 'fact:postcard-proof', storyId, statement: 'Kartu pos bertanda tangan Surya memakai tinta yang sama dengan buku besar.', subjectCharacterId: 'char:surya', establishedChapter: 12, salience: 1, loadBearing: true, paidOff: false },
      { id: 'fact:arga-letter', storyId, statement: 'Surat ibu Arga menjelaskan bahwa kunci loker dititipkan untuk melindungi bukti.', subjectCharacterId: 'char:arga', establishedChapter: 24, salience: 0.85, loadBearing: true, paidOff: false },
      { id: 'fact:resident-statement', storyId, statement: 'Warga bersedia menandatangani pernyataan untuk menjaga kedai bersama.', subjectCharacterId: 'char:sinta', establishedChapter: 44, salience: 0.95, loadBearing: true, paidOff: false },
    ],
    knowledge: [
      { characterId: 'char:sinta', factId: 'fact:torn-page', knownFromChapter: 1 },
      { characterId: 'char:sinta', factId: 'fact:warehouse-receipt', knownFromChapter: 7 },
      { characterId: 'char:sinta', factId: 'fact:postcard-proof', knownFromChapter: 12 },
      { characterId: 'char:sinta', factId: 'fact:arga-letter', knownFromChapter: 24 },
      { characterId: 'char:sinta', factId: 'fact:resident-statement', knownFromChapter: 44 },
    ],
    secrets: [
      { id: 'secret:ledger-author', description: 'Surya menulis catatan rahasia dalam buku besar.', revealGateChapter: 12, revealed: false },
      { id: 'secret:mother-letter', description: 'Ibu meminta kedai dijadikan ruang milik bersama.', revealGateChapter: 32, revealed: false },
    ],
    timeline: [
      { chapterNumber: 1, ordinal: 0, description: 'Sinta menemukan halaman buku besar yang disobek.', isFlashback: false, occursAt: 100 },
      { chapterNumber: 7, ordinal: 0, description: 'Sinta menemukan kuitansi gudang bercap koperasi.', isFlashback: false, occursAt: 700 },
      { chapterNumber: 12, ordinal: 0, description: 'Sinta menemukan kartu pos Surya di loker stasiun.', isFlashback: false, occursAt: 1200 },
      { chapterNumber: 24, ordinal: 0, description: 'Arga mengakui bahwa ibunya menitipkan kunci loker.', isFlashback: false, occursAt: 2400 },
      { chapterNumber: 44, ordinal: 0, description: 'Warga sepakat berkumpul untuk memeriksa buku besar asli.', isFlashback: false, occursAt: 4400 },
    ],
    threads: [
      { id: 'thread:ledger', title: 'Penulis buku besar dan pengiriman malam', status: 'PAYOFF_DUE', openedChapter: 1, lastTouchedChapter: 44, payoffWindow: 48, isMainMystery: true },
      { id: 'thread:trust', title: 'Kepercayaan Sinta dan Arga', status: 'DEVELOPING', openedChapter: 2, lastTouchedChapter: 44, payoffWindow: 49, isMainMystery: false },
    ],
    actRollups: [
      { actNumber: 1, summary: 'Sinta mewarisi kedai, menemukan halaman buku besar yang hilang, dan mulai menyelidiki bersama Arga.', stateDelta: { ledgerSearch: true }, coversFromChapter: 1, coversToChapter: 5 },
      { actNumber: 2, summary: 'Kuitansi gudang meretakkan kepercayaan, lalu loker membuktikan Surya menulis catatan rahasia.', stateDelta: { authorRevealed: true }, coversFromChapter: 6, coversToChapter: 12 },
      { actNumber: 3, summary: 'Jejak pengiriman menghubungkan Surya dengan kerugian koperasi dan menekan keluarga Arga.', stateDelta: { shipmentsTraced: true }, coversFromChapter: 13, coversToChapter: 20 },
      { actNumber: 4, summary: 'Sinta dan Arga menghadapi luka hubungan mereka serta menemukan tujuan sosial kedai.', stateDelta: { trustConditional: true }, coversFromChapter: 21, coversToChapter: 32 },
      { actNumber: 5, summary: 'Warga mengumpulkan bukti dan memilih menjaga kedai sebagai ruang bersama.', stateDelta: { residentsOrganized: true }, coversFromChapter: 33, coversToChapter: 40 },
    ],
    blueprints,
  }

  for (const override of overrides) {
    const chapter = CHAPTERS[override.fixtureKey]
    if (override.channel === 'characterName') {
      const character = canon.characters.find((candidate) => candidate.introducedChapter <= chapter)
      if (character) character.canonicalName = override.value
    } else if (override.channel === 'voiceGuidance') {
      const voice = canon.voiceSheets.find((candidate) => (
        canon.characters.find((character) => character.id === candidate.characterId)?.introducedChapter ?? 51
      ) <= chapter)
      if (voice) voice.sampleLines = [override.value]
    } else if (override.channel === 'thread') {
      canon.threads[0]!.title = override.value
    } else if (override.channel === 'fact') {
      const fact = canon.facts.find((candidate) => candidate.establishedChapter <= chapter - 1)
      if (fact) fact.statement = override.value
    } else if (override.channel === 'timeline') {
      const event = canon.timeline.find((candidate) => candidate.chapterNumber <= chapter - 1)
      if (event) event.description = override.value
    } else if (override.channel === 'rollup') {
      const rollup = canon.actRollups.find((candidate) => candidate.coversToChapter < chapter)
      if (rollup) rollup.summary = override.value
    }
  }

  return canon
}

function previousContext(
  chapterNumber: number,
  overrides: readonly QualificationSourceAuthorityOverride[] = [],
  key?: QualificationFixtureV2Key,
) {
  if (chapterNumber === 1) return { previousChapterRow: null, previousChoice: null }
  const previous = chapterNumber - 1
  const byChapter: Record<number, { title: string; paragraphs: string[]; label: string; consequence: string[] }> = {
    7: { title: 'Cap di Kuitansi', paragraphs: ['Hujan berhenti ketika Sinta meratakan kuitansi di meja.', 'Arga memandangi cap koperasi tanpa menyentuhnya.', 'Ia mengenali nomor gudang sebelum Sinta sempat membacanya.', 'Sinta bertanya dari mana Arga mengetahui nomor itu.'], label: 'Minta Arga menjelaskan cap kuitansi', consequence: ['Arga harus menjawab pengetahuan yang baru saja ia tunjukkan.'] },
    11: { title: 'Loker Nomor Tujuh', paragraphs: ['Kunci pemberian Arga pas dengan loker stasiun.', 'Sinta mendengar langkah petugas menjauh di lorong.', 'Di balik pintu besi tersimpan kotak kartu pos lama.', 'Ia menarik kotak itu keluar sebelum loker menutup kembali.'], label: 'Buka loker sebelum petugas kembali', consequence: ['Sinta memegang kotak kartu pos yang menyimpan bukti tentang buku besar.'] },
    24: { title: 'Kunci yang Dikembalikan', paragraphs: ['Arga menunggu di teras kedai yang sudah gelap.', 'Sinta meletakkan kunci loker di antara mereka.', 'Ia mengakui bahwa tuduhannya membuat Arga kehilangan tempat aman.', 'Arga belum menjawab ketika Sinta meminta maaf.'], label: 'Minta maaf tanpa meminta Arga langsung percaya', consequence: ['Arga bebas menentukan syarat baru untuk melanjutkan kerja sama.'] },
    44: { title: 'Tanda Tangan Pertama', paragraphs: ['Daftar dukungan warga terbuka di meja panjang.', 'Sinta meletakkan buku besar asli di samping surat pernyataan.', 'Nama pertama sudah ditulis ketika suara mobil Surya terdengar.', 'Sinta memilih tetap di ruangan bersama warga.'], label: 'Buka bukti di hadapan warga', consequence: ['Pertemuan warga berlangsung terbuka dan Surya tidak dapat lagi memisahkan para saksi.'] },
  }
  const context = byChapter[previous]
  if (!context) throw new Error(`WRITER_QUALIFICATION_FIXTURE_V2_PREVIOUS_CONTEXT_MISSING:${previous}`)
  const fixtureKey = key ?? WRITER_QUALIFICATION_FIXTURE_V2_KEYS.find(
    (candidate) => CHAPTERS[candidate] === chapterNumber,
  )
  const injectedPreviousProse = fixtureKey
    ? overrideFor(overrides, fixtureKey, 'previousProse')
    : undefined
  const injectedChoiceLabel = fixtureKey
    ? overrideFor(overrides, fixtureKey, 'choiceLabel')
    : undefined
  const injectedChoiceConsequence = fixtureKey
    ? overrideFor(overrides, fixtureKey, 'choiceConsequence')
    : undefined
  return {
    previousChapterRow: {
      number: previous,
      title: context.title,
      paragraphs: injectedPreviousProse
        ? [...context.paragraphs.slice(0, -1), injectedPreviousProse]
        : context.paragraphs,
    },
    previousChoice: {
      chapterNumber: previous,
      choiceId: `fixture-choice-${previous}`,
      label: injectedChoiceLabel ?? context.label,
      consequence: injectedChoiceConsequence ? [injectedChoiceConsequence] : context.consequence,
      effectSummary: { truth: 1, empathy: 1, flagsSet: [`fixture_${previous}_resolved`] },
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  }
}

function normalizeSemantic(value: string): string {
  return value.toLocaleLowerCase('id-ID').replace(/[^a-z0-9]+/g, ' ').trim()
}

function containsDeclaredSecret(value: string, authority: QualificationSecretAuthority): boolean {
  const normalized = normalizeSemantic(value)
  return [authority.secretId, authority.meaning, authority.explicitLeakMarker]
    .map(normalizeSemantic)
    .some((declared) => declared.length > 0 && normalized.includes(declared))
}

function hasPrivateIdentifier(value: string): boolean {
  if (/^[a-f0-9]{64}$/i.test(value)) return false
  return /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b(?:\+?62|0)8\d{7,12}\b|\b(?:sk|pk|api)[-_][a-z0-9]{12,}\b|\b(?:user[:_-])?[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(value)
}

function containsPrivateIdentifier(value: unknown): boolean {
  if (typeof value === 'string') return hasPrivateIdentifier(value)
  if (Array.isArray(value)) return value.some(containsPrivateIdentifier)
  if (typeof value !== 'object' || value === null) return false
  return Object.entries(value).some(([key, nested]) => (
    hasPrivateIdentifier(key) || containsPrivateIdentifier(nested)
  ))
}

function projectionLeaks(
  chapterNumber: number,
  authorities: readonly QualificationSecretAuthority[],
  channels: Record<QualificationAuditedProjectionChannel, string[]>,
  prohibitionChannel: readonly string[],
): Array<{ secretId: string; channel: QualificationAuditedProjectionChannel }> {
  const prohibition = new Set(prohibitionChannel)
  return authorities
    .filter((authority) => authority.revealGateChapter > chapterNumber)
    .flatMap((authority) => Object.entries(channels).flatMap(([channel, values]) => {
      const positiveValues = channel === 'writerPrompt'
        ? values.map((value) => [...prohibition].reduce(
            (clean, blocked) => clean.split(blocked).join(''),
            value,
          ))
        : values
      return positiveValues.some((value) => containsDeclaredSecret(value, authority))
        ? [{ secretId: authority.secretId, channel: channel as QualificationAuditedProjectionChannel }]
        : []
    }))
}

function sourceIssues(row: QualificationFixtureV2ValidationRow): QualificationFixtureV2Issue[] {
  const issues: QualificationFixtureV2Issue[] = []
  if (row.source.beats.some((beat) => /beat utama bab|kembangkan fase|placeholder|lorem ipsum/i.test(beat))) {
    issues.push({ code: 'FIXTURE_SOURCE_GENERIC_PLACEHOLDER', fixtureKey: row.key })
  }
  const normalizedBeats = row.source.beats.map(normalizeSemantic)
  if (new Set(normalizedBeats).size !== normalizedBeats.length) {
    issues.push({ code: 'FIXTURE_SOURCE_DUPLICATE_SEMANTIC_BEAT', fixtureKey: row.key })
  }
  for (const authority of row.source.secretAuthorities) {
    if (authority.revealGateChapter <= row.chapterNumber) continue
    for (const [channel, storedValues] of Object.entries(row.source.positiveChannels) as Array<[
      QualificationPositiveChannel,
      string[],
    ]>) {
      const values = channel === 'beats' ? row.source.beats : storedValues
      if (values.some((value) => containsDeclaredSecret(value, authority))) {
        issues.push({
          code: 'FIXTURE_SOURCE_PREMATURE_REVEAL',
          fixtureKey: row.key,
          channel,
          secretId: authority.secretId,
        })
      }
    }
  }
  const expectedPrevious = row.chapterNumber === 1 ? null : row.chapterNumber - 1
  if (row.continuity.previousChapterNumber !== expectedPrevious
    || row.continuity.previousChoiceChapter !== expectedPrevious
    || row.continuity.visibleEstablishedChapters.some((chapter) => chapter > row.chapterNumber - 1)
    || row.continuity.visibleTimelineChapters.some((chapter) => chapter > row.chapterNumber - 1)) {
    issues.push({ code: 'FIXTURE_SOURCE_ANACHRONISTIC_CONTINUITY', fixtureKey: row.key })
  }
  return issues
}

function stageOutputHash(
  row: QualificationFixtureV2ValidationRow,
  stage: BuilderStage,
): string | null {
  return row.provenance.stageEvidence.find((evidence) => evidence.stage === stage)?.outputHash ?? null
}

const TRUSTED_SEMANTIC_ARTIFACT_AUTHORITIES: Readonly<Record<QualificationFixtureV2Key, Readonly<{
  plan: { stageOutputHash: string; safeArtifactHash: string }
  writer: { stageOutputHash: string; safeArtifactHash: string }
  continuation: { stageOutputHash: string | null; safeArtifactHash: string }
}>>> = Object.freeze({
  EARLY: {
    plan: { stageOutputHash: '8cdd5d5a3075257cdf5da90a7922db4fa438dd250b1f3afb8f07bdf155344fed', safeArtifactHash: 'f32ac35385feb50b4600f41e461d863e66e866359745c92106c9fab31987cf09' },
    writer: { stageOutputHash: 'de8433a98ae558f8a675e74ff5817a8165bb287440eba08a8cae69b348788473', safeArtifactHash: 'd03ea0d3af8bc0df8f842f44cf3312bf8696ce14a0291bbf1072696faf6c21c9' },
    continuation: { stageOutputHash: null, safeArtifactHash: '543441d372671e13ffa1f02e7110fa7abf179bf26ce83fa5b8fa7b510dec1e4f' },
  },
  DIALOGUE: {
    plan: { stageOutputHash: 'd16b02d5e759ba2f883919d6f77338dc0a5a253f30ae097fb43ed4d7651b7ef0', safeArtifactHash: '53158300dba50f53ca5bb705c73714e795ad47217cb8031946c0648e1b9e7578' },
    writer: { stageOutputHash: '28d16adfc4a8ea002642b1b7e405ac87a6d9a179b01d28f014e46c5a40a6aca0', safeArtifactHash: '0d0ea5fa6ee6e7ea8dedb29f1559edf77e15bed80cf9200ae32dfb9b6a08e76f' },
    continuation: { stageOutputHash: '83a0021bbd406cde84c4715a455814a24bf29b000c534caa5ec527a5433c06ba', safeArtifactHash: '42929d9fd8bff5431435609efba2efb8196a2a9f6a4710ae32a2f576bda2850c' },
  },
  MYSTERY: {
    plan: { stageOutputHash: '2dfb194ea7152ebcc383226c31c55f1994af6aec76483c83ea0223099fe6912d', safeArtifactHash: 'dab86b305a004d54f98d4ca7f9d9267cb47c04b3b2e5ddbdc61d5e3d21e6022d' },
    writer: { stageOutputHash: '455617d776048c49e1d23919ff0c89dcaff119789c7eab88b74cd27d00575a64', safeArtifactHash: 'f07207aa7463c73531d8cd3c560cd90ac488cd2a51a2622dc43a790416402ecc' },
    continuation: { stageOutputHash: '767faef75e353d7445af8e34b6d2a0b1ccc540efc65d41837b010c965c007771', safeArtifactHash: 'bd5e8a55af2d6bc89e1911478c9ffcf8382f5964396ea2e5187fcc1fe94d404c' },
  },
  EMOTIONAL: {
    plan: { stageOutputHash: 'a7a5e14ed985abe3c3def29156dc798c801e180c0c0e6c09f01c859fec576848', safeArtifactHash: 'e30ffbd499757ca89f36b368918bbde2f0d2b93b7820bc0e63740faec8929cbf' },
    writer: { stageOutputHash: '676fdd652d434be1badce00d1c86690cf06fd5366c9a79855eb98d3400586e54', safeArtifactHash: 'e5aaba9ed8f5a9a0408269fe7fdaf74f010757ccf88e7644e6ba5414ad21f1de' },
    continuation: { stageOutputHash: '636d8ba5331ee820fad77ccd58ef0c0c9e81c9fdf75e86771cd97d4a587357c6', safeArtifactHash: 'bc90bcfb8e2b14c34828935614e8152eceb21043db3ec1659796b7df8f39bd8e' },
  },
  LATER_ACT: {
    plan: { stageOutputHash: 'f63634943e7f43ee4611a96e39b294976a72c1d00e31cc625c3a366d1dd10895', safeArtifactHash: '4cdabb90937884c2fe27d58fbd4e5fb7559e3d506a263540915d2b88f1ed32ae' },
    writer: { stageOutputHash: '8a5c96d0a91ef9561153031ba4461f6e8b5fb5b9c3eb8de5718e9862f3fc4636', safeArtifactHash: '7697b29346b23cf243e931b682dc7ffe10dbd83103c7b80bff10d464ada599fe' },
    continuation: { stageOutputHash: 'a84866a669ae84cb2c190ec6d20e0c6afe6f78402931611c912614b74f0c3072', safeArtifactHash: 'f14e11a56b1650ecbcbe97046e213d17a3342b4def79f321d1963d38b6ec1d62' },
  },
})

function semanticArtifactBindingsValid(row: QualificationFixtureV2ValidationRow): boolean {
  const semantic = row.projection.semanticEvidence
  const bindings = semantic.artifactBindings
  const planStageHash = stageOutputHash(row, 'generatePlan')
  const writerStageHash = stageOutputHash(row, 'buildProductionChapterWriterPrompt')
  const continuationStageHash = stageOutputHash(row, 'buildContinuationContext')
  const planArtifact = bindings.plan.safeArtifact
  const writerArtifact = bindings.writer.safeArtifact
  const continuationArtifact = bindings.continuation.safeArtifact
  const trusted = TRUSTED_SEMANTIC_ARTIFACT_AUTHORITIES[row.key]
  const expectedWriterFindings = semantic.writerVisibleFindings.map(({ channel, normalizedValue }) => ({
    channel,
    normalizedValue,
  }))
  const expectedPlannedCharacters = semantic.characterOccurrences
    .filter((occurrence) => occurrence.inPlannedBeats)
    .map((occurrence) => occurrence.characterName)
    .sort()
  const expectedWriterCharacters = semantic.characterOccurrences
    .filter((occurrence) => occurrence.inWriterProjection)
    .map((occurrence) => occurrence.characterName)
    .sort()
  const expectedRevealIds = semantic.scheduledReveal ? [semantic.scheduledReveal.secretId] : []
  const binding = row.projection.authorityBinding
  const preProseStageHash = stageOutputHash(row, 'buildPreProseChapterBrief')
  const chapterBriefStageHash = stageOutputHash(row, 'buildChapterBrief')
  const expectedDirectiveHashes = writerArtifact.writerDirectiveHashes

  return planStageHash !== null

    && writerStageHash !== null
    && bindings.plan.stageOutputHash === planStageHash
    && bindings.writer.stageOutputHash === writerStageHash
    && bindings.continuation.stageOutputHash === continuationStageHash
    && bindings.plan.stageOutputHash === trusted.plan.stageOutputHash
    && bindings.plan.safeArtifactHash === trusted.plan.safeArtifactHash
    && bindings.writer.stageOutputHash === trusted.writer.stageOutputHash
    && bindings.writer.safeArtifactHash === trusted.writer.safeArtifactHash
    && bindings.continuation.stageOutputHash === trusted.continuation.stageOutputHash
    && bindings.continuation.safeArtifactHash === trusted.continuation.safeArtifactHash
    && bindings.plan.safeArtifactHash === domainHash('PLAN_SEMANTIC_ARTIFACT_BINDING', {
      stageOutputHash: bindings.plan.stageOutputHash,
      safeArtifact: planArtifact,
    })
    && bindings.writer.safeArtifactHash === domainHash('WRITER_SEMANTIC_ARTIFACT_BINDING', {
      stageOutputHash: bindings.writer.stageOutputHash,
      safeArtifact: writerArtifact,
    })
    && bindings.continuation.safeArtifactHash === domainHash('CONTINUATION_SEMANTIC_ARTIFACT_BINDING', {
      stageOutputHash: bindings.continuation.stageOutputHash,
      safeArtifact: continuationArtifact,
    })
    && planArtifact.normalizedChapterGoal === normalizeSemantic(row.projection.exactPlanChapterGoal)
    && stableStringify(planArtifact.normalizedPlannedBeats)
      === stableStringify(row.projection.exactPlanPlannedBeats.map(normalizeSemantic))
    && stableStringify(planArtifact.proposedStateDeltaKeys)
      === stableStringify([...row.projection.exactPlanProposedStateDeltaKeys].sort())
    && stableStringify(planArtifact.characterNamesInPlannedBeats)
      === stableStringify(expectedPlannedCharacters)
    && stableStringify(planArtifact.scheduledRevealSecretIds) === stableStringify(expectedRevealIds.filter(
      () => semantic.scheduledReveal?.presentInExactPlan,
    ))
    && binding.authorityMode === 'CHAPTER_BRIEF_V2'
    && binding.legacyFallbackUsed === false
    && binding.briefBindingHash === preProseStageHash
    && binding.preProseBriefHash === preProseStageHash
    && binding.chapterBriefHash === chapterBriefStageHash
    && binding.planHash === planStageHash
    && binding.fixtureHash === WRITER_QUALIFICATION_FIXTURE_V2.fixtureHashes[row.key]
    && binding.writerVisibleInternalIdCount === 0
    && stableStringify(binding.forbiddenRevealIdentityHashes) === stableStringify(
      row.source.forbiddenRevealIds.map((authorityId) => domainHash('FORBIDDEN_REVEAL_IDENTITY', authorityId)),
    )
    && writerArtifact.authorityMode === binding.authorityMode
    && writerArtifact.briefBindingHash === binding.briefBindingHash
    && writerArtifact.legacyFallbackUsed === binding.legacyFallbackUsed
    && writerArtifact.writerVisibleInternalIdCount === binding.writerVisibleInternalIdCount
    && stableStringify(writerArtifact.visibleFindings) === stableStringify(expectedWriterFindings)
    && stableStringify(writerArtifact.characterNamesInProjection)
      === stableStringify(expectedWriterCharacters)
    && stableStringify(writerArtifact.projectedObligationAuthorityIds)
      === stableStringify(binding.projectedObligationAuthorityIds)
    && stableStringify(writerArtifact.writerDirectiveHashes) === stableStringify(expectedDirectiveHashes)
    && stableStringify(binding.writerDirectiveHashes) === stableStringify(expectedDirectiveHashes)
    && writerArtifact.endingAuthorityProjectionHash === binding.endingAuthorityProjectionHash
    && stableStringify(binding.projectedObligationAuthorityIds) === stableStringify([
      ...binding.projectedObligationAuthorityIds,
    ])
    && stableStringify(writerArtifact.scheduledRevealSecretIds) === stableStringify(expectedRevealIds.filter(
      () => semantic.scheduledReveal?.presentInWriterSemanticProjection,
    ))
    && continuationArtifact.present === semantic.continuation.present
    && continuationArtifact.previousChapterNumber === semantic.continuation.previousChapterNumber
    && continuationArtifact.previousChoiceChapter === semantic.continuation.previousChoiceChapter
}

function projectionIssues(row: QualificationFixtureV2ValidationRow): QualificationFixtureV2Issue[] {
  const issues: QualificationFixtureV2Issue[] = []
  if (row.source.scheduledReveal
    && (!row.projection.scheduledRevealObligationConcrete
      || !row.projection.scheduledRevealWriterVisible)) {
    issues.push({ code: 'PRODUCTION_PROJECTION_SCHEDULED_REVEAL_NOT_WRITER_VISIBLE', fixtureKey: row.key })
  }
  const auditedLeaks = projectionLeaks(
    row.chapterNumber,
    row.source.secretAuthorities,
    row.projection.auditedPositiveChannels,
    row.projection.prohibitionChannel,
  )
  const reportedLeakIds = new Set(row.projection.futureRevealLeaks)
  for (const leak of auditedLeaks) {
    issues.push({
      code: 'PRODUCTION_PROJECTION_FUTURE_REVEAL_LEAK',
      fixtureKey: row.key,
      channel: leak.channel,
      secretId: leak.secretId,
    })
  }
  if (auditedLeaks.length === 0 && reportedLeakIds.size > 0) {
    issues.push({ code: 'PRODUCTION_PROJECTION_FUTURE_REVEAL_LEAK', fixtureKey: row.key })
  }
  if (row.projection.productionSelectedEndingLock) {
    const semanticMatch = row.source.selectedEndingMeaning !== null
      && row.projection.writerVisibleEndingMeaning !== null
      && normalizeSemantic(row.projection.writerVisibleEndingMeaning)
        === normalizeSemantic(row.source.selectedEndingMeaning)
    if (!row.projection.writerVisibleEndingLock || !semanticMatch) {
      issues.push({ code: 'PRODUCTION_PROJECTION_ENDING_LOCK_NOT_WRITER_VISIBLE', fixtureKey: row.key })
    }
  }
  if (!row.provenance.productionRequiredBriefFieldsPresent) {
    issues.push({ code: 'PRODUCTION_PROJECTION_REQUIRED_BRIEF_FIELD_MISSING', fixtureKey: row.key })
  }
  const semantic = row.projection.semanticEvidence
  const expectedDeltaKeys = [...row.projection.exactPlanProposedStateDeltaKeys].sort()
  const actualDeltaKeys = [...semantic.proposedStateDelta.keys].sort()
  const findingsValid = semantic.writerVisibleFindings.every((finding) => (
    finding.normalizedValue.length > 0
    && finding.artifactHash === domainHash('WRITER_VISIBLE_SEMANTIC_FINDING', {
      channel: finding.channel,
      normalizedValue: finding.normalizedValue,
    })
  ))
  const continuationStageHash = row.provenance.stageEvidence.find(
    (evidence) => evidence.stage === 'buildContinuationContext',
  )?.outputHash ?? null
  const continuationValid = row.key === 'EARLY'
    ? !semantic.continuation.present
      && semantic.continuation.outputHash === null
      && semantic.continuation.previousChapterNumber === null
      && semantic.continuation.previousChoiceChapter === null
    : semantic.continuation.present
      && semantic.continuation.outputHash === continuationStageHash
      && semantic.continuation.previousChapterNumber === row.continuity.previousChapterNumber
      && semantic.continuation.previousChoiceChapter === row.continuity.previousChoiceChapter
  const revealValid = row.source.scheduledReveal === null
    ? semantic.scheduledReveal === null
    : semantic.scheduledReveal?.secretId === row.source.scheduledReveal.secretId
      && semantic.scheduledReveal.presentInExactPlan === row.projection.scheduledRevealObligationConcrete
      && semantic.scheduledReveal.presentInWriterSemanticProjection === row.projection.scheduledRevealWriterVisible
  if (stableStringify(actualDeltaKeys) !== stableStringify(expectedDeltaKeys)
    || semantic.proposedStateDelta.nonempty !== (expectedDeltaKeys.length > 0)
    || !semanticArtifactBindingsValid(row)
    || !findingsValid
    || !continuationValid
    || !revealValid) {
    issues.push({ code: 'PRODUCTION_PROJECTION_SEMANTIC_EVIDENCE_INVALID', fixtureKey: row.key })
  }
  return issues
}

export function assertQualificationFixtureV2(input: QualificationFixtureV2ValidationInput) {
  const issues: QualificationFixtureV2Issue[] = []
  for (const row of input.fixtures) {
    issues.push(...sourceIssues(row), ...projectionIssues(row))
    const expectedStages = expectedBuilderStages(row.key)
    const evidenceStages = row.provenance.stageEvidence.map((evidence) => evidence.stage)
    const uniqueEvidenceStages = new Set(evidenceStages)
    const evidenceHashesValid = row.provenance.stageEvidence.every((evidence) => (
      /^[a-f0-9]{64}$/.test(evidence.outputHash)
    )) && row.provenance.artifactAuthorityHash === domainHash(
      'BUILDER_STAGE_ARTIFACT_AUTHORITY',
      row.provenance.stageEvidence,
    )
    const sequenceValid = stableStringify(row.provenance.stages) === stableStringify(expectedStages)
      && stableStringify(evidenceStages) === stableStringify(expectedStages)
      && uniqueEvidenceStages.size === evidenceStages.length
    const naValid = row.key === 'EARLY'
      ? stableStringify(row.provenance.notApplicableStages) === stableStringify([{
          stage: 'buildContinuationContext',
          reason: 'BAB_1_PRODUCTION_CONTINUATION_IS_NULL',
        }])
          && row.proof.continuationWasNullForPreProse
          && row.proof.continuationWasNullForPlan
          && row.proof.continuationWasNullForWriter
      : row.provenance.notApplicableStages.length === 0
    if (!sequenceValid || !evidenceHashesValid || !naValid) {
      issues.push({ code: 'BUILDER_PROVENANCE_STAGE_BYPASSED', fixtureKey: row.key })
    }
    if (containsPrivateIdentifier({
      source: row.source,
      continuity: row.continuity,
      projection: row.projection,
      provenance: row.provenance,
      privacy: row.privacy,
    })) {
      issues.push({ code: 'PRIVACY_PRIVATE_IDENTIFIER', fixtureKey: row.key })
    }
  }
  const sourceValid = !issues.some((issue) => issue.code.startsWith('FIXTURE_SOURCE_'))
  const builderTraversalPassed = !issues.some((issue) => issue.code.startsWith('BUILDER_PROVENANCE_'))
  const schemaTraversalPassed = input.fixtures.every((row) => (
    row.proof.storyContractParsed && row.proof.chapterBriefParsed && row.proof.preProseBriefParsed
      && row.proof.planParsed && row.proof.writerProjectionBuilt
  ))
  const privacyPassed = !issues.some((issue) => issue.code.startsWith('PRIVACY_'))
  const projectionPassed = !issues.some((issue) => issue.code.startsWith('PRODUCTION_PROJECTION_'))
  const validationCategories = {
    source: sourceValid,
    schema: schemaTraversalPassed,
    builder: builderTraversalPassed,
    privacy: privacyPassed,
    projection: projectionPassed,
  }
  const terminalVerdict = !sourceValid
    ? 'BLOCKED_FIXTURE_SOURCE_GAP' as const
    : !schemaTraversalPassed
      ? 'BLOCKED_SCHEMA_GAP' as const
      : !builderTraversalPassed
        ? 'BLOCKED_BUILDER_PROVENANCE_GAP' as const
        : !privacyPassed
          ? 'BLOCKED_PRIVACY_GAP' as const
          : !projectionPassed
            ? 'BLOCKED_PRODUCTION_PROJECTION_GAP' as const
            : 'PROVISIONAL_VALIDATION_PASSED' as const
  return {
    issues,
    sourceValid,
    schemaTraversalPassed,
    builderTraversalPassed,
    privacyPassed,
    projectionPassed,
    semanticSourcePassed: sourceValid,
    validationCategories,
    terminalVerdict,
    qualificationAllowed: terminalVerdict === 'PROVISIONAL_VALIDATION_PASSED',
  }
}

function domainHash(domain: string, value: unknown): string {
  return computeSha256(`${domain}\0${stableStringify(value)}`)
}

export function computeQualificationFixtureV2Hashes(input: QualificationFixtureV2ValidationInput) {
  const fixtureHashes = Object.fromEntries(input.fixtures.map((fixture) => [
    fixture.key,
    domainHash('WRITER_QUALIFICATION_FIXTURE_V2_SOURCE', {
      key: fixture.key,
      chapterNumber: fixture.chapterNumber,
      source: fixture.source,
      continuity: fixture.continuity,
    }),
  ])) as Record<QualificationFixtureV2Key, string>
  const provisionalCorpusManifestHash = domainHash('WRITER_QUALIFICATION_FIXTURE_V2_CORPUS', {
    track: 'WRITER_QUALIFICATION_FIXTURE_V2',
    fixtureHashes,
    representativeness: input.fixtures.map((fixture) => ({
      key: fixture.key,
      chapterNumber: fixture.chapterNumber,
      referenceClass: REFERENCE_CLASS[fixture.key],
    })),
  })
  const privacyValidationHash = domainHash(
    'WRITER_QUALIFICATION_FIXTURE_V2_PRIVACY',
    input.fixtures.map((fixture) => ({
      key: fixture.key,
      source: fixture.source,
      continuity: fixture.continuity,
      projection: fixture.projection,
      provenance: fixture.provenance,
      privacy: fixture.privacy,
    })),
  )
  const projectionValidationHash = domainHash(
    'WRITER_QUALIFICATION_FIXTURE_V2_PROJECTION',
    {
      fixtures: input.fixtures.map((fixture) => ({
        key: fixture.key,
        projection: fixture.projection,
        provenance: fixture.provenance,
        proof: fixture.proof,
      })),
      privacyValidationHash,
    },
  )
  return {
    fixtureHashes,
    provisionalCorpusManifestHash,
    projectionValidationHash,
    privacyValidationHash,
  }
}

const REFERENCE_LOCATOR: Readonly<Record<QualificationFixtureV2Key, string>> = {
  EARLY: 'fixtures/narrative/premium-bilik-ketujuh-v2.ts:blueprintSpecs.0#L494',
  DIALOGUE: 'fixtures/narrative/premium-bilik-ketujuh-v2.ts:blueprintSpecs.1#L495',
  MYSTERY: 'fixtures/contracts/misteri-drama.ts:misteriDramaContract#L3-L80',
  EMOTIONAL: 'fixtures/narrative/premium-bilik-ketujuh-v2.ts:blueprintSpecs.24#L518',
  LATER_ACT: 'lib/story-engine/chapter-brief.ts:buildChapterBrief#L244-L337',
}

const PRODUCTION_CONTRACT_FIELD: Readonly<Record<QualificationFixtureV2Key, string>> = {
  EARLY: 'ChapterBlueprint.chapterNumber/chapterGoal/mandatoryBeats',
  DIALOGUE: 'ChapterBlueprint.chapterNumber/chapterGoal/mandatoryBeats',
  MYSTERY: 'ChapterTarget.mustInclude/revealRunway',
  EMOTIONAL: 'ChapterBlueprint.chapterNumber/chapterGoal/mandatoryBeats',
  LATER_ACT: 'ChapterBrief.lockedEndingKey/endingRunway + EndingCandidate.requiredClosure',
}

const REPRESENTATIVENESS_RATIONALE: Readonly<Record<QualificationFixtureV2Key, string>> = {
  EARLY: 'Opening comparison records selected directly comparable committed and V2 ChapterBlueprint obligation fields at the same authority layer; differing stories remain an intentional synthetic substitution, not evidence of production draft behavior.',
  DIALOGUE: 'Dialogue-class comparison records selected directly comparable committed and V2 ChapterBlueprint obligation fields at the same authority layer; it makes no claim about spoken lines, emotion beats, cast, or production draft behavior.',
  MYSTERY: 'Scheduled-reveal comparison matches only exact gate obligation presence in independently parsed committed mystery contract; production writer visibility is not claimed without independent projection evidence.',
  EMOTIONAL: 'Midstory emotional comparison records selected directly comparable committed and V2 ChapterBlueprint obligation fields at the same authority layer; it makes no proxy claim about draft emotion or relationship behavior.',
  LATER_ACT: 'Later-act comparison independently runs buildChapterBrief with committed production-like contract, snapshot, and route inputs; both lock at Bab 45 and carry selected semantic closure.',
}

function referenceSnapshotForContract(contract: StoryContract): CanonSnapshot {
  return {
    storyId: contract.storyId,
    characters: [],
    aliases: [],
    voiceSheets: [],
    facts: [],
    knowledge: [],
    secrets: contract.revealRunway.map((reveal) => ({
      id: reveal.secretId,
      description: `Reference authority for ${reveal.secretId}.`,
      revealGateChapter: reveal.revealGateChapter,
      revealed: false,
    })),
    timeline: [],
    threads: [],
    actRollups: [],
    blueprints: contract.chapterTargets.map((target) => ({
      chapterNumber: target.chapterNumber,
      version: 1,
      phase: target.phase,
      chapterGoal: target.goal,
      mandatoryBeats: [...target.mustInclude],
      forbiddenReveals: [...target.mustNotReveal],
      allowedStateDelta: {},
      introducesCharacters: [],
      reconciledFromVersion: null,
      reconciliationReason: null,
    })),
  }
}

function blueprintAuthorityShape(blueprint: ChapterBlueprint) {
  return {
    chapterNumber: blueprint.chapterNumber,
    normalizedChapterGoal: normalizeSemantic(blueprint.chapterGoal),
    mandatoryBeats: blueprint.mandatoryBeats.map(normalizeSemantic),
  }
}

function committedReferenceShape(key: QualificationFixtureV2Key) {
  const bilikSnapshot = buildPremiumBilikKetujuhV2Snapshot()
  if (key === 'EARLY') {
    return blueprintAuthorityShape(latestBlueprintForChapter(bilikSnapshot, 1)!)
  }
  if (key === 'DIALOGUE') {
    return blueprintAuthorityShape(latestBlueprintForChapter(bilikSnapshot, 2)!)
  }
  if (key === 'MYSTERY') {
    const contract = parseStoryContract(StoryContractSchema.parse(misteriDramaContract))
    const target = contract.chapterTargets.find((candidate) => candidate.chapterNumber === 12)!
    const scheduled = contract.revealRunway.find((reveal) => reveal.revealGateChapter === 12)!
    return {
      chapterNumber: 12,
      scheduledRevealPresent: target.mustInclude.some((item) => item.includes(scheduled.secretId)),
    }
  }
  if (key === 'EMOTIONAL') {
    return blueprintAuthorityShape(latestBlueprintForChapter(bilikSnapshot, 25)!)
  }
  const contract = parseStoryContract(StoryContractSchema.parse(misteriDramaContract))
  const chapterNumber = contract.closureRunway.endingLockChapter
  const chapterBrief = buildChapterBrief({
    storyContract: contract,
    snapshot: referenceSnapshotForContract(contract),
    readerState: {
      routeState: {
        truth: 12,
        risk: 4,
        secrecy: 1,
        empathy: 8,
        trust: {},
        evidence: [],
        flags: {},
        endingBias: { 'publish-truth': 20, 'protect-witnesses': 2, 'shadows-protect': 0 },
      },
      choiceHistory: [],
      lockedEndingKey: null,
    },
    chapterNumber,
    previousChoice: null,
  })
  const selected = contract.endingCandidates.find((ending) => ending.key === chapterBrief.lockedEndingKey)!
  return {
    lockChapter: contract.closureRunway.endingLockChapter,
    chapterNumber: chapterBrief.chapterNumber,
    endingRunway: chapterBrief.endingRunway,
    lockedEndingKey: chapterBrief.lockedEndingKey,
    selectedEndingClosure: [...selected.requiredClosure],
  }
}

function fixtureComparisonShape(fixture: QualificationFixtureV2ValidationRow) {
  if (fixture.key === 'EARLY' || fixture.key === 'DIALOGUE' || fixture.key === 'EMOTIONAL') {
    return {
      chapterNumber: fixture.chapterNumber,
      normalizedChapterGoal: normalizeSemantic(
        fixture.projection.auditedPositiveChannels.blueprintGoal[0] ?? '',
      ),
      mandatoryBeats: fixture.projection.auditedPositiveChannels.blueprintBeat.map(normalizeSemantic),
    }
  }
  if (fixture.key === 'MYSTERY') {
    return {
      chapterNumber: fixture.chapterNumber,
      scheduledRevealPresent: fixture.source.scheduledReveal !== null,
    }
  }
  const selectedClosure = fixture.source.selectedEndingMeaning
  return {
    lockChapter: 45,
    chapterNumber: fixture.chapterNumber,
    endingRunway: 'ending-lock',
    lockedEndingKey: fixture.projection.productionSelectedEndingLock
      ? fixture.projection.writerVisibleEndingRawKey ?? 'rumah-bersama'
      : null,
    selectedEndingClosure: selectedClosure ? [selectedClosure] : [],
  }
}

export function deriveQualificationFixtureV2SemanticSummary(
  fixture: QualificationFixtureV2ValidationRow,
) {
  const artifactBindingsValid = semanticArtifactBindingsValid(fixture)
  const findings = artifactBindingsValid
    ? fixture.projection.semanticEvidence.writerVisibleFindings
    : []
  const expectedFindingValues = new Set([
    normalizeSemantic(fixture.projection.exactPlanChapterGoal),
    ...fixture.projection.exactPlanPlannedBeats.map(normalizeSemantic),
  ])
  const provenFindings = findings.filter((finding) => (
    expectedFindingValues.has(finding.normalizedValue)
    && finding.artifactHash === domainHash('WRITER_VISIBLE_SEMANTIC_FINDING', {
      channel: finding.channel,
      normalizedValue: finding.normalizedValue,
    })
  ))
  const sceneDriving = provenFindings.map((finding, index) => (
    finding.channel === 'chapterGoal' ? 'plan:chapter-goal' : `plan:beat:${index}`
  ))
  const continuationEvidence = fixture.projection.semanticEvidence.continuation
  const continuationStageHash = fixture.provenance.stageEvidence.find(
    (evidence) => evidence.stage === 'buildContinuationContext',
  )?.outputHash ?? null
  const continuityProven = artifactBindingsValid
    && continuationEvidence.present
    && continuationEvidence.outputHash !== null
    && continuationEvidence.outputHash === continuationStageHash
  const continuity = continuityProven
    ? [
        ...(continuationEvidence.previousChapterNumber === null ? [] : ['continuity:previous-chapter']),
        ...(continuationEvidence.previousChoiceChapter === null ? [] : ['continuity:previous-choice']),
      ]
    : []
  const delta = fixture.projection.semanticEvidence.proposedStateDelta
  const deltaMatchesPlan = stableStringify([...delta.keys].sort()) === stableStringify(
    [...fixture.projection.exactPlanProposedStateDeltaKeys].sort(),
  )
  const newState = artifactBindingsValid && deltaMatchesPlan && delta.nonempty && delta.keys.length > 0
    ? ['plan:proposed-state-delta']
    : []
  const characterInteraction = fixture.projection.semanticEvidence.characterOccurrences
    .filter((occurrence) => (
      artifactBindingsValid
      && occurrence.inPlannedBeats
      && occurrence.inWriterProjection
      && occurrence.artifactHash === domainHash('WRITER_CHARACTER_OCCURRENCE', {
        characterName: occurrence.characterName,
        inPlannedBeats: occurrence.inPlannedBeats,
        inWriterProjection: occurrence.inWriterProjection,
      })
    ))
    .map((occurrence) => `writer:character:${normalizeSemantic(occurrence.characterName)}`)
  const reveal = fixture.projection.semanticEvidence.scheduledReveal
  const revealPayoff = artifactBindingsValid
    && reveal
    && reveal.secretId === fixture.source.scheduledReveal?.secretId
    && reveal.presentInExactPlan
    && reveal.presentInWriterSemanticProjection
    ? [`reveal:${reveal.secretId}`]
    : []
  const ending = fixture.projection.productionSelectedEndingLock
    ? ['ending:production-selection']
    : []
  const evidenceIds = {
    sceneDriving: [...new Set(sceneDriving)],
    continuity: [...new Set(continuity)],
    newState,
    characterInteraction: [...new Set(characterInteraction)],
    revealPayoff,
    ending,
  }
  const endingEvidence = {
    selected: fixture.projection.productionSelectedEndingLock,
    writerVisible: fixture.projection.writerVisibleEndingLock,
  }
  return {
    key: fixture.key,
    phaseKind: fixture.source.phaseKind,
    continuityShape: fixture.chapterNumber === 1 ? 'NO_PRIOR_CONTEXT' as const : 'DIRECT_PREVIOUS_CHAPTER_AND_CHOICE' as const,
    revealShape: fixture.source.scheduledReveal ? 'CONCRETE_SCHEDULED_REVEAL' as const : 'FUTURE_REVEALS_BLOCKED' as const,
    endingShape: endingEvidence.selected
      ? endingEvidence.writerVisible
        ? 'PRODUCTION_SELECTED_AND_WRITER_VISIBLE' as const
        : 'PRODUCTION_SELECTED_NOT_WRITER_VISIBLE' as const
      : 'NOT_SELECTED' as const,
    endingEvidence,
    evidenceIds,
    obligationCounts: {
      sceneDriving: evidenceIds.sceneDriving.length,
      continuity: evidenceIds.continuity.length,
      newState: evidenceIds.newState.length,
      characterInteraction: evidenceIds.characterInteraction.length,
      revealPayoff: evidenceIds.revealPayoff.length,
      ending: evidenceIds.ending.length,
    },
  }
}

export const WRITER_QUALIFICATION_FIXTURE_V2 = Object.freeze({
  fixtureHashes: Object.freeze({
    EARLY: 'a15a0084bfffc34615f0e3817ef8c400c87999a48dcff867b3d94a27f48d3c2e',
    DIALOGUE: '69acde3f508aba42f6cabd4729945f5851262a40c9e4a43da6b2cb5ba11269fb',
    MYSTERY: 'ad9fbe534b4c44229b520febe5c0de32bbfb7dc9785ed46a951deff25bd35314',
    EMOTIONAL: '231176048040954a752fec1b27576e5ed03a3de93823f4d3d4853711e345499f',
    LATER_ACT: 'ed639042424181802a7f6df7b1bb8dcbbd0ef1137754f41a4c9a7bb3f0bbb6f9',
  }),
  provisionalCorpusManifestHash: '712d46e7b9a06394b98593ee537fab43c376cea4aebcc951d48b654d51ca6a2a',
  projectionValidationHash: 'ad0a3fdfd22af46983542cad3ca2add63c0df2765ce7a45b8782d47c57f0bf91',
  privacyValidationHash: 'feced0a494c7fd27fd1b855e4827b0270d6b9677d7347cb921fbc8982c8108af',
  readyAuthorityManifestHash: 'be4216adc5d1b1306aef13186eddcc294fa53d4abd8bba681889c7762bde4b99',
})

export type WriterQualificationFixtureV2RuntimeCapture = Readonly<{
  key: QualificationFixtureV2Key
  snapshot: CanonSnapshot
  plan: ChapterPlan
  continuation: ContinuationContext | null
  brief: PreProseChapterBrief
}>

export async function buildWriterQualificationFixtureV2(options: Readonly<{
  sourceAuthorityOverrides?: readonly QualificationSourceAuthorityOverride[]
  captureRuntimeFixture?: (fixture: WriterQualificationFixtureV2RuntimeCapture) => void
}> = {}) {
  const overrides = options.sourceAuthorityOverrides ?? []
  const contractBuild = storyContract(overrides)
  const contract = contractBuild.contract
  const canon = snapshot(contract, overrides)
  const fixtures: QualificationFixtureV2ValidationRow[] = []

  for (const key of WRITER_QUALIFICATION_FIXTURE_V2_KEYS) {
    const stageEvidence: Array<{ stage: BuilderStage; outputHash: string }> = [
      contractBuild.schemaEvidence,
      contractBuild.parserEvidence,
    ]
    const chapterNumber = CHAPTERS[key]
    const blueprint = latestBlueprintForChapter(canon, chapterNumber)
    if (!blueprint) throw new Error(`WRITER_QUALIFICATION_FIXTURE_V2_BLUEPRINT_MISSING:${key}`)
    stageEvidence.push({
      stage: 'latestBlueprintForChapter',
      outputHash: domainHash('BUILDER_STAGE_LATEST_BLUEPRINT', blueprint),
    })
    const routeLeak = overrideFor(overrides, key, 'routeState')
    const routeState = {
      truth: chapterNumber >= 12 ? 12 : 4,
      risk: chapterNumber >= 45 ? 14 : 5,
      secrecy: chapterNumber >= 12 ? 3 : 8,
      empathy: chapterNumber >= 25 ? 15 : 6,
      trust: { Arga: chapterNumber >= 25 ? 5 : 1 },
      evidence: routeLeak
        ? [routeLeak]
        : chapterNumber >= 12 ? ['Kartu pos dari loker stasiun'] : [],
      flags: {},
      endingBias: { 'rumah-bersama': 20, 'jalan-baru': 3, 'surat-ibu': 1 },
    }
    const prior = previousContext(chapterNumber, overrides, key)
    const chapterBrief = ChapterBriefSchema.parse(buildChapterBrief({
      storyContract: contract,
      snapshot: canon,
      readerState: { routeState, choiceHistory: [], lockedEndingKey: null },
      chapterNumber,
      previousChoice: prior.previousChoice,
    }))
    const chapterBriefHash = domainHash('BUILDER_STAGE_CHAPTER_BRIEF', chapterBrief)
    stageEvidence.push({
      stage: 'buildChapterBrief',
      outputHash: chapterBriefHash,
    })
    const packet = compileContext(canon, chapterNumber)
    stageEvidence.push({
      stage: 'compileContext',
      outputHash: domainHash('BUILDER_STAGE_COMPILED_CONTEXT', packet),
    })
    const storyAnchorLeak = overrideFor(overrides, key, 'storyAnchor')
    const continuation = key === 'EARLY'
      ? null
      : buildContinuationContext({
          storyId: canon.storyId,
          targetChapterNumber: chapterNumber,
          snapshot: canon,
          packet,
          previousChapterRow: prior.previousChapterRow,
          previousChoice: prior.previousChoice,
          routeStateSummary: chapterBrief.routeStateSummary,
          lockedEndingKey: null,
          storyAnchors: {
            corePromise: storyAnchorLeak ?? contract.corePromise,
            mainConflict: contract.mainConflict,
            finalQuestion: contract.finalQuestion,
          },
        })
    if (continuation) {
      stageEvidence.push({
        stage: 'buildContinuationContext',
        outputHash: domainHash('BUILDER_STAGE_CONTINUATION_CONTEXT', continuation),
      })
    }
    const preProseBrief = PreProseChapterBriefSchema.parse(buildPreProseChapterBrief({
      storyId: canon.storyId,
      chapterNumber,
      snapshot: canon,
      blueprint,
      continuation,
      chapterBrief,
    }))
    const preProseBriefHash = domainHash('BUILDER_STAGE_PRE_PROSE_BRIEF', preProseBrief)
    stageEvidence.push({
      stage: 'buildPreProseChapterBrief',
      outputHash: preProseBriefHash,
    })
    const plan = await generatePlan({ provider: createDeterministicProvider() }, {
      snapshot: canon,
      blueprint,
      chapterNumber,
      continuation,
      brief: preProseBrief,
    })
    const planStageOutputHash = domainHash('BUILDER_STAGE_PRODUCTION_PLAN', plan)
    stageEvidence.push({
      stage: 'generatePlan',
      outputHash: planStageOutputHash,
    })
    const writer = buildProductionChapterWriterPrompt({
      authorityMode: 'CHAPTER_BRIEF_V2',
      snapshot: canon,
      plan,
      continuation,
      brief: preProseBrief,
    })
    options.captureRuntimeFixture?.({
      key,
      snapshot: canon,
      plan,
      continuation,
      brief: preProseBrief,
    })
    if (!writer.system || !writer.prompt) {
      throw new Error(`WRITER_QUALIFICATION_FIXTURE_V2_WRITER_PROJECTION_EMPTY:${key}`)
    }
    const writerStageOutputHash = domainHash('BUILDER_STAGE_WRITER_PROJECTION', writer)
    stageEvidence.push({
      stage: 'buildProductionChapterWriterPrompt',
      outputHash: writerStageOutputHash,
    })
    const writerEnvelope = `${writer.system}\n${writer.prompt}`
    const characterNames = canon.characters
      .filter((character) => character.status !== 'DEAD' && character.introducedChapter <= chapterNumber)
      .map((character) => character.canonicalName)
    const voiceGuidance = canon.voiceSheets
      .filter((voice) => canon.characters.some((character) => (
        character.id === voice.characterId
        && character.status !== 'DEAD'
        && character.introducedChapter <= chapterNumber
      )))
      .flatMap((voice) => [voice.register, ...voice.speechHabits, ...voice.forbiddenWords, ...voice.sampleLines])
    const scheduledReveal = contract.revealRunway.find(
      (reveal) => reveal.revealGateChapter === chapterNumber,
    )
    const scheduledSourceObligation = scheduledReveal
      ? chapterBrief.mustInclude.find((item) => item.includes(scheduledReveal.secretId)) ?? null
      : null
    const scheduledProjectionObligation = scheduledReveal
      ? writer.metadata.obligations.find(
          (obligation) => obligation.authorityId === scheduledReveal.secretId,
        ) ?? null
      : null
    const selectedEnding = chapterBrief.lockedEndingKey === null
      ? null
      : contract.endingCandidates.find((ending) => ending.key === chapterBrief.lockedEndingKey) ?? null
    const forbiddenRevealIds = [...chapterBrief.mustNotReveal]
    const forbiddenRevealMeanings = canon.secrets
      .filter((secret) => forbiddenRevealIds.includes(secret.id))
      .map((secret) => secret.description)
    const sourceBeats = [
      chapterBrief.chapterGoal,
      ...chapterBrief.mustInclude,
    ]
    const secretAuthorities = canon.secrets.map((secret) => ({
      secretId: secret.id,
      meaning: secret.description,
      revealGateChapter: secret.revealGateChapter,
      explicitLeakMarker: `EXPLICIT_SECRET_LEAK:${secret.id}`,
    }))
    const positiveChannels: Record<QualificationPositiveChannel, string[]> = {
      goal: [chapterBrief.chapterGoal],
      beats: sourceBeats,
      previousProse: continuation?.previousChapter?.endingParagraphs ?? [],
      choiceConsequence: continuation?.previousChoice?.consequence ?? [],
      facts: continuation?.anchorFacts.map((fact) => fact.statement) ?? [],
      timeline: continuation?.recentTimeline.map((event) => event.description) ?? [],
      routeSummary: continuation ? [continuation.routeStateSummary] : [],
      storyAnchors: continuation?.storyAnchors
        ? [
            continuation.storyAnchors.corePromise,
            continuation.storyAnchors.mainConflict,
            continuation.storyAnchors.finalQuestion,
          ]
        : [],
    }
    const prohibitionChannel = [
      ...chapterBrief.mustNotReveal,
      ...(continuation?.mustNotReveal ?? []),
    ]
    const auditedPositiveChannels: Record<QualificationAuditedProjectionChannel, string[]> = {
      blueprintGoal: [blueprint.chapterGoal],
      blueprintBeat: [...blueprint.mandatoryBeats],
      characterName: characterNames,
      voiceGuidance,
      previousProse: continuation?.previousChapter?.endingParagraphs ?? [],
      choiceLabel: continuation?.previousChoice ? [continuation.previousChoice.label] : [],
      choiceConsequence: continuation?.previousChoice?.consequence ?? [],
      routeState: continuation ? [continuation.routeStateSummary] : [],
      thread: continuation?.openThreads.map((thread) => `${thread.id} ${thread.title} ${thread.status}`) ?? [],
      fact: continuation?.anchorFacts.map((fact) => fact.statement) ?? [],
      timeline: continuation?.recentTimeline.map((event) => event.description) ?? [],
      rollup: continuation?.actRollups.map((rollup) => rollup.summary) ?? [],
      storyAnchor: continuation?.storyAnchors
        ? Object.values(continuation.storyAnchors)
        : [],
      planChapterGoal: [plan.chapterGoal],
      planPlannedBeats: [...plan.plannedBeats],
      writerSystem: secretAuthorities.flatMap((authority) => (
        containsDeclaredSecret(writer.system, authority)
          ? [authority.explicitLeakMarker]
          : []
      )),
      writerPrompt: secretAuthorities.flatMap((authority) => {
        const positivePrompt = [...new Set(prohibitionChannel)].reduce(
          (clean, blocked) => clean.split(blocked).join(''),
          writer.prompt,
        )
        return containsDeclaredSecret(positivePrompt, authority)
          ? [authority.explicitLeakMarker]
          : []
      }),
    }
    const futureRevealLeaks = [...new Set(projectionLeaks(
      chapterNumber,
      secretAuthorities,
      auditedPositiveChannels,
      prohibitionChannel,
    ).map((leak) => leak.secretId))]
    const writerVisibleFindings = [
      { channel: 'chapterGoal' as const, value: plan.chapterGoal },
      ...plan.plannedBeats.map((value) => ({ channel: 'plannedBeat' as const, value })),
    ].flatMap(({ channel, value }) => {
      const normalizedValue = normalizeSemantic(value)
      return normalizedValue.length > 0 && normalizeSemantic(writerEnvelope).includes(normalizedValue)
        ? [{
            channel,
            normalizedValue,
            artifactHash: domainHash('WRITER_VISIBLE_SEMANTIC_FINDING', {
              channel,
              normalizedValue,
            }),
          }]
        : []
    })
    const normalizedPlanBeats = normalizeSemantic(plan.plannedBeats.join(' '))
    const normalizedWriterProjection = normalizeSemantic(writerEnvelope)
    const characterOccurrences = characterNames.flatMap((characterName) => {
      const normalizedName = normalizeSemantic(characterName)
      const inPlannedBeats = normalizedPlanBeats.includes(normalizedName)
      const inWriterProjection = normalizedWriterProjection.includes(normalizedName)
      const occurrence = {
        characterName,
        inPlannedBeats,
        inWriterProjection,
        artifactHash: domainHash('WRITER_CHARACTER_OCCURRENCE', {
          characterName,
          inPlannedBeats,
          inWriterProjection,
        }),
      }
      return occurrence.inPlannedBeats || occurrence.inWriterProjection ? [occurrence] : []
    })
    const exactPlanProposedStateDeltaKeys = Object.keys(plan.proposedStateDelta).sort()
    const projectedObligationAuthorityIds = writer.metadata.obligations
      .map((obligation) => obligation.authorityId)
    const writerDirectiveHashes = writer.metadata.obligations
      .map((obligation) => domainHash('WRITER_DIRECTIVE', obligation.writerDirective))
    const internalAuthorityIds = [...new Set([
      ...preProseBrief.forbiddenRevealIds,
      ...preProseBrief.resolvedPlotDebtIds,
      ...projectedObligationAuthorityIds,
      ...(preProseBrief.lockedEndingKey ? [preProseBrief.lockedEndingKey] : []),
    ])]
    const writerVisibleInternalIdCount = internalAuthorityIds.reduce(
      (count, authorityId) => count + (writerEnvelope.includes(authorityId) ? 1 : 0),
      0,
    )
    const endingAuthorityProjectionHash = writer.metadata.endingLockProjected
      ? domainHash('ENDING_AUTHORITY_PROJECTION', {
          lockedEndingKey: preProseBrief.lockedEndingKey,
          lockedEndingClosure: preProseBrief.lockedEndingClosure,
          writerVisible: preProseBrief.lockedEndingClosure.every((closure) => writerEnvelope.includes(closure)),
        })
      : null
    const continuationOutputHash = continuation
      ? domainHash('BUILDER_STAGE_CONTINUATION_CONTEXT', continuation)
      : null
    const planSafeArtifact = {
      normalizedChapterGoal: normalizeSemantic(plan.chapterGoal),
      normalizedPlannedBeats: plan.plannedBeats.map(normalizeSemantic),
      proposedStateDeltaKeys: Object.keys(plan.proposedStateDelta).sort(),
      characterNamesInPlannedBeats: characterNames.filter((characterName) => (
        normalizedPlanBeats.includes(normalizeSemantic(characterName))
      )).sort(),
      scheduledRevealSecretIds: scheduledReveal
        && plan.plannedBeats.some((beat) => beat.includes(scheduledReveal.secretId))
        ? [scheduledReveal.secretId]
        : [],
    }
    const writerSafeArtifact = {
      authorityMode: 'CHAPTER_BRIEF_V2' as const,
      briefBindingHash: preProseBriefHash,
      visibleFindings: writerVisibleFindings.map(({ channel, normalizedValue }) => ({
        channel,
        normalizedValue,
      })),
      characterNamesInProjection: characterNames.filter((characterName) => (
        normalizedWriterProjection.includes(normalizeSemantic(characterName))
      )).sort(),
      projectedObligationAuthorityIds,
      scheduledRevealSecretIds: scheduledReveal && scheduledProjectionObligation
        && writerEnvelope.includes(scheduledProjectionObligation.writerDirective)
        ? [scheduledReveal.secretId]
        : [],
      writerDirectiveHashes,
      endingAuthorityProjectionHash,
      writerVisibleInternalIdCount,
      legacyFallbackUsed: false as const,
    }
    const continuationSafeArtifact = {
      present: continuation !== null,
      previousChapterNumber: continuation?.previousChapter?.number ?? null,
      previousChoiceChapter: continuation?.previousChoice?.chapterNumber ?? null,
    }
    const artifactBindings = {
      plan: {
        stageOutputHash: planStageOutputHash,
        safeArtifact: planSafeArtifact,
        safeArtifactHash: domainHash('PLAN_SEMANTIC_ARTIFACT_BINDING', {
          stageOutputHash: planStageOutputHash,
          safeArtifact: planSafeArtifact,
        }),
      },
      writer: {
        stageOutputHash: writerStageOutputHash,
        safeArtifact: writerSafeArtifact,
        safeArtifactHash: domainHash('WRITER_SEMANTIC_ARTIFACT_BINDING', {
          stageOutputHash: writerStageOutputHash,
          safeArtifact: writerSafeArtifact,
        }),
      },
      continuation: {
        stageOutputHash: continuationOutputHash,
        safeArtifact: continuationSafeArtifact,
        safeArtifactHash: domainHash('CONTINUATION_SEMANTIC_ARTIFACT_BINDING', {
          stageOutputHash: continuationOutputHash,
          safeArtifact: continuationSafeArtifact,
        }),
      },
    }

    fixtures.push({
      key,
      chapterNumber,
      source: {
        phaseKind: PHASE_KIND[key],
        remainingChapters: chapterBrief.remainingChapters,
        beats: sourceBeats,
        forbiddenRevealIds,
        forbiddenRevealMeanings,
        scheduledReveal: scheduledReveal && scheduledSourceObligation ? {
          secretId: scheduledReveal.secretId,
          gateChapter: scheduledReveal.revealGateChapter,
          obligation: scheduledSourceObligation,
        } : null,
        selectedEndingMeaning: selectedEnding?.requiredClosure[0] ?? null,
        secretAuthorities,
        positiveChannels,
        prohibitionChannel,
      },
      continuity: {
        previousChapterNumber: continuation?.previousChapter?.number ?? null,
        previousChoiceChapter: continuation?.previousChoice?.chapterNumber ?? null,
        visibleEstablishedChapters: continuation?.anchorFacts.map((fact) => fact.establishedChapter) ?? [],
        visibleTimelineChapters: continuation?.recentTimeline.map((event) => event.chapterNumber) ?? [],
      },
      projection: {
        scheduledRevealObligationConcrete: scheduledSourceObligation !== null
          && plan.plannedBeats.some((beat) => beat.includes(scheduledReveal!.secretId)),
        scheduledRevealWriterVisible: scheduledProjectionObligation !== null
          && writerEnvelope.includes(scheduledProjectionObligation.writerDirective),
        futureRevealLeaks,
        auditedPositiveChannels,
        prohibitionChannel,
        exactPlanChapterGoal: plan.chapterGoal,
        exactPlanPlannedBeats: [...plan.plannedBeats],
        exactPlanProposedStateDeltaKeys,
        productionSelectedEndingLock: chapterBrief.lockedEndingKey !== null,
        writerVisibleEndingLock: writer.metadata.endingLockProjected
          && preProseBrief.lockedEndingClosure.length > 0
          && preProseBrief.lockedEndingClosure.every((closure) => writerEnvelope.includes(closure)),
        writerVisibleEndingMeaning: selectedEnding && writerEnvelope.includes(selectedEnding.requiredClosure[0]!)
          ? selectedEnding.requiredClosure[0]!
          : null,
        writerVisibleEndingRawKey: chapterBrief.lockedEndingKey
          && writerEnvelope.includes(chapterBrief.lockedEndingKey)
          ? chapterBrief.lockedEndingKey
          : null,
        authorityBinding: {
          fixtureHash: WRITER_QUALIFICATION_FIXTURE_V2.fixtureHashes[key],
          chapterBriefHash,
          preProseBriefHash,
          planHash: planStageOutputHash,
          authorityMode: 'CHAPTER_BRIEF_V2' as const,
          briefBindingHash: preProseBriefHash,
          projectedObligationAuthorityIds,
          writerDirectiveHashes,
          forbiddenRevealIdentityHashes: preProseBrief.forbiddenRevealIds.map(
            (authorityId) => domainHash('FORBIDDEN_REVEAL_IDENTITY', authorityId),
          ),
          endingAuthorityProjectionHash,
          writerVisibleInternalIdCount,
          legacyFallbackUsed: false,
        },
        semanticEvidence: {
          proposedStateDelta: {
            keys: exactPlanProposedStateDeltaKeys,
            nonempty: exactPlanProposedStateDeltaKeys.length > 0,
          },
          writerVisibleFindings,
          characterOccurrences,
          scheduledReveal: scheduledReveal ? {
            secretId: scheduledReveal.secretId,
            presentInExactPlan: scheduledSourceObligation !== null
              && plan.plannedBeats.some((beat) => beat.includes(scheduledReveal.secretId)),
            presentInWriterSemanticProjection: scheduledProjectionObligation !== null
              && writerEnvelope.includes(scheduledProjectionObligation.writerDirective),
          } : null,
          continuation: {
            present: continuation !== null,
            outputHash: continuationOutputHash,
            previousChapterNumber: continuation?.previousChapter?.number ?? null,
            previousChoiceChapter: continuation?.previousChoice?.chapterNumber ?? null,
          },
          artifactBindings,
        },
      },
      provenance: {
        stages: stageEvidence.map((evidence) => evidence.stage),
        stageEvidence,
        artifactAuthorityHash: domainHash('BUILDER_STAGE_ARTIFACT_AUTHORITY', stageEvidence),
        notApplicableStages: key === 'EARLY'
          ? [{
              stage: 'buildContinuationContext' as const,
              reason: 'BAB_1_PRODUCTION_CONTINUATION_IS_NULL' as const,
            }]
          : [],
        productionRequiredBriefFieldsPresent: Boolean(
          preProseBrief.chapterGoal
          && preProseBrief.phase
          && Array.isArray(preProseBrief.mustInclude)
          && Array.isArray(preProseBrief.mustNotReveal)
          && typeof preProseBrief.routeStateSummary === 'string',
        ),
        latestBlueprintVersion: blueprint.version,
      },
      privacy: {
        metadataValues: [key, REFERENCE_CLASS[key], `chapter-${chapterNumber}`],
      },
      proof: {
        storyContractParsed: StoryContractSchema.safeParse(contract).success,
        chapterBriefParsed: ChapterBriefSchema.safeParse(chapterBrief).success,
        preProseBriefParsed: PreProseChapterBriefSchema.safeParse(preProseBrief).success,
        planParsed: plan.storyId === canon.storyId && plan.chapterNumber === chapterNumber,
        writerProjectionBuilt: writer.system.length > 0 && writer.prompt.length > 0,
        continuationWasNullForPreProse: key === 'EARLY' && continuation === null,
        continuationWasNullForPlan: key === 'EARLY' && continuation === null,
        continuationWasNullForWriter: key === 'EARLY' && continuation === null,
      },
    })
  }

  const validationInput = { fixtures }
  const validation = assertQualificationFixtureV2(validationInput)
  const hashes = computeQualificationFixtureV2Hashes(validationInput)
  const readyAuthorityManifestHash = validation.qualificationAllowed
    ? domainHash('WRITER_QUALIFICATION_FIXTURE_V2_READY_AUTHORITY', {
        track: 'WRITER_QUALIFICATION_FIXTURE_V2',
        fixtureHashes: hashes.fixtureHashes,
        provisionalCorpusManifestHash: hashes.provisionalCorpusManifestHash,
        projectionValidationHash: hashes.projectionValidationHash,
        privacyValidationHash: hashes.privacyValidationHash,
        trustedSemanticArtifactAuthorities: TRUSTED_SEMANTIC_ARTIFACT_AUTHORITIES,
        terminalVerdict: validation.terminalVerdict,
        validationCategories: validation.validationCategories,
      })
    : null
  const manifest = {
    track: 'WRITER_QUALIFICATION_FIXTURE_V2' as const,
    fixtureKeys: [...WRITER_QUALIFICATION_FIXTURE_V2_KEYS],
    fixtureHashes: hashes.fixtureHashes,
    provisionalCorpusManifestHash: hashes.provisionalCorpusManifestHash,
    projectionValidationHash: hashes.projectionValidationHash,
    privacyValidationHash: hashes.privacyValidationHash,
    readyAuthorityManifestHash,
    terminalVerdict: validation.terminalVerdict,
    qualificationAllowed: validation.qualificationAllowed,
    corpusBuilt: true as const,
    schemaTraversalPassed: validation.schemaTraversalPassed,
    builderTraversalPassed: validation.builderTraversalPassed,
    semanticSourcePassed: validation.semanticSourcePassed,
    validationCategories: validation.validationCategories,
    inferenceCount: 0 as const,
    databaseCalls: 0 as const,
    publicationCalls: 0 as const,
    fixtures: fixtures.map((fixture) => ({
      key: fixture.key,
      chapterNumber: fixture.chapterNumber,
      persistedReaderLock: null,
      productionSelectedEndingLock: fixture.projection.productionSelectedEndingLock,
      writerVisibleEndingLock: fixture.projection.writerVisibleEndingLock,
      continuationSemantics: fixture.key === 'EARLY'
        ? 'NULL_FOR_BAB_1_PRODUCTION_PATH' as const
        : 'DIRECT_PREVIOUS_CHAPTER_AND_CHOICE' as const,
    })),
    representativenessMatrix: fixtures.map((fixture) => {
      const fixtureValue = fixtureComparisonShape(fixture)
      const referenceValue = committedReferenceShape(fixture.key)
      const assessment = stableStringify(fixtureValue) === stableStringify(referenceValue)
        ? 'MATCH' as const
        : 'INTENTIONAL_SYNTHETIC_SUBSTITUTION' as const
      return {
        key: fixture.key,
        chapterNumber: fixture.chapterNumber,
        referenceClass: REFERENCE_CLASS[fixture.key],
        productionContractField: PRODUCTION_CONTRACT_FIELD[fixture.key],
        committedProductionLikeReference: REFERENCE_LOCATOR[fixture.key],
        referenceCounterpart: {
          semanticShape: referenceValue,
          valueHash: domainHash('QUALIFICATION_REFERENCE_COUNTERPART', referenceValue),
        },
        fixtureV2Counterpart: {
          semanticShape: fixtureValue,
          valueHash: domainHash('QUALIFICATION_REFERENCE_COUNTERPART', fixtureValue),
        },
        comparisonMethod: assessment === 'MATCH'
          ? 'EXACT_CANONICAL_SHAPE' as const
          : 'DECLARED_SYNTHETIC_EQUIVALENCE' as const,
        assessment,
        rationale: REPRESENTATIVENESS_RATIONALE[fixture.key],
      }
    }),
    semanticSummaries: fixtures.map(deriveQualificationFixtureV2SemanticSummary),
  }

  return { validationInput, manifest }
}
