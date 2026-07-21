import { createClient } from '@/lib/supabase/client'
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

  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  try {
    const supabase = createClient({
      url: 'https://example.supabase.co',
      anonKey: 'public-anon-key',
    } as never)
    check('browser Supabase client accepts explicit public config', Boolean(supabase.auth))
  } catch (error) {
    check('browser Supabase client accepts explicit public config', false, error)
  } finally {
    if (previousUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl
    if (previousAnonKey) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey
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
