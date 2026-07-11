/**
 * Smoke: taste profile schema, normalize, merge, dan Phase 6 revisi.
 *
 * Memverifikasi pure functions terkait Taste Profile tanpa DOM/localStorage.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
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
  adaptStorySetupQuestionsForAnswers,
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

		console.log(`taste-profile-smoke (legacy): ${pass}/${pass + fail} PASS`)

// ═══════════════════════════════════════════════════════════════════
// Phase 6 — Taste Profile Revisi Smoke Tests
// ═══════════════════════════════════════════════════════════════════

console.log('\n── Phase 6C: Dynamic genre-based options ──')

// Replicate buildOptionsFromGenres logic from taste-profile-flow.tsx
const P6_GENRE_TROPE: Record<string, string[]> = {
  'Misteri & rahasia': [
    'Rahasia keluarga yang dikubur lama',
    'Surat lama yang mengubah warisan',
    'Identitas asli yang disembunyikan',
    'Kematian lama yang belum terjawab',
    'Saksi yang tiba-tiba muncul',
    'Kebenaran yang sengaja ditutup keluarga',
  ],
  'Romansa': [
    'Cinta lama yang kembali',
    'Pernikahan kontrak',
    'Sekutu jadi cinta',
    'Cinta yang harus diperjuangkan lagi',
    'Hubungan pura-pura yang jadi nyata',
    'Orang yang salah di waktu yang tepat',
  ],
}
const P6_FALLBACK = [
  'Cinta lama yang kembali', 'Pernikahan kontrak',
  'Rahasia keluarga & warisan', 'Bangkit setelah jatuh',
  'Sekutu jadi cinta', 'Balas dendam yang tertunda',
]

function buildOpts(genres: string[], map: Record<string, string[]>, fb: string[]): string[] {
  if (!genres.length) return fb.slice(0, 6)
  const seen = new Set<string>(); const result: string[] = []
  for (const g of genres) {
    const opts = map[g]; if (!opts) continue
    for (const o of opts) { if (result.length >= 6) break; if (seen.has(o)) continue; seen.add(o); result.push(o) }
    if (result.length >= 6) break
  }
  for (const o of fb) { if (result.length >= 6) break; if (seen.has(o)) continue; seen.add(o); result.push(o) }
  return result
}

{
  const opts = buildOpts(['Misteri & rahasia'], P6_GENRE_TROPE, P6_FALLBACK)
  check('6C: Misteri → has "Rahasia keluarga yang dikubur lama"', opts.includes('Rahasia keluarga yang dikubur lama'))
  check('6C: Misteri → max 6', opts.length <= 6)
}
{
  const opts = buildOpts(['Romansa'], P6_GENRE_TROPE, P6_FALLBACK)
  check('6C: Romansa → has "Cinta lama yang kembali"', opts.includes('Cinta lama yang kembali'))
  check('6C: Romansa → no misteri option', !opts.includes('Rahasia keluarga yang dikubur lama'))
}
{
  const opts = buildOpts(['Misteri & rahasia', 'Romansa'], P6_GENRE_TROPE, P6_FALLBACK)
  check('6C: Multi-genre → max 6', opts.length <= 6)
  check('6C: Multi-genre → no dupes', new Set(opts).size === opts.length)
}
{
  const opts = buildOpts([], P6_GENRE_TROPE, P6_FALLBACK)
  check('6C: No genre → fallback', opts[0] === P6_FALLBACK[0])
}

console.log('\n── Phase 6D: Contextual follow-up ──')

{
  const qs = getStorySetupQuestions(null)
  const adapted = adaptStorySetupQuestionsForAnswers(qs, { trope: 'Rahasia keluarga yang dikubur lama' })
  const sikapQ = adapted.find((q) => q.key === 'sikap')!
  check('6D: Misteri trope → sikap has "Mengamati detail"', sikapQ.options.some((o) => o.includes('Mengamati detail')))
  const hubQ = adapted.find((q) => q.key === 'hubungan')!
  check('6D: Misteri trope → hubungan has "kunci jawaban"', hubQ.options.some((o) => o.includes('kunci jawaban')))
  const akhQ = adapted.find((q) => q.key === 'akhir')!
  check('6D: Misteri trope → akhir has "Kebenaran terbuka"', akhQ.options.some((o) => o.includes('Kebenaran terbuka')))
}
{
  const qs = getStorySetupQuestions(null)
  const adapted = adaptStorySetupQuestionsForAnswers(qs, { trope: 'Bangkit setelah jatuh' })
  const sikapQ = adapted.find((q) => q.key === 'sikap')!
  check('6D: Generic trope → sikap unchanged', sikapQ.options[0] === qs.find((q) => q.key === 'sikap')!.options[0])
}
{
  const qs = getStorySetupQuestions(null)
  const adapted = adaptStorySetupQuestionsForAnswers(qs, {})
  check('6D: No trope answer → same ref', adapted === qs)
}

console.log('\n── Phase 6A/B: File checks ──')

{
  const src = readFileSync(resolve('app/(shell)/beranda/page.tsx'), 'utf-8')
  check('6A: No "Sesuaikan selera ceritamu"', !src.includes('Sesuaikan selera ceritamu'))
  check('6A: No "Atur selera cerita" button', !src.includes('Atur selera cerita'))
  check('6B: Imports TasteProfileFirstRunGate', src.includes('TasteProfileFirstRunGate'))
}
{
  const src = readFileSync(resolve('components/profile-settings.tsx'), 'utf-8')
  check('6A: Profile has "Selera Cerita"', src.includes("'Selera Cerita'"))
  check('6A: Profile links /onboarding/selera?next=/profil', src.includes('/onboarding/selera?next=/profil'))
}

console.log('\n── Phase 6E: Merge fix ──')

{
  const src = readFileSync(resolve('app/onboarding/selera/actions.ts'), 'utf-8')
  check('6E: Param rawGuestProfile', src.includes('rawGuestProfile: unknown'))
  check('6E: No _guestProfile', !src.includes('_guestProfile'))
  check('6E: No readGuestTasteProfile import', !src.includes('readGuestTasteProfile'))
  check('6E: safeParse(rawGuestProfile)', src.includes('TasteProfileSchema.safeParse(rawGuestProfile)'))
}
{
  const src = readFileSync(resolve('app/auth/login/login-form.tsx'), 'utf-8')
  check('6E: Login imports actMergeGuestTasteProfile', src.includes('actMergeGuestTasteProfile'))
  check('6E: Login calls clearGuestTasteProfile', src.includes('clearGuestTasteProfile'))
}

console.log(`\ntaste-profile-smoke: ${pass}/${pass + fail} PASS`)
if (fail) process.exit(1)
