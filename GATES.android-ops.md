# Gates: Android ops rollout — migrasi DB, env VPS, katalog android

OWNS: scripts/android/**, GATES.android-ops.md

Scope: Mendorong migration Play Billing ke Supabase produksi, menyiapkan
placeholder env Play Billing di VPS (inert sampai service account siap),
dan seed katalog kredit kanal android (mirror web, nonaktif sampai SKU
Play terdaftar). Otorisasi: instruksi user eksplisit 2026-09-18
("migrasikan DB", "tambah ke env vps", "tambah katalog android") —
mengesampingkan boundary no-DB-write pada ledger build.

Boundary: Tanpa commit/push git. Tanpa restart service VPS (placeholder
commented = nol efek runtime). Tanpa nilai secret nyata (service account
masih G9 — belum ada).

Kontrol negatif tercatat: sebelum migrasi, query kolom channel gagal
("column credit_products.channel does not exist") — bukti CHECK P3/P5
mengukur objek yang benar, bukan sukses vakum.

- [x] P0: ledger ini bisa di-lint dan mencantumkan outcome yang dapat gagal
  CHECK: node "C:\Users\bimap\.agents\skills\unlazy\scripts\gate-lint.mjs" GATES.android-ops.md
  EXPECT: LINT OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=42de0b2d48a0afc851d59f6cd70d1a787c779771ae9a61243e3144c564c57d34; output-bytes=385

- [x] P1: dry-run push hanya berisi 2 migrasi yang dikenal (referral + play billing)
  CHECK: pnpm exec supabase db push --linked --dry-run
  EXPECT: 20260917120000_play_billing_channel_model.sql
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=9ee4eb0c1469163bd8b0e3a2f76d635ca09cf2bb61cb9b9cb81f89bc996c3aac; output-bytes=474

- [x] P2: migrasi tercatat applied di histori remote (scope sesuai keputusan owner P-decide)
  CHECK: pnpm exec supabase migration list --linked
  EXPECT: 20260917120000 | 20260917120000
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=0b762792b7cc8ecb56970f86d8697835d7d3d8476b473fb51b7219835726b3c4; output-bytes=5370

- [x] P3: kolom channel/play_sku hidup di produksi (query service_role berhasil)
  CHECK: node scripts/android/read-catalog.mjs android
  EXPECT: catalog read passed
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=2eed0f20f777711a9aae1d479769e09e70362af1e8f8f306c86c6ba36a7047c2; output-bytes=1803

- [x] P4: placeholder env Play Billing ada di .env VPS (backup dulu, tanpa restart)
  CHECK: python D:\Coding\deploy-kit\scripts\shared-vps-exec.py "grep -E '^#? ?GOOGLE_PLAY_' /home/ubuntu/mox-apps/lakoku/.env"
  EXPECT: GOOGLE_PLAY_BILLING_ENABLED
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=d7acd04c05fa1982f9cf8bad0643f65fe008b70eae9a54289e39627559349dc7; output-bytes=138

- [x] P5: katalog android terseed mirror web (6 baris, nonaktif, play_sku terisi unik)
  CHECK: node scripts/android/verify-android-catalog.mjs
  EXPECT: android catalog verification passed
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=8af826e23fd682dce0305c759d467b052922a0428e5aa9f3b2cd9c48203f5e85; output-bytes=77

- [ ] P6: manual review - aktifkan katalog + isi service account setelah SKU Play terdaftar (butuh G9 Play Console, tidak dapat dilakukan dari sesi ini)
  EVIDENCE: pending
