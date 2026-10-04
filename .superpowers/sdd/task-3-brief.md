### Task 3: Audit dependensi `auth.users` di fungsi SQL + shim

**Files:**
- Create: `neon/ADAPTATION_NOTES.md` (lengkapi bagian auth.users)
- Create: `neon/bootstrap/001-auth-compat.sql` (hasil keputusan audit)
- Modify: `neon/migrations/<file yang relevan>` bila fungsi harus diubah

**Interfaces:**
- Produces: Neon yang punya semua fungsi RPC hidup BERFUNGSI tanpa `auth`
  schema asli. `neon/ADAPTATION_NOTES.md` §"auth.users dependencies" = tabel
  keputusan (fungsi → dipakai oleh file X → solusi).

- [ ] **Step 1: Enumerasi**

Run: `grep -rn "auth\.users" neon/migrations/ | grep -v "^.*--"` → daftar
fungsi yang menyentuh `auth.users` (dari Task 2 seharusnya tinggal yang di
body fungsi: `from auth.users`, `join auth.users`, `into auth.users`).
Untuk tiap fungsi, grep pemanggil `.rpc('<nama>')` di lib/, app/, scripts/
untuk tahu hidup atau mati.

- [ ] **Step 2: Putuskan per fungsi dan tulis keputusan di ADAPTATION_NOTES**

Kebijakan:
- Fungsi TIDAK dipanggil dari kode → biarkan; buat `auth.users` compat table
  minimal (kolom yang dirujuk) agar body tetap valid saat dipanggil.
- Fungsi HIDUP yang join `auth.users` untuk mengambil email/nama → ubah body:
  join dihilangkan, kolom profil diambil dari tabel `profiles` public yang
  sudah ada (verifikasi: profiles memakai id yang sama) ATAU param tambahan
  dari caller. Rekam alasannya. Fungsi HIDUP yang INSERT `auth.users` →
  eskalasi ke controller (jangan pilih sendiri).

- [ ] **Step 3: Implementasi `neon/bootstrap/001-auth-compat.sql`**

```sql
-- Compat: tabel auth.users minimal untuk fungsi yang tidak lagi hidup.
-- KOLOM DISESUAIKAN dgn hasil audit Task ini (id/email/encrypted_password
-- adalah kandidat umum). Tidak berisi data; tidak dipakai jalur hidup.
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  encrypted_password text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  email_confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
```

Jalankan `node scripts/neon-migrate.mjs` (bootstrap ikut diterapkan bila
runner memuat folder bootstrap sebelum migrations — tambahkan itu di runner
Task 2 bila belum).

- [ ] **Step 4: Commit**

```bash
git add neon/ scripts/neon-migrate.mjs
git commit -m "feat(neon): auth.users dependency audit resolved with compat shim"
```

---

