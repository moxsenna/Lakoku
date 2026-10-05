### Task 3: Script Impor Pengguna Supabase Existing ke Better Auth

**Files:**
- Create: `scripts/neon-import-users.mjs`
- Test: `tests/auth/user-import-fidelity.test.ts`

**Interfaces:**
- Consumes: Data tabel `auth.users` compat di Neon (18 pengguna yang dikloning dari Supabase pada Fase A Task 4).
- Produces: Data di tabel `public."user"` dan `public."account"` Better Auth dengan UUID, email, dan hash password identik.

- [ ] **Step 1: Tulis test verifikasi impor**

```ts
// tests/auth/user-import-fidelity.test.ts
import { describe, expect, it } from 'vitest'
import pg from 'pg'
import bcrypt from 'bcryptjs'

const hasDb = !!process.env.DATABASE_URL

describe.skipIf(!hasDb)('User import fidelity', () => {
  it('pengguna uji moxsenna+monkeytest1@gmail.com ada di tabel user & account dengan password valid', async () => {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
    const { rows: userRows } = await pool.query<{ id: string; email: string }>(
      'SELECT id, email FROM public."user" WHERE email = $1',
      ['moxsenna+monkeytest1@gmail.com']
    )
    expect(userRows).toHaveLength(1)
    const userId = userRows[0].id

    const { rows: accountRows } = await pool.query<{ password: string }>(
      'SELECT password FROM public."account" WHERE "userId" = $1 AND "providerId" = $2',
      [userId, 'credential']
    )
    await pool.end()

    expect(accountRows).toHaveLength(1)
    const valid = await bcrypt.compare('lakoku-uji-123', accountRows[0].password)
    expect(valid).toBe(true)
  })
})
```

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `pnpm exec vitest run tests/auth/user-import-fidelity.test.ts`
Expected: FAIL — user belum diimpor ke tabel `user`/`account`.

- [ ] **Step 3: Buat script impor `scripts/neon-import-users.mjs`**

```js
/**
 * Impor pengguna dari auth.users compat ke tabel user & account Better Auth di Neon.
 * Usage: node scripts/neon-import-users.mjs
 * Idempoten: ON CONFLICT DO NOTHING.
 */
import { readFileSync } from 'node:fs'
import pg from 'pg'

const env = { ...process.env }
for (const file of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) env[m[1]] ??= m[2].replace(/^["']|["']$/g, '')
    }
  } catch {}
}

if (!env.DATABASE_URL) {
  console.error('DATABASE_URL belum diset.')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 })

console.log('Membaca auth.users dari Neon...')
const { rows: sourceUsers } = await pool.query(`
  SELECT
    id,
    email,
    encrypted_password,
    raw_user_meta_data,
    email_confirmed_at,
    created_at,
    updated_at
  FROM auth.users
  WHERE email IS NOT NULL AND email != ''
`)

console.log(`Ditemukan ${sourceUsers.length} pengguna di auth.users`)

let importedUsers = 0
let importedAccounts = 0

for (const u of sourceUsers) {
  const meta = typeof u.raw_user_meta_data === 'string' ? JSON.parse(u.raw_user_meta_data) : (u.raw_user_meta_data || {})
  const name = meta.full_name || meta.name || meta.display_name || u.email.split('@')[0]
  const emailVerified = !!u.email_confirmed_at
  const createdAt = u.created_at || new Date()
  const updatedAt = u.updated_at || createdAt

  // 1. Insert ke public."user"
  const userRes = await pool.query(`
    INSERT INTO public."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      "emailVerified" = EXCLUDED."emailVerified",
      "updatedAt" = EXCLUDED."updatedAt"
    RETURNING id
  `, [u.id, name, u.email, emailVerified, createdAt, updatedAt])

  if (userRes.rowCount > 0) importedUsers++

  // 2. Insert ke public."account" (hanya jika ada encrypted_password)
  if (u.encrypted_password) {
    const accountId = `legacy-acc-${u.id}`
    const accRes = await pool.query(`
      INSERT INTO public."account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
      VALUES ($1, $2, 'credential', $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET
        password = EXCLUDED.password,
        "updatedAt" = EXCLUDED."updatedAt"
    `, [accountId, u.id, u.id, u.encrypted_password, createdAt, updatedAt])

    if (accRes.rowCount > 0) importedAccounts++
  }
}

console.log(`Selesai: ${importedUsers} baris user, ${importedAccounts} baris account diproses.`)
await pool.end()
```

- [ ] **Step 4: Jalankan script impor**

Run: `node scripts/neon-import-users.mjs`
Expected: `Selesai: 18 baris user, 18 baris account diproses.`

- [ ] **Step 5: Jalankan test verifikasi impor**

Run: `pnpm exec vitest run tests/auth/user-import-fidelity.test.ts`
Expected: PASS (kata sandi `lakoku-uji-123` terverifikasi via bcrypt).

- [ ] **Step 6: Commit**

```bash
git add scripts/neon-import-users.mjs tests/auth/user-import-fidelity.test.ts
git commit -m "feat(auth): user import script from auth.users to Better Auth with bcrypt fidelity"
```

---

