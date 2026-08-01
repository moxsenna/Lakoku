import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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

function source(root: string, path: string) {
  const fullPath = join(root, path)
  return existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : ''
}

async function main() {
  console.log('Password recovery smoke:')
  const root = join(__dirname, '..')
  const forgotPage = source(root, 'app/auth/forgot-password/page.tsx')
  const forgotForm = source(root, 'app/auth/forgot-password/forgot-password-form.tsx')
  const resetPage = source(root, 'app/auth/reset-password/page.tsx')
  const resetForm = source(root, 'app/auth/reset-password/reset-password-form.tsx')
  const loginPage = source(root, 'app/auth/login/page.tsx')
  const loginForm = source(root, 'app/auth/login/login-form.tsx')

  check('forgot-password server route exists', Boolean(forgotPage))
  check('reset-password server route exists', Boolean(resetPage))
  check('forgot route passes public Supabase config', forgotPage.includes('getSupabasePublicConfig'))
  check('reset route passes public Supabase config', resetPage.includes('getSupabasePublicConfig'))
  check('forgot form calls resetPasswordForEmail', forgotForm.includes('resetPasswordForEmail'))
  check(
    'forgot form uses fixed recovery callback',
    forgotForm.includes('`${window.location.origin}/auth/callback/recovery`'),
  )
  check('reset form verifies recovery user', resetForm.includes('supabase.auth.getUser()'))
  check('reset form uses server password mutation', resetForm.includes("fetch('/api/auth/password-recovery'"))
  check('server mutation updates password', source(root, 'app/api/auth/password-recovery/route.ts').includes('updateUserById'))
  check(
    'reset form hard-navigates to reset success login',
    resetForm.includes("window.location.assign('/auth/login?reset=success')"),
  )
  check('login links to forgot-password', loginForm.includes('href="/auth/forgot-password"'))
  check('login page handles reset success', loginPage.includes("reset === 'success'"))
  check('forms do not manually parse URL fragments', !`${forgotForm}\n${resetForm}`.includes('location.hash'))
  check(
    'forms do not reference recovery token fields',
    !/access_token|refresh_token/.test(`${forgotForm}\n${resetForm}`),
  )
  check(
    'forms do not render provider error messages',
    !/setError\(\s*(?:error|authError|updateError)\.message\s*\)/.test(`${forgotForm}\n${resetForm}`),
  )

  if (fail > 0) {
    console.error(`password-recovery-smoke: ${pass}/${pass + fail} PASS`)
    process.exit(1)
  }
  console.log(`password-recovery-smoke: ${pass}/${pass + fail} PASS`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
