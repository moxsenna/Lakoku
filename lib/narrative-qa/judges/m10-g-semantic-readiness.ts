export const M10G_SEMANTIC_ARCHITECTURE_SURFACES = Object.freeze([
  'FROZEN_SEMANTIC_AUTHORITY',
  'TRUSTED_PRODUCTION_EXECUTOR',
  'GLOBAL_CANDIDATE_BUDGET_SEAM',
  'TRUSTED_SOURCE_BYTE_LOADER',
  'INJECTED_DB_ROW_LOADER',
  'PRODUCTION_ISOLATED_DB_LOADER',
  'TRUSTED_CAPTURE_WRITER',
  'DETERMINISTIC_CAPTURE_VALIDATOR',
  'GUARDED_CLI',
] as const)

export const M10G_SEMANTIC_RUN_INPUT_BLOCKERS = Object.freeze([
  'FROZEN_M10G_SOURCE_MANIFEST_NOT_YET_PROVIDED',
  'FROZEN_M10G_SOURCE_CAPTURE_NOT_YET_PROVIDED',
  'M10G_STORY_IDENTITY_NOT_YET_PROVIDED',
  'M10G_GLOBAL_BUDGET_AUTHORITY_NOT_YET_PROVIDED',
  'M10G_EXECUTION_AUTHORIZATION_NOT_YET_PROVIDED',
] as const)

export interface M10GSemanticSurfaceLoaderReadiness {
  ok: true
  code: null
  architectureStatus: 'ARCHITECTURE_READY'
  runInputStatus: 'RUN_INPUTS_NOT_YET_AVAILABLE'
  architectureSurfaces: typeof M10G_SEMANTIC_ARCHITECTURE_SURFACES
  executeTimeBlockers: typeof M10G_SEMANTIC_RUN_INPUT_BLOCKERS
}

/** Pure architecture declaration. Never reads env, paths, network, or DB. */
export function evaluateM10GSemanticSurfaceLoaderReadiness(): M10GSemanticSurfaceLoaderReadiness {
  return {
    ok: true,
    code: null,
    architectureStatus: 'ARCHITECTURE_READY',
    runInputStatus: 'RUN_INPUTS_NOT_YET_AVAILABLE',
    architectureSurfaces: M10G_SEMANTIC_ARCHITECTURE_SURFACES,
    executeTimeBlockers: M10G_SEMANTIC_RUN_INPUT_BLOCKERS,
  }
}
