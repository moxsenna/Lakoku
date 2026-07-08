/**
 * M9 release gate otomatis untuk web release.
 *
 * Script ini tidak menggantikan QA staging manual. Ia memastikan prasyarat yang
 * bisa dicek deterministik sudah terpasang dan akan gagal bila jalur release
 * kembali menerima synthetic choice atau kehilangan recovery smoke.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
let pass = 0
let fail = 0

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++
    console.log('  PASS ', name)
  } else {
    fail++
    console.error('  FAIL ', name, detail ?? '')
  }
}

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

function exists(rel: string): boolean {
  return fs.existsSync(path.join(root, rel))
}

function walkFiles(rel: string): string[] {
  const base = path.join(root, rel)
  if (!fs.existsSync(base)) return []
  return fs.readdirSync(base, { withFileTypes: true }).flatMap((entry) => {
    const entryRel = path.join(rel, entry.name)
    if (entry.isDirectory()) return walkFiles(entryRel)
    return entry.isFile() ? [entryRel] : []
  })
}

function publicBrandLeaks(): string[] {
  const patterns = [/Narraza/i, /AI generator/i]
  return ['app', 'components', 'lib/api']
    .flatMap(walkFiles)
    .filter((file) => /\.(ts|tsx|css|md)$/.test(file))
    .filter((file) => patterns.some((pattern) => pattern.test(read(file))))
}

console.log('M9 release gate:')

const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
const scripts = pkg.scripts ?? {}
const smoke = scripts.smoke ?? ''

check('smoke:web-release script tersedia', scripts['smoke:web-release'] === 'node scripts/run-smoke.cjs scripts/web-release-smoke.ts')
check('smoke chain memuat web-release', smoke.includes('smoke:web-release'))
check('release:m9 script tersedia', scripts['release:m9'] === 'node scripts/run-smoke.cjs scripts/m9-release-gate.ts')

const ci = exists('.github/workflows/ci.yml') ? read('.github/workflows/ci.yml') : ''
check('CI menjalankan release gate M9', ci.includes('pnpm release:m9'))

const client = read('lib/api/client.ts')
check(
  'synthetic choice fallback tidak ada',
  !client.includes('Pilihanmu telah dicatat') && !/Fallback aman/i.test(client),
)

const pending = read('lib/api/pending-choice.ts')
check('pending choice memakai storage key stabil', pending.includes('lakoku:pending-choice:v1'))
check('pending choice retry tidak menghapus saat gagal', pending.includes('lastError') && pending.includes('throw error'))

const reader = read('components/reader-view.tsx')
check('reader punya phase pending', reader.includes("'pending'"))
check('reader tidak menawarkan pilihan kedua saat pending', reader.includes("phase === 'pending'"))

const layout = read('app/layout.tsx')
check('theme inline script helper tersedia untuk Cloudflare', layout.includes('self.__name'))
check('Vercel Analytics hanya aktif di Vercel', layout.includes("process.env.VERCEL === '1'"))

const qaPath = 'docs/STAGING_QA_WEB_RELEASE.md'
check('staging QA checklist ada', exists(qaPath))
if (exists(qaPath)) {
  const qa = read(qaPath)
  check('staging QA mencakup no synthetic choice', /No Synthetic Choice/i.test(qa))
  check('staging QA mencakup pending-choice recovery', /Pending-choice recovery/i.test(qa))
  check('staging QA mencakup keputusan release', /Release decision/i.test(qa))
}

const docs = read('docs/PROGRESS_CHECKLIST.md')
check('progress checklist mencatat M9 release gate', docs.includes('scripts/m9-release-gate.ts'))

check('brand guard public web bersih', publicBrandLeaks().length === 0, publicBrandLeaks())

if (fail > 0) {
  console.error(`m9-release-gate: ${pass}/${pass + fail} PASS`)
  process.exit(1)
}

console.log(`m9-release-gate: ${pass}/${pass + fail} PASS`)
