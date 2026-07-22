/**
 * Adaptive story-specific questions for /mulai — plan §8.
 * Does NOT repeat global taste quiz when profile is complete.
 */
import {
  CONFLICT_LABEL,
  ENDING_BIAS_LABEL,
  GENRE_CATALOG,
  GENRE_LABEL,
} from '@/lib/taste-profile/catalog'
import { buildConflictOptionEntries } from '@/lib/taste-profile/onboarding-state'
import type { GenreId, TasteProfileV2 } from '@/lib/taste-profile/schema'
import { hasUsableTasteProfile } from '@/lib/taste-profile/resolver'
import {
  AGENCY_OPTIONS,
  RELATIONSHIP_OPTIONS,
  buildRoleOptions,
} from './role-catalog'

export type AutoOrValue =
  | { mode: 'auto' }
  | { mode: 'selected'; value: string }
  | { mode: 'custom'; text: string }

export type StorySpecificQuestionKey =
  | 'genre'
  | 'coreConflict'
  | 'protagonistRole'
  | 'relationshipFocus'
  | 'agencyStyle'
  | 'endingDirection'

export type StorySpecificQuestion = {
  key: StorySpecificQuestionKey
  prompt: string
  helper?: string
  options: { id: string; label: string }[]
  allowAuto: boolean
  allowCustom: boolean
  autoLabel: string
  customLabel: string
}

export type SessionTasteOverrides = {
  dramaIntensity?: TasteProfileV2['dramaIntensity']
  pacing?: TasteProfileV2['pacing']
  languageStyle?: TasteProfileV2['languageStyle']
  endingBias?: TasteProfileV2['endingBias']
  contentBoundaryIds?: string[]
}

export function applySessionOverrides(
  profile: TasteProfileV2 | null,
  overrides?: SessionTasteOverrides | null,
): TasteProfileV2 | null {
  if (!profile) return null
  if (!overrides) return profile
  return {
    ...profile,
    dramaIntensity: overrides.dramaIntensity ?? profile.dramaIntensity,
    pacing: overrides.pacing ?? profile.pacing,
    languageStyle: overrides.languageStyle ?? profile.languageStyle,
    endingBias: overrides.endingBias ?? profile.endingBias,
    contentBoundaryIds: overrides.contentBoundaryIds ?? profile.contentBoundaryIds,
  }
}

/**
 * Build adaptive questions. Complete profile → 4 core questions.
 */
export function buildStorySpecificQuestions(args: {
  tasteProfile: TasteProfileV2 | null
  sessionOverrides?: SessionTasteOverrides | null
}): StorySpecificQuestion[] {
  const profile = applySessionOverrides(args.tasteProfile, args.sessionOverrides)
  const questions: StorySpecificQuestion[] = []

  const primary = profile?.primaryGenreId ?? null
  const secondary = profile?.secondaryGenreId ?? null
  const hasGenre = Boolean(primary)

  // 1. genre — only if missing
  if (!hasGenre) {
    questions.push({
      key: 'genre',
      prompt: 'Jenis cerita apa yang ingin kamu jalani kali ini?',
      helper: 'Pilih satu sebagai arah utama cerita ini.',
      options: GENRE_CATALOG.map((g) => ({ id: g.id, label: g.label })),
      allowAuto: false,
      allowCustom: false,
      autoLabel: 'Pilihkan yang paling cocok',
      customLabel: 'Tulis sendiri',
    })
  }

  // 2. coreConflict — always
  questions.push({
    key: 'coreConflict',
    prompt: 'Masalah apa yang ingin menjadi pusat cerita kali ini?',
    helper: 'Pilih satu. Kami akan mengembangkan tokoh, rahasia, dan dunianya dari sini.',
    options: buildCoreConflictOptions(profile),
    allowAuto: true,
    allowCustom: true,
    autoLabel: 'Pilihkan yang paling cocok',
    customLabel: 'Tulis sendiri',
  })

  // 3. protagonistRole — always
  questions.push({
    key: 'protagonistRole',
    prompt: 'Kamu ingin menjadi tokoh seperti apa?',
    helper: 'Peran ini menentukan posisi dan taruhanmu di dalam cerita.',
    options: buildRoleOptions(primary as GenreId | null, secondary as GenreId | null).map((r) => ({
      id: r.id,
      label: r.label,
    })),
    allowAuto: true,
    allowCustom: true,
    autoLabel: 'Pilihkan yang paling cocok',
    customLabel: 'Tulis sendiri',
  })

  // 4. relationshipFocus — always
  questions.push({
    key: 'relationshipFocus',
    prompt: 'Hubungan apa yang paling penting dalam perjalananmu?',
    helper: 'Ini menentukan ikatan emosional utama, bukan selalu romansa.',
    options: RELATIONSHIP_OPTIONS.map((r) => ({ id: r.id, label: r.label })),
    allowAuto: true,
    allowCustom: false,
    autoLabel: 'Pilihkan yang paling cocok',
    customLabel: 'Tulis sendiri',
  })

  // 5. agencyStyle — always
  questions.push({
    key: 'agencyStyle',
    prompt: 'Bagaimana kamu ingin menghadapi masalah dalam cerita ini?',
    helper:
      'Ini membantu Lakoku menyiapkan pilihan rute yang terasa cocok, tanpa membatasi keputusanmu nanti.',
    options: AGENCY_OPTIONS.map((r) => ({ id: r.id, label: r.label })),
    allowAuto: true,
    allowCustom: false,
    autoLabel: 'Pilihkan yang paling cocok',
    customLabel: 'Tulis sendiri',
  })

  // 6. ending — only if profile lacks endingBias
  if (!profile?.endingBias) {
    questions.push({
      key: 'endingDirection',
      prompt: 'Arah akhir mana yang paling ingin kamu kejar?',
      helper: 'Ini bukan jaminan. Pilihanmu selama membaca tetap menentukan hasilnya.',
      options: (['peaceful', 'justice', 'victory', 'bittersweet'] as const).map((id) => ({
        id,
        label: ENDING_BIAS_LABEL[id] ?? id,
      })),
      allowAuto: false,
      allowCustom: false,
      autoLabel: 'Pilihkan yang paling cocok',
      customLabel: 'Tulis sendiri',
    })
  }

  return questions
}

function buildCoreConflictOptions(profile: TasteProfileV2 | null): { id: string; label: string }[] {
  const seen = new Set<string>()
  const result: { id: string; label: string }[] = []

  // Up to 3 from likedConflictIds
  for (const id of profile?.likedConflictIds ?? []) {
    if (result.length >= 3) break
    if (seen.has(id)) continue
    const label = CONFLICT_LABEL[id]
    if (!label) continue
    seen.add(id)
    result.push({ id, label })
  }

  // Fill up to 5 from primary/secondary catalog
  const extras = buildConflictOptionEntries(
    (profile?.primaryGenreId as GenreId) ?? null,
    (profile?.secondaryGenreId as GenreId) ?? null,
  )
  for (const e of extras) {
    if (result.length >= 5) break
    if (seen.has(e.id)) continue
    seen.add(e.id)
    result.push(e)
  }

  // Absolute fallback if empty
  if (result.length === 0) {
    for (const e of buildConflictOptionEntries('mystery', 'fantasy_kingdom')) {
      if (result.length >= 5) break
      result.push(e)
    }
  }

  return result
}

export function countAdaptiveQuestions(profile: TasteProfileV2 | null): number {
  return buildStorySpecificQuestions({ tasteProfile: profile }).length
}

export function profileSummaryForMulai(profile: TasteProfileV2 | null): string {
  if (!profile || !hasUsableTasteProfile(profile)) return 'Belum ada selera tersimpan.'
  const parts: string[] = []
  if (profile.primaryGenreId) {
    const g = GENRE_LABEL[profile.primaryGenreId] ?? profile.primaryGenreId
    const short =
      profile.primaryGenreId === 'mystery'
        ? 'Misteri'
        : profile.primaryGenreId === 'fantasy_kingdom'
          ? 'Fantasi'
          : g
    if (profile.secondaryGenreId) {
      const s =
        profile.secondaryGenreId === 'mystery'
          ? 'Misteri'
          : profile.secondaryGenreId === 'fantasy_kingdom'
            ? 'Fantasi'
            : GENRE_LABEL[profile.secondaryGenreId] ?? profile.secondaryGenreId
      parts.push(`${short} + ${s}`)
    } else {
      parts.push(short)
    }
  }
  if (profile.dramaIntensity === 'intense') parts.push('Intens')
  else if (profile.dramaIntensity === 'warm') parts.push('Hangat')
  else if (profile.dramaIntensity === 'balanced') parts.push('Seimbang')

  if (profile.languageStyle === 'cinematic_visual') parts.push('Sinematik')
  else if (profile.languageStyle === 'poetic_emotional') parts.push('Puitis')
  else if (profile.languageStyle === 'clear_concise') parts.push('Jernih')

  if (profile.endingBias === 'peaceful') parts.push('Akhir damai')
  else if (profile.endingBias === 'justice') parts.push('Akhir keadilan')
  else if (profile.endingBias === 'victory') parts.push('Akhir kemenangan')
  else if (profile.endingBias === 'bittersweet') parts.push('Akhir pahit bermakna')

  return parts.length ? parts.join(' · ') : 'Selera tersimpan'
}
