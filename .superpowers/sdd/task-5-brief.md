### Task 5: Kysely instance + tipe codegen (`lib/supabase/db.ts`)

**Files:**
- Create: `lib/supabase/db.ts`
- Create: `scripts/neon-codegen.mjs`
- Create: `lib/supabase/db-types.ts` (HASIL codegen — besar, di-commit)
- Modify: `lib/supabase/index.ts` (barrel: ekspor `getDb` + tipe)
- Test: `lib/supabase/db.test.ts`

**Interfaces:**
- Produces (dipakai semua task rewrite):
  - `getDb(): Kysely<Database>` — singleton per proses, `PostgresDialect` + `pg.Pool` (max 10), env `DATABASE_URL` wajib (throw pesan jelas bila kosong).
  - `Database` (codegen) di `lib/supabase/db-types.ts`.
  - Barrel `@lakoku/db` tetap ekspor `createAdminClient` (fase A) + tambah `getDb`, `Database`, `type DbResult`.

- [ ] **Step 1: Codegen script + jalankan**

```js
// scripts/neon-codegen.mjs
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
execSync(
  `npx kysely-codegen --url "${env.DATABASE_URL}" --out-file lib/supabase/db-types.ts --dialect postgres --print`,
  { stdio: 'inherit' },
)
```

Run: `node scripts/neon-codegen.mjs`
Expected: `lib/supabase/db-types.ts` berisi interface per tabel (snake_case).

- [ ] **Step 2: Tulis test yang gagal** (`lib/supabase/db.test.ts`)

```ts
import { describe, expect, it } from 'vitest'
import { getDb } from './db'

const hasDb = !!process.env.DATABASE_URL

describe.skipIf(!hasDb)('getDb (butuh DATABASE_URL)', () => {
  it('menjalankan select sederhana dan singleton per proses', async () => {
    const db1 = getDb()
    const db2 = getDb()
    expect(db1).toBe(db2)
    const r = await db1.selectFrom((eb) => eb.selectFrom(sql`1`.as('one')).selectAll()).execute()
    expect(r).toHaveLength(1)
  })
})
```

(Import `sql` dari `kysely` — perbaiki agar valid; test inti: singleton +
query `select 1` berhasil terhadap Neon.)

- [ ] **Step 3: Implementasi `lib/supabase/db.ts`**

```ts
import 'server-only'
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import type { Database } from './db-types'

/**
 * Kysely instance untuk Neon (Full Exit Supabase — Fase A).
 * Singleton per proses; kredensial hanya dari DATABASE_URL (server env).
 * Pool kecil: endpoint pooled Neon free tier.
 */
let instance: Kysely<Database> | null = null

export function getDb(): Kysely<Database> {
  if (!instance) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('getDb: DATABASE_URL belum diset.')
    instance = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 10 }) }),
    })
  }
  return instance
}
```

Barrel `lib/supabase/index.ts` tambah: `export { getDb } from './db'` +
`export type { Database } from './db-types'` (keep `createAdminClient` export
fase A).

- [ ] **Step 4: Test lulus + commit**

Run: `pnpm exec vitest run lib/supabase/db.test.ts` → PASS (1 test)
Run: `pnpm typecheck` → bersih

```bash
git add lib/supabase/db.ts lib/supabase/db-types.ts lib/supabase/index.ts lib/supabase/db.test.ts scripts/neon-codegen.mjs
git commit -m "feat(neon): Kysely getDb singleton with codegen Database types"
```

---

