# Batas Paket (M0 — Pilihan A: batas logis)

Status: **batas LOGIS** ditegakkan lewat alias + lint. Belum ada folder fisik
`packages/*` atau `apps/*` (itu langkah lanjut bila proyek benar-benar butuh
build/publish terpisah atau aplikasi Android). Semua kode tetap satu app Next.js;
preview & HMR tetap berjalan.

Referensi: ARCHITECTURE_v1.1.md §5 (struktur repo & aturan kepemilikan §5.1).

## Peta paket logis → lokasi fisik saat ini

| Paket logis (alias)        | Lokasi sekarang      | Isi / tanggung jawab                                              |
| -------------------------- | -------------------- | ---------------------------------------------------------------- |
| `@lakoku/narrative-core`   | `lib/narrative/`     | types, alias, compiler, layer-a, layer-b, reconciliation, template, threads |
| `@lakoku/narrative-core/server` | `lib/narrative/server.ts` | seam DB-facing (`loader`: baca canon Supabase) — `server-only`   |
| `@lakoku/ai-gateway`       | `lib/ai-gateway/`    | schemas, provider (deterministik), gateway (consumer-safe), generate |
| `@lakoku/ai-gateway/server`| `lib/ai-gateway/server.ts` | seam pemilih provider (`selectProvider`) — `server-only`         |
| `@lakoku/runtime`          | `lib/runtime/`       | lifecycle (RPC atomik), fake-generation, story-generation (jalur nyata) |
| `@lakoku/authoring/server` | `lib/authoring/`     | alat OFFLINE canon-authoring: schema draft, proposer (brainstorm), validate/compile, repair, persist, `reconcile-goal` (goalAuthor adaptif T7.5) — `server-only` |
| `@lakoku/db`               | `lib/supabase/`      | `createAdminClient` (service-role). Seam framework di file lain  |
| `@lakoku/api`              | `lib/api/`           | kontrak & query reader client-safe                               |

Catatan seam framework Next.js yang SENGAJA tetap deep-import (bukan lewat barrel):
`@/lib/supabase/{client,server,proxy}` dan `@/lib/api/server`. Ini karena tiap
file punya arahan lingkungan berbeda (browser vs server vs middleware) dan tidak
boleh digabung dalam satu barrel.

## Arah dependensi yang diizinkan (§5.1)

Aliran satu arah, dari data ke orkestrasi:

```
db  →  narrative-core  →  ai-gateway  →  runtime  →  (app routes)
                                   api  →  db
```

Aturan konkret yang ditegakkan ESLint (`no-restricted-imports`, lihat
`eslint.config.mjs`):

- `narrative-core` TIDAK boleh impor `ai-gateway`, `runtime`, atau `api`.
- `ai-gateway` boleh impor `narrative-core`; TIDAK boleh impor `runtime`/`api`.
- `runtime` boleh impor `narrative-core`, `ai-gateway`, `db`; TIDAK boleh impor `api`.
- `authoring` (alat offline) boleh impor `narrative-core`, `ai-gateway`, `db`; dikonsumsi oleh app routes (mis. `app/brainstorm/`). `narrative-core` tetap TIDAK boleh impor `authoring` — jalur adaptif memakai dependency injection (`GoalAuthorFn` diinjeksi ke `runReconciliationAdaptive`), bukan impor langsung.
- Konsumen lintas-paket WAJIB lewat barrel `@lakoku/*` (atau `/server`), bukan
  deep-import ke file internal paket lain (mis. `@/lib/narrative/threads`).
- Impor INTERNAL dalam satu paket tetap pakai path relatif (`./threads`).

## Bukti penegakan

Probe pelanggaran (impor `@lakoku/runtime` dari dalam `narrative-core`) terdeteksi
sebagai error lint — dijalankan saat M0 lalu dihapus. Untuk mengulang: buat file
sementara di `lib/narrative/` yang mengimpor `@lakoku/ai-gateway`, jalankan
`npx eslint <file>`, harus muncul pesan "Boundary".

## Kenapa belum pindah fisik ke `packages/*`

- Manfaat arsitektural §5.1 (kepemilikan & arah dependensi) sudah 100% didapat
  via alias + lint, tanpa risiko memutus preview/HMR.
- Pindah fisik + workspace baru bernilai saat butuh: build/test/publish paket
  terpisah, atau menambah `apps/android` / `apps/api` (Worker) yang berdiri sendiri.
- Saat itu tiba: tiap `lib/<x>/index.ts` menjadi entry `package.json` paket, dan
  alias `@lakoku/*` dipetakan ulang ke `packages/<x>` — kode konsumen tak berubah.
