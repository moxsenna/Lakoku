/**
 * Smoke: story-setup prompt composer.
 *
 * Memverifikasi buildStorySetupIdea menghasilkan prompt yang valid untuk
 * setiap mode (quick/custom) dan mengikuti aturan prioritas.
 */
import {
  StorySetupInputSchema,
  buildStorySetupIdea,
} from '../lib/onboarding/story-setup'
import { createDefaultTasteProfile } from '../lib/taste-profile/schema'

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

// ── Hard constraints: avoidedTropes masuk prompt ─────────────────

const constrainedProfile = {
  ...profile,
  avoidedTropes: ['kekerasan eksplisit', 'pengkhianatan pasangan'],
  contentBoundaries: ['tidak ada adegan dewasa'],
}

const constrainedResult = buildStorySetupIdea({
  setup: { mode: 'quick', answers: {} },
  tasteProfile: constrainedProfile,
})

check(
  'avoidedTropes masuk prompt sebagai BATAS',
  constrainedResult.includes('BATAS') && constrainedResult.includes('kekerasan eksplisit'),
)

check(
  'contentBoundaries masuk prompt sebagai BATAS',
  constrainedResult.includes('tidak ada adegan dewasa'),
)

check(
  'avoidedTropes menggunakan label JANGAN',
  constrainedResult.includes('JANGAN'),
)

// ── Empty answers tetap menghasilkan prompt valid ─────────────────

const emptyResult = buildStorySetupIdea({
  setup: { mode: 'quick', answers: {} },
})

check('Quick empty answers tetap menghasilkan directive engine', emptyResult.includes('3 premis'))

console.log(`story-setup-prompt-smoke: ${pass}/${pass + fail} PASS`)
if (fail) process.exit(1)
