# Spesifikasi Desain: PWA Install Prompt & In-App Guide

- **Tanggal**: 2026-11-05
- **Status**: Disetujui
- **Target**: Webapp Lakoku (Browser Mobile & Desktop)

## 1. Latar Belakang & Tujuan
Lakoku sudah memiliki `public/manifest.webmanifest`, aset ikon maskable (192px & 512px), serta metadata manifest di `app/layout.tsx`. Namun belum ada pemicu instalasi (install prompt) interaktif di dalam aplikasi. Pengguna browser saat ini hanya bisa menginstal jika membuka menu browser manual.

Tujuan:
1. Menyediakan banner melayang yang sopan dan tidak intrusif di halaman utama pembaca untuk mendorong pemasangan aplikasi ke layar utama (home screen).
2. Menyediakan tombol akses instalasi permanen di menu Pengaturan Profil (`/profil`).
3. Mendukung alur Chromium (Android/Chrome/Edge) dengan pemicu native `beforeinstallprompt`.
4. Mendukung alur iOS Safari dengan dialog panduan langkah demi langkah (Share → Tambah ke Layar Utama).
5. Mencegah tampilan ganda jika pengguna sudah berada di mode standalone PWA atau menggunakan aplikasi wrapper Android Capacitor (`LakokuAndroid`).

## 2. Batasan & Prinsip Desain
- **Brand Guard**: Tanpa jargon teknis ("PWA", "Service Worker", "Cache"). Menggunakan bahasa Indonesia yang ramah pembaca ("Pasang Lakoku", "Layar Utama").
- **Mobile-First**: Komponen dirancang untuk layar sentuh vertikal, aman dari notch dan gesture bar, berada tepat di atas `BottomNav`.
- **Tidak Intrusif**: Tombol "Nanti" pada banner akan menunda banner selama 7 hari via `localStorage`.
- **Zero Build Friction**: Menggunakan native browser APIs tanpa dependensi bundler atau generator pihak ketiga yang berisiko merusak build standalone VPS.

## 3. Arsitektur & Komponen

```
                  ┌───────────────────────────────┐
                  │    Window Events / Browser    │
                  │ (beforeinstallprompt, media)  │
                  └───────────────┬───────────────┘
                                  │
                                  ▼
                    ┌───────────────────────────┐
                    │  Hook: `usePwaInstall()`  │
                    │  - isStandalone           │
                    │  - isInstalled            │
                    │  - isAndroidApp           │
                    │  - isIos                  │
                    │  - canInstall             │
                    │  - promptInstall()        │
                    └─────────────┬─────────────┘
                                  │
         ┌────────────────────────┴────────────────────────┐
         ▼                                                 ▼
┌─────────────────────────┐                     ┌─────────────────────────┐
│   `PwaInstallBanner`    │                     │     `PwaInstallRow`     │
│ (di app/(shell)/layout) │                     │  (di ProfileSettings)   │
└────────────┬────────────┘                     └────────────┬────────────┘
             │                                               │
             └───────────────────────┬───────────────────────┘
                                     │ (jika iOS)
                                     ▼
                        ┌─────────────────────────┐
                        │   `IosInstallDialog`    │
                        │    (Panduan Safari)     │
                        └─────────────────────────┘
```

### 3.1 Hook: `usePwaInstall` (`components/pwa/use-pwa-install.ts`)
Mengelola state dan deteksi instalasi:
- `isStandalone`: Mendeteksi jika aplikasi berjalan di mode PWA standalone (`window.matchMedia('(display-mode: standalone)').matches` atau `window.navigator.standalone === true`).
- `isAndroidApp`: Mendeteksi jika dibuka di dalam wrapper Capacitor (`navigator.userAgent.includes('LakokuAndroid')`).
- `isIos`: Mendeteksi platform iOS (`/iPad|iPhone|iPod/.test(navigator.userAgent)`).
- `deferredPrompt`: Menyimpan event `beforeinstallprompt` jika dipicu browser Chromium.
- `canInstall`: True jika bukan standalone, bukan Android app, dan (memiliki deferredPrompt ATAU perangkat iOS Safari).
- `promptInstall()`:
  - Jika Chromium: memanggil `deferredPrompt.prompt()`, membaca `userChoice`, lalu reset state jika diterima.
  - Jika iOS: mengembalikan status `'ios'` agar UI membuka dialog instruksi.
  - Jika sudah terpasang: no-op.

### 3.2 Komponen Banner: `PwaInstallBanner` (`components/pwa/pwa-install-banner.tsx`)
- Tampil melayang di atas navigasi bawah (`fixed inset-x-4 bottom-20 z-40`).
- Guard:
  - Hanya muncul jika `canInstall === true`.
  - Tidak muncul jika `localStorage.getItem('lakoku-pwa-dismissed')` bernilai timestamp kurang dari 7 hari.
- Interaksi:
  - Tombol **Pasang**: Memicu `promptInstall()`. Jika iOS, membuka `IosInstallDialog`.
  - Tombol **Nanti**: Menyimpan timestamp saat ini ke `localStorage` dan menyembunyikan banner.

### 3.3 Komponen Profil: `PwaInstallRow` (`components/pwa/pwa-install-row.tsx`)
- Ditampilkan di `components/profile-settings.tsx` di dalam kelompok Pengaturan.
- Ikon: `Smartphone` atau `Download` dari `lucide-react`.
- Label: *"Pasang Aplikasi"*, deskripsi: *"Akses langsung dari layar utama tanpa bilah browser"*.
- Hanya tampil jika `!isStandalone && !isAndroidApp`.

### 3.4 Dialog Panduan iOS: `IosInstallDialog` (`components/pwa/ios-install-dialog.tsx`)
- Modal sheet / dialog untuk pengguna iPhone/iPad:
  - Langkah 1: Ketuk tombol **Bagikan** (ikon Share Safari di bilah bawah).
  - Langkah 2: Gulir ke bawah lalu pilih **"Tambah ke Layar Utama" (Add to Home Screen)**.
  - Tombol aksi: "Mengerti".

## 4. Penempatan & Integrasi
1. `app/(shell)/layout.tsx`:
   - Pasang `<PwaInstallBanner />` di samping komponen shell reader (agar selalu siap di halaman utama tanpa mengganggu pembacaan bab penuh).
2. `components/profile-settings.tsx`:
   - Pasang `<PwaInstallRow />` di bagian atas daftar tautan pengaturan.

## 5. Rencana Pengujian
1. **Unit & Environment Test**:
   - Uji deteksi standalone, deteksi UA `LakokuAndroid`, dan validasi batas waktu dismiss 7 hari.
2. **Browser Testing**:
   - Chromium desktop/mobile: Emulasi event `beforeinstallprompt` dan verifikasi pemanggilan `.prompt()`.
   - iOS Safari: Verifikasi kemunculan modal instruksi saat "Pasang" ditekan.
   - PWA Standalone / Capacitor: Verifikasi banner dan row di profil otomatis hilang.
