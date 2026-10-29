#!/usr/bin/env node
/**
 * Oracle runner untuk GATES.kbm-prose-optimization.md.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

function fail(message) {
  console.error(`[kbm-prose-verify] GAGAL: ${message}`)
  process.exit(1)
}

function read(relativePath) {
  const absolute = path.join(root, relativePath)
  if (!existsSync(absolute)) fail(`file tidak ada: ${relativePath}`)
  return readFileSync(absolute, 'utf8')
}

function assertContains(source, needle, label) {
  if (!source.includes(needle)) fail(`${label}: tidak menemukan ${JSON.stringify(needle)}`)
}

function assertNotContains(source, needle, label) {
  if (source.includes(needle)) fail(`${label}: TIDAK BOLEH memuat ${JSON.stringify(needle)}`)
}

function runNode(args, env = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
  if (result.error) fail(`gagal menjalankan node ${args.join(' ')}: ${result.error.message}`)
  if (result.status !== 0) fail(`node ${args.join(' ')} keluar dengan status ${result.status}`)
}

function staticCheck() {
  const genreFlavor = read('lib/prose/genre-flavor.ts')
  assertContains(genreFlavor, 'hookGuidance:', 'genre-flavor')
  assertContains(genreFlavor, 'Hook Pembuka Detik-0 (In Medias Res)', 'genre-flavor')
  for (const genre of [
    'family_drama',
    'romance',
    'mystery',
    'fantasy_kingdom',
    'slice_of_life',
    'survival_thriller',
  ]) {
    assertContains(genreFlavor, `id: '${genre}'`, `genre-flavor ${genre}`)
  }

  const promptEngine = read('lib/prose/prompt-engine/build-writer-prompt.ts')
  assertNotContains(promptEngine, 'perlambat tempo agar cerita tidak selesai', 'build-writer-prompt')
  assertNotContains(promptEngine, 'pembukaan situasi, detail sensorik lingkungan', 'build-writer-prompt')
  assertContains(promptEngine, 'In Medias Res', 'build-writer-prompt')
  assertContains(promptEngine, 'kbm_viral_v1', 'build-writer-prompt')

  const mobileStyle = read('lib/prose/mobile-drama-style.ts')
  assertContains(mobileStyle, 'kbm_viral_v1', 'mobile-drama-style')

  const contract = read('lib/story-engine/story-contract.ts')
  assertContains(contract, 'kbm_viral_v1', 'story-contract')

  console.log('KBM_PROSE_STATIC_OK')
}

function typecheck() {
  runNode(['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false'])
  console.log('KBM_PROSE_TYPECHECK_OK')
}

function lint() {
  const targets = [
    'lib/prose/genre-flavor.ts',
    'lib/prose/mobile-drama-style.ts',
    'lib/prose/prompt-engine/build-writer-prompt.ts',
    'lib/prose/prompt-engine/types.ts',
    'lib/story-engine/story-contract.ts',
    'lib/catalog/generator.server.ts',
    'tests/prose/kbm-prose-optimization.test.ts',
  ]
  runNode(['node_modules/eslint/bin/eslint.js', ...targets])
  console.log('KBM_PROSE_LINT_OK')
}

function unit() {
  runNode([
    'node_modules/vitest/vitest.mjs',
    'run',
    'tests/prose/kbm-prose-optimization.test.ts',
  ])
  console.log('KBM_PROSE_UNIT_OK')
}

function integration() {
  runNode([
    'node_modules/vitest/vitest.mjs',
    'run',
    'tests/catalog/catalog-generator.test.ts',
  ])
  console.log('KBM_PROSE_INTEGRATION_OK')
}

const command = process.argv[2]
switch (command) {
  case 'static':
    staticCheck()
    break
  case 'typecheck':
    typecheck()
    break
  case 'lint':
    lint()
    break
  case 'unit':
    unit()
    break
  case 'integration':
    integration()
    break
  default:
    console.error('Usage: node scripts/kbm-prose-verify.mjs <static|typecheck|lint|unit|integration>')
    process.exit(1)
}
