import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Frozen M10-E diagnostic suites yang CPU-bound berat (78s–392s per file).
// Mereka aman berjalan paralel satu sama lain (terbukti pada baseline penuh),
// tetapi kalau ikut pool `unit` mereka menghabiskan seluruh worker sehingga
// test murah yang membuka module graph besar lewat `await import(...)` bisa
// melewati default testTimeout 5000ms secara non-deterministik. Dipisah ke
// fase sendiri (groupOrder 0) supaya tidak pernah berbagi pool dengan test
// cepat. Bukan perubahan timeout, bukan skip: semuanya tetap harus PASS.
const HEAVY_PARALLEL_TESTS = [
  'tests/narrative-qa/m10-e-reliability-sensitivity.test.ts',
  'tests/narrative-qa/m10-e-e0-closure.test.ts',
  'tests/narrative-qa/m10-e-reliability-model-determinism.test.ts',
  'tests/narrative-qa/m10-e-reliability-pricing-fallback-provenance.test.ts',
  'tests/narrative-qa/m10-e-reliability-model.test.ts',
  'tests/narrative-qa/m10-e-e1-e2-closure-regression.test.ts',
]

const CONTENTION_SENSITIVE_TESTS = [
  'tests/scripts/choice-replay-harness.test.ts',
  'tests/db/m10-c-r3-2-positive-reconciled.test.ts',
  'tests/db/m10-c-r3-2-negative-reconciled-failure.test.ts',
  'tests/narrative-qa/m10-e2-telemetry-reference.test.ts',
  'tests/narrative-qa/m10-e-e3a-e4-counted-comparison.test.ts',
  'tests/narrative-qa/m10-e-e3a-e4-runner.test.ts',
  'tests/narrative-qa/m10-e-reliability-artifacts.test.ts',
  'tests/narrative-qa/m10-e-reliability-fixture.test.ts',
]

export default defineConfig({
  resolve: {
    alias: [
      // String find = prefix match (perilaku default vite), sama seperti bentuk
      // object lama — `@/lib/...` tetap ter-resolve.
      { find: '@', replacement: fileURLToPath(new URL('.', import.meta.url)) },
      // Hanya barrel yang dibutuhkan harness replay (transitif: ai-gateway →
      // narrative-core) + import type @lakoku/narrative-core pada test lama.
      // Exact-match (^...$) agar tidak membayangi subpath
      // (@lakoku/ai-gateway/server tetap resolve sendiri).
      {
        find: /^@lakoku\/ai-gateway\/server$/,
        replacement: fileURLToPath(new URL('./lib/ai-gateway/server.ts', import.meta.url)),
      },
      {
        find: /^@lakoku\/ai-gateway$/,
        replacement: fileURLToPath(new URL('./lib/ai-gateway/index.ts', import.meta.url)),
      },
      {
        find: /^@lakoku\/narrative-core\/server$/,
        replacement: fileURLToPath(new URL('./lib/narrative/server.ts', import.meta.url)),
      },
      {
        find: /^@lakoku\/narrative-core$/,
        replacement: fileURLToPath(new URL('./lib/narrative/index.ts', import.meta.url)),
      },
      {
        find: /^@lakoku\/runtime$/,
        replacement: fileURLToPath(new URL('./lib/runtime/index.ts', import.meta.url)),
      },
      {
        find: /^@lakoku\/db$/,
        replacement: fileURLToPath(new URL('./lib/supabase/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    environment: 'node',
    projects: [
      {
        extends: true,
        test: {
          name: 'heavy',
          include: HEAVY_PARALLEL_TESTS,
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['lib/**/*.test.ts', 'tests/**/*.test.ts'],
          exclude: [...CONTENTION_SENSITIVE_TESTS, ...HEAVY_PARALLEL_TESTS],
          sequence: { groupOrder: 1 },
        },
      },
      {
        extends: true,
        test: {
          name: 'contention-sensitive',
          include: CONTENTION_SENSITIVE_TESTS,
          fileParallelism: false,
          maxWorkers: 1,
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
})
