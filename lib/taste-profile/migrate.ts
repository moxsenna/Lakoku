/**
 * V1 → V2 migration — re-export + thin pure entry.
 *
 * Implementation lives in schema.ts (shared types). Import from here
 * when you only need migrateTasteProfileToV2.
 */
export { migrateTasteProfileToV2, normalizeTasteProfile } from './schema'
export type { TasteProfileV2, TasteProfileV1 } from './schema'
