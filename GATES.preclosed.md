# Gates: Pre-closed testing — UI sadar-kanal + IAP + service account

OWNS: app/(shell)/kredit/**, app/api/play-billing/**, components/kredit/**, lib/play-billing/**, android/**, capacitor.config.ts, package.json, pnpm-lock.yaml, docs/android/**, tests/play-billing/**, scripts/android/**, GATES.preclosed.md

Scope: (1) UI sadar-kanal — app Android menampilkan produk Play Billing
native, checkout PayCore disembunyikan khusus di app, web tidak berubah;
(2) kesiapan 6 produk IAP + aktivasi katalog android; (3) pengisian service
account ke env VPS. Otorisasi: instruksi user eksplisit 2026-09-19.

Boundary: Tanpa commit/push. Tanpa membuat produk IAP di Console (owner).
Tanpa menulis secret ke chat/log/file terlacak. Restart VPS hanya dengan
konfirmasi eksplisit saat eksekusi (downtime). Purchase device-asli = owner.

- [x] W0: ledger ini bisa di-lint dan mencantumkan outcome yang dapat gagal
  CHECK: node "C:\Users\bimap\.agents\skills\unlazy\scripts\gate-lint.mjs" GATES.preclosed.md
  EXPECT: LINT OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=153bba19a0b17e5d89c512b8d5621a2622c489b0bda6ae346ad7c6b1d4f887a6; output-bytes=727

- [x] W1: halaman kredit bercabang kanal (UA marker app; PayCore tersembunyi di app, utuh di web)
  CHECK: node scripts/android/channel-ui-check.mjs
  EXPECT: channel ui verification passed
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=c891e11c6ba50ded88281d4ea2b2ee52f2f060cc0d1df2ad615046e344139912; output-bytes=463

- [ ] W2: GET /api/play-billing/products live mengembalikan katalog android (dev server + DB nyata)
  CHECK: node scripts/android/play-products-live-check.mjs
  EXPECT: play products live verification passed
  EVIDENCE: pending

- [x] W3: orkestrasi purchase native teruji deterministik (vitest, plugin+fetch di-mock)
  CHECK: cmd /c "npx vitest run tests/play-billing --project unit && echo UNITTEST PASSED"
  EXPECT: UNITTEST PASSED
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=84f37765e12ff064c1f1f6513bbd62823913dc077981e61f7a6757da0c28be7e; output-bytes=219

- [x] W4: typecheck proyek tetap hijau
  CHECK: cmd /c "pnpm typecheck && echo TYPECHECK PASSED"
  EXPECT: TYPECHECK PASSED
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=7c6421916e56cb77b9bc10e4d9aa99229c1e5187e7e84df4416890f70fb67019; output-bytes=54

- [x] W5: plugin billing terpasang + tersinkron ke proyek Android
  CHECK: node scripts/android/billing-plugin-check.mjs
  EXPECT: billing plugin verification passed
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=631ee62b729ee2752634a009c0ed16d445ebc46663eae3813e2b629ddb39ef98; output-bytes=339

- [x] W6: AAB versionCode 3 terbangun signed (membawa plugin billing)
  CHECK: cmd /c "set JAVA_HOME=%USERPROFILE%\.jdks\jdk-21.0.12.1+1&& set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk&& gradlew.bat bundleRelease --console=plain && cd .. && node scripts/android/aab-version-check.mjs 3 && echo AAB V3 OK"
  EXPECT: AAB V3 OK
  CWD: android
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2\android; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=9b76438852966f91e4abb5cfd2c46fb1ff4ad9e06580bf093edc90f5a29c307b; output-bytes=11647

- [ ] W7: manual review - owner membuat 6 produk IAP di Play Console (ID lakoku_credits_*)
  EVIDENCE: pending

- [ ] W8: katalog android aktif 6/6 di produksi (setelah W7 dikonfirmasi owner)
  CHECK: node scripts/android/verify-android-catalog-active.mjs
  EXPECT: android catalog active verification passed
  EVIDENCE: pending

- [ ] W9: manual review - service account JSON dari owner diisi ke env VPS + restart (butuh konfirmasi downtime saat eksekusi)
  EVIDENCE: pending

- [ ] W10: manual review - uji purchase end-to-end di perangkat (license tester, setelah W7+W8+W9)
  EVIDENCE: pending
