import { buildAllPremiumBilikKetujuhKbmV2Drafts as buildAllPremiumBilikKetujuh50Drafts, buildPremiumBilikKetujuhKbmV2Snapshot as buildPremiumBilikKetujuh50Snapshot } from '../fixtures/narrative/premium-bilik-ketujuh-kbm-v2'

const drafts = buildAllPremiumBilikKetujuh50Drafts()
const snapshot = buildPremiumBilikKetujuh50Snapshot()

let errors: string[] = []

if (drafts.length !== 50) errors.push(`Total drafts is not 50, it is ${drafts.length}`)

for (let i = 0; i < drafts.length; i++) {
  const d = drafts[i]
  if (d.chapterNumber !== i + 1) errors.push(`Draft ${i} has wrong chapterNumber: ${d.chapterNumber}`)
  if (d.wordCount < 800 || d.wordCount > 1000) errors.push(`Draft ${d.chapterNumber} has invalid wordCount: ${d.wordCount}`)
}

const reqChoices = [1, 6, 14, 28, 45]
for (const ch of reqChoices) {
  const d = drafts[ch - 1]
  if (d && !d.hasChoiceOrGate) errors.push(`Draft ${ch} should have hasChoiceOrGate = true`)
}

const reqReveals = [6, 10, 16, 21, 24, 32, 44, 45, 50]
const snapshotReveals = snapshot.secrets.map(s => s.revealGateChapter)
for (const ch of reqReveals) {
  if (!snapshotReveals.includes(ch)) errors.push(`Snapshot missing reveal gate at chapter ${ch}`)
}

if (errors.length > 0) {
  console.error('Validation errors:', errors)
  process.exit(1)
} else {
  console.log('All validations passed.')
}
