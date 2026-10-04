# Neon Migration Kit (Full Exit Supabase — Fase A)

Struktur:
- `migrations/` — salinan adaptif `supabase/migrations/` (tanpa RLS/policy,
  GRANT/REVOKE roles Supabase, storage.buckets, pg_cron, FK auth.users).
- `bootstrap/001-roles-and-shims.sql` — dibuat oleh script adaptasi bila perlu.
- Runner: `node scripts/neon-migrate.mjs` (membaca `DATABASE_URL` dari
  `.env.local`, menerapkan file urut, mencatat di `neon_schema_migrations`).
- Clone data: `node scripts/neon-clone-data.mjs` (pg_dump data-only dari
  Supabase → restore ke Neon; idempoten dari awal: WADUH — jalankan pada DB
  kosong saja; untuk re-clone, drop schema public/private dulu).
Dilarang menyimpan kredensial di repo.
