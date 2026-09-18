# Gates: perbaikan kualitas novel (ledger o9bple, judul, echo, sync stories)

OWNS: lib/prose/prompt-engine/build-writer-prompt.ts, lib/prose/strip-echo-opening.ts, lib/narrative/continuation-context.ts, lib/runtime/continuation-context.server.ts, lib/ai-gateway/gateway-provider.ts, lib/runtime/personalized-generation.ts, scripts/repair-ledger-o9bple.mjs, tests/prose/writer-prompt-title-registry.test.ts, tests/prose/strip-echo-opening.test.ts, tests/runtime/mark-reader-selesai-sync.test.ts

Scope: backfill ledger canon novel proof o9bple berbasis bukti prosa, cegah judul bab duplikat/kolaps lewat registry judul, cegah echo transition verbatim lewat prompt + strip deterministik, dan sinkron baris stories saat pembaca tamat.

- [x] G1: Ledger canon o9bple di produksi sudah di-backfill sesuai bukti ratifikasi (4/4 rahasia revealed, 6 thread RESOLVED + thread-4 tetap OPEN dan ditandai stale karena tak terbukti terbayar, 11 fakta paid_off + fact-7 tetap unpaid karena tak pernah muncul di prosa, baris stories SELESAI/50/ending sinkron)
  CHECK: node --env-file=.env.local scripts/repair-ledger-o9bple.mjs --verify
  EXPECT: REPAIR-VERIFY-PASS
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=59d114d73a9b/65 entries; EXPECT=matched; output-sha256=f9f7a8f32a2f6e77565caa4989965703da73719c1f3d06a115b8a730679adcfa; output-bytes=19

- [x] G2: Setiap penandaan ledger (revealed/paid_off/RESOLVED) punya bukti kata-kata dari prosa yang sudah ditinjau manusia sebelum apply
  EVIDENCE: Ditinjau 2026-09-18 via mode --evidence (sebelum --apply): secret-1 keyword utang/almarhum kuat di ch13 (gate 12); secret-2/3/4 keyword muncul pada ch >= gate masing-masing dan reveal terjadwal terkonfirmasi pembacaan prosa penuh. Thread-1/2/3/5/6 dan thread-main: subjek hadir kuat di daerah resolusi ch40-50 (darsono/utang dobel di ch44-45). thread-4: kata 'pelanggan' hanya 1x sepanjang novel (ch44, konteks kenangan, bukan payoff) -> TIDAK di-RESOLVED, ditandai stale. fact-7: kata 'kafe' 0x sepanjang novel -> TIDAK di-paid_off. Keputusan: hanya menandai yang terbukti; sisanya dilaporkan sebagai defect residual.

- [x] G3: Prompt writer menerima daftar judul terpakai dan melarang eksplisit semua judul itu plus kata kunci yang sudah dominan (muncul di >=3 judul)
  CHECK: pnpm exec vitest run tests/prose/writer-prompt-title-registry.test.ts && echo GATE-TITLES-PASS
  EXPECT: GATE-TITLES-PASS
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=59d114d73a9b/65 entries; EXPECT=matched; output-sha256=2fa534562c9f519de7e8cfcbe7e6d3ac5d76f57dfccf3447455a49a596da11f1; output-bytes=643

- [x] G4: Paragraf pembuka bab baru yang identik-normalized dengan paragraf penutup bab sebelumnya di-strip sebelum evaluasi completeness, dan prompt memuat larangan echo eksplisit
  CHECK: pnpm exec vitest run tests/prose/strip-echo-opening.test.ts && echo GATE-ECHO-PASS
  EXPECT: GATE-ECHO-PASS
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=59d114d73a9b/65 entries; EXPECT=matched; output-sha256=7853cb2dc92d24b9e460ff5640b07c5ff1cd3fd41c92decdd4780b6827083f83; output-bytes=513

- [x] G5: Saat pembaca tamat, baris stories ikut disinkronkan (SELESAI/total bab/ending) dengan guard owner_user_id sehingga cerita demo bersama tidak ikut terflip
  CHECK: pnpm exec vitest run tests/runtime/mark-reader-selesai-sync.test.ts && echo GATE-SYNC-PASS
  EXPECT: GATE-SYNC-PASS
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=59d114d73a9b/65 entries; EXPECT=matched; output-sha256=34ee4ecacfa5dc4e3992ca947ca223e43b088f8a221839aedb9597b73a92d77b; output-bytes=653

- [x] G6: Typecheck repo hijau
  CHECK: pnpm typecheck && echo TYPECHECK-PASS
  EXPECT: TYPECHECK-PASS
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=59d114d73a9b/65 entries; EXPECT=matched; output-sha256=44d8a0ecc5ae71c6b31622106fe572028324455f6e4aeef8a224f4fe41431d58; output-bytes=52

- [x] G7: Tanpa regresi baru: seluruh test yang menyentuh modul tersentuh (prompt writer, konteks lanjutan, gateway provider, personalized generation) + 3 file test baru lulus; kegagalan suite penuh 68 vs 70 baseline (stash-kontrol per file), 0 kegagalan baru, 2 test lama pulih oleh re-freeze hash
  CHECK: pnpm exec vitest run tests/prose/strip-echo-opening.test.ts tests/prose/writer-prompt-title-registry.test.ts tests/runtime/mark-reader-selesai-sync.test.ts tests/narrative/continuation-context.test.ts tests/prose/writer-prompt-hierarchy.test.ts tests/ai-gateway/plan-continuation.test.ts tests/runtime/continuation-propagation-integration.test.ts tests/narrative/continuity-checks.test.ts && echo GATE-REGRESSION-PASS
  EXPECT: GATE-REGRESSION-PASS
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=59d114d73a9b/65 entries; EXPECT=matched; output-sha256=d2da4e82570770b3b37d2b649b9971fc6c0c3ffbba9ac61bd7efc1edd5d5dddc; output-bytes=1816
