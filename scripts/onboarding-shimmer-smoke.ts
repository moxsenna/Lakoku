import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '..')
const component = fs.readFileSync(path.join(root, 'components/mulai/onboarding-flow.tsx'), 'utf8')
const css = fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8')
const shimmer = fs.readFileSync(path.join(root, 'components/ai-elements/shimmer.tsx'), 'utf8')

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

console.log('Onboarding shimmer smoke:')

check('AI Elements Shimmer terpasang', /export const Shimmer = memo\(ShimmerComponent\)/.test(shimmer))
check('onboarding mengimpor Shimmer resmi', /import \{ Shimmer \} from '@\/components\/ai-elements\/shimmer'/.test(component))
check('active build step memakai Shimmer resmi', /active \? \(\s*<Shimmer[\s\S]*\{s\.label\}[\s\S]*<\/Shimmer>\s*\)/.test(component))
check('label step build tetap terbaca saat tidak aktif', /:\s*\(\s*<span className="font-medium">\{s\.label\}<\/span>/.test(component))
check('custom shimmer lama tidak dipakai', !/lk-text-shimmer/.test(component + css))

if (fail > 0) {
  console.error(`onboarding-shimmer-smoke: ${pass}/${pass + fail} PASS`)
  process.exit(1)
}

console.log(`onboarding-shimmer-smoke: ${pass}/${pass + fail} PASS`)
