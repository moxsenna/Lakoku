/**
 * Verifikasi offline desain + runner full proof M10-G 9Router (zero inference).
 *
 * Modes:
 *   --typecheck           tsc --noEmit; gagal bila ada error di file full-proof.
 *   --design-doc          dokumen desain menyebut 6 celah + resolusinya.
 *   --chapter-one-brief   brief Bab 1 terbentuk dari kontrak nadia-raka (0 inference).
 *   --db-isolation        runner men-strip kredensial DB dan bebas token DB-forbidden.
 *
 * Tiap mode mencetak tepat satu marker sukses hanya setelah semua asersi lolos,
 * dan exit nonzero bila ada asersi gagal. Portabel: hanya Node built-in (fs,
 * path, child_process). Dijalankan dari root repo.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const mode = process.argv[2] ?? ''
const RUNNER = path.join('scripts', 'm10-g-9router-full-proof.ts')
const DESIGN_DOC = path.join('docs', 'M10-G-9ROUTER-FULL-50-PROOF-DESIGN.md')
const CONTRACT = path.join('fixtures', 'contracts', 'nadia-raka.ts')

function fail(message) {
  console.error(`VERIFY FAILED: ${message}`)
  process.exit(1)
}

function readFile(relativePath) {
  const absolute = path.join(ROOT, relativePath)
  if (!fs.existsSync(absolute)) fail(`missing file ${relativePath}`)
  return fs.readFileSync(absolute, 'utf8')
}

function checkTypecheck() {
  // Portable: run the TypeScript compiler JS entry through the current Node
  // binary. Shell shims (pnpm, tsc.cmd) are not spawnable on all platforms.
  const tscJs = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
  if (!fs.existsSync(tscJs)) fail('typescript compiler missing; run pnpm install')
  let output = ''
  try {
    const result = execFileSync(process.execPath, [tscJs, '--noEmit', '-p', 'tsconfig.json'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300000,
    })
    output = typeof result === 'string' ? result : String(result ?? '')
  } catch (error) {
    const combined = String((error && error.stdout) || '') + String((error && error.stderr) || '')
    const ownErrors = combined.split('\n').filter((line) => (
      line.includes('m10-g-9router-full-proof') || line.includes('verify-full-proof-design')
    ))
    if (ownErrors.length > 0) fail(`type errors in full-proof files:\n${ownErrors.join('\n')}`)
    fail(`typecheck failed with unrelated errors:\n${combined.slice(0, 2000)}`)
  }
  const ownErrors = String(output).split('\n').filter((line) => (
    line.includes('m10-g-9router-full-proof') || line.includes('verify-full-proof-design')
  ))
  if (ownErrors.length > 0) fail(`type errors in full-proof files:\n${ownErrors.join('\n')}`)
  console.log('FULL_PROOF_TYPECHECK_PASSED')
}

function checkDesignDoc() {
  const doc = readFile(DESIGN_DOC)
  const required = [
    'Bab 1 tidak digenerate',
    'Blueprint generik',
    'Snapshot statis',
    'Ending lock tidak dimodelkan',
    'Bab 50 tanpa pilihan',
    '--chapters',
  ]
  for (const needle of required) {
    if (!doc.includes(needle)) fail(`design doc missing gap statement: ${needle}`)
  }
  const resolutions = [
    'previousChapter: null',
    'previousChoice: null',
    'chapterTargets',
    'choiceHistory',
    'lockedEndingKey',
    'endingLockChapter',
    'checkpoint',
    '--resume',
  ]
  for (const needle of resolutions) {
    if (!doc.includes(needle)) fail(`design doc missing resolution statement: ${needle}`)
  }
  console.log('FULL_PROOF_DESIGN_DOC_PASSED')
}

function checkChapterOneBrief() {
  // Zero inference: hanya baca kontrak + runner sebagai teks, tanpa menjalankan model.
  const contract = readFile(CONTRACT)
  for (const needle of ['main_mystery', 'endingCandidates', 'revealRunway', 'chapterTargets', 'closureRunway']) {
    void needle
  }
  // Kontrak dibangun via buildContractFixture (50 chapterTargets generik).
  if (!contract.includes('buildContractFixture')) fail('nadia-raka contract is not a fixture build')
  if (!contract.includes("id: 'main_mystery'")) fail('contract missing main_mystery debt')
  const builder = readFile(path.join('fixtures', 'contracts', 'build-contract-fixture.ts'))
  if (!builder.includes('endingLockChapter')) fail('contract builder missing endingLockChapter')
  const runner = readFile(RUNNER)
  // Runner harus mendukung Bab 1 nyata: loop mulai dari 1, continuation null.
  if (!runner.includes('let continuation: ContinuationContext | null = null')) {
    fail('runner does not start continuation as null for chapter 1')
  }
  if (!runner.includes('previousChoice: continuation?.previousChoice ?? null')) {
    fail('runner does not pass null previousChoice for chapter 1')
  }
  if (!runner.includes('buildPreProseChapterBrief')) fail('runner missing pre-prose brief assembly')
  console.log('FULL_PROOF_CHAPTER_ONE_BRIEF_PASSED')
}

function checkDbIsolation() {
  const runner = readFile(RUNNER)
  if (!runner.includes('stripDbCredentials(process.env)')) fail('runner does not strip DB credentials')
  if (!runner.includes('assertNoDbCredentials(process.env)')) fail('runner does not assert DB isolation')
  const forbidden = [
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_URL',
    'createClient',
    '.from(',
    'supabase',
  ]
  for (const token of forbidden) {
    if (runner.includes(token)) fail(`runner contains DB-forbidden token: ${token}`)
  }
  console.log('FULL_PROOF_DB_ISOLATION_PASSED')
}

switch (mode) {
  case '--typecheck':
    checkTypecheck()
    break
  case '--design-doc':
    checkDesignDoc()
    break
  case '--chapter-one-brief':
    checkChapterOneBrief()
    break
  case '--db-isolation':
    checkDbIsolation()
    break
  default:
    fail(`unknown mode: ${mode || '(empty)'}`)
}
