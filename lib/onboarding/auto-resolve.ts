/**
 * Server-side auto resolution for "Pilihkan yang paling cocok".
 * Deterministic. Never uses universal romance default.
 */
import { CONFLICT_LABEL } from '@/lib/taste-profile/catalog'
import type { TasteProfileV2 } from '@/lib/taste-profile/schema'
import { buildConflictOptionEntries } from '@/lib/taste-profile/onboarding-state'
import type { GenreId } from '@/lib/taste-profile/schema'
import {
  AGENCY_OPTIONS,
  RELATIONSHIP_OPTIONS,
  ROLE_CATALOG_BY_GENRE,
  buildRoleOptions,
} from './role-catalog'
import type { AutoOrValue } from './story-questions'
import { buildCoreConflictFallback } from './auto-resolve-helpers'

export type ResolvedField = {
  id: string | null
  customText: string | null
  resolvedFromAuto: boolean
  label: string | null
}

export type ResolvedStoryAnswers = {
  coreConflict: ResolvedField
  protagonistRole: ResolvedField
  relationshipFocus: ResolvedField
  agencyStyle: ResolvedField
  endingDirection: ResolvedField | null
  genre: ResolvedField | null
}

function selected(id: string, label: string | null): ResolvedField {
  return { id, customText: null, resolvedFromAuto: false, label }
}

function custom(text: string): ResolvedField {
  return { id: null, customText: text, resolvedFromAuto: false, label: text }
}

function auto(id: string, label: string | null): ResolvedField {
  return { id, customText: null, resolvedFromAuto: true, label }
}

function resolveField(
  answer: AutoOrValue | undefined,
  pickAuto: () => { id: string; label: string },
): ResolvedField {
  if (!answer || answer.mode === 'auto') {
    const p = pickAuto()
    return auto(p.id, p.label)
  }
  if (answer.mode === 'custom') {
    const text = answer.text.trim().slice(0, 200)
    return custom(text || pickAuto().label)
  }
  // selected — value may be id or label
  const value = answer.value
  return selected(value, value)
}

export function resolveAutoSelections(args: {
  profile: TasteProfileV2
  answers: Partial<Record<string, AutoOrValue>>
  /** Optional option lists from UI for label lookup */
  optionLabels?: Partial<Record<string, Record<string, string>>>
}): ResolvedStoryAnswers {
  const { profile, answers } = args
  const primary = (profile.primaryGenreId ?? 'mystery') as GenreId
  const secondary = profile.secondaryGenreId as GenreId | null

  const conflictPool = buildConflictOptionEntries(primary, secondary)
  // Prefer liked conflicts first
  const liked = (profile.likedConflictIds ?? [])
    .map((id) => ({ id, label: CONFLICT_LABEL[id] ?? id }))
    .filter((x) => x.label)
  const conflictCandidates = [
    ...liked,
    ...conflictPool.filter((c) => !liked.some((l) => l.id === c.id)),
  ]
  if (conflictCandidates.length === 0) {
    conflictCandidates.push(...buildCoreConflictFallback())
  }

  const rolePool = buildRoleOptions(primary, secondary)
  const roleCandidates =
    rolePool.length > 0
      ? rolePool
      : (ROLE_CATALOG_BY_GENRE.mystery as { id: string; label: string }[])

  // Relationship: prefer non-romance when primary not romance
  const relPool = [...RELATIONSHIP_OPTIONS]
  if (primary !== 'romance') {
    relPool.sort((a, b) => {
      const aRom = a.id === 'relationship_slow_romance' ? 1 : 0
      const bRom = b.id === 'relationship_slow_romance' ? 1 : 0
      return aRom - bRom
    })
  }

  // Agency: map intensity lightly
  const agencyPool = [...AGENCY_OPTIONS]
  if (profile.dramaIntensity === 'intense') {
    agencyPool.sort((a, b) => (a.id === 'agency_direct' ? -1 : b.id === 'agency_direct' ? 1 : 0))
  } else if (profile.dramaIntensity === 'warm') {
    agencyPool.sort((a, b) => (a.id === 'agency_observe' ? -1 : b.id === 'agency_observe' ? 1 : 0))
  }

  const coreConflict = resolveField(answers.coreConflict, () => conflictCandidates[0])
  // Enrich label if id known
  if (coreConflict.id && CONFLICT_LABEL[coreConflict.id]) {
    coreConflict.label = CONFLICT_LABEL[coreConflict.id]
  }

  const protagonistRole = resolveField(answers.protagonistRole, () => roleCandidates[0])
  if (protagonistRole.id) {
    const found = roleCandidates.find((r) => r.id === protagonistRole.id)
    if (found) protagonistRole.label = found.label
  }

  const relationshipFocus = resolveField(answers.relationshipFocus, () => relPool[0])
  if (relationshipFocus.id) {
    const found = relPool.find((r) => r.id === relationshipFocus.id)
    if (found) relationshipFocus.label = found.label
  }

  const agencyStyle = resolveField(answers.agencyStyle, () => agencyPool[0])
  if (agencyStyle.id) {
    const found = agencyPool.find((r) => r.id === agencyStyle.id)
    if (found) agencyStyle.label = found.label
  }

  let endingDirection: ResolvedField | null = null
  if (answers.endingDirection || !profile.endingBias) {
    const endingMap: Record<string, string> = {
      peaceful: 'Lega & damai',
      justice: 'Keadilan',
      victory: 'Kemenangan',
      bittersweet: 'Pahit, tetapi bermakna',
    }
    const defaultEnding = profile.endingBias ?? 'justice'
    endingDirection = resolveField(answers.endingDirection, () => ({
      id: defaultEnding,
      label: endingMap[defaultEnding] ?? defaultEnding,
    }))
  }

  let genre: ResolvedField | null = null
  if (answers.genre || !profile.primaryGenreId) {
    genre = resolveField(answers.genre, () => ({
      id: primary,
      label: primary,
    }))
  }

  return {
    coreConflict,
    protagonistRole,
    relationshipFocus,
    agencyStyle,
    endingDirection,
    genre,
  }
}

/** Guard: never return the old universal romance default as auto conflict. */
export function isForbiddenUniversalDefault(label: string | null | undefined): boolean {
  if (!label) return false
  const n = label.toLowerCase()
  return n.includes('pasangan yang berkhianat')
}
