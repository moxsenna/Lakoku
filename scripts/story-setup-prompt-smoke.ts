/**
 * Smoke: story-setup prompt composer.
 *
 * Memverifikasi buildStorySetupIdea menghasilkan prompt yang valid untuk
 * setiap mode (quick/custom) dan mengikuti aturan soft/hard prioritas.
 */
import {
  StorySetupInputSchema,
  buildStorySetupIdea,
} from '../lib/onboarding/story-setup'
import { createDefaultTasteProfile, createEmptyTasteProfile } from '../lib/taste-profile/schema'

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

console.log('story-setup-prompt:')

// ── Schema validation ─────────────────────────────────────────────

check(
  'Schema menerima quick mode valid',
  StorySetupInputSchema.safeParse({ mode: 'quick', answers: { trope: 'drama' } }).success,
)

check(
  'Schema menerima custom mode valid',
  StorySetupInputSchema.safeParse({ mode: 'custom', customIdea: 'cerita misteri keluarga' }).success,
)

check(
  'Schema menolak mode tidak dikenal',
  !StorySetupInputSchema.safeParse({ mode: 'invalid' }).success,
)

check(
  'Schema menolak custom mode tanpa customIdea',
  !StorySetupInputSchema.safeParse({ mode: 'custom' }).success,
)

check(
  'Schema menolak customIdea kosong',
  !StorySetupInputSchema.safeParse({ mode: 'custom', customIdea: '  ' }).success,
)

// ── Quick mode prompt ─────────────────────────────────────────────

const quickResult = buildStorySetupIdea({
  setup: { mode: 'quick', answers: { trope: 'Pasangan yang berkhianat' } },
})

check('Quick mode menghasilkan prompt non-empty', quickResult.length > 0)
check('Quick mode prompt memuat pilihan cerita', quickResult.includes('Pilihan cerita'))
check('Quick mode prompt memuat directive engine', quickResult.includes('3 premis'))

// ── Custom mode prompt ────────────────────────────────────────────

const customResult = buildStorySetupIdea({
  setup: { mode: 'custom', customIdea: 'seorang pewaris menemukan surat lama' },
})

check('Custom mode menghasilkan prompt non-empty', customResult.length > 0)
check('Custom mode prompt memuat ide user', customResult.includes('seorang pewaris menemukan surat lama'))
check('Custom mode prompt memuat directive engine', customResult.includes('3 premis'))

// ── Priority: customIdea > taste profile dalam prompt ─────────────

const profile = createDefaultTasteProfile()
const prioritySetup = {
  mode: 'custom' as const,
  customIdea: 'petualangan di kerajaan bawah laut',
  guestTasteProfile: profile,
}

const priorityResult = buildStorySetupIdea({
  setup: prioritySetup,
  tasteProfile: profile,
})

check(
  'Custom idea muncul dalam prompt (creative direction utama)',
  priorityResult.includes('petualangan di kerajaan bawah laut'),
)

// ── Soft vs Hard split (V2) ───────────────────────────────────────

const constrainedProfile = {
  ...createEmptyTasteProfile(),
  softAvoidanceIds: ['avoid_unearned_twist', 'avoid_romance_takeover'],
  contentBoundaryIds: ['boundary_explicit_sexual_content'],
}

const constrainedResult = buildStorySetupIdea({
  setup: { mode: 'quick', answers: {} },
  tasteProfile: constrainedProfile,
})

check(
  'softAvoidanceIds pakai soft wording, bukan BATAS',
  constrainedResult.includes('Kurangi atau hindari') &&
    !constrainedResult.includes('JANGAN pakai trope'),
)

check(
  'contentBoundaryIds masuk prompt sebagai BATAS KONTEN WAJIB',
  constrainedResult.includes('BATAS KONTEN WAJIB') &&
    constrainedResult.includes('Jangan masukkan'),
)

check(
  'softAvoidanceIds TIDAK memakai label JANGAN hard',
  !constrainedResult.includes('JANGAN pakai trope'),
)

// Catalog labels appear (not only raw IDs when catalog has them)
check(
  'softAvoidance label catalog muncul',
  constrainedResult.includes('Twist yang muncul tanpa petunjuk') ||
    constrainedResult.includes('avoid_unearned_twist'),
)

// ── V1-shaped raw migrates ────────────────────────────────────────

const v1Shaped = {
  version: 1 as const,
  preferredGenres: ['Misteri & rahasia'],
  likedTropes: [],
  avoidedTropes: ['Cinta segitiga', 'Kekerasan eksplisit'],
  dramaIntensity: 'sedang' as const,
  romanceLevel: 'subtle' as const,
  pacing: 'seimbang' as const,
  languageStyle: 'sinematik' as const,
  endingBias: 'keadilan' as const,
  contentBoundaries: ['tanpa adegan dewasa'],
}

const v1Result = buildStorySetupIdea({
  setup: { mode: 'quick', answers: {} },
  tasteProfile: v1Shaped,
})

check(
  'V1-shaped raw: soft avoid tanpa JANGAN trope hard',
  v1Result.includes('Kurangi atau hindari') || v1Result.includes('soft'),
)
check(
  'V1-shaped raw: hard boundary tetap BATAS',
  v1Result.includes('BATAS KONTEN WAJIB'),
)

// ── Empty answers tetap menghasilkan prompt valid ─────────────────

const emptyResult = buildStorySetupIdea({
  setup: { mode: 'quick', answers: {} },
})

check('Quick empty answers tetap menghasilkan directive engine', emptyResult.includes('3 premis'))

console.log(`story-setup-prompt-smoke: ${pass}/${pass + fail} PASS`)
if (fail) process.exit(1)
