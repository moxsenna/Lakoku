# Desain: Migrasi Storage Sampul → Cloudflare R2

**Tanggal:** 2026-10-02
**Status:** Disetujui (brainstorming)
**Induk:** Migrasi Supabase → Neon (sub-proyek 1 dari 3)

## Konteks

Lakoku akan meninggalkan Supabase bertahap dalam 3 sub-proyek:
1. **Storage sampul → Cloudflare R2** (dokumen ini)
2. Neon DB & query layer
3. Better Auth

Supabase Storage dipakai hanya untuk satu bucket: `story-covers` (publik baca,
2MB, WebP saja). Tulis lewat 2 route API; baca lewat URL absolut yang disimpan
di kolom `stories.cover`. Fitur sampul live produksi sejak 2026-09-20, jadi ada
objek existing yang harus ikut pindah.

## Keputusan (disetujui PM)

| Keputusan | Pilihan |
|-----------|---------|
| Cakupan | Storage saja; DB & Auth menyusul di sub-proyek lain |
| URL publik baca | Custom domain `covers.lakoku.biz.id` (bound ke bucket R2) |
| Format kolom `stories.cover` | **Object key relatif** (`<storyId>/<stamp>.webp`); URL dirakit saat baca dari env |
| Pendekatan implementasi | `@aws-sdk/client-s3` (S3 API resmi R2), cutover satu rilis |

## Arsitektur

**Tulis:** route cover → `putCover()` → `PutObjectCommand` ke R2
(endpoint `https://<account-id>.r2.cloudflarestorage.com`) → simpan **key** ke
`stories.cover`.

**Baca:** browser → `https://covers.lakoku.biz.id/<key>` (Cloudflare cache di
depannya). Server tidak ikut melayani byte gambar.

**Backup:** bucket Supabase lama dibiarkan utuh sampai verifikasi selesai
(lalu dihapus manual oleh PM).

## Perubahan Kode

1. **`lib/cover/storage.ts`** — isi diganti: `S3Client` + `PutObjectCommand`
   dari `@aws-sdk/client-s3`. `putCover(storyId, webp)` kembalikan
   `{ ok: true, key }` (bukan `{ ok: true, url }`). Path objek & validasi
   app-side (WebP, ≤2MB via `normalizeCoverImage`) tidak berubah. `PutObject`
   dikirim dengan `ContentType: 'image/webp'` dan `CacheControl: '31536000'`.
2. **`lib/cover/server.ts`** — `setStoryCover(storyId, userId, coverPath)`:
   param kini menerima key; logika update `stories.cover` tidak berubah.
3. **`app/api/stories/[id]/cover/generate/route.ts`** &
   **`app/api/stories/[id]/cover/upload/route.ts`** — sesuaikan ke
   `stored.key` (response JSON `cover` kini berisi URL rakitan untuk
   immediate preview: `${NEXT_PUBLIC_COVER_BASE}/${key}`).
4. **`lib/api/queries.ts`** — `resolveStoryCover()`:
   - `''`/null/`/placeholder.svg*` → `DEFAULT_STORY_COVER` (perilaku lama).
   - Key relatif (tidak diawali `http`) → `${NEXT_PUBLIC_COVER_BASE}/${key}`.
   - URL absolut `http(s)://` (jaring pengaman untuk row tersisa) →
     dikembalikan apa adanya.

Kolom `stories.cover` bertipe `text NOT NULL DEFAULT ''` tanpa constraint
format — penyimpanan key aman tanpa migrasi skema.

## Script Migrasi Data

**`scripts/migrate-covers-to-r2.mjs`** (CJS-style, pola scripts/ existing):

1. List semua objek Supabase Storage `story-covers` (service-role client).
2. Unduh tiap objek → unggah ke R2 dengan **key sama**.
   Idempoten: jika objek dengan key sama sudah ada di R2 (HEAD), skip unggah.
3. Rewrite DB: `UPDATE stories SET cover = <key>` untuk row yang `cover`-nya
   berprefix `<SUPABASE_URL>/storage/v1/object/public/story-covers/`
   (ekstrak key dari URL).
4. Cetak laporan: jumlah objek disalin/skip, jumlah row diubah.
5. Flag `--dry-run`: hanya laporan, tanpa tulis R2/DB.

Dijalankan sekali di jendela cutover (setelah deploy kode + env produksi).
Aman diulang.

## Prasyarat (aksi PM, di luar repo)

1. Buat bucket R2 (nama: `lakoku-story-covers`).
2. Buat token API R2 dengan izin **Object Read & Write** untuk bucket tsb
   (hasil: Access Key ID + Secret).
3. Bind custom domain `covers.lakoku.biz.id` ke bucket (zone
   `lakoku.biz.id` harus dikelola Cloudflare).

## Env Baru

| Variabel | Isi | Sisi |
|----------|-----|------|
| `R2_ACCOUNT_ID` | Cloudflare account ID | server |
| `R2_ACCESS_KEY_ID` | dari token API R2 | server |
| `R2_SECRET_ACCESS_KEY` | dari token API R2 | server |
| `R2_BUCKET` | `lakoku-story-covers` | server |
| `NEXT_PUBLIC_COVER_BASE` | `https://covers.lakoku.biz.id` | client+server |

## Error Handling

- `putCover` gagal → response error seperti sekarang; reservasi kredit tidak
  dicapture; user bisa retry. Tidak ada perubahan semantik.
- Objek hilang di R2 (key ada di DB tapi 404) → fallback UI tetap
  `DEFAULT_STORY_COVER` via mekanisme existing.

## Rollout & Verifikasi

1. Deploy kode + env produksi (runbook deploy-kit).
2. Jalankan `scripts/migrate-covers-to-r2.mjs` (dry-run dulu, lalu riil).
3. Verifikasi (Reticle + cek DB produksi):
   - Upload cover baru → tersimpan di R2, kolom DB berisi key, gambar tampil.
   - Cover lama tetap tampil setelah migrasi.
   - `SELECT count(*) FROM stories WHERE cover LIKE '%supabase%'` = 0.
4. Unit test: `resolveStoryCover` (3 cabang di atas) + smoke route upload.

## Batas Luar (Non-Tujuan)

- Tidak menyentuh DB engine, Auth, atau RPC lain.
- Tidak menghapus bucket Supabase (keputusan PM setelah verifikasi).
- Tidak mengubah alur reservasi kredit cover (RPC tetap di Supabase sampai
  sub-proyek 2).
