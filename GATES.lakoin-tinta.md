# Gates: Lakoin-Tinta Economy P1-P12 (spec docs/superpowers/plans/2026-09-19-lakoin-tinta-economy.md)

OWNS: lib/tinta/**, tests/tinta/**, components/tinta/**, app/(shell)/profil/tinta/**, supabase/migrations/20260919*, app/api/stories/[id]/visibility/**, app/api/admin/settings/tinta-policy/**, scripts/tinta-economy-smoke.ts

Scope: Ekonomi 3 lapis Lakoin (rename display Kredit) + Tinta (ledger, misi, reward penulis cerita publik, tukar) + toggle publik/privat + rail etalase terpisah + admin policy + analytics + smoke, sesuai spec 2ebde3e dengan amandemen PM (etalase rail TERPISAH, bukan merge).

Catatan lingkungan: `pnpm lint` penuh gagal karena 52 error pre-existing dari stream android (tests/paycore, tests/rewards) — gate lint selalu ter-scope ke direktori stream ini. `pnpm test` penuh memiliki 70 kegagalan pre-existing — suite penuh bukan gate; G13 memakai scope terarah.

- [x] G1: Migration SQL tinta_ledger + tinta_policy + 4 RPC lolos test konten dan versi migration unik
  CHECK: pnpm exec vitest run tests/tinta/migration.test.ts && pnpm run check:migration-versions && echo GATE1_OK
  EXPECT: GATE1_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=59d114d73a9b/65 entries; EXPECT=matched; output-sha256=fe588c94d37d4e0eee2bcd373aa3e220ffcb9b7c3d8069fae78d37461fbd36d3; output-bytes=573

- [x] G2: Domain murni TintaPolicy + kalkulator tukar lolos unit test dan typecheck
  CHECK: pnpm exec vitest run tests/tinta/policy.test.ts && pnpm run typecheck && echo GATE2_OK
  EXPECT: GATE2_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=59d114d73a9b/65 entries; EXPECT=matched; output-sha256=8f8489140f42ce81e72b65d86f671a5b59f8fcae85171c80e775d50203e89dc2; output-bytes=532

- [x] G3: Server seam dompet Tinta (policy/balance/exchange/rollback) lolos unit test, typecheck, lint ter-scope
  CHECK: pnpm exec vitest run tests/tinta/server.test.ts && pnpm run typecheck && npx eslint lib/tinta tests/tinta && echo GATE3_OK
  EXPECT: GATE3_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=59d114d73a9b/65 entries; EXPECT=matched; output-sha256=e76f9757c04fbc504e11e8e0e52cab2ea366a7ae023d87a331616329eca1557d; output-bytes=534

- [x] G4: Hook reward penulis non-fatal terpasang di route pilihan, lolos unit test dan typecheck
  CHECK: pnpm exec vitest run tests/tinta/author-reward.test.ts && pnpm run typecheck && echo GATE4_OK
  EXPECT: GATE4_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=59d114d73a9b/65 entries; EXPECT=matched; output-sha256=92a9b837c634019ae6eff550926b24668d084595a25d5f399654758a78d920dc; output-bytes=541

- [x] G5: Migrasi misi ke Tinta reversibel (currency mapping) lolos unit test dan typecheck
  CHECK: pnpm exec vitest run tests/tinta/missions.test.ts && pnpm run typecheck && echo GATE5_OK
  EXPECT: GATE5_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=59d114d73a9b/65 entries; EXPECT=matched; output-sha256=08ec6babb9844ac39e92cd00e8bd5982a3309dfcb2e6f714a55a6cc62edae207; output-bytes=536

- [x] G6: Dompet Tinta + dialog tukar ter-compile bersih (typecheck + lint ter-scope)
  CHECK: pnpm run typecheck && npx eslint components/tinta "app/(shell)/profil/tinta" && echo GATE6_OK
  EXPECT: GATE6_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=59d114d73a9b/65 entries; EXPECT=matched; output-sha256=a7c9f7bce1b887e670a20a6c2e3037054b63042cde4f6ec9f15fb81d8b962c8d; output-bytes=46

- [ ] G6-M: Navigasi /profil -> /profil/tinta -> tukar bekerja (verifikasi staging saat deploy)
  EVIDENCE: pending

- [x] G7: Rename display Kredit -> Lakoin lolos typecheck dan web-release smoke
  CHECK: pnpm run typecheck && pnpm run smoke:web-release && echo GATE7_OK
  EXPECT: GATE7_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=59d114d73a9b/65 entries; EXPECT=matched; output-sha256=3fd7506c424f9d00f5bd4076732b4c01a38a4f9c54e8e64456239dc34fdc484d; output-bytes=590

- [x] G7-M: Grep audit AC7.3 (nol string literal "kredit" yang tampil ke pembaca) ditempel di laporan
  EVIDENCE: P7 report (.sdd-scratch/lakoin-tinta/task-P7-report.md) — grep akhir 37 hit, semua identifier/URL/komentar dev/admin (6 URL /kredit, 4 identifier, 9 komentar dev, 1 dokumen dev, 17 antarmuka admin), 0 string literal pembaca. Diverifikasi reviewer P7 + scanner otomatis smoke AC12.5 (smoke:tinta 44/44).

- [x] G8: Toggle publik/privat (kontrak + route + seam) lolos unit test, contracts smoke, typecheck
  CHECK: pnpm exec vitest run tests/tinta/visibility.test.ts && pnpm run smoke:contracts && pnpm run typecheck && echo GATE8_OK
  EXPECT: GATE8_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=59d114d73a9b/65 entries; EXPECT=matched; output-sha256=9cd55d55375c2879f1864b63124549cf85c9c4363dda89dca6f533ed94074152; output-bytes=1324

- [x] G9: Etalase rail terpisah cerita publik user (query + dedupe + filter prefix) lolos unit test dan typecheck
  CHECK: pnpm exec vitest run tests/tinta/explore.test.ts && pnpm run typecheck && echo GATE9_OK
  EXPECT: GATE9_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=59d114d73a9b/65 entries; EXPECT=matched; output-sha256=4f5b5c578f26a393c5119724e49a1d4e43f2924d6852ea0f96aa2eed062e0497; output-bytes=535

- [x] G10: Admin tinta_policy (schema 11 knob + audit) lolos unit test dan typecheck
  CHECK: pnpm exec vitest run tests/tinta/admin-policy.test.ts && pnpm run typecheck && echo GATE10_OK
  EXPECT: GATE10_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=59d114d73a9b/65 entries; EXPECT=matched; output-sha256=58648568e8f5617e1b4058fbd8c71fb9756816e580f8976d5c32f7e1a6eeea66; output-bytes=541

- [x] G11: 4 event analytics + payload lolos schema, analytics smoke hijau
  CHECK: pnpm run smoke:analytics && pnpm exec vitest run tests/tinta/analytics.test.ts && pnpm run typecheck && echo GATE11_OK
  EXPECT: GATE11_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=59d114d73a9b/65 entries; EXPECT=matched; output-sha256=8d4bb22f0a6f42eff6fa39699373664573a77c9bc7f763149f6881ccff587399; output-bytes=4672

- [x] G12: Smoke ekonomi Tinta (statik SQL + logika murni, pola smoke-rewards) exit 0
  CHECK: pnpm run smoke:tinta && echo GATE12_OK
  EXPECT: GATE12_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=59d114d73a9b/65 entries; EXPECT=matched; output-sha256=466e831b2497c9691b874d21172e565e599790f419a0ad87f39ac81a77e6f935; output-bytes=3084

- [ ] G12-M: Verifikasi RPC live (claim/dedupe/cap/tukar) di DB staging saat deploy — Docker lokal tidak berjalan sehingga pgTAP/live tidak bisa dijalankan di mesin ini
  EVIDENCE: pending

- [x] G13: Closeout — typecheck + migration check + seluruh unit tests stream tinta & analytics hijau
  CHECK: pnpm run typecheck && pnpm run check:migration-versions && pnpm exec vitest run tests/tinta tests/analytics && echo GATE13_OK
  EXPECT: GATE13_OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=59d114d73a9b/65 entries; EXPECT=matched; output-sha256=8d3168935be9482269883ffc85acf6d6c2effb90dc36c6e21e8a08a53babab73; output-bytes=4876
