/**
 * Smoke: taste profile schema, normalize, dan merge.
 *
 * Memverifikasi pure functions terkait Taste Profile tanpa DOM/localStorage.
 */
import {
  TasteProfileSchema,
  createDefaultTasteProfile,
  normalizeTasteProfile,
  mergeTasteProfiles,
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

console.log('taste-profile:')

// ── Schema validation ─────────────────────────────────────────────

const valid = TasteProfileSchema.safeParse({})
check('Schema menerima object kosong (default)', valid.success)

const full = TasteProfileSchema.safeParse({
  version: 1,
  preferredGenres: ['misteri keluarga'],
  likedTropes: ['cinta lama kembali'],
  avoidedTropes: ['kekerasan'],
  dramaIntensity: 'tinggi',
  romanceLevel: 'utama',
  pacing: 'slow-burn',
  languageStyle: 'puitis',
  endingBias: 'kedamaian',
  contentBoundaries: ['tidak ada adegan dewasa'],
})
check('Schema menerima profile lengkap', full.success)

check(
  'Schema menolak dramaIntensity invalid',
  !TasteProfileSchema.safeParse({ dramaIntensity: 'sangat-tinggi' }).success,
)

check(
  'Schema menolak romanceLevel invalid',
  !TasteProfileSchema.safeParse({ romanceLevel: 'maksimal' }).success,
)

check(
  'Schema menolak pacing invalid',
  !TasteProfileSchema.safeParse({ pacing: 'sangat-cepat' }).success,
)

check(
  'Schema menolak version selain 1',
  !TasteProfileSchema.safeParse({ version: 2 }).success,
)

// ── Default profile ───────────────────────────────────────────────

const defaults = createDefaultTasteProfile()
check('Default: version = 1', defaults.version === 1)
check('Default: preferredGenres kosong', defaults.preferredGenres.length === 0)
check('Default: dramaIntensity = sedang', defaults.dramaIntensity === 'sedang')
check('Default: romanceLevel = subtle', defaults.romanceLevel === 'subtle')
check('Default: pacing = seimbang', defaults.pacing === 'seimbang')
check('Default: languageStyle = sinematik', defaults.languageStyle === 'sinematik')
check('Default: endingBias = keadilan', defaults.endingBias === 'keadilan')

// ── normalizeTasteProfile ────────────────────────────────────────

const normalized = normalizeTasteProfile({ version: 1 })
check('normalize menerima profile minimal valid', normalized.version === 1)

const normalizedInvalid = normalizeTasteProfile({ version: 99, dramaIntensity: 'invalid' })
check('normalize fallback ke default jika invalid', normalizedInvalid.dramaIntensity === 'sedang')

const normalizedNull = normalizeTasteProfile(null)
check('normalize null → default', normalizedNull.version === 1)

// ── mergeTasteProfiles ───────────────────────────────────────────

const serverProfile = full.data!
const guestProfile = { ...defaults, preferredGenres: ['fantasi'], likedTropes: ['sekutu jadi cinta'] }

const merge1 = mergeTasteProfiles({ server: serverProfile, guest: guestProfile })
check('Merge: server menang atas guest', merge1.profile.dramaIntensity === 'tinggi')
check('Merge: usedGuest = false jika server ada', !merge1.usedGuest)

const merge2 = mergeTasteProfiles({ server: null, guest: guestProfile })
check('Merge: guest dipakai jika server kosong', merge2.profile.preferredGenres[0] === 'fantasi')
check('Merge: usedGuest = true jika guest dipakai', merge2.usedGuest)

const merge3 = mergeTasteProfiles({ server: null, guest: null })
check('Merge: default jika keduanya null', merge3.profile.version === 1)
check('Merge: usedGuest = false jika keduanya null', !merge3.usedGuest)

// ── updatedAt/completedAt/skippedAt opsional ─────────────────────

const minimal = TasteProfileSchema.safeParse({ version: 1 })
check('Schema toleran: tanpa updatedAt', minimal.success)
	if (minimal.success) {
	  check('Tanpa updatedAt = undefined', minimal.data.updatedAt === undefined)
	  check('Tanpa completedAt = undefined', minimal.data.completedAt === undefined)
	  check('Tanpa skippedAt = undefined', minimal.data.skippedAt === undefined)
	}

	// ── Phase 4: getStorySetupQuestions personalization ──────────────

	function hasOption(options: string[], needle: string): boolean {
	  return options.some((o) => o.toLowerCase().includes(needle.toLowerCase()))
	}
	function indexOfOption(options: string[], needle: string): number {
	  return options.findIndex((o) => o.toLowerCase().includes(needle.toLowerCase()))
	}

	const qsDefault = getStorySetupQuestions(null)
	check('getStorySetupQuestions(null) = default count', qsDefault.length === defaultStorySetupQuestions.length)
	check('getStorySetupQuestions(null) trope intact', qsDefault[0].options.length === defaultStorySetupQuestions[0].options.length)

	const skippedProfile: TasteProfile = {
	  ...createDefaultTasteProfile(),
	  skippedAt: new Date().toISOString(),
	  updatedAt: new Date().toISOString(),
	}
	check('hasUsable: skipped-only = false', !hasUsableTasteProfile(skippedProfile))
	check('Setup: skipped = default', getStorySetupQuestions(skippedProfile)[0].options.length === defaultStorySetupQuestions[0].options.length)

	check('hasUsable: empty default = false', !hasUsableTasteProfile(createDefaultTasteProfile()))

	const genreProfile: TasteProfile = {
	  ...createDefaultTasteProfile(), completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
	  preferredGenres: ['Misteri & rahasia'],
	}
	const tropeQ = getStorySetupQuestions(genreProfile).find((q) => q.key === 'trope')!
	check('genre: inject rahasia option', tropeQ.options.some((o) => o.includes('tersimpan')))
	check('genre: base not deleted', hasOption(tropeQ.options, 'Pasangan yang berkhianat'))

	const avoidProfile: TasteProfile = {
	  ...createDefaultTasteProfile(), completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
	  avoidedTropes: ['Pengkhianatan pasangan'],
	}
	const avoidQ = getStorySetupQuestions(avoidProfile).find((q) => q.key === 'trope')!
	check('avoid: pengkhianatan demoted', indexOfOption(avoidQ.options, 'Berkhianat') > 0)

	const romanceProfile: TasteProfile = {
	  ...createDefaultTasteProfile(), completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
	  romanceLevel: 'utama',
	}
	const hubQ = getStorySetupQuestions(romanceProfile).find((q) => q.key === 'hubungan')!
	check('romance: cinta promoted', indexOfOption(hubQ.options, 'Cinta yang') < indexOfOption(hubQ.options, 'Fokus pada'))

	const endingProfile: TasteProfile = {
	  ...createDefaultTasteProfile(), completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
	  endingBias: 'keadilan',
	}
	const akhirQ = getStorySetupQuestions(endingProfile).find((q) => q.key === 'akhir')!
	check('ending: keadilan at 0', indexOfOption(akhirQ.options, 'Keadilan') === 0)

	console.log(`taste-profile-smoke: ${pass}/${pass + fail} PASS`)
if (fail) process.exit(1)
