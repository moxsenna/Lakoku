/**
 * Impor pengguna dari auth.users compat ke tabel user & account Better Auth di Neon.
 * Usage: node scripts/neon-import-users.mjs
 * Idempoten: ON CONFLICT DO UPDATE.
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

try {
  console.log('Membaca auth.users dari Neon...')
  const { rows: sourceUsers } = await pool.query(`
    SELECT
      id,
      email,
      encrypted_password,
      raw_app_meta_data,
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
    const image = meta.avatar_url || meta.picture || null
    const emailVerified = !!u.email_confirmed_at
    const createdAt = u.created_at || new Date()
    const updatedAt = u.updated_at || createdAt

    // 1. Insert ke public."user"
    const userRes = await pool.query(`
      INSERT INTO public."user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        "emailVerified" = EXCLUDED."emailVerified",
        image = COALESCE(EXCLUDED.image, public."user".image),
        "updatedAt" = EXCLUDED."updatedAt"
      RETURNING id
    `, [u.id, name, u.email, emailVerified, image, createdAt, updatedAt])

    if (userRes.rowCount > 0) importedUsers++

    // 2. Insert ke public."account"
    const accountId = `legacy-acc-${u.id}`
    if (u.encrypted_password) {
      const accRes = await pool.query(`
        INSERT INTO public."account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
        VALUES ($1, $2, 'credential', $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE SET
          password = EXCLUDED.password,
          "updatedAt" = EXCLUDED."updatedAt"
      `, [accountId, u.id, u.id, u.encrypted_password, createdAt, updatedAt])

      if (accRes.rowCount > 0) importedAccounts++
    } else {
      // Pengguna OAuth (mis. Google) tanpa encrypted_password
      const appMeta = typeof u.raw_app_meta_data === 'string' ? JSON.parse(u.raw_app_meta_data) : (u.raw_app_meta_data || {})
      const providerId = appMeta.provider || 'google'
      const oauthAccountId = meta.sub || meta.provider_id || u.id
      const accRes = await pool.query(`
        INSERT INTO public."account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, NULL, $5, $6)
        ON CONFLICT (id) DO UPDATE SET
          "updatedAt" = EXCLUDED."updatedAt"
      `, [accountId, oauthAccountId, providerId, u.id, createdAt, updatedAt])

      if (accRes.rowCount > 0) importedAccounts++
    }
  }

  console.log(`Selesai: ${importedUsers} baris user, ${importedAccounts} baris account diproses.`)
} finally {
  await pool.end()
}
