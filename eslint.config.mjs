import next from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

/**
 * Pesan boundary yang dipakai ulang (ARCH §5.1 package ownership rules).
 */
const boundary = (msg) => `Boundary paket (ARCH §5.1): ${msg}`

const eslintConfig = [
  ...next,
  ...nextTs,
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
  {
    // Hormati konvensi prefix underscore untuk variabel/argumen yang sengaja diabaikan
    // (mis. destructure-omit pada seam data `lib/api`).
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  // ---- Batas kepemilikan paket logis @lakoku/* (ARCH §5.1) ----
  // Impor DALAM paket tetap relatif (./ atau ../file); impor LINTAS paket wajib
  // lewat alias barrel @lakoku/*. Aturan di bawah menegakkan ARAH dependensi.

  // narrative-core: TIDAK boleh mengimpor ai-gateway, runtime, api, atau objek
  // HTTP request. Boleh: @lakoku/db (loader canon).
  {
    files: ['lib/narrative/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@lakoku/ai-gateway',
                '@lakoku/runtime',
                '@lakoku/api',
                '@/lib/ai-gateway',
                '@/lib/ai-gateway/*',
                '@/lib/runtime',
                '@/lib/runtime/*',
                '@/lib/api',
                '@/lib/api/*',
                '../ai-gateway/*',
                '../runtime/*',
                '../api/*',
              ],
              message: boundary(
                'narrative-core hanya boleh bergantung pada @lakoku/db (dan dirinya sendiri).',
              ),
            },
          ],
        },
      ],
    },
  },

  // ai-gateway: hanya boleh merujuk @lakoku/narrative-core. TIDAK boleh runtime,
  // api, atau db.
  {
    files: ['lib/ai-gateway/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@lakoku/runtime',
                '@lakoku/api',
                '@lakoku/db',
                '@/lib/runtime',
                '@/lib/runtime/*',
                '@/lib/api',
                '@/lib/api/*',
                '@/lib/supabase',
                '@/lib/supabase/*',
                '../runtime/*',
                '../api/*',
                '../supabase/*',
                // paksa barrel untuk narrative-core (bukan deep-import)
                '@/lib/narrative',
                '@/lib/narrative/*',
                '../narrative/*',
              ],
              message: boundary(
                'ai-gateway hanya boleh mengimpor @lakoku/narrative-core lewat barrel.',
              ),
            },
          ],
        },
      ],
    },
  },

  // db (lib/supabase): paket daun. TIDAK boleh mengimpor paket domain lain.
  {
    files: ['lib/supabase/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@lakoku/narrative-core',
                '@lakoku/ai-gateway',
                '@lakoku/runtime',
                '@lakoku/api',
                '@/lib/narrative',
                '@/lib/narrative/*',
                '@/lib/ai-gateway',
                '@/lib/ai-gateway/*',
                '@/lib/runtime',
                '@/lib/runtime/*',
                '@/lib/api',
                '@/lib/api/*',
              ],
              message: boundary('db adalah paket daun; tidak boleh bergantung pada paket domain.'),
            },
          ],
        },
      ],
    },
  },

  // runtime: boleh narrative-core, ai-gateway, db. TIDAK boleh api.
  {
    files: ['lib/runtime/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@lakoku/api',
                '@/lib/api',
                '@/lib/api/*',
                '../api/*',
                // paksa barrel untuk paket lintas (bukan deep-import)
                '@/lib/narrative',
                '@/lib/narrative/*',
                '@/lib/ai-gateway',
                '@/lib/ai-gateway/*',
                '../narrative/*',
                '../ai-gateway/*',
              ],
              message: boundary(
                'runtime boleh memakai @lakoku/{narrative-core,ai-gateway,db} lewat barrel; tidak boleh api.',
              ),
            },
          ],
        },
      ],
    },
  },

  // Konsumen (app + scripts): wajib memakai barrel @lakoku/* untuk paket logika;
  // deep-import ke internal paket dilarang. Seam framework Supabase
  // (client/server/proxy) & seam data @/lib/api/server sengaja DIBOLEHKAN.
  {
    files: ['app/**/*.{ts,tsx}', 'scripts/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/lib/narrative',
                '@/lib/narrative/*',
                '@/lib/ai-gateway',
                '@/lib/ai-gateway/*',
                '@/lib/runtime',
                '@/lib/runtime/*',
                '../lib/narrative/*',
                '../lib/ai-gateway/*',
                '../lib/runtime/*',
                '../../lib/narrative/*',
                '../../lib/ai-gateway/*',
                '../../lib/runtime/*',
              ],
              message: boundary(
                'Gunakan barrel @lakoku/{narrative-core,ai-gateway,runtime} — bukan deep-import ke file internal.',
              ),
            },
          ],
        },
      ],
    },
  },
]

export default eslintConfig
