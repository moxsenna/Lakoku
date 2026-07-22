/**
 * Smoke: taste profile V2 schema, normalize, migrate, merge.
 *
 * Pure functions only — no DOM/localStorage.
 */
import {
  TasteProfileSchema,
  TasteProfileV1Schema,
  TasteProfileV2Schema,
  createDefaultTasteProfile,
  createEmptyTasteProfile,
  normalizeTasteProfile,
  migrateTasteProfileToV2,
  mergeTasteProfiles,
  asV1Compat,
  type TasteProfile,
} from '../lib/taste-profile/schema'
import {
  getStorySetupQuestions,
  hasUsableTasteProfile,
  defaultStorySetupQuestions,
} from '../lib/onboarding/question-presets'

let pass = 0
let fail = 0

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++
    console.log('  PASS ', name)
  } else {
    fail++
    console.error('  FAIL ', name, detail ?? '')
  }
}

console.log('taste-profile (V2):')

// ── Schema validation ─────────────────────────────────────────────

const emptyOk = TasteProfileV2Schema.safeParse({ version: 2 })
check('V2 schema accepts empty version:2', emptyOk.success)

const fullV2 = TasteProfileV2Schema.safeParse({
  version: 2,
  primaryGenreId: 'mystery',
  secondaryGenreId: 'romance',
  likedConflictIds: ['mystery_hidden_identity'],
  softAvoidanceIds: ['avoid_unearned_twist'],
  contentBoundaryIds: ['boundary_graphic_violence'],
  dramaIntensity: 'intense',
  pacing: 'slow_deep',
  languageStyle: 'poetic_emotional',
  endingBias: 'peaceful',
})
check('V2 schema accepts full profile', fullV2.success)

check(
  'V2 schema rejects invalid dramaIntensity',
  !TasteProfileV2Schema.safeParse({ version: 2, dramaIntensity: 'sangat-tinggi' }).success,
)

check(
  'V2 schema rejects version 1 as V2',
  !TasteProfileV2Schema.safeParse({ version: 1 }).success,
)

// V1 still parseable for migration
const v1Ok = TasteProfileV1Schema.safeParse({
  preferredGenres: ['Misteri & rahasia'],
  dramaIntensity: 'tinggi',
})
check('V1 schema still parses legacy', v1Ok.success)

// ── Default / empty ───────────────────────────────────────────────

const defaults = createDefaultTasteProfile()
check('Default: version = 2', defaults.version === 2)
check('Default: primaryGenreId null', defaults.primaryGenreId === null)
check('Default: dramaIntensity null (no fake default)', defaults.dramaIntensity === null)
check('Default: languageStyle null', defaults.languageStyle === null)
check('Default: endingBias null', defaults.endingBias === null)
check('Default: pacing null', defaults.pacing === null)
check('createEmpty === createDefault', createEmptyTasteProfile().version === 2)

// ── normalize / migrate ───────────────────────────────────────────

const normalized = normalizeTasteProfile({ version: 1, preferredGenres: ['Romansa'] })
check('normalize V1 → V2', normalized.version === 2)
check('normalize maps genre', normalized.primaryGenreId === 'romance')

const migrated = migrateTasteProfileToV2({
  version: 1,
  preferredGenres: ['Drama keluarga', 'Fantasi & kerajaan'],
  avoidedTropes: ['Kekerasan eksplisit', 'Cinta segitiga'],
  dramaIntensity: 'ringan',
})
check('migrate genres', migrated.primaryGenreId === 'family_drama' && migrated.secondaryGenreId === 'fantasy_kingdom')
check('migrate hard avoid', migrated.contentBoundaryIds.includes('boundary_graphic_violence'))
check('migrate soft avoid', migrated.softAvoidanceIds.includes('avoid_romance_takeover'))
check('migrate intensity', migrated.dramaIntensity === 'warm')

const normalizedInvalid = normalizeTasteProfile({ version: 99, dramaIntensity: 'invalid' })
check('normalize garbage → empty V2', normalizedInvalid.version === 2 && normalizedInvalid.dramaIntensity === null)

const normalizedNull = normalizeTasteProfile(null)
check('normalize null → empty V2', normalizedNull.version === 2)

// ── mergeTasteProfiles ───────────────────────────────────────────

const serverProfile: TasteProfile = {
  ...createEmptyTasteProfile(),
  primaryGenreId: 'mystery',
  dramaIntensity: 'intense',
  completedAt: '2025-01-01T00:00:00.000Z',
}
const guestProfile: TasteProfile = {
  ...createEmptyTasteProfile(),
  primaryGenreId: 'fantasy_kingdom',
  completedAt: '2025-01-02T00:00:00.000Z',
}

const merge1 = mergeTasteProfiles({ server: serverProfile, guest: guestProfile })
check('Merge: server wins', merge1.profile.primaryGenreId === 'mystery' && !merge1.usedGuest)

const merge2 = mergeTasteProfiles({ server: null, guest: guestProfile })
check('Merge: guest used when server empty', merge2.usedGuest && merge2.profile.primaryGenreId === 'fantasy_kingdom')

const merge3 = mergeTasteProfiles({ server: null, guest: null })
check('Merge: empty when both null', merge3.profile.version === 2 && !merge3.usedGuest)

// ── asV1Compat ────────────────────────────────────────────────────

const compat = asV1Compat(serverProfile)
check('asV1Compat version 1', compat.version === 1)
check('asV1Compat genre label', compat.preferredGenres[0] === 'Misteri & rahasia')
check('asV1Compat intensity', compat.dramaIntensity === 'tinggi')

// ── Setup questions ───────────────────────────────────────────────

const qsDefault = getStorySetupQuestions(null)
check(
  'getStorySetupQuestions(null) = default count',
  qsDefault.length === defaultStorySetupQuestions.length,
)

const skippedProfile: TasteProfile = {
  ...createEmptyTasteProfile(),
  skippedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}
check('hasUsable: skipped-only = false', !hasUsableTasteProfile(skippedProfile))
check('hasUsable: empty default = false', !hasUsableTasteProfile(createDefaultTasteProfile()))

const genreProfile: TasteProfile = {
  ...createEmptyTasteProfile(),
  completedAt: new Date().toISOString(),
  primaryGenreId: 'mystery',
}
const tropeQ = getStorySetupQuestions(genreProfile).find((q) => q.key === 'trope')
check('genre profile usable', hasUsableTasteProfile(genreProfile))
check('genre: returns questions', Boolean(tropeQ && tropeQ.options.length > 0))

// Alias export
check('TasteProfileSchema is V2', TasteProfileSchema === TasteProfileV2Schema)

console.log(`taste-profile-smoke: ${pass}/${pass + fail} PASS`)
if (fail > 0) process.exit(1)
