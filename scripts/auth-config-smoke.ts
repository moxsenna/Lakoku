import { authClient } from '@/lib/auth-client'
import { readFileSync } from 'node:fs'
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

async function main() {
  console.log('Auth config smoke:')

  try {
    check('Better Auth client accepts valid configuration', Boolean(authClient.signIn && authClient.signUp))
  } catch (error) {
    check('Better Auth client accepts valid configuration', false, error)
  }

  const root = join(__dirname, '..')
  const loginSrc = readFileSync(join(root, 'app/auth/login/login-form.tsx'), 'utf8')
  const signUpSrc = readFileSync(join(root, 'app/auth/sign-up/sign-up-form.tsx'), 'utf8')
  const callbackSrc = readFileSync(join(root, 'app/auth/callback/route.ts'), 'utf8')
  const safeNextSrc = readFileSync(join(root, 'lib/auth/safe-next.ts'), 'utf8')
  const completeSrc = readFileSync(join(root, 'app/auth/complete/page.tsx'), 'utf8')

  check(
    'login form exposes Google CTA copy',
    loginSrc.includes('Masuk dengan Google') || loginSrc.includes('GoogleSignInButton'),
  )
  check(
    'sign-up form exposes Google CTA',
    signUpSrc.includes('GoogleSignInButton') || signUpSrc.includes('Masuk dengan Google'),
  )
  check(
    'login uses signInWithOAuth google',
    loginSrc.includes("provider: 'google'") || loginSrc.includes('provider: "google"'),
  )
  check(
    'sign-up uses signInWithOAuth google',
    signUpSrc.includes("provider: 'google'") || signUpSrc.includes('provider: "google"'),
  )
  check('callback sanitizes next', callbackSrc.includes('sanitizeNextPath'))
  check('callback routes to complete bridge', callbackSrc.includes('/auth/complete'))
  check(
    'safe-next helper exports sanitizeNextPath',
    safeNextSrc.includes('export function sanitizeNextPath'),
  )
  check('complete page merges guest taste', completeSrc.includes('actMergeGuestTasteProfile'))
  check('complete page hard-navigates', completeSrc.includes('window.location.assign'))

  if (fail > 0) {
    console.error(`auth-config-smoke: ${pass}/${pass + fail} PASS`)
    process.exit(1)
  }

  console.log(`auth-config-smoke: ${pass}/${pass + fail} PASS`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
