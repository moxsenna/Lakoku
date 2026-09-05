import type { CanonSnapshot, ContinuationContext, Finding } from '@lakoku/narrative-core'
import { buildWriterPrompt } from '@/lib/prose/prompt-engine'
import type {
  PreProseChapterBrief,
  WriterNarrativeObligation,
} from '@/lib/story-engine/pre-prose-brief'
import {
  evaluateWriterCompleteness,
  type WriterCompletenessFinding,
} from './writer-completeness'

export const PRODUCTION_CHAPTER_WRITER_TIMEOUT_MS = 120_000
export const PRODUCTION_CHAPTER_WRITER_MAX_RETRIES = 0
export const PRODUCTION_CHAPTER_WRITER_STREAMING = true
export const DEFAULT_PRODUCTION_CHAPTER_WRITER_MAX_OUTPUT_TOKENS = 2048
export const ANTIGRAVITY_REASONING_MAX_OUTPUT_FLOOR = 4096

export type ProductionChapterWriterRuntime = Readonly<{
  timeoutMs: number
  streaming: true
  maxRetries: 0
  maxOutputTokens: number
}>

export function resolveProductionChapterWriterRuntime(args: Readonly<{
  label: string
  modelId?: string
  routeMax?: number | null
}>): ProductionChapterWriterRuntime {
  const maxOutputTokens = args.routeMax ?? DEFAULT_PRODUCTION_CHAPTER_WRITER_MAX_OUTPUT_TOKENS
  const identity = `${args.label} ${args.modelId ?? ''}`.toLowerCase()
  const usesAntigravity = identity.includes('ag/') || identity.includes('antigravity')

  return {
    timeoutMs: PRODUCTION_CHAPTER_WRITER_TIMEOUT_MS,
    streaming: PRODUCTION_CHAPTER_WRITER_STREAMING,
    maxRetries: PRODUCTION_CHAPTER_WRITER_MAX_RETRIES,
    maxOutputTokens: usesAntigravity
      ? Math.max(maxOutputTokens, ANTIGRAVITY_REASONING_MAX_OUTPUT_FLOOR)
      : maxOutputTokens,
  }
}

export type ParsedChapterWriterProse = Readonly<{
  title: string
  paragraphs: string[]
  hasExplicitTitle: boolean
}>

export function parseChapterWriterProse(text: string): ParsedChapterWriterProse {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)

  if (blocks.length === 0) {
    throw new Error('gateway-provider: LLM mengembalikan teks kosong.')
  }

  let title = ''
  const first = blocks[0]
  const titleMatch = first.match(/^\s*(?:JUDUL|Judul|TITLE|Title)\s*[:：]\s*(.+)$/)
  const hasExplicitTitle = titleMatch !== null
  if (titleMatch) {
    title = titleMatch[1].trim()
    blocks.shift()
  } else {
    const firstLine = first.split('\n')[0].trim()
    if (!first.includes('\n') && firstLine.length <= 80) {
      title = firstLine.replace(/^#+\s*/, '')
      blocks.shift()
    } else {
      title = 'Tanpa Judul'
    }
  }

  const paragraphs = blocks
    .flatMap((block) => block.split(/\n+/))
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  if (!title) title = 'Tanpa Judul'
  return { title, paragraphs, hasExplicitTitle }
}

export function evaluateCapturedChapterWriterOutput(input: Readonly<{
  text: string
  finishReason: string | undefined
}>): Readonly<{
  prose: ParsedChapterWriterProse
  findings: WriterCompletenessFinding[]
}> {
  const prose = parseChapterWriterProse(input.text)
  return {
    prose,
    findings: evaluateWriterCompleteness({
      finishReason: input.finishReason,
      ...prose,
    }),
  }
}

function activeCharacterNames(snapshot: CanonSnapshot, chapter: number): string[] {
  return snapshot.characters
    .filter((character) => character.status !== 'DEAD' && character.introducedChapter <= chapter)
    .map((character) => character.canonicalName)
}

function voiceGuidance(snapshot: CanonSnapshot, chapter: number): string {
  const nameById = new Map(snapshot.characters.map((character) => [
    character.id,
    character.canonicalName,
  ]))
  const activeIds = new Set(
    snapshot.characters
      .filter((character) => (
        character.status !== 'DEAD' && character.introducedChapter <= chapter
      ))
      .map((character) => character.id),
  )
  const lines = snapshot.voiceSheets
    .filter((voice) => activeIds.has(voice.characterId))
    .sort((left, right) => left.characterId.localeCompare(right.characterId))
    .map((voice) => {
      const name = nameById.get(voice.characterId) ?? 'Tokoh'
      const parts = [`- ${name}: bicara ${voice.register}`]
      if (voice.speechHabits.length) parts.push(`kebiasaan: ${voice.speechHabits.join('; ')}`)
      if (voice.forbiddenWords.length) parts.push(`hindari kata: ${voice.forbiddenWords.join(', ')}`)
      if (voice.sampleLines.length) parts.push(`contoh nada: "${voice.sampleLines[0]}"`)
      return parts.join(' — ')
    })
  if (!lines.length) return ''
  return ['Jaga suara tiap tokoh agar khas & konsisten:', ...lines].join('\n')
}

export type WriterAuthorityMode = 'CHAPTER_BRIEF_V2'

export interface BuildProductionChapterWriterPromptArgs {
  readonly snapshot: CanonSnapshot
  readonly plan: Record<string, unknown>
  readonly continuation?: ContinuationContext | null
  readonly brief?: PreProseChapterBrief | null
  readonly authorityMode: WriterAuthorityMode
  readonly repairFindings?: Finding[]
}

export type ChapterWriterPromptProjection = Readonly<{
  system: string
  prompt: string
  metadata: Readonly<{
    authorityMode: WriterAuthorityMode
    endingLockProjected: boolean
    obligations: readonly WriterNarrativeObligation[]
  }>
}>

export function buildWriterLengthRepairPrompt(args: Readonly<{
  production: Readonly<{ system: string; prompt: string }>
  firstPass: Pick<ParsedChapterWriterProse, 'title' | 'paragraphs'>
  wordCount: number
}>): Readonly<{ system: string; prompt: string }> {
  const direction = args.wordCount < 800
    ? 'Prosa terlalu pendek: perluas adegan yang sudah ada secara alami; jangan menambah fakta baru.'
    : 'Prosa terlalu panjang: padatkan pilihan kata dan pengulangan; jangan menghapus peristiwa apa pun.'
  const firstPass = [
    `JUDUL: ${args.firstPass.title}`,
    '',
    ...args.firstPass.paragraphs,
  ].join('\n\n')

  return {
    system: args.production.system,
    prompt: [
      args.production.prompt,
      '',
      'REVISI PANJANG — ganti seluruh keluaran sebelumnya.',
      direction,
      'Targetkan 850–950 kata.',
      'Pertahankan judul, semua peristiwa, akhir, sudut pandang/POV, canon, dan makna.',
      'Balas hanya dengan JUDUL: diikuti prosa lengkap, tanpa komentar, penjelasan, atau markdown.',
      '',
      'DRAF PERTAMA UNTUK DIREVISI:',
      firstPass,
    ].join('\n'),
  }
}

export class ContradictionError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'ContradictionError'
    this.code = code
  }
}

function knownInternalAuthorityIdentifiers(brief: PreProseChapterBrief): string[] {
  return [...new Set([
    ...brief.forbiddenRevealIds,
    ...brief.resolvedPlotDebtIds,
    ...brief.scheduledReveals.map((item) => item.authorityId),
    ...brief.plotDebtsToProgress.map((item) => item.authorityId),
    ...brief.plotDebtsToClose.map((item) => item.authorityId),
    ...(brief.lockedEndingKey === null ? [] : [brief.lockedEndingKey]),
  ])]
}

function assertNoWriterVisibleInternalAuthorityIdentifiers(args: Readonly<{
  brief: PreProseChapterBrief
  system: string
  prompt: string
}>): void {
  const writerVisible = `${args.system}\n${args.prompt}`
  const leaked = knownInternalAuthorityIdentifiers(args.brief)
    .find((authorityId) => writerVisible.includes(authorityId))
  if (leaked) {
    throw new ContradictionError('WRITER_VISIBLE_INTERNAL_AUTHORITY_IDENTIFIER')
  }
}

function assertAuthorityContradictionGuards(args: Readonly<{
  snapshot: CanonSnapshot
  brief: PreProseChapterBrief
  continuation?: ContinuationContext | null
}>): void {
  const { snapshot, brief, continuation } = args
  const forbiddenRevealIds = new Set(brief.forbiddenRevealIds)
  if (brief.scheduledReveals.some((reveal) => forbiddenRevealIds.has(reveal.authorityId))) {
    throw new ContradictionError('SCHEDULED_REVEAL_CONTRADICTS_FORBIDDEN_REVEAL_ID')
  }

  const resolvedPlotDebtIds = new Set(brief.resolvedPlotDebtIds)
  if (brief.plotDebtsToClose.some((debt) => resolvedPlotDebtIds.has(debt.authorityId))) {
    throw new ContradictionError('PLOT_DEBT_TO_CLOSE_ALREADY_RESOLVED')
  }

  if (
    continuation?.lockedEndingKey !== null
    && continuation?.lockedEndingKey !== undefined
    && brief.lockedEndingKey !== null
    && continuation.lockedEndingKey !== brief.lockedEndingKey
  ) {
    throw new ContradictionError('ENDING_LOCK_CONFLICT_BETWEEN_BRIEF_AND_CONTINUATION')
  }

  const revealGateChapterById = new Map(
    snapshot.secrets.map((secret) => [secret.id, secret.revealGateChapter]),
  )
  if (brief.scheduledReveals.some((reveal) => {
    const gateChapter = revealGateChapterById.get(reveal.authorityId)
      ?? snapshot.secrets.find((secret) => (
        secret.id.endsWith(reveal.authorityId) || reveal.authorityId.endsWith(secret.id)
      ))?.revealGateChapter
    return gateChapter !== undefined && brief.chapterNumber < gateChapter
  })) {
    throw new ContradictionError('SCHEDULED_REVEAL_BEFORE_GATE_CHAPTER')
  }
}

export function buildProductionChapterWriterPrompt(
  args: BuildProductionChapterWriterPromptArgs,
): ChapterWriterPromptProjection {
  if (!args.brief) {
    throw new Error(
      'CHAPTER_BRIEF_V2_BRIEF_REQUIRED: brief is mandatory in CHAPTER_BRIEF_V2 authority mode',
    )
  }

  const { snapshot, plan, continuation, brief } = args
  assertAuthorityContradictionGuards({ snapshot, brief, continuation })

  const chapter = brief?.chapterNumber ?? Number(plan.chapterNumber)
  const names = activeCharacterNames(snapshot, chapter)
  const voices = voiceGuidance(snapshot, chapter)
  const beats = Array.isArray(plan.plannedBeats) ? (plan.plannedBeats as string[]) : []
  const obligations = brief
    ? [
        ...brief.scheduledReveals,
        ...brief.plotDebtsToProgress,
        ...brief.plotDebtsToClose,
      ].map((obligation) => ({ ...obligation }))
    : []

  const phase = brief?.phase ?? String(plan.phase ?? '')
  const goal = brief?.chapterGoal ?? String(plan.chapterGoal ?? '')
  const parts = buildWriterPrompt({
    chapterNumber: chapter,
    phase: phase || undefined,
    goal: goal || undefined,
    characterNames: names,
    voiceGuidance: voices || undefined,
    plannedBeats: beats,
    sceneCount: Number(plan.targetSceneCount ?? 3),
    continuation,
    brief,
    repairFindings: args.repairFindings?.map((finding) => ({
      severity: finding.severity,
      message: finding.message,
    })),
  })
  if (brief) {
    assertNoWriterVisibleInternalAuthorityIdentifiers({
      brief,
      system: parts.system,
      prompt: parts.user,
    })
  }

  return {
    system: parts.system,
    prompt: parts.user,
    metadata: {
      authorityMode: args.authorityMode,
      endingLockProjected: brief?.lockedEndingKey != null,
      obligations,
    },
  }
}
