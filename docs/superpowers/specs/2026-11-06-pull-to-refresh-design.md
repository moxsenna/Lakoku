# Spesifikasi Desain: Pull-to-Refresh Halaman Utama

- **Tanggal**: 2026-11-06
- **Status**: Disetujui
- **Target**: Halaman Navigasi Utama Lakoku (Mobile Web, PWA Standalone, & Android Capacitor)

## 1. Latar Belakang & Tujuan
Pembaca webapp Lakoku terbiasa dengan pola navigasi aplikasi seluler modern: menarik layar ke bawah saat berada di posisi paling atas untuk menyegarkan konten (pull-to-refresh).

Tujuan:
1. Menyediakan interaksi tarik-ke-bawah yang responsif, mulus, dan alami pada tab navigasi utama (Beranda, Jelajah, Koleksiku, Misi, Profil).
2. Mengecualikan halaman baca bab penuh (`/baca/*`) agar tidak terjadi refresh yang tidak sengaja saat pembaca menggulir cerita dengan cepat.
3. Melakukan penyegaran halus (soft refresh via Next.js `router.refresh()`), menghindari kedipan putih reload penuh browser.
4. Menyesuaikan tampilan indikator dengan palet tema Lakoku (dark mode dan light mode) secara konsisten.

## 2. Batasan & Prinsip Desain
- **Branding & Tema**: Menggunakan semantic token Tailwind Lakoku (`bg-card`, `border-border`, `text-primary`, `shadow-md`, `backdrop-blur`).
  - Dark Mode: latar kartu plum/gelap (`#191319`), border halus, aksen rose/plum.
  - Light Mode: latar kartu bersih, kontras teks dan spinner primer.
- **Isolasi Alur Baca**: Hanya aktif di `components/app-shell.tsx` saat `withNav === true`. Halaman dengan `withNav={false}` (seperti reader penuh) tidak memuat pull-to-refresh.
- **Pencegahan Scroll Rusak**:
  - Hanya merespons jika tarikan dimulai saat posisi scroll tepat di puncak (`window.scrollY === 0` atau `document.documentElement.scrollTop === 0`).
  - Tidak memblokir scroll alami ke bawah jika posisi awal bukan 0.
- **Zero New Dependencies**: Dibangun murni menggunakan React 19 Touch Events dan Tailwind CSS tanpa paket npm tambahan.

## 3. Arsitektur & Interaksi

```
                  ┌───────────────────────────────┐
                  │         Touch Events          │
                  │ (touchstart, touchmove, end)  │
                  └───────────────┬───────────────┘
                                  │
                                  ▼
                   ┌─────────────────────────────┐
                   │   Hook: `usePullToRefresh`  │
                   │   - pullDistance            │
                   │   - isRefreshing            │
                   │   - canPull                 │
                   └──────────────┬──────────────┘
                                  │
                                  ▼
                   ┌─────────────────────────────┐
                   │  `PullToRefresh` Component  │
                   │  - Floating pill indicator  │
                   │  - Transform/rotation CSS   │
                   │  - Brand styling light/dark │
                   └──────────────┬──────────────┘
                                  │ (dibungkus di AppShell saat withNav === true)
                                  ▼
                   ┌─────────────────────────────┐
                   │    `components/app-shell`   │
                   └─────────────────────────────┘
```

### 3.1 Logika Gestur (`usePullToRefresh`)
- **Ambang Batas (Threshold)**: 60px jarak tarikan teredam.
- **Jarak Maksimum (Max Pull)**: 80px.
- **Rumus Redaman (Friction)**: `Math.min(MAX_PULL, (currentY - startY) * 0.4)`.
- **Status Lifecycle**:
  - `idle`: Posisi scroll normal, indikator tersembunyi (`translate-y-[-100%]`).
  - `pulling`: Indikator turun mengikuti jarak tarikan, panah berputar proporsional (`rotate-[deg]`).
  - `refreshing`: Indikator terkunci di posisi 50px, ikon berputar (`animate-spin`), `router.refresh()` dipanggil dalam `startTransition`.
  - `settling`: Setelah refresh selesai (atau timeout cadangan 2.5s), indikator meluncur kembali ke atas secara halus dengan transisi CSS.

### 3.2 Indikator Visual (`PullToRefreshIndicator`)
- **Letak**: Melayang di bagian atas layar tengah (`fixed top-3 inset-x-0 mx-auto z-30`).
- **Dimensi**: Lingkaran kompak berukuran 40x40px (`size-10`).
- **Styling**:
  - `rounded-full border border-border bg-card/90 shadow-md backdrop-blur`
  - Ikon: `Loader2` atau `RotateCw` dari `lucide-react` dengan warna `text-primary`.
  - Saat `pulling`: Opacity bertransisi dari 0 ke 1, rotasi mengikuti proporsi tarikan `(distance / 60) * 180` derajat.
  - Saat `refreshing`: Berputar kontinu `animate-spin text-primary`.

### 3.3 Integrasi ke `AppShell`
- `components/app-shell.tsx`:
  - Bungkus area konten utama dengan `<PullToRefresh>` jika `withNav === true`.
  - Jika `withNav === false`, render konten secara langsung tanpa overhead gestur sentuh.

## 4. Rencana Pengujian & Verifikasi
1. **Unit Test**:
   - Uji rumus redaman jarak tarikan (friction calculation).
   - Uji transisi status (`idle` -> `pulling` -> `refreshing` -> `idle`).
2. **Browser Testing (Playwright/Mobile Viewport 390x844)**:
   - Emulasi touchstart + touchmove + touchend pada posisi scroll 0 di `/beranda`.
   - Pastikan indikator muncul dan `router.refresh()` terpanggil.
   - Uji saat scroll > 0: pastikan tarikan tidak memicu indikator.
   - Uji tema: verifikasi warna indikator di dark mode dan light mode.
