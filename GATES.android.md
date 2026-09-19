# Gates: Android client (Capacitor) — fase 1–5

OWNS: android/**, capacitor.config.ts, lib/paycore/**, lib/credits/**, lib/entitlement/**, supabase/migrations/**, app/api/play-billing/**, components/**, app/(shell)/**

Scope: Klien Android (Capacitor) yang menunjuk web produksi, auth Supabase native via deep link, Play Billing sebagai kanal pembayaran Android dengan katalog kredit per-kanal dari DB, verifikasi server-side, dan grant idempotent ke ledger yang sama dengan web.

Boundary: Tidak ada deploy/push/commit. Publish Play Store + purchase asli = butuh akses akun Google user (manual gate).

- [x] G0: ledger ini bisa di-lint dan mencantumkan outcome yang dapat gagal
  CHECK: node "C:\Users\bimap\.agents\skills\unlazy\scripts\gate-lint.mjs" GATES.android.md
  EXPECT: LINT OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=e76b55afb67806a6ae7e01ba22ec98a9ac572e9d60ffe2d80c1f3164a3227bb3; output-bytes=487

- [x] G1: proyek Android Capacitor ada dan config menunjuk server produksi
  CHECK: node scripts/android/cap-shell-check.mjs
  EXPECT: android shell verification passed
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=d032cd83702c0c69a8c4cbb121c8b074dcb4d22662c83abcd7284681ac79f9e1; output-bytes=446

- [x] G2: auth native Android tersedia di web app (tabel sessions + endpoint POST /api/auth/android + deep link terdaftar)
  CHECK: node scripts/android/auth-wiring-check.mjs
  EXPECT: android auth wiring verification passed
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=b0f09d49a36d1332accb96c7f05f9f624d096f3c30dcc6cdad5ee7e1917e6f6f; output-bytes=444

- [x] G3: katalog kredit mendukung konfigurasi per-kanal dari DB (kolom channel + default web, Android hanya baca baris android)
  CHECK: node scripts/android/channel-catalog-check.mjs
  EXPECT: channel catalog verification passed
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=ff443817e2469be106065f10e4218e892110c974b90aee5e9f0175186c205459; output-bytes=693

- [x] G4: verifikasi pembelian Play Billing server-side idempoten (signature/vendor check + grant via ledger yang sama, replay ditolak)
  CHECK: node scripts/android/play-billing-check.mjs
  EXPECT: play billing verification passed
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=38ce784a1e68d7ba481164a3ca43c2f0a1e8e488ae81dfa9eca93bd2a6990b19; output-bytes=733

- [x] G5: build Android debug lulus (APK dihasilkan, exit 0)
  CHECK: cmd /c "set JAVA_HOME=%USERPROFILE%\.jdks\jdk-21.0.12.1+1&& set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk&& gradlew.bat assembleDebug --console=plain && echo ANDROID BUILD PASSED"
  EXPECT: ANDROID BUILD PASSED
  CWD: android
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2\android; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=c7d1fe07ef365ae76fb75a0af1d9ad57c4314e619a3691c8037508f1ebb8c898; output-bytes=13485

- [x] G6: typecheck proyek tetap hijau (tidak ada regresi web)
  CHECK: cmd /c "pnpm typecheck && echo TYPECHECK PASSED"
  EXPECT: TYPECHECK PASSED
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=7c6421916e56cb77b9bc10e4d9aa99229c1e5187e7e84df4416890f70fb67019; output-bytes=54

- [x] G7: checkout web tidak berubah perilaku (webhook + create tetap kanal web)
  CHECK: node scripts/android/web-paycore-regression-check.mjs
  EXPECT: web paycore regression verification passed
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=6bdc5cdfab3e630cb81f6adb990b32046f56f125aaaf9435e7f7be782249a691; output-bytes=450

- [x] G8: unit test kredit/entitlement/play-billing kanal android (vitest, deterministik tanpa DB)
  CHECK: cmd /c "npx vitest run lib/paycore lib/entitlement tests/paycore --project unit && echo UNITTEST PASSED"
  EXPECT: UNITTEST PASSED
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=2427bf7412845b2007c298b8697da128bb9dadcc2b2b3197ad62502b1ee53001; output-bytes=222

- [ ] G9: manual review - publish Play Store membutuhkan akun Google, Play Console, app signing, dan produk IAP terdaftar oleh pemilik akun
  EVIDENCE: pending

- [ ] G10: manual review - uji purchase Play Billing end-to-end di perangkat/internal testing (butuh G9; tidak dapat dilakukan dari laptop)
  EVIDENCE: pending

<!--
Catatan format: G5 dijalankan dengan CWD android (wrapper gradle butuh cwd
folder android). G9/G10 manual karena bergantung kredensial eksternal.
-->
