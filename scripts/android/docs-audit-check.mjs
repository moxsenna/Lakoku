#!/usr/bin/env node
/**
 * Oracle audit dokumen (A1–A5): setiap mode mengassert marker teks yang
 * membuktikan klaim kedaluwarsa sudah dikoreksi. Gagal jujur bila marker absen.
 */
import { readFileSync } from 'node:fs'

const mode = process.argv[2]
let failed = false
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok   ${name}`)
  else { failed = true; console.error(`  FAIL ${name} ${detail}`) }
}

if (mode === 'deploy') {
  const rules = readFileSync('AGENT_RULES.md', 'utf8')
  const paycore = readFileSync('docs/PAYCORE_INTEGRATION.md', 'utf8')
  check('AGENT_RULES menunjuk shared VPS aktif', rules.includes('mox-lakoku') && rules.includes('mox-apps/lakoku'))
  check('AGENT_RULES tidak lagi menunjuk /opt/docker sebagai aktif', !rules.includes('container `lakoku-web`'))
  check('PAYCORE menunjuk shared VPS aktif', paycore.includes('mox-lakoku') && paycore.includes('mox-apps/lakoku'))
  console.log(failed ? 'deploy truth verification FAILED' : 'deploy truth verification passed')
} else if (mode === 'implplan') {
  const src = readFileSync('docs/IMPLEMENTATION_PLAN.md', 'utf8')
  check('M6 mencatat Capacitor live', src.includes('Capacitor'))
  check('M6 tidak lagi murni Kotlin-nanti', src.includes('digantikan') || src.includes('diganti'))
  console.log(failed ? 'implplan android verification FAILED' : 'implplan android verification passed')
} else if (mode === 'progress') {
  const src = readFileSync('docs/PROGRESS_CHECKLIST.md', 'utf8')
  check('M6 mencatat realisasi Capacitor', src.includes('Capacitor'))
  check('M6 lama ditandai digantikan', src.toLowerCase().includes('digantikan'))
  console.log(failed ? 'progress android verification FAILED' : 'progress android verification passed')
} else if (mode === 'paycore') {
  const src = readFileSync('docs/PAYCORE_INTEGRATION.md', 'utf8')
  check('kanal android didokumentasikan', src.includes("channel='android'") || src.includes('channel=`android`'))
  check('Play Billing didokumentasikan', src.includes('play_billing') || src.includes('Play Billing'))
  check('migrasi awal tidak lagi "belum ada"', !src.includes('Skema kredit belum ada di Supabase'))
  console.log(failed ? 'paycore channel verification FAILED' : 'paycore channel verification passed')
} else if (mode === 'amendments') {
  const src = readFileSync('AGENT_RULES.md', 'utf8')
  check('peta dokumen mencakup AMENDMENTS v0.7', src.includes('AMENDMENTS_v0.7'))
  console.log(failed ? 'amendments map verification FAILED' : 'amendments map verification passed')
} else {
  console.error(`mode unknown: ${mode}`)
  process.exit(2)
}
if (failed) process.exit(1)
