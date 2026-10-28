import { z } from 'zod'
import { RouteStateSchema, type RouteState } from './route-state'
import {
  StoryContractSchema,
  EndingCandidateSchema,
  type EndingCandidate,
  type StoryContract,
} from './story-contract'

export interface EndingResolution {
  key: string
  name: string
  requiredClosure: string[]
}

export interface ResolveEndingInput {
  routeState: RouteState | unknown
  storyContract: StoryContract
  chapterNumber: number
  lockedEndingKey?: string | null
}

export interface ResolveEndingFromCandidatesInput {
  routeState: RouteState | unknown
  endingLockChapter: number
  endingCandidates: EndingCandidate[]
  chapterNumber: number
  lockedEndingKey?: string | null
}

const ResolveEndingInputSchema = z.object({
  routeState: RouteStateSchema,
  storyContract: StoryContractSchema,
  chapterNumber: z.number().int().min(1).max(50),
  lockedEndingKey: z.string().trim().min(1).max(80).nullable().optional(),
}).strict()

const ResolveEndingFromCandidatesInputSchema = z.object({
  routeState: RouteStateSchema,
  endingLockChapter: z.number().int().min(1).max(50),
  endingCandidates: z.array(EndingCandidateSchema).min(1),
  chapterNumber: z.number().int().min(1).max(50),
  lockedEndingKey: z.string().trim().min(1).max(80).nullable().optional(),
}).strict()

function publicEnding(candidate: EndingCandidate): EndingResolution {
  return {
    key: candidate.key,
    name: candidate.name,
    requiredClosure: [...candidate.requiredClosure],
  }
}

export function resolveEndingFromCandidates(
  input: ResolveEndingFromCandidatesInput,
): EndingResolution {
  const parsed = ResolveEndingFromCandidatesInputSchema.parse(input)
  const { endingLockChapter, endingCandidates, chapterNumber, lockedEndingKey, routeState } = parsed

  if (chapterNumber < endingLockChapter) {
    throw new Error(
      `Ending cannot lock before chapter ${endingLockChapter}.`,
    )
  }

  if (lockedEndingKey != null) {
    const locked = endingCandidates.find(
      (candidate) => candidate.key === lockedEndingKey,
    )
    if (!locked) {
      throw new Error(`Unknown locked ending key: ${lockedEndingKey}`)
    }
    return publicEnding(locked)
  }

  const ranked = endingCandidates
    .map((candidate, index) => ({
      candidate,
      index,
      score: routeState.endingBias[candidate.key] ?? 0,
    }))
    .sort((left, right) => (
      right.score - left.score
      || left.index - right.index
      || left.candidate.key.localeCompare(right.candidate.key)
    ))

  const selected = ranked[0]?.candidate
  if (!selected) {
    throw new Error('Ending candidate list is empty.')
  }

  return publicEnding(selected)
}

export function resolveEnding(input: ResolveEndingInput): EndingResolution {
  const parsed = ResolveEndingInputSchema.parse(input)
  return resolveEndingFromCandidates({
    routeState: parsed.routeState,
    endingLockChapter: parsed.storyContract.closureRunway.endingLockChapter,
    endingCandidates: parsed.storyContract.endingCandidates,
    chapterNumber: parsed.chapterNumber,
    lockedEndingKey: parsed.lockedEndingKey,
  })
}

