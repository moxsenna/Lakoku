'use server'

/**
 * Server action khusus /mulai — jembatan onboarding cepat ↔ engine authoring.
 *
 * Tidak mengubah signature actProposePremises (yang dipakai /brainstorm).
 * Action ini membaca StorySetupInput (quick/custom), menyusun idea lewat
 * buildStorySetupIdea, lalu meneruskan ke proposePremises dari engine.
 *
 * ActionResult didefinisikan lokal agar tidak coupling dengan /brainstorm/actions.
 */
import { proposePremises, publicAuthoringErrorMessage } from '@/lib/authoring/server'
import {
  StorySetupInputSchema,
  buildStorySetupIdea,
} from '@/lib/onboarding/story-setup'
import type { PremiseDraft } from '@/lib/authoring/schema'
import {
  AUTHORING_AUTH_REQUIRED_ERROR,
  requireAuthoringSessionUser,
} from '@/lib/authoring/action-auth'

// ─── Result type (lokal, tidak import dari /brainstorm/actions) ───

type ActionError = { ok: false; error: string }
type ActionResult<T extends object> = ({ ok: true } & T) | ActionError

// ─── Server action ────────────────────────────────────────────────

export async function actProposeStorySetupPremises(
  rawInput: unknown,
): Promise<ActionResult<{ proposals: PremiseDraft[] }>> {
  try {
    await requireAuthoringSessionUser()
    const setup = StorySetupInputSchema.parse(rawInput)

    const idea = buildStorySetupIdea({
      setup,
      tasteProfile: setup.guestTasteProfile ?? null,
    })

    const { proposals } = await proposePremises(idea)

    return { ok: true, proposals }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error && error.message === AUTHORING_AUTH_REQUIRED_ERROR
        ? AUTHORING_AUTH_REQUIRED_ERROR
        : publicAuthoringErrorMessage(error),
    }
  }
}
