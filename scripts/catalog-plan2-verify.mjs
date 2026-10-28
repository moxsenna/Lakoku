#!/usr/bin/env node
/**
 * Oracle runner untuk GATES.catalog-plan-2.md.
 * Setiap subperintah mencetak satu marker sukses hanya setelah semua assertion lulus.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const LOCAL_DATABASE_URL = 'postgresql://postgres:postgres@localhost:55432/lakoku'

function fail(message) {
  console.error(`[plan2-verify] GAGAL: ${message}`)
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
  const providerTypes = read('lib/ai-gateway/provider.ts')
  assertContains(providerTypes, 'export interface CatalogReactionsProviderInput', 'provider types')
  assertContains(providerTypes, 'generateCatalogReactions?', 'provider interface')
  assertContains(providerTypes, 'async generateCatalogReactions(', 'deterministic provider')

  const gatewayProvider = read('lib/ai-gateway/gateway-provider.ts')
  assertContains(gatewayProvider, 'generateCatalogReactionsJson', 'gateway provider')
  assertContains(gatewayProvider, 'buildCatalogReactionsPrompt', 'gateway provider')

  const contract = read('lib/catalog/catalog-contract.ts')
  assertContains(contract, 'export function normalizeCatalogEndings', 'catalog-contract')
  assertContains(contract, 'CATALOG_SPINE_LAST_CHAPTER = 44', 'catalog-contract')

  const engine = read('lib/catalog/generator.server.ts')
  for (const marker of [
    'export function buildCatalogContinuation',
    'export function validateCatalogReactions',
    'export async function generateCatalogNovel',
    'export async function regenerateCatalogSpineChapter',
    'previousChoice: null',
    'ENDING_LOCK_BIAS_DELTA = 10',
  ]) {
    assertContains(engine, marker, 'generator.server')
  }

  const dbWriter = read('lib/catalog/generator-db.server.ts')
  for (const marker of [
    'export async function createCatalogDraft',
    'export function createDbCatalogWriter',
    'createResilientStoryContract',
    'contractToCanonBootstrap',
  ]) {
    assertContains(dbWriter, marker, 'generator-db.server')
  }

  const cli = read('scripts/catalog-generate.ts')
  for (const marker of ['CATALOG_GENERATE_DB_REQUIRED', 'CATALOG_GENERATE_AUTHORIZATION_REQUIRED', '--regenerate']) {
    assertContains(cli, marker, 'catalog-generate.ts')
  }

  const pkg = JSON.parse(read('package.json'))
  if (pkg.scripts['catalog:generate'] !== 'node scripts/run-smoke.cjs scripts/catalog-generate.ts') {
    fail('package.json: script catalog:generate tidak terpasang')
  }

  const detailPage = read('app/admin/katalog/[id]/page.tsx')
  assertContains(detailPage, 'Salin perintah', 'halaman detail admin')
  assertContains(detailPage, 'pnpm catalog:generate --story=', 'halaman detail admin')

  runNode(['scripts/run-smoke.cjs', 'scripts/check-migration-version-uniqueness.ts'])
  console.log('CATALOG_PLAN2_STATIC_OK')
}

function typecheck() {
  runNode(['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false'])
  console.log('CATALOG_PLAN2_TYPECHECK_OK')
}

function lint() {
  const targets = [
    'lib/ai-gateway/provider.ts',
    'lib/ai-gateway/gateway-provider.ts',
    'lib/catalog/catalog-contract.ts',
    'lib/catalog/generator.server.ts',
    'lib/catalog/generator-db.server.ts',
    'scripts/catalog-generate.ts',
    'scripts/catalog-plan2-live-check.ts',
    'tests/catalog/catalog-generator.test.ts',
    'app/admin/katalog/[id]/page.tsx',
  ]
  runNode(['node_modules/eslint/bin/eslint.js', ...targets])
  console.log('CATALOG_PLAN2_LINT_OK')
}

function unit() {
  runNode([
    'node_modules/vitest/vitest.mjs',
    'run',
    'tests/catalog/catalog-generator.test.ts',
  ])
  console.log('CATALOG_PLAN2_UNIT_OK')
}

function live() {
  const env = {
    DATABASE_URL: LOCAL_DATABASE_URL,
    CATALOG_GENERATE_DB: '1',
    LAKOKU_ALLOW_DETERMINISTIC_PROVIDER: '1',
    LAKOKU_LOCAL_DB_TEST: '1',
  }
  for (const key of ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE']) {
    delete process.env[key]
  }
  runNode(['scripts/run-smoke.cjs', 'scripts/catalog-plan2-live-check.ts'], env)
  console.log('CATALOG_PLAN2_LIVE_OK')
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
  case 'live':
    live()
    break
  default:
    console.error('Usage: node scripts/catalog-plan2-verify.mjs <static|typecheck|lint|unit|live>')
    process.exit(1)
}
