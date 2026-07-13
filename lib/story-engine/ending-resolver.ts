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
  contract: StoryContract
  chapterNumber: number
  lockedEndingKey?: string
}

const ResolveEndingInputSchema = z.object({
  routeState: RouteStateSchema,
  contract: StoryContractSchema,
  chapterNumber: z.number().int().min(1).max(50),
  lockedEndingKey: z.string().trim().min(1).max(80).optional(),
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
  const { contract, chapterNumber, lockedEndingKey, routeState } = parsed

  if (chapterNumber < contract.closureRunway.endingLockChapter) {
    throw new Error(
      `Ending cannot lock before chapter ${contract.closureRunway.endingLockChapter}.`,
    )
  }

  if (lockedEndingKey !== undefined) {
    const locked = contract.endingCandidates.find(
      (candidate) => candidate.key === lockedEndingKey,
    )
    if (!locked) {
      throw new Error(`Unknown locked ending key: ${lockedEndingKey}`)
    }
    return publicEnding(locked)
  }

  const ranked = contract.endingCandidates
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
