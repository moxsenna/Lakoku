import { getEmailRedirectTo } from '@/app/auth/sign-up/redirect'

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
  console.log('Auth redirect smoke:')

  const redirect = getEmailRedirectTo(
    'https://lakoku.appvibe.biz.id',
    'https://v0.app/chat/api/supabase/redirect/6MYKydJOsnj',
  )

  check(
    'email confirmation redirect stays on current app origin',
    redirect === 'https://lakoku.appvibe.biz.id/auth/callback',
    redirect,
  )

  if (fail > 0) {
    console.error(`auth-redirect-smoke: ${pass}/${pass + fail} PASS`)
    process.exit(1)
  }

  console.log(`auth-redirect-smoke: ${pass}/${pass + fail} PASS`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
