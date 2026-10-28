# Gates: Catalog Plan 2 — novel generator (deferred choices + fork 3 ending)

OWNS: lib/catalog/generator.server.ts, lib/catalog/generator-db.server.ts, lib/catalog/catalog-contract.ts, lib/ai-gateway/provider.ts, lib/ai-gateway/gateway-provider.ts, scripts/catalog-generate.ts, scripts/catalog-plan2-*, tests/catalog/catalog-generator*.test.ts, tests/catalog/catalog-contract*.test.ts, app/admin/katalog/[id]/page.tsx, package.json, docs/superpowers/plans/2026-10-29-catalog-plan-2-generator.md

Scope: Script operator `pnpm catalog:generate` membuat draf novel katalog (kontrak + canon), menulis Bab 1–44 dengan pilihan tertunda ke DB, fork Bab 45–50 untuk 3 varian ending, bisa resume dan regenerate satu bab, dan mengakhiri dengan status `review`.

- [x] G1: pintu masuk generator, kontrak katalog, dan penanda admin terpasang konsisten
  CHECK: node scripts/catalog-plan2-verify.mjs static
  EXPECT: CATALOG_PLAN2_STATIC_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=0c6749f1dbc6/73 entries; EXPECT=matched; output-sha256=2dae9ba9478ad729a6d4f357c628d17cced08174af4219617e12bde7468af5c5; output-bytes=24

- [x] G2: seluruh proyek lolos pemeriksaan tipe TypeScript
  CHECK: node scripts/catalog-plan2-verify.mjs typecheck
  EXPECT: CATALOG_PLAN2_TYPECHECK_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=0c6749f1dbc6/73 entries; EXPECT=matched; output-sha256=347fbd9ddff4b3cd0444c3cef9b8cdd4c3b9e3d4d07635c9db9866844735d5e6; output-bytes=27

- [x] G3: file Plan 2 lolos ESLint tanpa error
  CHECK: node scripts/catalog-plan2-verify.mjs lint
  EXPECT: CATALOG_PLAN2_LINT_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=0c6749f1dbc6/73 entries; EXPECT=matched; output-sha256=a3be76923844e0440d23f7980a4e5b4e1f8ccf15c83ccd68c0c8bd1863b0249f; output-bytes=22

- [x] G4: engine generator teruji: brief tanpa pilihan pembaca, Bab 44 memaksa 3 pilihan ending, reaksi lolos batas kata, fork 3 varian, Bab 50 tanpa pilihan, resume, dan regenerate
  CHECK: node scripts/catalog-plan2-verify.mjs unit
  EXPECT: CATALOG_PLAN2_UNIT_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=0c6749f1dbc6/73 entries; EXPECT=matched; output-sha256=d6fb76e6d84c7640788f09431f12266dd2ef61cbfb5e1220c281aca816bd0f7e; output-bytes=525

- [x] G5: alur DB nyata dari draf sampai review berjalan end-to-end di Postgres lokal tanpa biaya inferensi
  CHECK: node scripts/catalog-plan2-verify.mjs live
  EXPECT: CATALOG_PLAN2_LIVE_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=0c6749f1dbc6/73 entries; EXPECT=matched; output-sha256=4d10271225990a2dfe17c91a042394f365737969f34b241c87f5377e2247ad53; output-bytes=192

- [x] G6: tombol "Salin perintah" pada detail admin menyalin perintah generator
  EVIDENCE: Reticle verified=yes 2026-10-28 pada localhost:3000 (lease tab terfokus, admin plan3-admin@local.test): tombol "Salin perintah" hadir pada detail /admin/katalog/catalog:bayang-tak-bertuan dan klik memunculkan label "Tersalin". Percobaan pertama di tab latar belakang gagal karena Chrome menolak clipboard tanpa dokumen fokus, sehingga ditambahkan fallback document.execCommand yang terbukti sukses.
