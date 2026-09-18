# Gates: Android release package — AAB bertanda tangan + aset Play Store

OWNS: android/**, docs/android/**, scripts/android/**, store-assets/**, GATES.android-release.md

Scope: Paket rilis siap-upload: keystore upload + signing config, ikon
launcher dari logo resmi, AAB release bertanda tangan, teks store listing
Indonesia, dan tabel IAP yang konsisten dengan katalog DB android.
Otorisasi: instruksi user eksplisit 2026-09-18 ("ya siapkan semuanya").

Boundary: Tanpa commit/push git. Password keystore HANYA di file lokal
git-ignored, tidak pernah dicetak ke chat/log. Upload ke Play Console,
kuesioner, dan produk IAP tetap owner (G9/G10 di GATES.android.md).

- [x] R0: ledger ini bisa di-lint dan mencantumkan outcome yang dapat gagal
  CHECK: node "C:\Users\bimap\.agents\skills\unlazy\scripts\gate-lint.mjs" GATES.android-release.md
  EXPECT: LINT OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=48630b7361dd44ee870917b12c3d19b9d7bdea738aaca16bb04d4cab83b772d2; output-bytes=8

- [x] R1: signing rilis siap (keystore ada, git-ignored, build.gradle membaca keystore.properties)
  CHECK: node scripts/android/release-signing-check.mjs
  EXPECT: release signing verification passed
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=7839f49134648b82ac1907d8f479788b51fa6a3c7fcb7421fa21b48226b11f3b; output-bytes=352

- [x] R2: AAB release terbangun, valid, dan bertanda tangan kunci upload
  CHECK: cmd /c "set JAVA_HOME=%USERPROFILE%\.jdks\jdk-21.0.12.1+1&& set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk&& gradlew.bat bundleRelease --console=plain && "%USERPROFILE%\.jdks\jdk-21.0.12.1+1\bin\java.exe" -jar "%USERPROFILE%\.android-tools\bundletool.jar" validate --bundle app\build\outputs\bundle\release\app-release.aab && cd .. && node scripts/android/aab-signed-check.mjs && echo AAB SIGNED OK"
  EXPECT: AAB SIGNED OK
  CWD: android
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2\android; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=bdb863e1b46c2b08866cce3750ef2ea06df23deb6c8fb5dc8d79f6f69a3c60fc; output-bytes=37856

- [x] R3: ikon launcher + aset store berdimensi benar dari logo resmi
  CHECK: node scripts/android/icon-assets-check.mjs
  EXPECT: icon assets verification passed
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=5eb9412b531af8b36f28cd3f98d4cbf8cbe9961d7a94dd92f2d80f9d46c37596; output-bytes=746

- [x] R4: dokumen listing lengkap (deskripsi pendek <=80 char, paket, privasi, kategori, kontak)
  CHECK: node scripts/android/listing-check.mjs
  EXPECT: store listing verification passed
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=12e7042a29f32113d10c7a7ca14bee60aa1f7fba30fe85fd8ef2fdc01963a5f1; output-bytes=406

- [x] R5: tabel IAP di dokumen konsisten dengan play_sku katalog DB android
  CHECK: node scripts/android/iap-db-check.mjs
  EXPECT: iap catalog consistency passed
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=7623699e9eda996e40c3a3197feb138cbbb1acf0588e9921f0e1e784501acbbf; output-bytes=196
