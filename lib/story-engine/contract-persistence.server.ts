import 'server-only'

import { createAdminClient } from '@lakoku/db'
import { z } from 'zod'
import type { TasteProfile } from '@/lib/taste-profile/schema'
import type { ContractSource } from './contract-generation.server'
import { StoryContractSchema, type StoryContract } from './story-contract'

export interface CharacterInsert {
  id: string
  story_id: string
  canonical_name: string
  role: string
  motivation: string
  introduced_chapter: number
}

export interface CharacterAliasInsert {
  story_id: string
  character_id: string
  alias: string
  alias_type: 'NAME' | 'NICKNAME' | 'RELATION' | 'TITLE'
}

export interface VoiceSheetInsert {
  story_id: string
  character_id: string
  register: string
  speech_habits: string[]
  forbidden_words: string[]
  sample_lines: string[]
}

export interface FactInsert {
  id: string
  story_id: string
  statement: string
  subject_character_id: string | null
  established_chapter: number
  salience: number
  load_bearing: boolean
  paid_off: boolean
}

export interface KnowledgeInsert {
  story_id: string
  character_id: string
  fact_id: string
  known_from_chapter: number
}

export interface SecretInsert {
  id: string
  story_id: string
  description: string
  reveal_gate_chapter: number
  revealed: boolean
}

export interface ThreadInsert {
  id: string
  story_id: string
  title: string
  status: 'OPEN' | 'DEVELOPING' | 'PAYOFF_DUE' | 'RESOLVED' | 'ABANDONED_APPROVED'
  opened_chapter: number
  last_touched_chapter: number
  payoff_window: number | null
  is_main_mystery: boolean
  stale: boolean
  stale_since_chapter: number | null
}

export interface ChapterBlueprintInsert {
  story_id: string
  chapter_number: number
  version: number
  phase: string
  chapter_goal: string
  mandatory_beats: string[]
  forbidden_reveals: string[]
  allowed_state_delta: Record<string, unknown>
  introduces_characters: string[]
  reconciled_from_version: number | null
  reconciliation_reason: string | null
}

export interface CanonBootstrap {
  characters: CharacterInsert[]
  characterAliases: CharacterAliasInsert[]
  voiceSheets: VoiceSheetInsert[]
  facts: FactInsert[]
  knowledge: KnowledgeInsert[]
  secrets: SecretInsert[]
  threads: ThreadInsert[]
  blueprints: ChapterBlueprintInsert[]
}

const idString = z.string().trim().min(1).max(256)
const storyIdString = z.string().trim().min(1).max(128)
const bounded = (min: number, max: number) => z.string().trim().min(min).max(max)
const chapter = z.number().int().min(1).max(50)
const nullableChapter = chapter.nullable()
const stringArray = (maxItems: number, minLength: number, maxLength: number) =>
  z.array(bounded(minLength, maxLength)).max(maxItems)

const CharacterInsertSchema = z.object({
  id: idString,
  story_id: storyIdString,
  canonical_name: bounded(2, 60),
  role: bounded(2, 60),
  motivation: bounded(10, 240),
  introduced_chapter: chapter,
}).strict()

const CharacterAliasInsertSchema = z.object({
  story_id: storyIdString,
  character_id: idString,
  alias: bounded(1, 60),
  alias_type: z.enum(['NAME', 'NICKNAME', 'RELATION', 'TITLE']),
}).strict()

const VoiceSheetInsertSchema = z.object({
  story_id: storyIdString,
  character_id: idString,
  register: bounded(3, 140),
  speech_habits: stringArray(6, 2, 120),
  forbidden_words: stringArray(10, 1, 40),
  sample_lines: stringArray(4, 3, 200).min(1),
}).strict()

const FactInsertSchema = z.object({
  id: idString,
  story_id: storyIdString,
  statement: bounded(8, 240),
  subject_character_id: idString.nullable(),
  established_chapter: chapter,
  salience: z.number().min(0).max(1),
  load_bearing: z.boolean(),
  paid_off: z.boolean(),
}).strict()

const KnowledgeInsertSchema = z.object({
  story_id: storyIdString,
  character_id: idString,
  fact_id: idString,
  known_from_chapter: chapter,
}).strict()

const SecretInsertSchema = z.object({
  id: idString,
  story_id: storyIdString,
  description: bounded(15, 300),
  reveal_gate_chapter: chapter,
  revealed: z.boolean(),
}).strict()

const ThreadInsertSchema = z.object({
  id: idString,
  story_id: storyIdString,
  title: bounded(5, 120),
  status: z.enum(['OPEN', 'DEVELOPING', 'PAYOFF_DUE', 'RESOLVED', 'ABANDONED_APPROVED']),
  opened_chapter: chapter,
  last_touched_chapter: chapter,
  payoff_window: nullableChapter,
  is_main_mystery: z.boolean(),
  stale: z.boolean(),
  stale_since_chapter: nullableChapter,
}).strict()

const ChapterBlueprintInsertSchema = z.object({
  story_id: storyIdString,
  chapter_number: chapter,
  version: z.number().int().min(1).max(1000),
  phase: bounded(1, 120),
  chapter_goal: bounded(1, 500),
  mandatory_beats: stringArray(50, 1, 500),
  forbidden_reveals: z.array(idString).max(500),
  // Bootstrap always seeds empty delta; reject non-empty / oversized objects.
  allowed_state_delta: z.record(z.string(), z.unknown()).refine(
    (value) => Object.keys(value).length === 0,
    { message: 'allowed_state_delta must be empty object at bootstrap' },
  ),
  introduces_characters: z.array(idString).max(100),
  reconciled_from_version: z.number().int().min(1).max(1000).nullable(),
  reconciliation_reason: bounded(1, 500).nullable(),
}).strict()

export const CanonBootstrapSchema = z.object({
  characters: z.array(CharacterInsertSchema).min(1).max(100),
  characterAliases: z.array(CharacterAliasInsertSchema).max(500),
  voiceSheets: z.array(VoiceSheetInsertSchema).max(100),
  facts: z.array(FactInsertSchema).max(1000),
  knowledge: z.array(KnowledgeInsertSchema).max(5000),
  secrets: z.array(SecretInsertSchema).max(500),
  threads: z.array(ThreadInsertSchema).max(500),
  blueprints: z.array(ChapterBlueprintInsertSchema).length(50),
}).strict()

/** Word-safe max truncate. Prefer last space within maxLength. */
function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  const candidate = value.slice(0, maxLength + 1)
  const boundary = candidate.lastIndexOf(' ')
  return candidate.slice(0, boundary > 0 ? boundary : maxLength).trimEnd()
}

/**
 * Deterministic pad after truncate so canon mins pass without inventing narrative.
 * Filler is fixed '.' only (no whitespace — CanonBootstrapSchema trims strings).
 * Never invents story text.
 */
function padToMin(value: string, minLength: number, maxLength: number): string {
  const trimmed = truncate(value.trim(), maxLength)
  if (trimmed.length >= minLength) return trimmed
  const need = Math.min(minLength, maxLength) - trimmed.length
  if (need <= 0) return trimmed.slice(0, maxLength)
  return (trimmed + '.'.repeat(need)).slice(0, maxLength)
}

function boundField(value: string, minLength: number, maxLength: number): string {
  return padToMin(value, minLength, maxLength)
}

function scopedId(storyId: string, localId: string): string {
  return `${storyId}:${localId}`
}

function threadStatus(status: StoryContract['plotDebts'][number]['status']): ThreadInsert['status'] {
  if (status === 'closed') return 'RESOLVED'
  if (status === 'progressing') return 'DEVELOPING'
  return 'OPEN'
}

export function contractToCanonBootstrap(contract: StoryContract): CanonBootstrap {
  const validated = StoryContractSchema.parse(contract)
  const storyId = validated.storyId
  const mainCharacterId = scopedId(storyId, 'character:main')
  const facts: FactInsert[] = [
    {
      id: scopedId(storyId, 'fact:main-character-wound'),
      story_id: storyId,
      statement: boundField(validated.mainCharacter.wound, 8, 240),
      subject_character_id: mainCharacterId,
      established_chapter: 1,
      salience: 0.9,
      load_bearing: true,
      paid_off: false,
    },
    {
      id: scopedId(storyId, 'fact:main-conflict'),
      story_id: storyId,
      statement: boundField(validated.mainConflict, 8, 240),
      subject_character_id: mainCharacterId,
      established_chapter: 1,
      salience: 1,
      load_bearing: true,
      paid_off: false,
    },
    {
      id: scopedId(storyId, 'fact:final-question'),
      story_id: storyId,
      statement: boundField(validated.finalQuestion, 8, 240),
      subject_character_id: mainCharacterId,
      established_chapter: 1,
      salience: 1,
      load_bearing: true,
      paid_off: false,
    },
  ]

  const bootstrap: CanonBootstrap = {
    characters: [{
      id: mainCharacterId,
      story_id: storyId,
      canonical_name: boundField(validated.mainCharacter.name, 2, 60),
      role: boundField(validated.mainCharacter.role, 2, 60),
      motivation: boundField(validated.mainCharacter.desire, 10, 240),
      introduced_chapter: 1,
    }],
    characterAliases: [{
      story_id: storyId,
      character_id: mainCharacterId,
      alias: boundField(validated.mainCharacter.name, 1, 60),
      alias_type: 'NAME',
    }],
    voiceSheets: [{
      story_id: storyId,
      character_id: mainCharacterId,
      register: boundField(validated.tone, 3, 140),
      speech_habits: ['Menjawab dengan tujuan yang jelas'],
      forbidden_words: [],
      sample_lines: [boundField(validated.corePromise, 3, 200)],
    }],
    facts,
    knowledge: facts.map((fact) => ({
      story_id: storyId,
      character_id: mainCharacterId,
      fact_id: fact.id,
      known_from_chapter: fact.established_chapter,
    })),
    secrets: validated.revealRunway.map((secret) => ({
      id: scopedId(storyId, secret.secretId),
      story_id: storyId,
      description: boundField(
        `Rahasia terjadwal ${secret.secretId} mengubah jawaban atas ${validated.finalQuestion}`,
        15,
        300,
      ),
      reveal_gate_chapter: secret.revealGateChapter,
      revealed: false,
    })),
    threads: validated.plotDebts.map((debt) => ({
      id: scopedId(storyId, `thread:${debt.id}`),
      story_id: storyId,
      title: boundField(debt.question, 5, 120),
      status: threadStatus(debt.status),
      opened_chapter: debt.introducedAt,
      last_touched_chapter: debt.introducedAt,
      payoff_window: debt.mustCloseBy,
      is_main_mystery: debt.id === 'main_mystery',
      stale: false,
      stale_since_chapter: null,
    })),
    blueprints: validated.chapterTargets.map((target) => ({
      story_id: storyId,
      chapter_number: target.chapterNumber,
      version: 1,
      phase: boundField(target.phase, 1, 120),
      chapter_goal: boundField(target.goal, 1, 500),
      mandatory_beats: [
        ...target.mustInclude,
        target.emotionalTurn,
        ...target.expectedThreadMovement,
      ].map((beat) => boundField(beat, 1, 500)),
      forbidden_reveals: target.mustNotReveal.map((secretId) => scopedId(storyId, secretId)),
      allowed_state_delta: {},
      introduces_characters: target.chapterNumber === 1 ? [mainCharacterId] : [],
      reconciled_from_version: null,
      reconciliation_reason: null,
    })),
  }
  return CanonBootstrapSchema.parse(bootstrap)
}

interface BootstrapRpcError {
  message: string
  code?: string
  details?: string
  hint?: string
}

export class PersonalizedStoryBootstrapError extends Error {
  readonly code?: string
  readonly details?: string
  readonly hint?: string

  constructor(error: BootstrapRpcError) {
    super(`bootstrap personalized story: ${error.message}`, { cause: error })
    this.name = 'PersonalizedStoryBootstrapError'
    this.code = error.code
    this.details = error.details
    this.hint = error.hint
  }
}

export async function persistContractAndCanon(input: {
  ownerUserId: string
  contract: StoryContract
  contractSource: ContractSource
  onboardingJson: TasteProfile
}): Promise<void> {
  const validated = StoryContractSchema.parse(input.contract)
  const ownerUserId = z.string().uuid().parse(input.ownerUserId)
  const canon = contractToCanonBootstrap(validated)
  const { endingCandidates, plotDebts, ...storyContractJson } = validated
  const db = createAdminClient()
  const { error } = await db.rpc('bootstrap_personalized_story_v1', {
    p_story_id: validated.storyId,
    p_owner_user_id: ownerUserId,
    p_contract_source: input.contractSource,
    p_onboarding_json: input.onboardingJson,
    p_story_contract_json: storyContractJson,
    p_route_schema_json: {},
    p_plot_debts_json: plotDebts,
    p_ending_candidates_json: endingCandidates,
    p_characters: canon.characters,
    p_character_aliases: canon.characterAliases,
    p_voice_sheets: canon.voiceSheets,
    p_facts: canon.facts,
    p_knowledge: canon.knowledge,
    p_secrets: canon.secrets,
    p_threads: canon.threads,
    p_blueprints: canon.blueprints,
  })

  if (error) throw new PersonalizedStoryBootstrapError(error)
}
