# Gates: KBM Viral & Modern Mobile Prose Optimization

OWNS: lib/prose/genre-flavor.ts, lib/prose/mobile-drama-style.ts, lib/prose/prompt-engine/**, lib/story-engine/story-contract.ts, lib/catalog/generator.server.ts, tests/prose/**, scripts/kbm-prose-*

Scope: Optimasi prose writer untuk semua genre (Opsi 2): penambahan style profile `kbm_viral_v1` untuk katalog/drama viral, pembaruan `lakoku_mobile_drama_v2` untuk genre lain (in medias res, anti pembuka cuaca/lambat, dialog aktif), serta pengayaan direktif sensorik & hook detik-0 pada 6 genre di `genre-flavor.ts`.

- [x] G1: direktif 6 genre dan profile kbm_viral_v1 terpasang konsisten tanpa instruksi perlambat tempo
  CHECK: node scripts/kbm-prose-verify.mjs static
  EXPECT: KBM_PROSE_STATIC_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=0c6749f1dbc6/73 entries; EXPECT=matched; output-sha256=ee891efe20a52aa2cdf7e513cef545612f49b14901b71c73c8af849c13c31191; output-bytes=20

- [x] G2: seluruh proyek lolos pemeriksaan tipe TypeScript
  CHECK: node scripts/kbm-prose-verify.mjs typecheck
  EXPECT: KBM_PROSE_TYPECHECK_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=0c6749f1dbc6/73 entries; EXPECT=matched; output-sha256=e62bed1d5b566c4d9f1d339997925b59de2398d05799b2c37bd2c24c01003ed8; output-bytes=23

- [x] G3: seluruh file yang diubah lolos ESLint tanpa error
  CHECK: node scripts/kbm-prose-verify.mjs lint
  EXPECT: KBM_PROSE_LINT_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=0c6749f1dbc6/73 entries; EXPECT=matched; output-sha256=36af3d1153dd7a4e8cd37edf5af2d85e4c260368ac237c1362f85163f84888fd; output-bytes=18

- [x] G4: unit test memvalidasi konstruksi prompt untuk 6 genre dan 2 style profile (in medias res, kuota dialog, larangan cuaca pembuka)
  CHECK: node scripts/kbm-prose-verify.mjs unit
  EXPECT: KBM_PROSE_UNIT_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=0c6749f1dbc6/73 entries; EXPECT=matched; output-sha256=aff2648c44cacad465782dc453452571dcbbd234127a83d2e0ed1f26a6be8163; output-bytes=520

- [x] G5: verifikasi integrasi generator katalog menggunakan kbm_viral_v1 dan genre terhubung
  CHECK: node scripts/kbm-prose-verify.mjs integration
  EXPECT: KBM_PROSE_INTEGRATION_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=0c6749f1dbc6/73 entries; EXPECT=matched; output-sha256=6144cdb083a81f1895e92af6e2730b184238e55a45a2ec74829502d8b3cf06ff; output-bytes=528
