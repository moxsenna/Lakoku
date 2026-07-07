import { createClient } from '@/lib/supabase/client'

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
