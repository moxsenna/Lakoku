import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

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
        find: /^@lakoku\/runtime\/server$/,
        replacement: fileURLToPath(new URL('./lib/runtime/server.ts', import.meta.url)),
      },
      {
        find: /^@lakoku\/db$/,
        replacement: fileURLToPath(new URL('./lib/supabase/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'tests/**/*.test.ts'],
    pool: 'forks',
    isolate: true, // Test isolation - each test file runs in separate VM context
  },
})
