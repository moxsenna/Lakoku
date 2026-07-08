import { guardAdminToken } from '@/lib/auth/admin-guard'

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

function reqWith(token?: string): Request {
  const headers = new Headers()
  if (token !== undefined) headers.set('x-runtime-token', token)
  return new Request('https://example.test/api/admin', { method: 'POST', headers })
}

async function main() {
  console.log('Admin guard smoke:')

  const previousToken = process.env.RUNTIME_ADMIN_TOKEN

  try {
    // Fail-closed: tanpa RUNTIME_ADMIN_TOKEN, permukaan internal DITOLAK 503,
    // bukan diteruskan ke DB (celah 500 lama).
    delete process.env.RUNTIME_ADMIN_TOKEN
    const noConfig = guardAdminToken(reqWith('anything'))
    check('tanpa token env → 503 (fail-closed)', noConfig?.status === 503, noConfig?.status)

    process.env.RUNTIME_ADMIN_TOKEN = 'secret-token-xyz'

    const missing = guardAdminToken(reqWith(undefined))
    check('token diset, header absen → 401', missing?.status === 401, missing?.status)

    const wrong = guardAdminToken(reqWith('salah'))
    check('token diset, header salah → 401', wrong?.status === 401, wrong?.status)

    const ok = guardAdminToken(reqWith('secret-token-xyz'))
    check('token diset, header cocok → diizinkan (null)', ok === null, ok)
  } finally {
    if (previousToken === undefined) delete process.env.RUNTIME_ADMIN_TOKEN
    else process.env.RUNTIME_ADMIN_TOKEN = previousToken
  }

  if (fail > 0) {
    console.error(`admin-guard-smoke: ${pass}/${pass + fail} PASS`)
    process.exit(1)
  }

  console.log(`admin-guard-smoke: ${pass}/${pass + fail} PASS`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
