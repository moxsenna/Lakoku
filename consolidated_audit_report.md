# Laporan Audit Aplikasi Lakoku — Bug & Celah Security

**Tanggal:** 2026-11-04
**Base commit:** `fc8d8f9` (main, lokal)
**Metode:** 6 reviewer konteks-fresh paralel (auth/session, uang & ekonomi, otorisasi admin, reader & generasi, database, permukaan client) + verifikasi silang manual atas semua klaim blocker, termasuk cek data read-only ke DB produksi.
**Typecheck:** `pnpm typecheck` exit 0 — tidak ada error tipe.

> ## STATUS IMPLEMENTASI P0 (update 2026-11-04)
>
> Rencana P0 dieksekusi, diverifikasi, dan **diterapkan ke DB produksi** (migrasi 20260706990000 s.d. 20261104180000). Detail koreksi atas laporan awal:
>
> - **B1 (diperbaiki & dikoreksi)**: introspeksi produksi membuktikan FK ke `auth.users` **tidak pernah terpasang** (tabel dibuat sebelum migrasi FK-nya, `create table if not exists` jadi no-op) — jadi bukan "tulis gagal FK", melainkan **integritas referensial hilang** + RPC yang buta terhadap user baru + rebuild fresh yang akan rusak. Solusi: `public."user".id` (dan session/account/user_acquisition) dikonversi `text`→`uuid` (19/19 id uuid-format, `generateId` sudah uuid sejak awal), FK domain dipasang ke `public."user"`, dan 6 RPC di-repoint ke `public."user"` via CREATE OR REPLACE (UPDATE pg_proc ditolak Neon). Probe produksi: 12/12 PASS, termasuk user baru bisa menulis ledger.
> - **B3/B4 (diperbaiki)**: penukaran imbalan & Tinta→Lakoin kini SATU RPC atomik ber-lock (`redeem_reward_credits_v1`, `exchange_tinta_to_lakoin_v1`). Catatan verifikasi: hipotesis "snapshot basi setelah menunggu lock" sempat muncul di pengujian namun **TERBUKTI SALAH** (kontaminasi saldo lintas-run test); race test dengan user fresh + saldo persis membuktikan pola single-RPC + advisory lock internal sudah benar (pembaca setelah lock melihat commit terbaru, `insufficient`).
> - **B5+M4, B6, B7 (diperbaiki)**: acknowledge Play Billing, bonus top-up lintas kanal, handler `error` pool auth, aktor sistem untuk grant via runtime token.
> - **B2 (diperbaiki)**: 5 migrasi disalin ke `db/migrations/` + shell `auth`/`extensions`/role untuk rebuild fresh. Rantai fresh-migrate 108 file diuji di DB scratch (docker postgres 16): hijau, dengan 2 pengecualian lingkungan (pg_cron & storage.buckets tersedia di Neon, tidak di docker vanilla).
> - **Koreksi temuan agen**: klaim "migrasi user_acquisition hilang" = keliru; T3 "lubang snapshot spend_credits_v1" = salah diagnosis (kontaminasi test); `spend_credits_v1` terbukti aman.
>
> ### STATUS P1 (update 2026-11-04, sesi kedua)
>
> - **M1+M2+M11**: fallback sesi dihapus; `requireEmailVerification` + `sendOnSignIn` aktif (20/20 user existing sudah verified — nol lockout; bonus anti-enumeration dari better-auth); email reset/verifikasi gagal kini melempar error.
> - **M3**: webhook menerima `payment.refunded` (kontrak diperluas & didokumentasikan) — clawback via `revoke_credits_v1` (idempoten, saldo boleh minus); refund order tak dikenal = 200 `ignored`; mismatch user_id = ditolak. Migrasi applied ke produksi; probe rollback-tx: clawback neto 0, replay `duplicate`. Sisa: komisi referral yang terlanjur dibayar belum ikut ditarik (follow-up).
> - **M5+M9+M10**: rate limiter per-IP baru (8/mnt report, 30/mnt analytics); `loadConsistencyInputs` ber-window 7 hari + limit 5000/2000 (anti-OOM /api/admin/metrics).
> - **M6+M8**: guardAdminToken timing-safe (SHA-256 digest); URL sampul di-whitelist (base sendiri / key polos / path lokal) di route + defense-in-depth di `setStoryCover`.
>
> Catatan verifikasi: typecheck & lint bersih untuk seluruh file yang diubah (4 error `tsc` dan 1 test gagal berasal dari `tests/authoring/circuit-breaker.test.ts` — file untracked puing pekerjaan lain di working tree, bukan bagian perubahan ini).

Setiap temuan di bawah sudah diverifikasi dengan membaca kode yang dirujuk (bukan dugaan). Klaim blocker diverifikasi ulang manual dan sebagian dikonfirmasi dengan query data produksi (read-only).

---

## Ringkasan Eksekutif

| Prioritas | Jumlah | Inti masalah |
|---|---|---|
| 🔴 Blocker | 7 | User baru tidak bisa menulis ke tabel uang (FK rusak), race double-spend penukaran imbalan, pembelian Play Billing auto-refund, crash server dari pool tanpa handler, skema DB tak bisa direproduksi |
| 🟡 Major | 14 | Fallback sesi melemahkan HMAC, verifikasi email tidak wajib, refund tidak dicabut kreditnya, bonus top-up bisa diambil berulang, endpoint tanpa rate limit, dll. |
| 🟢 Nit | 8 | Kode status salah, audit trail kosong, endpoint mati, dsb. |

**Yang paling mendesak (P0):** seluruh alur ekonomi untuk **user yang mendaftar setelah migrasi better-auth** akan gagal dengan FK violation. Ini bukan prediksi — terkonfirmasi lewat data produksi (lihat B1).

---

## 🔴 BLOCKER

### B1. Semua user baru tidak bisa menulis ke tabel keuangan (FK menunjuk `auth.users` yang tidak lagi diisi)
- **KATEGORI:** SECURITY/BUG — **TERKONFIRMASI DI PRODUKSI (data)** *(koreksi pasca-eksekusi: FK ke `auth.users` ternyata tidak pernah terpasang di produksi — dampak riilnya integritas hilang + RPC buta user baru; lihat blok STATUS IMPLEMENTASI di atas)*
- **LOKASI:** `db/migrations/20260708000000_paycore_credit_model.sql:27` (credit_ledger, credit_orders), `db/migrations/20260917000000_dompet_imbalan_referral.sql:46` (reward_ledger: `user_id uuid not null references auth.users(id)`), plus referral_attributions, tinta_ledger, user_mission_daily, user_acquisition (satu ini sudah diperbaiki di `cae08ee`), admin_credit_grants, dsb.
- **Bukti:**
  - Better-auth menulis user ke `public."user"` dengan `id text` (`neon/migrations/20261005000000_better_auth_schema.sql:4`), TIDAK ke `auth.users`.
  - `auth.uid()` tinggal stub GUC (`neon/migrations/20261004010000_auth_uid_guc_fix.sql`). Tidak ada trigger/fungsi sinkronisasi `public."user"` → `auth.users` di migrasi mana pun (satu-satunya `insert into auth.users` adalah helper test `create_test_auth_user_v1`).
  - **Data produksi (cek read-only 2026-11-04):** `public."user"` = 19 baris, `auth.users` = 18 baris. **1 user baru (`alfatihinspire@gmail.com`, 2026-11-02) TIDAK ada di `auth.users`.** Baris credit_ledger/user_mission_daily milik "user hantu" = **0** — artinya belum ada satu pun tulisan keuangan yang berhasil untuk user pasca-cutover.
- **Dampak:** Setiap reader yang mendaftar mulai sekarang akan gagal (error 500) pada: klaim misi, reward Tinta, penukaran imbalan, pembelian & unlock kredit, atribusi referral (yang ini diam-diam gagal — `lib/rewards/attribution.server.ts` menelan error non-23505). Situs tetap bisa dibaca (bab 1–3 gratis tidak menulis ledger), jadi bug ini belum terasa — tapi seluruh funnel monetisasi mati untuk user baru.
- **Perbaikan:** Migrasi repoint massal semua FK `user_id` dari `auth.users(id)` ke `public."user"(id)` (pola yang sudah dipakai `cae08ee` untuk user_acquisition). Perhatikan perbedaan tipe: `public."user".id` adalah `text`, sedangkan kolom FK sekarang `uuid` — butuh normalisasi tipe (mis. `uuid` tetap dipakai dan `public."user".id` divalidasi format UUID, atau kolom FK diubah `text`).

### B2. Drift skema: 5 migrasi kritis ada di `neon/migrations/` tapi tidak di `db/migrations/`
- **KATEGORI:** BUG — **TERVERIFIKASI (diff direktori)**
- **LOKASI:** `neon/migrations/` berisi 5 file yang tidak ada di `db/migrations/`: `20261004000000_live_drift_capture.sql`, `20261004010000_auth_uid_guc_fix.sql`, `20261005000000_better_auth_schema.sql`, `20261027000000_admin_catalog_stories.sql`, `20261028120000_catalog_admin_review.sql`.
- **Dampak:** `db/migrations/` adalah sumber skema tunggal (AGENTS.md) dan runner `pnpm db:migrate` hanya membaca situ. Setup baru/staging/CI/recovery dari nol tidak akan punya tabel better-auth, tabel katalog, dan RPC `spend_bundle_v1` — aplikasi tidak jalan. Bonus: `20261103090000_repoint_user_acquisition_fk.sql` menambah FK ke `public."user"` yang dibuat oleh migrasi yang hilang, jadi urutan migrasi fresh akan crash.
- **Perbaikan:** Salin kelima file ke `db/migrations/` dengan urutan timestamp konsisten, lalu jalankan migrasi fresh di DB sementara sebagai bukti.

### B3. Race double-spend + saldo minus pada penukaran saldo imbalan → Lakoin
- **KATEGORI:** SECURITY — **TERVERIFIKASI (kode)**
- **LOKASI:** `lib/rewards/server.ts:129-152`; RPC `grant_reward_v1` di `db/migrations/20260917000000_dompet_imbalan_referral.sql:83-93` tidak memeriksa saldo dan tidak ada lock.
- **Bukti:** Cek saldo dilakukan di Node (`balance < amountIdr`) tanpa lock, lalu deduksi via `grant_reward_v1` yang hanya INSERT. `ref` dibuat `randomUUID()` baru per panggilan sehingga constraint UNIQUE tidak menahan replay, dan deduksi + grant Lakoin bukan satu transaksi.
- **Dampak:** Kirim 5 request paralel dengan saldo Rp1.000 → kelima lolos cek → saldo jadi −Rp4.000 dan Lakoin 5× lipat. Uang nyata.
- **Perbaikan:** Satu RPC atomik `redeem_reward_credits_v1` dengan `pg_advisory_xact_lock(hashtext(user_id))` (pola yang sudah dipakai `spend_credits_v1`/`spend_tinta_v1`), cek saldo di dalam lock, tulis kedua ledger dalam 1 transaksi, ref deterministik.

### B4. Tinta → Lakoin: dua RPC terpisah dikoordinasikan Node (bukan transaksi DB)
- **KATEGORI:** BUG — **TERVERIFIKASI (kode)**
- **LOKASI:** `lib/tinta/server.ts:112-165`.
- **Bukti:** `spend_tinta_v1` commit → `grant_credits_v1` commit → kalau grant gagal, kompensasi `grant_tinta_v1` dikirim terpisah. Tiga transaksi independen.
- **Dampak:** (a) Server mati/putus koneksi setelah langkah 1 → Tinta hangus tanpa Lakoin. (b) Langkah 2 sukses di DB tapi timeout ke Node → kompensasi jalan → user dapat Lakoin DAN Tinta kembali (duplikasi mata uang).
- **Perbaikan:** Satu fungsi SQL atomik `exchange_tinta_to_lakoin_v1` (lock per user, potong Tinta + grant Lakoin dalam satu blok, return `insufficient` bila kurang).

### B5. Pembelian Google Play tidak pernah di-consume/acknowledge
- **KATEGORI:** SECURITY & BUG — **TERVERIFIKASI (kode)**
- **LOKASI:** `app/api/play-billing/verify/route.ts:56-78` (grant langsung, tidak ada panggilan consume) dan `lib/paycore/play-billing.server.ts` (hanya MEMBACA `acknowledgementState`, tidak pernah menulis).
- **Dampak:** Aturan Google Play: purchase yang tidak di-acknowledge dalam 72 jam otomatis dibatalkan dan uang kembali ke pembeli — pembeli tetap memegang Lakoin. Juga pembeli tidak bisa membeli SKU yang sama lagi (`ITEM_ALREADY_OWNED`) sebelum 72 jam.
- **Perbaikan:** Setelah `playBillingGrantV1` sukses, panggil `purchases.products.acknowledge` (atau consume untuk SKU consumable) via Google Play Developer API.

### B6. Pool Better Auth tanpa handler `error` → crash proses saat koneksi idle Neon diputus
- **KATEGORI:** BUG — **TERVERIFIKASI (kode)**
- **LOKASI:** `lib/auth.ts:22-28` (Pool tanpa `pool.on('error')`) vs `lib/db/db.ts:28-31` (pool utama sudah punya).
- **Dampak:** Neon pooler rutin memutus koneksi idle. Event `'error'` tidak tertangani pada Pool `pg` memicu `uncaughtException` → proses Next.js mati mendadak (502). Ini pola crash yang sama yang sudah dimitigasi di pool utama.
- **Perbaikan:** Tambahkan `poolInstance.on('error', ...)` yang sama, atau satukan pool auth dengan pool Kysely.

### B7. Grant kredit via token runtime selalu gagal: sentinel UUID melanggar FK
- **KATEGORI:** BUG — **TERVERIFIKASI (kode)**
- **LOKASI:** `app/api/admin/credits/grant/route.ts:31` (`adminUserId = '00000000-...'` untuk jalur `x-runtime-token`) + `db/migrations/20260711010000_ops_credit_config.sql:113-118` (`admin_user_id uuid not null references auth.users(id)`).
- **Dampak:** Otomasi/ops yang memanggil endpoint ini tanpa sesi cookie selalu kena FK violation → 500. Jalur token yang didesain "backward compat" tidak pernah bisa jalan.
- **Perbaikan:** Buat user sistem nyata di DB untuk aktor token, atau jadikan `admin_user_id` nullable untuk grant via token.

---

## 🟡 MAJOR

### M1. Fallback sesi memotong signature HMAC cookie
`lib/auth.ts:143-154` — bila `getSession` gagal, cookie di-split `.` dan token mentahnya dipakai sebagai Bearer. Integritas signature cookie jadi tidak berarti; siapa pun yang punya token mentah (mis. dari log) cukup kirim cookie tanpa signature. **Perbaikan:** hapus fallback ini; klien yang butuh Bearer harus kirim header eksplisit.

### M2. Verifikasi email tidak pernah diwajibkan
`lib/auth.ts:44-67` — `emailVerification.sendOnSignUp: true` ada, tapi tanpa `emailAndPassword.requireEmailVerification: true`, akun langsung aktif tanpa membuktikan kepemilikan inbox. Efek samping: siapa pun bisa mendaftar dengan email orang lain, dan error `USER_ALREADY_EXISTS` (422) membocorkan status registrasi email. Cek `EMAIL_NOT_VERIFIED` di `app/auth/login/login-form.tsx:55-60` tidak akan pernah terpicu.

### M3. Refund/chargeback diabaikan — kredit tidak pernah ditarik
`lib/entitlement/paycore.ts:82` (`if (eventType !== PAYMENT_SUCCEEDED) return { badType: true }`) dan `grant_credits_v1` menolak delta ≤ 0. Pembeli refund via gateway tetap memegang Lakoin. Perlu handler event refund + RPC clawback.

### M4. Bonus top-up pertama bisa diambil berulang dari jalur Play Billing
`db/migrations/20260711010000_ops_credit_config.sql:97-103` — `has_paid_topup_v1` hanya cek `ref like 'paycore:%'`, sedangkan jalur Play Billing memakai ref `playbilling:...`. Hasilnya: pembelian Play Billing selalu dianggap "top-up pertama" (`app/api/play-billing/verify/route.ts:65`) → bonus perdana diterima berulang. Perbaikan: cek kedua channel.

### M5. `/api/admin/metrics` & `/api/admin/alerts`: query tanpa batas → OOM
`lib/observability/telemetry.ts:234` — tanpa parameter `storyId`, query memindai seluruh `story_events` (payload JSON) tanpa LIMIT, tanpa rate limit. Permintaan berulang bisa menghabiskan heap. Wajibkan window waktu + paging + limit.

### M6. Perbandingan token tidak timing-safe pada guard admin
`lib/auth/admin-guard.ts:22` — `provided !== adminToken` untuk `RUNTIME_ADMIN_TOKEN` yang mengamankan metrics, broadcast push, dan grant kredit. Route recover sudah benar pakai `timingSafeEqual`; samakan di sini.

### M7. Wildcard LIKE tidak di-escape pada pencarian user admin
`db/migrations/20260711020000_admin_users_role.sql:17` — input `?email=%%` melewati batas 2 karakter dan mencocokkan semua baris → dumping email user bertahap (10 per permintaan). Escape `%`, `_`, `\`.

### M8. `cover/apply` menerima URL eksternal bebas
`app/api/stories/[id]/cover/apply/route.ts:28-41` — `body.url` tidak diverifikasi terdaftar di `story_cover_candidates` atau berawalan base R2. Cerita publik bisa memaksa browser pembaca lain memuat gambar dari domain penyerang (kebocoran IP pembaca, konten ilegal tanpa kurasi).

### M9. Endpoint report publik tanpa rate limit & tanpa cek eksistensi
`app/api/stories/[id]/report/route.ts:14-46` — anonim boleh kirim, `storyId`/`chapterNumber` tidak dicek ada, tidak ada limit per IP → spam tabel report/story_events (DoS biaya DB Neon).

### M10. `analytics/track` publik tanpa rate limit
`app/api/analytics/track/route.ts` — zod strict + size guard sudah baik, tapi tidak ada limit → flood baris analytics. Data funnel pra-launch (dasar keputusan go/no-go) bisa tercemar bot. Tambah limit per IP/anonymous_id + sampling.

### M11. Kegagalan kirim email reset password senyap
`lib/email/mailketing.ts:14-17` mengembalikan `{ success: false }` tanpa throw; callback `sendResetPassword`/`sendVerificationEmail` di `lib/auth.ts:50-56` tidak memeriksa hasilnya → Better Auth membalas sukses padahal email tidak terkirim. Throw error agar user tahu dan monitoring menangkapnya.

### M12. Race sequence `story_events` (baca MAX lalu insert)
`lib/observability/telemetry.ts:79-100` — `MAX(seq)+1` tanpa lock dengan unique `(story_id, seq)` → event dibuang saat tabrakan (tanpa retry seperti di modul lain). Insert atomik via subquery + retry on conflict.

### M13. `catalog_stories.chapter_price`/`bundle_price` tanpa CHECK ≥ 0
`neon/migrations/20261027000000_admin_catalog_stories.sql:16-17` — harga negatif dari kesalahan admin menyuntikkan kredit gratis via `spend_bundle_v1`/unlock. Tambah constraint CHECK.

### M14. Kredensial dev Reticle ikut bundle produksi
`NEXT_PUBLIC_RETICLE_TOKEN`/`NEXT_PUBLIC_RETICLE_URL` dipakai di `app/reticle-dev.tsx:13-17`. Komponen hanya dirender saat development (`app/layout.tsx:75`), tapi nilai `NEXT_PUBLIC_*` tetap ter-inline di bundle produksi. Gunakan env tanpa prefix `NEXT_PUBLIC_` dan injeksi via server, atau pisahkan file dari graph produksi.

### M15. Fallback `DATABASE_URL` dummy di pool auth
`lib/auth.ts:24` — `'postgresql://postgres:postgres@localhost:5432/dummy'` menutupi env yang hilang dengan kegagalan samar. Buat fail-closed seperti pool utama.

*(Catatan: M4 dan B3 terkait — keduanya di jalur hadiah/top-up; perbaiki bersama.)*

---

## 🟢 NIT

1. **7 route settings admin + 2 route blueprint-review** membalas `Unauthenticated` dengan 500 alih-alih 401 (pola catch di `app/api/admin/settings/*/route.ts:22` dan `app/api/blueprint-review/*/route.ts:24-43`) → false positive di monitoring. Fail-closed, hanya klasifikasi status salah.
2. **Arsip katalog & push via API tidak mencatat aktor**: `lib/catalog/admin.server.ts:606` menerima `adminUserId` tapi tidak menyimpannya; `app/api/admin/push/send/route.ts:21` tidak mengisi `sent_by` (Server Action versi web sudah benar).
3. **`/api/auth/android` stub kosong** (`app/api/auth/android/route.ts:4-8`) — sisa migrasi, tidak menerbitkan token (aman) tapi alur bridge Android tidak sinkron dengan klaim komentar di `app/auth/android-bridge/page.tsx`.
4. **`push/subscribe` upsert per `fcm_token`** menimpa `user_id` — user lain yang tahu token bisa mencuri binding device (risiko rendah, butuh token orang lain).
5. **Counter cover bisa crash cast** (`neon/migrations/20260920000000_story_cover_generation.sql:70-76`) — `substring(...)::int` fatal bila ada ref dengan format lain; escape backslash juga belum ada.
6. **Redeem tanpa idempotency key dari klien** — `randomUUID()` per panggilan membuat retry timeout menarik saldo dua kali (bagian dari B3; jika B3 diperbaiki dengan RPC atomik, ini ikut selesai).
7. **Wildcard tanpa `escape` clause eksplisit** pada beberapa LIKE lain — audit saat menyentuh file yang sama.
8. **Cerita gagal/ kosong tampil di "Dari Pembaca Lain"** — `lib/api/queries.ts:228-245` hanya filter `visibility='public'`; cerita dengan `generation_status='failed'` atau 0 bab tetap muncul dan berujung halaman kosong. (Bug kualitas tampak, bukan security.)

---

## AREA SUDAH AMAN (terverifikasi)

- **Webhook checkout**: HMAC-SHA256 timing-safe, toleransi timestamp 5 menit, idempotensi via ref unik (`lib/entitlement/paycore.ts:128-144`).
- **AdMob SSV**: verifikasi ECDSA kunci publik Google + advisory lock + anti-replay transaction_id + cap harian di DB (`lib/missions/admob-ssv.ts:43-118`).
- **Klaim misi**: advisory lock per user + unique `(user_id, mission_key, day_jkt)`, reset harian dikunci `Asia/Jakarta` di DB.
- **Unlock bab**: `spend_credits_v1` atomik ber-lock; re-unlock bab yang sudah dibeli gratis (`lib/credits/access-resolver.server.ts:103-118`).
- **Ownership cerita**: semua route `[id]` mengunci `visibility='public' OR owner_user_id = user.id`; mutasi mengunci owner; non-owner tidak bisa picu generasi.
- **Gate akses bab**: `resolveChapterAccess()` di server — bab belum unlock ditolak 402/403; route status tidak membocorkan teks.
- **Biaya AI**: concurrency per user = 1, global = 10, hard cap biaya/bab; output AI tervalidasi zod strict + `assertConsumerSafe`/`scanForLeaks` (brand guard terjaga).
- **Cover upload**: magic byte + batas 8MB + re-encode sharp (EXIF dibuang), path R2 tak bisa menimpa milik orang lain.
- **Otorisasi admin**: deny-by-default di semua 22 route (5 varian guard, tidak ada route telanjang); settings audit-log aktif; API key provider tidak pernah diekspos.
- **Session & password**: bcrypt cost 10 timing-safe, token reset ~143-bit single-use berbatas waktu, rate limiter bawaan Better Auth aktif di produksi, cookie httpOnly/secure/sameSite, admin tersimpan di tabel terpisah (imun mass-assignment).
- **Referral**: self-referral ditolak, jendela 30 hari dicek server, komisi dari snapshot harga DB.
- **XSS**: tidak ada sink HTML untuk konten user/AI (satu-satunya `dangerouslySetInnerHTML` = string statis tema); link eksternal lengkap `rel="noopener noreferrer"`; redirect pasca-login tervalidasi `sanitizeNextPath`.

---

## Matriks Jejak (temuan → asal → status verifikasi)

| ID | Asal | Status |
|---|---|---|
| B1 | Agen DB + Agen Uang | ✅ Diverifikasi manual + data produksi |
| B2 | Agen DB | ✅ Diverifikasi manual (diff direktori) |
| B3 | Agen Uang + Agen DB (konvergen independen) | ✅ Diverifikasi manual (kode) |
| B4 | Agen DB (konvergen dengan Agen Uang) | ✅ Diverifikasi manual (kode) |
| B5 | Agen Uang | ✅ Diverifikasi manual (grep consume/acknowledge) |
| B6 | Agen DB | ✅ Diverifikasi manual (kode) |
| B7 | Agen Admin | ✅ Diverifikasi manual (kode) |
| M1–M15 | Berbagai | ✅ Diverifikasi manual (kode) |
| Nit 1–8 | Berbagai | ✅ Diverifikasi manual (kode) |

Temuan agen yang TIDAK masuk laporan karena gagal verifikasi: klaim bahwa `db/migrations` kehilangan migrasi `user_acquisition` (keliru — file ada), klaim saturasi RLS (RLS memang enable di beberapa tabel tapi tidak menjadi vektor karena semua akses via service route — dipantau saja).

---

## Rencana Eksekusi yang Disarankan

**P0 — hari ini (uang & stabilitas):**
1. Repoint FK massal `auth.users` → `public."user"` (B1) — sekaligus uji klaim misi user baru sebagai bukti.
2. Sinkronkan 5 migrasi ke `db/migrations/` (B2) + uji migrasi fresh.
3. RPC atomik redeem imbalan (B3) + exchange Tinta (B4).
4. `pool.on('error')` di `lib/auth.ts` (B6) — satu baris, mencegah crash produksi.
5. Acknowledge/consume Play Billing (B5) + perbaiki `has_paid_topup_v1` (M4).
6. Perbaiki sentinel grant admin (B7).

**P1 — minggu ini:**
M1 (hapus fallback sesi), M2 (wajib verifikasi email), M3 (handler refund), M5+M9+M10 (rate limit & batas query), M6 (timing-safe), M8 (whitelist URL cover), M11 (email gagal = throw).

**P2 — kebersihan:**
Seluruh Nit + M7, M12–M15.

Semua perubahan P0 menyentuh jalur uang → ikuti aturan project: verifikasi Reticle per fitur sebelum commit, commit terpisah per alur, dan uji idempotensi retry sebelum deploy.
