/**
 * Creative direction helpers for authoring stages (cast / mystery / world).
 *
 * Fase 0 stub: documents Bug 4 — direction stops after premise.
 * proposeCast / proposeMystery / proposeWorld do not accept direction yet.
 * Fase later will wire prompt blocks + stage signatures.
 */

export type CreativeDirectionInput = {
  hardBoundaries: string[]
  softAvoidances: string[]
  storySetup: Record<string, string>
}

/**
 * Build prompt block from creative direction.
 * Not implemented yet — authoring stages still ignore direction.
 */
export function buildCreativeDirectionPromptBlock(
  _direction: CreativeDirectionInput,
): string {
  throw new Error('not implemented')
}

export type AuthoringStageWithDirection = 'cast' | 'mystery' | 'world'

/**
 * Whether authoring stage accepts creative direction.
 * CURRENT reality: false for cast/mystery/world (Bug 4).
 * Desired: true for all three so direction propagates past premise.
 */
export function authoringStageAcceptsDirection(
  _stage: AuthoringStageWithDirection,
): boolean {
  return false
}
