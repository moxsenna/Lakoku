'use server'

/**
 * Server action /mulai — resolve taste + auto answers → creative direction → premises.
 */
import { proposePremises, publicAuthoringErrorMessage } from '@/lib/authoring/server'
import type { PremiseDraft } from '@/lib/authoring/schema'
import {
  AUTHORING_AUTH_REQUIRED_ERROR,
  requireAuthoringSessionUser,
} from '@/lib/authoring/action-auth'
import { getTasteProfileForUser } from '@/lib/api/taste-profile'
// getTasteProfileForUser is mocked in unit tests
import {
  normalizeTasteProfile,
  type TasteProfileV2,
} from '@/lib/taste-profile/schema'
import { resolveAutoSelections, type ResolvedStoryAnswers } from '@/lib/onboarding/auto-resolve'
import {
  buildIdeaFromCreativeDirection,
  buildStoryCreativeDirection,
  creativeDirectionFingerprint,
  publicDirectionSummary,
  type StoryCreativeDirection,
} from '@/lib/onboarding/creative-direction'
import type { AutoOrValue } from '@/lib/onboarding/story-questions'
import { z } from 'zod'

type ActionError = { ok: false; error: string }
type ActionResult<T extends object> = ({ ok: true } & T) | ActionError

const AutoOrValueSchema: z.ZodType<AutoOrValue> = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('auto') }),
  z.object({ mode: z.literal('selected'), value: z.string().min(1).max(200) }),
  z.object({ mode: z.literal('custom'), text: z.string().trim().min(1).max(200) }),
])

const AnswerValueSchema = z.union([
  AutoOrValueSchema,
  z.string().min(1).max(200),
])

const SessionOverridesSchema = z
  .object({
    dramaIntensity: z.string().nullish(),
    pacing: z.string().nullish(),
    languageStyle: z.string().nullish(),
    endingBias: z.string().nullish(),
    contentBoundaryIds: z.array(z.string()).optional(),
  })
  .nullish()

const StorySetupV2InputSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('quick'),
    answers: z.record(z.string(), AnswerValueSchema),
    guestTasteProfile: z.unknown().nullish(),
    sessionOverrides: SessionOverridesSchema,
  }),
  z.object({
    mode: z.literal('custom'),
    customIdea: z.string().trim().min(1).max(2000),
    guestTasteProfile: z.unknown().nullish(),
    answers: z.record(z.string(), AnswerValueSchema).optional(),
  }),
])

function coerceAnswerValue(value: AutoOrValue | string): AutoOrValue {
  if (typeof value !== 'string') return value
  if (value === 'Pilihkan untukku' || value === 'Pilihkan yang paling cocok') {
    return { mode: 'auto' }
  }
  // Prefer selected when looks like stable id
  if (/^[a-z][a-z0-9_]*$/.test(value)) {
    return { mode: 'selected', value }
  }
  return { mode: 'custom', text: value }
}

function coerceAnswers(
  answers: Record<string, AutoOrValue | string>,
): Partial<Record<string, AutoOrValue>> {
  const map: Record<string, string> = {
    trope: 'coreConflict',
    sikap: 'agencyStyle',
    hubungan: 'relationshipFocus',
    akhir: 'endingDirection',
  }
  const out: Partial<Record<string, AutoOrValue>> = {}
  for (const [k, v] of Object.entries(answers)) {
    if (v === undefined || v === null || v === '') continue
    out[map[k] ?? k] = coerceAnswerValue(v)
  }
  return out
}

async function loadEffectiveProfile(
  userId: string,
  guestRaw: unknown,
): Promise<TasteProfileV2> {
  const server = await getTasteProfileForUser(userId)
  if (server && (server.completedAt || server.primaryGenreId)) {
    return server
  }
  if (guestRaw) {
    return normalizeTasteProfile(guestRaw)
  }
  return server ?? normalizeTasteProfile({})
}

export async function actProposeStorySetupPremises(
  rawInput: unknown,
): Promise<
  ActionResult<{
    proposals: PremiseDraft[]
    direction?: StoryCreativeDirection
    publicSummary?: string
    fingerprint?: string
  }>
> {
  try {
    const user = await requireAuthoringSessionUser()
    const parsed = StorySetupV2InputSchema.safeParse(rawInput)

    // Backward compat: old schema from story-setup.ts
    if (!parsed.success) {
      const { StorySetupInputSchema, buildStorySetupIdea } = await import(
        '@/lib/onboarding/story-setup'
      )
      const setup = StorySetupInputSchema.parse(rawInput)
      const idea = buildStorySetupIdea({
        setup,
        tasteProfile: setup.guestTasteProfile
          ? normalizeTasteProfile(setup.guestTasteProfile)
          : null,
      })
      const { proposals } = await proposePremises(idea)
      return { ok: true, proposals }
    }

    const input = parsed.data
    const profile = await loadEffectiveProfile(user.id, input.guestTasteProfile)

    let answers: Partial<Record<string, AutoOrValue>> = {}
    let source: StoryCreativeDirection['source'] = 'taste_quick'
    let customIdea: string | null = null

    if (input.mode === 'custom') {
      source = profile.primaryGenreId ? 'taste_custom_idea' : 'no_taste_quick'
      customIdea = input.customIdea
      answers = coerceAnswers(input.answers ?? {})
    } else {
      source = profile.primaryGenreId ? 'taste_quick' : 'no_taste_quick'
      answers = coerceAnswers(input.answers)
    }

    // Apply session overrides onto a working profile copy
    let working = profile
    if (input.mode === 'quick' && input.sessionOverrides) {
      const o = input.sessionOverrides
      working = {
        ...profile,
        dramaIntensity: (o.dramaIntensity as TasteProfileV2['dramaIntensity']) ?? profile.dramaIntensity,
        pacing: (o.pacing as TasteProfileV2['pacing']) ?? profile.pacing,
        languageStyle: (o.languageStyle as TasteProfileV2['languageStyle']) ?? profile.languageStyle,
        endingBias: (o.endingBias as TasteProfileV2['endingBias']) ?? profile.endingBias,
        contentBoundaryIds: o.contentBoundaryIds ?? profile.contentBoundaryIds,
      }
    }

    const resolved: ResolvedStoryAnswers = resolveAutoSelections({
      profile: working,
      answers,
    })

    const direction = buildStoryCreativeDirection({
      profile: working,
      resolved,
      source,
    })

    let idea = buildIdeaFromCreativeDirection(direction)
    if (customIdea) {
      idea =
        `Ide bebas pengguna — ini adalah arahan kreatif utama:\n${customIdea}\n\n` +
        idea
    }

    const { proposals } = await proposePremises(idea)
    const fingerprint = creativeDirectionFingerprint(direction)
    const publicSummary = publicDirectionSummary(direction)

    return {
      ok: true,
      proposals,
      direction,
      publicSummary,
      fingerprint,
    }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.message === AUTHORING_AUTH_REQUIRED_ERROR
          ? AUTHORING_AUTH_REQUIRED_ERROR
          : publicAuthoringErrorMessage(error),
    }
  }
}
