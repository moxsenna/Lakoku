# Gates: Catalog Plan 3 — admin QC & publish dashboard

OWNS: app/admin/katalog/**, app/api/admin/catalog/**, lib/catalog/admin.server.ts, lib/catalog/admin-http.server.ts, lib/credits/access-resolver.server.ts, lib/supabase/db-types.ts, components/admin/admin-sidebar.tsx, neon/migrations/20261028120000_catalog_admin_review.sql, tests/catalog/**, scripts/catalog-plan3-*, docs/superpowers/plans/2026-10-28-catalog-plan-3-admin-qc.md

Scope: Admin bisa meninjau tiap bab katalog, mengedit teks, menyetujui seluruh unit, menerbitkan novel ke Beranda, dan menariknya tanpa mencabut akses pembeli lama.

- [x] G1: jalur admin, migrasi review, dan tipe DB terpasang konsisten
  CHECK: node scripts/catalog-plan3-verify.mjs static
  EXPECT: CATALOG_PLAN3_STATIC_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=0c6749f1dbc6/73 entries; EXPECT=matched; output-sha256=fb7591039ed01202f27ddcb09cdff831c7db896939117343decdcdaf7843394c; output-bytes=24

- [x] G2: seluruh proyek lolos pemeriksaan tipe TypeScript
  CHECK: node scripts/catalog-plan3-verify.mjs typecheck
  EXPECT: CATALOG_PLAN3_TYPECHECK_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=0c6749f1dbc6/73 entries; EXPECT=matched; output-sha256=d1edd615eabe118cc40ef6f6f9dda2d3c13048d38c5854b7d56b2a6baf6c7d14; output-bytes=27

- [x] G3: file Plan 3 lolos ESLint tanpa error
  CHECK: node scripts/catalog-plan3-verify.mjs lint
  EXPECT: CATALOG_PLAN3_LINT_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=0c6749f1dbc6/73 entries; EXPECT=matched; output-sha256=f8fcb48003984bf0451451bf5134c18005ac1d1c3dae932ce73a4bd2f54c8fae; output-bytes=22

- [x] G4: unit dan route test Plan 3 beserta regresi akses katalog lulus
  CHECK: node scripts/catalog-plan3-verify.mjs unit
  EXPECT: CATALOG_PLAN3_UNIT_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=0c6749f1dbc6/73 entries; EXPECT=matched; output-sha256=332dcf64242db1547b1742b6eb39e2c9624a6a5620914693a939ccc3e12dbbc3; output-bytes=1215

- [x] G5: alur DB nyata menolak terbit sebelum semua unit disetujui, lalu menerbitkan dan menarik tanpa mencabut akses pembeli
  CHECK: node scripts/catalog-plan3-verify.mjs live
  EXPECT: CATALOG_PLAN3_LIVE_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=0c6749f1dbc6/73 entries; EXPECT=matched; output-sha256=a83ce882f5ee6b1a227a6022ba90e78ab7277456c0e6e3782ed96b43db87a23f; output-bytes=625

- [x] G6: alur admin di browser memuat daftar, membuka detail, menyetujui bab, menerbitkan, dan menarik novel
  EVIDENCE: Reticle verified=yes 2026-10-28 di localhost:3000 + DB lokal 55432: daftar "Novel Katalog" memuat "Bayang Tak Bertuan" status "Menunggu QC" dan "Disetujui 0/62"; detail terbuka "Disetujui 0/62"; "Baca teks" menampilkan paragraf hasil suntingan; "Setujui" menaikkan ke "Disetujui 1/62"/"61 belum ditinjau"; "Terbitkan" state=disabled; setelah 61 unit disetujui lewat jalur server yang sama, "Muat ulang" menunjukkan "Disetujui 62/62" dan "Terbitkan" enabled; klik "Terbitkan" memunculkan notice terbit dan label "Terbitkan ulang"; /jelajah memuat "Bayang Tak Bertuan"; "Tarik" lalu "Yakin tarik novel" memunculkan notice "Novel ditarik dari Beranda." dan "Status Ditarik"; DB status=archived dengan visibility=public; /jelajah tidak lagi memuat judul itu.
