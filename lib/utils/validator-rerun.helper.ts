/**
 * Canonical validator rerun for E5 blueprint review.
 *
 * Authority comes from one canon snapshot plus the persisted story generation
 * contract. Missing or malformed authority fails closed.
 */
import { createAdminClient } from '@lakoku/db'
import { loadCanonSnapshot } from '@/lib/narrative/loader'
import {
  checkEndingReachability,
  checkSpineIntegrity,
  isEndingReachable,
  type ActualState,
  type EndingDef,
} from '@/lib/narrative/reconciliation'
import { ENDING_RULES } from '@/lib/narrative/template'
import {
  deriveEndingDef,
  parseStoryContractWithNormalization,
} from '@/lib/story-engine/story-contract'
import type { ValidatorRerunResult } from '@/lib/types/blueprint.contract'

const TOTAL_CHAPTERS = 50
const CONTRACT_SELECT =
  'story_id,story_contract_json,plot_debts_json,ending_candidates_json' as const

interface StoryGenerationContractRow {
  story_id: string
  story_contract_json: Record<string, unknown>
  plot_debts_json: unknown
  ending_candidates_json: unknown
}

function failedResult(
  chapterNumber: number,
  failureType: string,
  message: string,
  validatedChapterVersions: ValidatorRerunResult['validatedChapterVersions'] = [],
): ValidatorRerunResult {
  return {
    passed: false,
    failures: [{ chapterNumber, failureType, message }],
    validatedChapterVersions,
  }
}

function normalizeChapterNumbers(chapterNumbers: number[]):
  | { valid: true; chapters: number[] }
  | { valid: false; result: ValidatorRerunResult } {
  if (chapterNumbers.length === 0) {
    return {
      valid: false,
      result: failedResult(0, 'INVALID_CHAPTER_NUMBERS', 'Chapter numbers cannot be empty'),
    }
  }

  const invalidChapter = chapterNumbers.find(
    (chapter) => !Number.isInteger(chapter) || chapter < 1 || chapter > TOTAL_CHAPTERS,
  )
  if (invalidChapter !== undefined) {
    return {
      valid: false,
      result: failedResult(
        invalidChapter,
        'INVALID_CHAPTER_NUMBERS',
        `Chapter number must be an integer from 1 to ${TOTAL_CHAPTERS}`,
      ),
    }
  }

  const uniqueChapters = [...new Set(chapterNumbers)].sort((a, b) => a - b)
  if (uniqueChapters.length !== chapterNumbers.length) {
    return {
      valid: false,
      result: failedResult(
        uniqueChapters[0] ?? 0,
        'INVALID_CHAPTER_NUMBERS',
        'Duplicate chapter numbers are not allowed',
      ),
    }
  }

  return { valid: true, chapters: uniqueChapters }
}

async function loadEndingDefinitions(storyId: string): Promise<EndingDef[]> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('story_generation_contracts')
    .select(CONTRACT_SELECT)
    .eq('story_id', storyId)
    .maybeSingle()

  if (error) throw new Error(`story_generation_contracts fetch failed: ${error.message}`)
  if (!data) throw new Error(`Story generation contract missing for ${storyId}`)

  const row = data as StoryGenerationContractRow
  const contract = parseStoryContractWithNormalization({
    ...row.story_contract_json,
    storyId: row.story_id,
    plotDebts: row.plot_debts_json,
    endingCandidates: row.ending_candidates_json,
  })
  const endings = contract.endingCandidates.map(deriveEndingDef)
  if (endings.length === 0) throw new Error(`Story generation contract has no endings for ${storyId}`)
  return endings
}

/** Run governed spine/reveal and ending validators against exact canonical authority. */
export async function runValidatorRerun(
  storyId: string,
  chapterNumbers: number[],
): Promise<ValidatorRerunResult> {
  const normalized = normalizeChapterNumbers(chapterNumbers)
  if (!normalized.valid) return normalized.result

  const chapters = normalized.chapters
  const maxChapter = chapters[chapters.length - 1]

  try {
    const [snapshot, endings] = await Promise.all([
      loadCanonSnapshot(storyId, maxChapter),
      loadEndingDefinitions(storyId),
    ])

    if (snapshot.storyId !== storyId) {
      return failedResult(
        chapters[0],
        'CANONICAL_AUTHORITY_INVALID',
        `Canon snapshot story mismatch for ${storyId}`,
      )
    }

    const latestBlueprints = new Map<number, (typeof snapshot.blueprints)[number]>()
    for (const blueprint of snapshot.blueprints) {
      if (!chapters.includes(blueprint.chapterNumber)) continue
      const current = latestBlueprints.get(blueprint.chapterNumber)
      if (!current || blueprint.version > current.version) {
        latestBlueprints.set(blueprint.chapterNumber, blueprint)
      }
    }

    const validatedBlueprints: Array<(typeof snapshot.blueprints)[number]> = []
    for (const chapter of chapters) {
      const blueprint = latestBlueprints.get(chapter)
      if (!blueprint) {
        return failedResult(
          chapter,
          'BLUEPRINT_NOT_FOUND',
          `No canonical blueprint found for ${storyId}:${chapter}`,
        )
      }
      if (!Number.isInteger(blueprint.version) || blueprint.version < 1) {
        return failedResult(
          chapter,
          'CANONICAL_AUTHORITY_INVALID',
          `Canonical blueprint version is invalid for ${storyId}:${chapter}`,
        )
      }
      validatedBlueprints.push(blueprint)
    }

    const validatedChapterVersions = validatedBlueprints.map((blueprint) => ({
      chapter: blueprint.chapterNumber,
      expected_version: blueprint.version,
    }))
    const revealedSecretIds = snapshot.secrets
      .filter((secret) => secret.revealed)
      .map((secret) => secret.id)
    const actualState: ActualState = {
      storyFlags: new Set([...snapshot.facts.map((fact) => fact.id), ...revealedSecretIds]),
      clues: new Set(
        snapshot.knowledge.map((knowledge) => `${knowledge.characterId}:${knowledge.factId}`),
      ),
      threadStatuses: Object.fromEntries(
        snapshot.threads.map((thread) => [thread.id, thread.status]),
      ),
    }

    const failures: ValidatorRerunResult['failures'] = []
    const spineRevealFindings: NonNullable<ValidatorRerunResult['spineRevealFindings']> = []

    for (const blueprint of validatedBlueprints) {
      const findings = checkSpineIntegrity(blueprint, snapshot.secrets)
      if (findings.length > 0) {
        spineRevealFindings.push({
          chapterNumber: blueprint.chapterNumber,
          findings: findings.map((finding) => ({
            findingType: finding.code,
            message: `${finding.severity}: ${finding.message}`,
          })),
        })
        failures.push(
          ...findings.map((finding) => ({
            chapterNumber: blueprint.chapterNumber,
            failureType: finding.code,
            message: `${finding.severity}: ${finding.message}`,
          })),
        )
      }
    }

    const endingFindings = checkEndingReachability(endings, actualState)
    failures.push(
      ...endingFindings.map((finding) => ({
        chapterNumber: maxChapter,
        failureType: finding.code,
        message: `${finding.severity}: ${finding.message}`,
      })),
    )

    const reachableMainCount = endings.filter(
      (ending) => ending.isMain && isEndingReachable(ending, actualState),
    ).length
    const endingResults: NonNullable<ValidatorRerunResult['endingResults']> = {
      mainEndingReachable: reachableMainCount >= ENDING_RULES.minReachableEndings,
      secretEndingsReachable: endings
        .filter((ending) => ending.isSecret && isEndingReachable(ending, actualState))
        .map((ending) => ending.id)
        .sort(),
    }

    return {
      passed: failures.length === 0,
      failures,
      validatedChapterVersions,
      spineRevealFindings,
      endingResults,
    }
  } catch (error) {
    console.error(`Canonical validator rerun failed for ${storyId}:`, error)
    return failedResult(
      chapters[0],
      'CANONICAL_AUTHORITY_UNAVAILABLE',
      error instanceof Error ? error.message : 'Unknown canonical authority error',
    )
  }
}

export async function clearValidatorCaches(): Promise<void> {
  // Validator always loads fresh canonical authority; no cache exists.
}
