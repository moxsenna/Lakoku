import { z } from 'zod'
import { RouteStateSchema, type RouteState } from './route-state'
import {
  StoryContractSchema,
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

const ResolveEndingInputSchema = z.object({
  routeState: RouteStateSchema,
  storyContract: StoryContractSchema,
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

export function resolveEnding(input: ResolveEndingInput): EndingResolution {
  const parsed = ResolveEndingInputSchema.parse(input)
  const { storyContract, chapterNumber, lockedEndingKey, routeState } = parsed

  if (chapterNumber < storyContract.closureRunway.endingLockChapter) {
    throw new Error(
      `Ending cannot lock before chapter ${storyContract.closureRunway.endingLockChapter}.`,
    )
  }

  if (lockedEndingKey != null) {
    const locked = storyContract.endingCandidates.find(
      (candidate) => candidate.key === lockedEndingKey,
    )
    if (!locked) {
      throw new Error(`Unknown locked ending key: ${lockedEndingKey}`)
    }
    return publicEnding(locked)
  }

  const ranked = storyContract.endingCandidates
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
    throw new Error('Story contract has no ending candidates.')
  }

  return publicEnding(selected)
}
