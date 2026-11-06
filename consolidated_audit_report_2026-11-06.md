# Laporan Audit Aplikasi Lakoku — Bug & Celah (Ronde 2)

**Tanggal:** 2026-11-06
**Base:** branch `feat/pwa-install-prompt` @ `3388cdd` (main `2591d40` + 8 commit PWA; commit `ce99f95` masuk di tengah audit — ada sesi lain yang aktif mengerjakan branch ini)
**Produksi:** VPS 43.128.103.110 @ `c40e2e0` (rilis audit P0/P1/P2 2026-11-04)
**Metode:** 6 reviewer konteks-fresh paralel (fitur PWA baru, auth/API, uang & ekonomi, runtime/AI generasi, database/migrasi, permukaan UI) + verifikasi silang manual semua klaim blocker + introspeksi produksi Neon **read-only** (FK constraint, CHECK constraint, data share).
**Gates mekanis:** `pnpm typecheck` **PASS** · `pnpm lint` **FAIL** (lihat H-16) · `pnpm test:unit` **FAIL 1/4118** (fixture basi, lihat H-15).

> Laporan ronde sebelumnya: `consolidated_audit_report.md` (2026-11-04) — seluruh P0/P1/P2 dari ronde itu sudah diverifikasi **utuh di kode** pada ronde ini (bagian "Status Verifikasi Fix Lama").

---

## Ringkasan Eksekutif

| Prioritas | Jumlah | Inti masalah |
|---|---|---|
| 🔴 Blocker | 4 | Bonus top-up terbalik (ekonomi bocor, aktif di produksi), refund tak tercatat karena CHECK constraint (aktif), halaman Jelajah 500 begitu ada 1 share publik, fitur PWA baru mustahil jalan di Chromium |
| 🟡 Major | 18 | Cost cap AI bisa ditembus lintas-job & lintas-attempt, 21 novel katalog lolos brand guard, komisi referral tak dicabut saat refund, rate limiter bisa di-spoof, dst. |
| 🟢 Nit | ~15 | Klasifikasi status HTTP, race ringan, dead code, konsistensi arsitektur |

---

## 🔴 BLOCKER

### BL-1. Bonus top-up pertama TERBALIK — user lama dapat bonus perdana setiap top-up, user baru tidak pernah dapat
- **KATEGORI:** BUG/EKONOMI — **TERVERIFIKASI (kode) — AKTIF DI PRODUKSI**
- **LOKASI:** `lib/paycore/client.ts:101-102` dan `app/api/play-billing/verify/route.ts:65-66`
- **Bukti:**
  ```ts
  // lib/paycore/client.ts:70 — komentar fungsi: "Cek apakah user SUDAH PERNAH topup"
  const firstTopup = await hasPaidTopup(input.userId)   // true = sudah pernah
  const calc = calculateTopupCredits(product, firstTopup) // param-nya: isFirstTopup!
  ```
  `calculateTopupCredits(product, isFirstTopup)` memberi `firstTopupBonusCredits` saat param `true`. Nilai `hasPaidTopup` justru `true` saat user **sudah** pernah top-up → logika terbalik total.
- **Dampak:** (1) User lama menerima **bonus perdana di setiap top-up ke-2, ke-3, dst.** — kebocoran ekonomi langsung. (2) User baru **tidak pernah** menerima bonus perdana yang dijanjikan UI (halaman kredit mengecek `has_paid_topup_v1` dengan benar: `raw !== true`, jadi UI menampilkan bonus tapi grant-nya tidak sesuai). Jalur web (PayCore) **dan** Play Billing sama-sama kena.
- **Perbaikan:** `const isFirstTopup = !(await hasPaidTopup(userId))` di kedua file + test unit untuk kedua jalur.

### BL-2. Refund gagal dicatat: CHECK constraint produksi menolak status `'refunded'`, error ditelan
- **KATEGORI:** BUG/AUDIT-FINANSIAL — **TERVERIFIKASI (kode + introspeksi produksi Neon)**
- **LOKASI:** `lib/entitlement/store.server.ts:153-162` (`markOrderRefunded` menulis `status: 'refunded'`) vs CHECK produksi `credit_orders_status_check`: `status in ('created','paid','duplicate','failed')` — **diverifikasi langsung di DB produksi 2026-11-06, tidak ada `'refunded'`**. Error ditelan non-fatal di `lib/entitlement/paycore.ts:241-243`.
- **Dampak:** Setiap event `payment.refunded` berhasil mencabut kredit (`revoke_credits_v1` jalan) tapi **status order selamanya `'paid'`** — laporan admin dan jejak audit finansial keliru; tidak ada cara membedakan order yang sudah di-refund.
- **Perbaikan:** Migrasi: drop constraint + re-add dengan `'refunded'` ditambahkan.

### BL-3. Halaman `/jelajah` crash (500) begitu ada 1 share publik — TDZ `ReferenceError`
- **KATEGORI:** BUG — **TERVERIFIKASI (kode + data produksi: saat ini 0 share publik, 3 share semuanya `unlisted` → belum meledak)**
- **LOKASI:** `app/(shell)/jelajah/page.tsx:69` — elemen ketiga dari `const items: ExploreItem[] = [...]` mem-filter dengan `!items.some(...)` sambil `items` sendiri masih dalam proses inisialisasi (Temporal Dead Zone).
- **Dampak:** Begitu satu pembaca men-share ending sebagai **publik** (alur "AKHIR: …" mendorong ini), `listPublicShareTeasers` mengembalikan ≥1 baris → `/jelajah` (di bottom nav utama) mati 500 untuk semua pengunjung.
- **Perbaikan:** Pisahkan `baseItems` (dari `explore` + `publicUserStories`) dulu, lalu filter `publicShares` terhadap `baseItems`, lalu gabung.

### BL-4. Fitur PWA install (branch aktif) mustahil berjalan di Chromium + tidak terpicu dengan benar di iOS/iPad
- **KATEGORI:** BUG/FITUR — **TERVERIFIKASI (kode + manifest)** — belum deploy, tangkap sebelum rilis
- **Bukti (3 lapisan):**
  1. **Manifest tak lolos syarat installability Chromium** (`public/manifest.webmanifest`): ikon 192/512 hanya `purpose: "maskable"`; ikon non-maskable cuma 180x180. Chromium butuh ikon ≥192 dengan purpose `"any"` → `beforeinstallprompt` **tidak pernah fire**.
  2. **Race listener:** `components/pwa/use-pwa-install.ts:57` memasang listener `beforeinstallprompt` di `useEffect`; event umumnya fire sebelum hydration di mobile (target utama) → terlewat, dan Chrome hanya emit 1x per load. Cache module-level (`globalDeferredPrompt`) tidak menolong karena tidak ada listener module-scope yang mengisinya.
  3. **Tidak ada service worker** di luar alur push Firebase (`components/push/web-registration.ts:52`) — modern Chrome sudah longgar soal ini, tapi tetap rentan kriteria.
  4. **Deteksi iPad modern gagal** (`lib/pwa/install-state.ts:17-20`): regex `/iPad|iPhone|iPod/` tidak mengenali iPadOS 13+ yang berkamuflase UA desktop (`MacIntel` + `maxTouchPoints > 1`) → dialog panduan iOS tak terbuka di iPad.
- **Dampak:** Banner + tombol tampil tapi `canInstall` tidak pernah `true` di Chrome/Android → fitur inti branch ini mati; di iPad salah platform.
- **Perbaikan:** (1) manifest: `purpose: "any maskable"` atau tambah ikon `any` 192+512; (2) listener module-scope/inline head yang mengisi `globalDeferredPrompt` sebelum React hidrasi; (3) registrasi SW dasar independen push; (4) tambahkan cek `maxTouchPoints` untuk iPad. Verifikasi runtime via DevTools → Application → Manifest.

---

## 🟡 MAJOR

### M-A1. E0CostGuard singleton tercemar antar-job paralel + reset per-attempt menembus plafon bab
- **LOKASI:** `lib/ai-gateway/e0-cost-guard.ts:86-106`; konkurensi global default **10 per proses** (`lib/runtime/generation-concurrency.ts:95` — terverifikasi).
- **Dampak:** (a) Job paralel tanpa scope mencatat biayanya ke scope job lain → job korban bisa kena `E0_CHAPTER_COST_CEILING_EXCEEDED` prematur, sedangkan job perusak berjalan **tanpa plafon bab**. (b) `generation-worker.ts:290` membuka scope `job.id#attempt` → tiap attempt mereset akumulator → plafon $2.10/bab jadi $2.10/attempt (5 attempt = ~$10/bab).
- **Perbaikan:** Pelacak biaya per-jobId (Map/AsyncLocalStorage), akumulasi lintas-attempt per bab.

### M-A2. Generator katalog (21 novel di produksi) mem-bypass brand guard
- **LOKASI:** `lib/catalog/generator.server.ts` — TIDAK ada panggilan `scanForLeaks`/`assertConsumerSafe` (terverifikasi grep; hanya `isReaderSafeParagraph` 8-kata untuk teks reaksi/kondisi, baris 147/179/275/277).
- **Dampak:** Pelanggaran AGENT_RULES #4: kebocoran meta-model ("sebagai AI…", potongan prompt) pada prosa/pilihan katalog tertulis langsung ke DB dan tampil ke pembaca tanpa scan.
- **Perbaikan:** Panggil `assertConsumerSafe` + `scanForLeaks` pada prosa/pilihan/konsekuensi di `generateSpineChapter`/`generateVariantChapter`.

### M-A3. Path sampul: `startsWith('/')` lolos sebelum cek traversal
- **LOKASI:** `lib/cover/url.ts:42-44` (terverifikasi urutannya).
- **Dampak:** `/../x` dan path lokal sembarang (mis. `/api/...`) lolos `isSafeStoryCoverInput` dan bisa dipasang sebagai sampul → browser pembaca lain memuat path arbitrer di domain sendiri. Diperparah M-A4.
- **Perbaikan:** Pindah cek `includes('..')` ke atas + whitelist prefix (`/covers/`, `/placeholder.svg`).

### M-A4. `cover/apply` tidak memvalidasi URL terhadap kandidat sampul cerita
- **LOKASI:** `app/api/stories/[id]/cover/apply/route.ts:28-36`.
- **Dampak:** Pemilik cerita bisa memasang key sampul milik user/cerita lain (sampul privat bocor ke cerita publik).
- **Perbaikan:** Cocokkan `url` dengan baris `story_cover_candidates` milik `(storyId, userId)`.

### M-A5. Komisi referral tidak dicabut saat order di-refund (vektor perputaran uang)
- **LOKASI:** `lib/entitlement/paycore.ts:208-245` (komentar follow-up eksplisit) + `lib/rewards/commission.server.ts`.
- **Dampak:** Skema: pembeli B top-up besar → pengajak A dapat komisi 10% → B refund → kredit B dicabut, komisi A tetap cair. Rugi kas nyata. *(Ini follow-up yang memang ditunda di ronde P1 — kini dengan jalur eksploitasi eksplisit.)*
- **Perbaikan:** RPC `revoke_reward_commission_v1(p_order_id)` dipanggil di blok `PAYMENT_REFUNDED`.

### M-A6. Entitlement bab/bundle tetap aktif walau saldo minus pasca-refund
- **LOKASI:** `lib/credits/access-resolver.server.ts:86-120` — hanya cek keberadaan baris ledger `unlock:`/`bundle:`, tidak cek saldo negatif.
- **Dampak:** Top-up → buka semua bab → refund → saldo minus, bacaan tetap terbuka selamanya.
- **Perbaikan:** Blokir akses bab berbayar bila `credit_balance_v1 < 0` (atau cabut entitlement saat refund).

### M-A7. Atribusi referral via share-link gugur diam-diam bila pemilik belum punya kode referral
- **LOKASI:** `lib/rewards/share-attribution.server.ts:32-41` — raw select `referral_codes`, `null` → `return false`; kode referral baru dibuat saat buka tab Imbalan.
- **Perbaikan:** Pakai `ensureReferralCode(owner)` sebelum atribusi.

### M-A8. Rate limiter bisa di-spoof via `X-Forwarded-For` (elemen pertama dikontrol klien)
- **LOKASI:** `lib/security/rate-limit.ts:48-55` — ambil `split(',')[0]`.
- **Dampak:** Bypass limit 8/mnt report & 30/mnt analytics dengan header palsu; bucket `'unknown'` bisa di-joint-DoS. **Tergantung rantai proxy** (Cloudflare Tunnel → Caddy): perlu dipastikan Caddy menimpa (bukan menambah) XFF — cek Caddyfile VPS.
- **Perbaikan:** Prioritaskan IP dari proxy terpercaya (`x-real-ip` yang di-set Caddy) atau pakai `CF-Connecting-IP`; konfigurasi `header_up` di Caddy.

### M-A9. Hydration mismatch `AdsenseBanner` di WebView Android
- **LOKASI:** `components/ads/adsense-banner.tsx:28,46` — `typeof window !== 'undefined' && Capacitor.isNativePlatform()` saat render.
- **Dampak:** SSR merender div, client (native) merender null → mismatch tiap mount di app Android (console error, re-render paksa).
- **Perbaikan:** State `isNative` di-set di `useEffect`.

### M-A10. `PwaInstallRow` dead-click di browser tanpa prompt
- **LOKASI:** `components/pwa/pwa-install-row.tsx:14,21-25` — render tidak mengecek `canInstall`; klik → `'unavailable'` tanpa feedback.
- **Perbaikan:** Sembunyikan bila `!canInstall` (kecuali iOS), atau tampilkan panduan manual.

### M-A11. Skeleton Koleksiku tidak match grid 3 kolom (regresi commit `00a30a3`)
- **LOKASI:** `app/(shell)/koleksiku/loading.tsx` vs `page.tsx` — CLS parah saat load.
- **Perbaikan:** Skeleton 3 kolom 9:16.

### M-A12. Tombol 404 "Jelajahi Cerita" mengarah ke `/` bukan `/jelajah`
- **LOKASI:** `app/not-found.tsx:24-27` — user login di-redirect ke `/beranda`, tidak pernah sampai katalog.

### M-A13. Drift skema sumber-tunggal: 7 tabel bermigrasi FK → `auth.users`, produksi TIDAK (fresh-rebuild rusak)
- **LOKASI (file migrasi):** `shared_story_starts` (20260710010000:38), `admin_generation_access_audit` (20260718110000:19), `chapter_state_commits` (20260805000000:242), `commercial_generation_intents` (20260805010000:15), `admob_ssv_events` (20260918000000:82), `push_log` (20260921000000:39), `story_cover_candidates` (20260922000000:7); plus view `vw_blueprint_recent_resolutions` (20260823100300:103) join `auth.users` (reviewer_email selalu NULL).
- **Introspeksi produksi 2026-11-06: FK ke `auth.users` = 0, FK ke `public."user"` = 30** → produksi sehat, tapi `db/migrations/` (sumber skema tunggal) TIDAK mereproduksi produksi: rebuild fresh/staging akan kembali kena kelas bug B1 ronde lalu.
- **Perbaikan:** Migrasi repoint untuk 7 tabel + `CREATE OR REPLACE VIEW`; sertakan 13 migrasi yang belum ada di `neon/migrations/` bila direktori itu masih dipelihara.

### M-A14. Cost guard E0: retry attempt baru reset plafon bab *(gabung dengan M-A1b — lihat atas)*

### M-A15. Gate `pnpm test:unit` MERAH: fixture test basi pasca fix N8
- **LOKASI:** `tests/catalog/catalog-explore-queries.test.ts:237-258` — fixture `user:cerita-saya` tanpa `status`/`current_chapter`, sementara `queryPublicUserStories` (benar, sesuai fix Audit N8/`46e2d1d`) memfilter `status <> 'BARU'` dan `current_chapter > 0`. Query produksi OK; **test-nya yang perlu update fixture** (beri `status: 'SELESAI'`, `current_chapter: 5`).

### M-A16. Gate `pnpm lint` MERAH: error nyata di 8 file sumber + noise artefak build
- Error sumber: `lib/narrative-qa/fault/scenarios.ts:490` (`any` ×2), `scripts/catalog-qc-patch.ts` (`any` ×5), `scripts/compare-prose-models.ts` (2 boundary + 1 prefer-const), `scripts/legacy/m10-g-9router-fork-proof.ts` (5 boundary), `components/pwa/use-pwa-install.ts:31` (setState-in-effect — verdict benign, lihat NIT), `components/kredit/android-buy-section.tsx:61` (benign), `components/story-cover-dialog.tsx:47` (benign), `app/global-error.tsx:115` (benign — `<a>` sengaja untuk full-reload).
- **Noise:** `android/app/build/**`, `.unlazy/**`, `.playwright-cli/**` ikut ter-lint → tambahkan ke `eslint.config` ignores (artefak build + direktori tooling).

---

## 🟢 NIT

1. `record_content_report_v1` pakai `MAX(seq)+1` tanpa lock (`db/migrations/20261004000000_live_drift_capture.sql:52-59`) — tabrakan concurrent report = unique_violation (pola yang sudah dimitigasi di TS `appendStoryEvent`, belum di RPC SQL ini).
2. `applyReferralCommission` membandingkan tanggal sebagai string ISO (`lib/rewards/commission.server.ts:42-48`) — aman selama driver mengembalikan `Date`; rapikan dengan epoch compare.
3. `actRedeemCredits` (`app/(shell)/profil/imbalan/actions.ts:11-16`) tanpa validasi `Number.isInteger`/positif — float/NaN menghasilkan error SQL mentah, bukan pesan pembaca.
4. `window.localStorage` diakses langsung (`use-pwa-install.ts:35,92`) — bisa throw `SecurityError` di mode pembatasan; bungkus try/catch.
5. Banner PWA pakai `role="dialog"` + `aria-live="polite"` sekaligus (`pwa-install-banner.tsx:33-35`) — semantics bentrok untuk screen reader; pakai `role="region"`.
6. Kelas error `Forbidden` → 500 di `app/api/blueprint-review/[id]/route.ts` (hanya `Unauthenticated` yang ditangkap 401).
7. 7 route settings admin + blueprint-review: body JSON rusak → 500, semestinya 400.
8. `/api/stories/[id]/unlock`: story tidak ditemukan → 500, semestinya 404.
9. `constantTimeEquals` di `app/api/generation/recover/route.ts:42-51` keluar cepat saat panjang beda — hash dulu seperti `admin-guard.ts`.
10. `POST /api/blueprint-review` mati tapi terbuka publik dan membocorkan pesan arsitektur worker.
11. Seam: `app/baca/[id]/page.tsx:75` & `app/(shell)/kredit/page.tsx:11` import `@lakoku/db` langsung — pindah ke `lib/api/` (konsistensi arsitektur; lint boundary tidak memprotes karena barrel).
12. Blok `if (reservation.replayed)` duplikat persis (`app/api/stories/[id]/cover/generate/route.ts:104-116`) — dead code.
13. Tombol pilihan reader tidak diberi atribut `disabled` selama transisi (`components/reader-view.tsx:691`) — guard JS sudah ada, ini untuk aksesibilitas.
14. `Date.now()` saat render tanpa guard mounted (`story-cover-actions.tsx:25`, `tinta-wallet-view.tsx:62`) — risiko hydration warning tipis.
15. 3 lint "error" yang dinilai **benign/as-intended**: `<a href="/">` di `global-error.tsx` (full reload memang diinginkan), `setMounted(true)` di `story-cover-dialog.tsx` & `setStoreMissing` di `android-buy-section.tsx` (pola init mount standar). `use-pwa-install.ts:31` satu-satunya yang disarankan refactor ke `useSyncExternalStore`.

---

## STATUS VERIFIKASI FIX LAMA (ronde 2026-11-04)

| Fix | Status |
|---|---|
| B1 FK user → `public."user"` uuid | ✅ Utuh (kode + produksi: 30 FK benar, 0 FK `auth.users`) |
| B3 `redeem_reward_credits_v1` atomik | ✅ Utuh |
| B4 `exchange_tinta_to_lakoin_v1` atomik | ✅ Utuh |
| B5 Play Billing acknowledge | ✅ Utuh di layer API/SQL (tapi dipanggil dengan bonus yang salah — BL-1) |
| B6 pool `on('error')` | ✅ Utuh |
| B7 aktor sistem runtime admin | ✅ Utuh |
| M1 fallback sesi dihapus | ✅ Utuh |
| M2 wajib verifikasi email | ✅ Utuh |
| M3 clawback refund | ⚠️ RPC utuh, tapi pencatatan status order gagal (BL-2) + komisi tak dicabut (M-A5) |
| M4 bonus lintas kanal | ⚠️ SQL utuh, pemanggil terbalik (BL-1) |
| M6 timing-safe admin guard | ✅ Utuh |
| M7 escape wildcard LIKE | ✅ Utuh |
| M13 CHECK harga ≥ 0 | ✅ Utuh |

---

## AREA SUDAH AMAN (terverifikasi ronde ini)

- **Webhook PayCore**: HMAC canonical timing-safe, toleransi 5 menit, dedup ref.
- **AdMob SSV**: ECDSA Google keys, anti-replay, cap harian, atomik ber-lock.
- **Klaim misi**: advisory lock + unique `(user_id, mission_key, day_jkt)`.
- **`spend_credits_v1` / `spend_bundle_v1`**: atomik ber-lock; bundle hitung offset fair-price.
- **Cover generate**: siklus reserve→capture→release fail-closed, advisory lock, 409 replay.
- **State machine job generasi**: trigger DB enforcement + recovery stale-lease (75s heartbeat, skip locked).
- **Telemetry `story_events`**: retry 23505 ×5 backoff (fix M12 utuh); `loadConsistencyInputs` ber-window/limit (fix M5 utuh).
- **Ownership route `[id]`**: deny-by-default terjaga di sampul/visibility/generate/choices; guest no-op di choices.
- **Guest flow bab 1–3**: read-only, fallback login rapi, tanpa crash `user: null`.
- **Brand guard UI web**: bersih (katalog generator = pengecualian, M-A2); error message reader-safe.
- **Idempotensi pilihan**: `submittingRef` + `Idempotency-Key` + lock `apply_personalized_choice_v2`.
- **Signature/kredensial**: tidak ada kebocoran stack/istilah internal di response.

## PERLU VERIFIKASI RUNTIME (tidak bisa dipastikan dari kode)

1. PWA: buka Chrome Android/desktop → DevTools → Application → Manifest (ikon warning?), cek event `beforeinstallprompt` tanpa izin push.
2. Caddyfile VPS: apakah `X-Forwarded-For` ditimpa (bukan ditambah) → menentukan severity M-A8.
3. Kondisi `bonusActive` di `credit_products` produksi — bila sedang `false`, dampak langsung BL-1 dorman tapi tetap wajib dibetulkan sebelum promo aktif.

## Rencana Eksekusi yang Disarankan

**P0 — sebelum rilis PWA / hari ini (uang & halaman utama):**
1. BL-1: balik logika bonus first-topup (2 file) + unit test.
2. BL-2: migrasi CHECK `credit_orders.status` + `'refunded'`.
3. BL-3: pisahkan `baseItems` di `/jelajah` (6 baris) + test regressi.
4. BL-4: manifest ikon `any` + listener module-scope + SW dasar + iPad detection.

**P1 — minggu ini:** M-A1 (cost guard per-job & lintas-attempt), M-A2 (brand guard katalog), M-A3+M-A4 (whitelist sampul), M-A5+M-A6 (clawback komisi & entitlement refund), M-A8 (rate limit proxy-safe), M-A13 (repoint 7 FK + view), M-A15+M-A16 (pulihkan gate test & lint).

**P2 — kebersihan:** seluruh NIT.

Semua perubahan P0 menyentuh jalur uang/halaman utama → ikuti aturan project: verifikasi per fitur sebelum commit, commit terpisah per alur, uji idempotensi retry sebelum deploy.
