const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const script = process.argv[2]

if (!script) {
  console.error('Usage: node scripts/run-smoke.cjs <script.ts>')
  process.exit(1)
}

function findJiti() {
  const pnpmDir = path.join(root, 'node_modules', '.pnpm')
  const entries = fs.readdirSync(pnpmDir)
  const match = entries.find((entry) => entry.startsWith('jiti@'))
  if (!match) throw new Error('jiti is not installed in node_modules/.pnpm')
  return path.join(pnpmDir, match, 'node_modules', 'jiti', 'lib', 'jiti.cjs')
}

const createJiti = require(findJiti())
const jiti = createJiti(__filename, {
  fsCache: false,
  alias: {
    '@/': `${root}/`,
    '@lakoku/narrative-core/server': path.join(root, 'lib/narrative/server.ts'),
    '@lakoku/narrative-core': path.join(root, 'lib/narrative/index.ts'),
    '@lakoku/ai-gateway/server': path.join(root, 'lib/ai-gateway/server.ts'),
    '@lakoku/ai-gateway': path.join(root, 'lib/ai-gateway/index.ts'),
    '@lakoku/runtime': path.join(root, 'lib/runtime/index.ts'),
    '@lakoku/db': path.join(root, 'lib/supabase/index.ts'),
    '@lakoku/authoring/server': path.join(root, 'lib/authoring/server.ts'),
    '@lakoku/authoring': path.join(root, 'lib/authoring/index.ts'),
    '@lakoku/api': path.join(root, 'lib/api/index.ts'),
    '@lakoku/contracts': path.join(root, 'packages/contracts/src/index.ts'),
    'server-only': path.join(root, 'node_modules/server-only/empty.js'),
  },
})

const scriptPath = path.resolve(root, script)

Promise.resolve(
  jiti.import(scriptPath, {
    conditions: ['react-server', 'node', 'import'],
  }),
).catch((error) => {
  console.error(error)
  process.exit(1)
})
