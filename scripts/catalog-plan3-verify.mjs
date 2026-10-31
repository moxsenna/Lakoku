#!/usr/bin/env node
/**
 * Oracle runner untuk GATES.catalog-plan-3.md.
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
  console.error(`[plan3-verify] GAGAL: ${message}`)
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
  const migration = read('neon/migrations/20261028120000_catalog_admin_review.sql')
  assertContains(migration, 'create table if not exists catalog_chapter_reviews', 'migrasi')
  assertContains(migration, 'primary key (story_id, chapter_number, variant_key)', 'migrasi')
  assertContains(migration, "check (status in ('pending', 'approved', 'rewrite_requested'))", 'migrasi')
  assertContains(migration, 'references stories(id) on delete cascade', 'migrasi')
  assertContains(migration, 'catalog_chapter_reviews_status_idx', 'migrasi')

  const dbTypes = read('lib/db/db-types.ts')
  assertContains(dbTypes, 'export interface CatalogChapterReviews', 'db-types')
  assertContains(dbTypes, 'catalog_chapter_reviews: CatalogChapterReviews;', 'db-types')

  const adminServer = read('lib/catalog/admin.server.ts')
  for (const exported of [
    'export async function listCatalogStoriesForAdmin',
    'export async function getCatalogStoryForAdmin',
    'export async function saveChapterReview',
    'export async function updateCatalogChapterContent',
    'export async function publishCatalogStory',
    'export async function archiveCatalogStory',
  ]) {
    assertContains(adminServer, exported, 'admin.server')
  }
  assertContains(adminServer, 'UNITS_NOT_APPROVED', 'admin.server')

  const routeExpectations = [
    ['app/api/admin/catalog/route.ts', 'export async function GET'],
    ['app/api/admin/catalog/[id]/route.ts', 'export async function GET'],
    ['app/api/admin/catalog/[id]/review/route.ts', 'export async function POST'],
    ['app/api/admin/catalog/[id]/chapter/route.ts', 'export async function PATCH'],
    ['app/api/admin/catalog/[id]/publish/route.ts', 'export async function POST'],
    ['app/api/admin/catalog/[id]/archive/route.ts', 'export async function POST'],
  ]
  for (const [file, marker] of routeExpectations) {
    assertContains(read(file), marker, file)
    assertContains(read(file), 'guardCatalogAdmin', file)
  }

  const sidebar = read('components/admin/admin-sidebar.tsx')
  assertContains(sidebar, "href: '/admin/katalog'", 'sidebar')
  assertContains(sidebar, 'BookOpen', 'sidebar')

  const listPage = read('app/admin/katalog/page.tsx')
  assertContains(listPage, '/api/admin/catalog', 'halaman daftar')

  const detailPage = read('app/admin/katalog/[id]/page.tsx')
  for (const marker of [
    '/review',
    '/chapter',
    '/publish',
    '/archive',
    'Setujui',
    'Terbitkan',
    'Tarik',
  ]) {
    assertContains(detailPage, marker, 'halaman detail')
  }

  const resolver = read('lib/credits/access-resolver.server.ts')
  assertContains(
    resolver,
    'isCatalog && catalogStatus !== null && catalogStatus !== \'published\'',
    'access-resolver',
  )
  assertContains(resolver, "reason: 'STORY_PENDING'", 'access-resolver')

  runNode(['scripts/run-smoke.cjs', 'scripts/check-migration-version-uniqueness.ts'])
  console.log('CATALOG_PLAN3_STATIC_OK')
}

function typecheck() {
  runNode(['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false'])
  console.log('CATALOG_PLAN3_TYPECHECK_OK')
}

function lint() {
  const targets = [
    'app/admin/katalog/page.tsx',
    'app/admin/katalog/[id]/page.tsx',
    'app/api/admin/catalog/route.ts',
    'app/api/admin/catalog/[id]/route.ts',
    'app/api/admin/catalog/[id]/review/route.ts',
    'app/api/admin/catalog/[id]/chapter/route.ts',
    'app/api/admin/catalog/[id]/publish/route.ts',
    'app/api/admin/catalog/[id]/archive/route.ts',
    'lib/catalog/admin.server.ts',
    'lib/catalog/admin-http.server.ts',
    'lib/credits/access-resolver.server.ts',
    'components/admin/admin-sidebar.tsx',
    'tests/catalog/catalog-admin.test.ts',
    'tests/catalog/catalog-admin-routes.test.ts',
    'tests/catalog/catalog-access-resolver.test.ts',
    'scripts/catalog-plan3-live-check.ts',
  ]
  runNode(['node_modules/eslint/bin/eslint.js', ...targets])
  console.log('CATALOG_PLAN3_LINT_OK')
}

function unit() {
  runNode([
    'node_modules/vitest/vitest.mjs',
    'run',
    'tests/catalog/catalog-admin.test.ts',
    'tests/catalog/catalog-admin-routes.test.ts',
    'tests/catalog/catalog-access-resolver.test.ts',
    'tests/catalog/catalog-ending-lock.test.ts',
  ])
  console.log('CATALOG_PLAN3_UNIT_OK')
}

function live() {
  const env = {
    DATABASE_URL: LOCAL_DATABASE_URL,
    LAKOKU_SEED_CATALOG: '1',
    LAKOKU_LOCAL_DB_TEST: '1',
  }
  for (const key of ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE']) {
    delete process.env[key]
  }
  runNode(['scripts/run-smoke.cjs', 'scripts/catalog-plan3-live-check.ts'], env)
  console.log('CATALOG_PLAN3_LIVE_OK')
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
    console.error('Usage: node scripts/catalog-plan3-verify.mjs <static|typecheck|lint|unit|live>')
    process.exit(1)
}
