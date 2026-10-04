# Desain: Full Exit Supabase — Neon DB + Kysely + Better Auth

**Tanggal:** 2026-10-03
**Status:** Disetujui (brainstorming)
**Induk:** Migrasi keluar Supabase — menggabungkan sub-proyek 2 (DB) + 3 (Auth)
menjadi satu proyek, karena motivasi PM adalah **keluar total dari Supabase**
(akun Supabase berulang kali dinonaktifkan karena inactivity).

## Keputusan (disetujui PM)

| Keputusan | Pilihan |
|-----------|---------|
| Motivasi | Keluar total dari Supabase (tidak ada tahap yang masih menyisakan Supabase) |
| Database | Neon Postgres, **free tier** (terima autosuspend: request pertama setelah idle ±1 dtk) |
| Lapisan query | **Kysely** + codegen tipe dari skema Neon (pilihan teknis didelegasikan ke agent) |
| Auth | **Better Auth** (cookie web + bearer Android), tabel di Neon |
| User existing | Semua diimpor **beserta hash password-nya**; UUID user dipertahankan |
| Email transaksional | **Mailketing HTTP API** (`POST /api/v2/send`, sender `admin@lakoku.biz.id`, sudah terverifikasi DKIM/SPF) |
| Jendela cutover | Boleh kapan saja; tulis berhenti ±30–60 menit, tanpa teknik dual-write |
| Rollback | Supabase dibiarkan utuh selama masa observasi; rollback = kembalikan env + release lama |

## Arsitektur Target

```
Browser/Android ──fetch──> Next.js API routes / RSC (TIDAK BERUBAH)
                               │
              ┌────────────────┼──────────────────┐
              │                │                  │
        Kysely (DATABASE_URL)  Better Auth       Mailketing API
              │                (tabel di Neon)   POST /api/v2/send
              ▼                                   (verifikasi email,
        Neon Postgres                             reset password)
        (data + auth schema)
```

- Browser tetap API-first: komponen tidak pernah menyentuh database (seam
  `lib/api/client.ts` fetch ke `/api/*` — tidak berubah).
- Android tetap kontrak API sama (bearer token) — tanpa update Play Store.
- Supabase: **nol dependensi** di akhir proyek.

## 1. Lapisan Data (Kysely)

- Paket `@lakoku/db` tetap pemilik akses data (ARCH §5.1, leaf package). Isi
  diganti: instance Kysely (`getDb()`, singleton per proses, driver `pg` Pool)
  + tipe `Database` hasil **kysely-codegen** dari skema Neon.
- Env baru: `DATABASE_URL` (endpoint pooled Neon).
- Permukaan yang di-rewrite (semuanya di server; browser tidak tersentuh):
  - 453 `.from()` → `selectFrom/insertInto/updateTable` (typed).
  - 508 `.filter()` → `.where()` dengan operator eksplisit.
  - 15 `.upsert()` → `.onConflict()`.
  - 85 `.rpc()` → template `sql` yang memanggil **fungsi SQL yang sama persis**
    (fungsi transaksional naratif TIDAK diubah isinya — direplay apa adanya).
- Semantik `maybeSingle`/`single` dipetakan ke
  `executeTakeFirst`/`executeTakeFirstOrThrow` secara konsisten.
- Pemanggil `createAdminClient` (±104 file) berpindah ke `getDb()`.

## 2. Skema & Data ke Neon

- Salinan adaptif 94 migrasi → `neon/migrations/` (bootstrap + urutan sama):
  - Dibuang: `storage.buckets`, `cron.schedule` (pg_cron), `create policy` +
    `enable row level security`, `GRANT/REVOKE` ke roles Supabase, FK ke
    `auth.users` (33 referensi — kolom UUID dipertahankan tanpa FK).
  - Job cleanup incidents (pg_cron 15 menit) → **systemd timer**
    `mox-lakoku-cleanup.timer` di VPS yang memanggil fungsi cleanup via psql.
  - Ekstensi: `pgcrypto`, `btree_gist` tersedia di Neon (dibuat ulang oleh
    migrasi). `pg_cron` tidak dibutuhkan lagi.
- Migration runner: `scripts/neon-migrate.mjs` — terapkan file `.sql` berurutan,
  catat di tabel `neon_schema_migrations`.
- **Pemindahan data produksi** (jendela cutover):
  1. Stop `mox-lakoku` (tulisan berhenti).
  2. `pg_dump --data-only --schema=public,private` dari Supabase →
     restore ke Neon (data-only; skema sudah dibuat oleh migrasi adaptif).
  3. Import user (lihat §3) dari dump `auth.users`.
  4. Deploy release baru dengan env Neon + Better Auth → start → health/E2E.
- UUID semua row dipertahankan; relasi `owner_user_id` dll. tetap valid karena
  id user Better Auth = id lama.

## 3. Auth (Better Auth)

- Adapter database Better Auth: **adapter Kysely resmi**, berbagi `DATABASE_URL`
  Neon dengan lapisan data.
- **Import user**: `auth.users` (id, email, `encrypted_password` bcrypt, flag
  konfirmasi, metadata) → tabel `user` + `account` (provider credential).
  Konfigurasi Better Auth dengan custom `hash/verify` yang menerima **bcrypt**
  (hash lama), rehash ke format Better Auth saat login sukses (lazy).
- **Sesi**: cookie untuk web (`getSessionUser` di `lib/api/user-state.ts`
  di-rewrite ke `auth.api.getSession` + bearer plugin untuk API/Android).
  Dead-cookie = guest dipertahankan (tanpa crash RSC — pola `084febb`).
- **Middleware** (`lib/supabase/proxy.ts`): diganti pemeriksaan sesi Better
  Auth yang sederhana (tidak ada lagi refresh-token dance); matcher sama
  (beranda/profil/kredit/payment/s).
- **Google OAuth**: social provider Better Auth dengan client ID/secret Google
  yang sama (PM ekspor dari dashboard Supabase), tambah 1 redirect URI baru.
- **Email** (Mailketing API, bukan SMTP): modul `lib/email/mailketing.ts`
  memanggil `POST https://api.mailketing.co.id/api/v2/send` dengan
  `Authorization: Bearer MAILKETING_API_TOKEN`, `from_name=Lakoku`,
  `from_email=admin@lakoku.biz.id`, `content` HTML. Dipakai di callback
  `sendVerificationEmail` dan `sendResetPassword` Better Auth.
  - Validasi token: dilakukan 2026-10-03 (respons 422 validation, bukan 401).
- **Route auth**: `/auth/login`, `/auth/sign-up`, `/auth/forgot-password`,
  `/auth/reset-password`, `/auth/callback/*`, `/api/auth/android` — UX dan
  kontrak request/response TIDAK berubah; implementasi dalam diganti Better
  Auth (client browser vanilla Better Auth di form-form auth).
- Auto-redirect user login ke `/beranda` (cold launch) dipertahankan.

## 4. Keamanan: RLS → Guard Eksplisit

Neon diakses satu role aplikasi dari server; RLS ditarik. Gantinya:
- **Audit RLS wajib** (deliverable): tabel matrix semua policy RLS existing
  (41 `auth.uid()` + policy anon read) → masing-masing dipetakan ke
  (a) guard aplikasi yang SUDAH ada (mis. `isStoryOwnedBy`, owner check di
  klausa UPDATE), atau (b) kondisi `WHERE` eksplisit baru di query pembaca
  (mis. konten published hanya `status='PUBLISHED' AND visibility='public'`).
- Sesi anon yang tadinya lewat PostgREST+RLS (katalog/reader) kini lewat
  Kysely dengan kondisi visibilitas eksplisit — daftar query pembaca yang
  menyentuh tabel sensitif wajib masuk matrix.
- Kredensial Neon hanya di server (VPS env), tidak pernah ke client.

## 5. Env

Hapus (setelah cutover): `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`.

Tambah:

| Variabel | Isi |
|----------|-----|
| `DATABASE_URL` | Connection string pooled Neon (sudah di `.env.local`) |
| `BETTER_AUTH_SECRET` | Secret random ≥32 byte |
| `BETTER_AUTH_URL` | `https://lakoku.biz.id` |
| `MAILKETING_API_TOKEN` | Token API Mailketing (sudah di `.env.local`) |
| `MAILKETING_FROM_EMAIL` / `MAILKETING_FROM_NAME` | `admin@lakoku.biz.id` / `Lakoku` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth Google (di ekspor PM dari dashboard Supabase) |

## 6. Rollout Bertahap

- **Fase A — Data plane**: project Neon + replay migrasi adaptif + Kysely +
  rewrite call-site. Auth masih Supabase via HTTP (GoTrue tidak menyentuh DB
  kita) sehingga fase ini bisa diverifikasi penuh dengan data clone produksi
  (dump+restore ke Neon) sebelum menyentuh auth.
- **Fase B — Auth**: Better Auth + import user + ganti route/middleware/form →
  verifikasi login/daftar/reset/Google di lokal (Neon berisi data clone).
- **Fase C — Cutover produksi**: satu jendela — stop service → dump+restore →
  import user → deploy → health + E2E (gaya cutover R2: akun test, smoke
  production-reader 9/9, SQL residue check).
- **Fase D — Decommission**: observasi; PM putuskan menonaktifkan project
  Supabase. Supabase dibiarkan utuh sampai keputusan ini (rollback tetap bisa:
  balik env + release lama; perubahan tulisan selama observasi di Neon tidak
  ikut balik — diterima).

## 7. Verifikasi

- Per fase: `pnpm typecheck`, unit tests, lint.
- Fase C: `pnpm smoke:production-reader` (9/9), E2E akun test (login dengan
  password lama yang diimpor — bukti bcrypt bekerja; pilih cerita; submit
  choice; saldo utuh), check SQL residue (0 referensi supabase di env/runtime).
- Reticle: alur login → baca bab → pilih → lihat saldo, pada release cutover.

## 8. Aksi PM (sebelum Fase C)

1. ~~Buat project Neon~~ ✓ (connection string diterima 2026-10-03)
2. ~~Token Mailketing~~ ✓ (valid, sender approved)
3. Ekspor Google OAuth client ID/secret dari dashboard Supabase → env VPS;
   tambah redirect URI Better Auth di Google Cloud Console.
4. (Opsional, pasca-observasi) Rotasi token Mailketing & password Neon karena
   sempat lewat chat; matikan project Supabase.

## 9. Batas Luar (Non-Tujuan)

- Tidak mengubah UX, kontrak API, atau struktur 50 bab.
- Tidak menyentuh Cloudflare R2 (sudah jalan).
- Tidak menambah fitur auth baru (magic link, 2FA, dsb.) — hanya paritas.
