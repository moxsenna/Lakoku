# Catalog Plan 2 — Novel Generator (deferred choices + fork 3 ending)

**Status:** Implemented & verified locally 2026-10-29. Belum ada novel nyata yang digenerate — run pertama butuh otorisasi biaya PM (plafon E0 $200/novel).

**Goal:** Script operator `pnpm catalog:generate` membuat draf novel katalog lengkap (kontrak + canon + 62 unit bab) yang berakhir di status `review`, siap untuk QC di `/admin/katalog` (Plan 3) lalu terbit manual.

**Depends on:** Catalog Plan 1 (reader foundation) dan Plan 3 (admin QC/publish), sudah di `main`.

## Perintah

```bash
# 1) Buat draf (kontrak dari mesin authoring, fallback template deterministik)
pnpm catalog:generate --create --story=catalog:{slug} \
  --title="Judul" --tagline="..." --synopsis="..." \
  --protagonist="Raka" --genre=misteri --tropes="Rahasia Keluarga,Kebangkitan Diri"

# 2) Generate / resume (aman dijalankan ulang kapan pun)
pnpm catalog:generate --story=catalog:{slug} --chapters=50

# 3) Tulis ulang satu bab spine (menghapus status tinjauannya)
pn catalog:generate --story=catalog:{slug} --regenerate=12
```

Syarat keamanan (fail-closed):

- `CATALOG_GENERATE_DB=1` + `DATABASE_URL` — script ini menulis DB; host non-lokal dicetak sebagai peringatan.
- Provider gateway (9Router VPS terkualifikasi dari authority M10-G) butuh `CATALOG_GENERATE_AUTHORIZED=1` — satu novel ≈ 120+ panggilan model.
- `--provider=deterministic` (prosa template, tanpa biaya) hanya untuk gate/verifikasi dan wajib `LAKOKU_ALLOW_DETERMINISTIC_PROVIDER=1`.

## Arsitektur

```text
lib/ai-gateway/provider.ts            # tipe CatalogReactionsProviderInput + metode provider opsional
                                      #   generateCatalogReactions + implementasi deterministic
lib/ai-gateway/gateway-provider.ts    # generateCatalogReactionsJson: panggilan LLM di jalur choices
                                      #   (chain, timeout, telemetry, slot konkurensi — pola generateChoiceJson)
lib/catalog/catalog-contract.ts       # assertCatalogStoryId / normalizeCatalogEndings (tepat 2 main + 1 secret)
lib/catalog/generator.server.ts       # engine murni: brief deferred, Bab 44 forced choices,
                                      #   reaksi tervalidasi, fork varian, resume, regenerate
lib/catalog/generator-db.server.ts    # createCatalogDraft + writer DB (chapters, choice_outcomes,
                                      #   catalog_ending_chapters, progres/status, canon bootstrap)
scripts/catalog-generate.ts           # CLI (parsing argumen, guard, provider routes)
scripts/catalog-plan2-verify.mjs      # oracle runner gate (static/typecheck/lint/unit/live)
scripts/catalog-plan2-live-check.ts   # uji DB nyata end-to-end tanpa biaya di Postgres lokal
```

### Mode pilihan tertunda (§6.3 spec)

- Brief Bab N+1 dibangun dengan `previousChoice: null` dan reader state kosong — badan bab tidak pernah mengasumsikan pilihan pembaca. Dampak pilihan hidup di reaksi + `effect_json`, bukan di badan bab.
- Tiap pilihan mendapat **reaksi kuat** dari panggilan `generateCatalogReactions` (1–2 paragraf, target 60–150 kata, ditolak < 40 kata; kata internal/`rute` ditolak; `directionHint` dibuang bila tidak aman lewat `sanitizeDirectionHint`).
- `directionHint` hanya dipasang saat `|endingBiasDeltas| ≥ 5`.
- **Bab 44 deterministik:** tiga pilihan dibangun dari 3 kandidat ending (label dari `condition`/`name` kandidat, brand-guarded), masing-masing `endingBiasDeltas: {[key]: 10}`, `next_chapter_number = 45` — menjamin ketiga ending terjangkau pembaca tanpa bergantung pada kehendak LLM.
- Bab 45–49 per varian memakai brief dengan `lockedEndingKey` varian; Bab 50 tanpa pilihan (`outcomes_json: []`).

### Kontrak & canon

- `createCatalogDraft` memakai `createResilientStoryContract` (LLM → repair → **template fallback deterministik**), lalu `normalizeCatalogEndings` memangkas kandidat ke tepat 2 main + 1 secret.
- Canon produksi disemai lewat `contractToCanonBootstrap` (karakter, alias, voice sheet, fakta, knowledge, rahasia, thread, 50 blueprint) sehingga engine memakai `loadCanonSnapshot` yang sama dengan jalur generasi personal.
- `stories` baru: `status 'BARU'`, `visibility 'private'`, `story_mode 'catalog'`, `owner_user_id null`. Selesai generate: `stories.status 'SELESAI'`, `current_chapter 50`, `catalog_stories.status 'review'`, `generation_progress 50`.

### Resume & regenerate

- Resume membaca ulang bab yang sudah ada dari DB (spine + per varian) dan melanjutkan dari bab berikutnya; menjalankan ulang perintah yang sama tidak pernah menulis duplikat (upsert per bab).
- `--regenerate=N` (1–44) menghapus bab N + `choice_outcomes` + baris `catalog_chapter_reviews` (QC kembali "belum ditinjau"), lalu menulis ulang dengan konteks bab N−1 dari DB. Ditolak saat novel `published`/`archived`.

## Verifikasi (GATES.catalog-plan-2.md — ALL MET 6/6)

- **Static:** pintu masuk CLI + guard, metode provider baru, engine, writer DB, tombol admin, script npm, unique migration check.
- **Typecheck** penuh; **lint** bersih atas semua file Plan 2.
- **Unit (14 test):** continuation tanpa `previousChoice`, normalisasi ending (4→3, tolak tanpa secret), validator reaksi (floor 40 kata, tolak hilang/asin, buang hint `rute`), run penuh 44+18 dengan provider deterministik (Bab 44 bias 10 + hint, Bab 50 kosong, progres → 50, markReview), resume dari bab 4, cap `--chapters=5`, guard novel tak dikenal/tertutup, regenerate menghapus lalu menulis ulang.
- **Live (Postgres lokal, tanpa biaya):** draf → 62 unit tersimpan, outcome tiap bab = jumlah pilihannya (≥2, Bab 44 = 3), semua reaksi ≥ 40 kata, hint bebas istilah internal, 3 varian × 6 bab, review tiruan dihapus oleh regenerate, resume tanpa tulis ulang, `canPublish` admin masih false (menunggu QC), fixture dibersihkan.
- **Browser (Reticle):** tombol "Salin perintah" pada detail admin memunculkan "Tersalin" di tab terfokus (tab latar belakang ditolak Chrome — ditambah fallback `document.execCommand`).

## Yang belum (butuh keputusan PM)

1. **Run novel nyata pertama** di VPS dengan provider 9Router (otorisasi biaya E0 per novel), dibaca admin end-to-end sebelum terbit pertama (spec §8).
2. **Form admin "Buat draf"** (§6.1) — untuk saat ini draf dibuat lewat CLI; tombol "Salin perintah" di dashboard menghasilkan perintah yang siap dijalankan operator.
3. Fase 2 spec (worker terpisah agar admin cukup klik) sengaja di luar scope.
