# Instrumentasi Funnel & Gerbang Promosi Lakoku

*   **Author:** moxsenna (dengan ZCode + tinjauan EGM Goldfish; remediasi r1 2026-11-01)
*   **Status:** Proposed (v2 — hasil review 5 stage, lihat `docs/audits/2026-11-01-prelaunch-analytics-review.md`)
*   **Date:** 2026-10-31 (v2: 2026-11-01)

--------------------------------------------------------------------------------

## Overview

Lakoku sudah live secara teknis di VPS, tetapi belum diluncurkan — belum ada satu pun pembaca nyata. Pemilik tidak bisa menjawab tiga pertanyaan bisnis dasar: kapan layak membelanjakan uang untuk promosi soft-launch, di bab ke berapa pembaca berhenti, dan apakah satu pembaca menghasilkan rupiah lebih besar daripada biaya AI-nya.

Desain ini adalah paket pra-launch analitik minimal yang menjawab ketiganya. Prinsip utamanya: hampir semua capture sudah terpasang di kodebase; satu-satunya data yang hilang selamanya jika tidak dipasang sebelum pembaca pertama adalah **sumber akuisisi** (kanal asal pembaca). Sisanya adalah verifikasi sekali jalan, satu laporan terpadu yang dibangun saat trafik mengalir, dan kerangka gerbang promosi yang angkanya diisi pemilik setelah ada baseline.

## The Problem

Pemilik saat ini tidak memiliki visibilitas atas tiga hal sekaligus:

1. **Funnel terpasang tapi tidak terlihat.** Event funnel baca (`chapter_viewed`, `paywall_viewed`, `checkout_started`) sudah ter-wire di kode dan tersimpan di tabel `analytics_events` — tetapi tidak ada satu pun kode di seluruh codebase yang membaca tabel itu, pengiriman event menelan kegagalan tanpa indikasi apa pun, dan payload invalid dibuang senyap di produksi. Event bisa mati 100% tanpa sinyal; laporan akan menampilkan nol dan keputusan tetap diambil dari data kosong.
2. **Sumber akuisisi tidak terekam.** Tidak ada capture UTM/referrer. In-app browser WhatsApp/Instagram/TikTok tidak selalu mempertahankan query param saat link dibagikan ulang — tanpa mekanisme fallback, banyak trafik akan muncul sebagai "unknown" dan pertanyaan "kanal mana yang pantas diberi uang iklan" tidak bisa dijawab. Klasifikasi share ditutup oleh slug link sendiri (fallback yang berdiri sendiri tanpa parameter).
3. **Biaya dan pendapatan tidak pernah digabung.** Biaya AI per pembaca sudah tercatat lengkap di `generation_provider_calls` (`user_id NOT NULL` + `cost_amount`), dan pendapatan tercatat di `credit_orders` (web) + `credit_orders_v2` (Play billing; lihat `docs/PAYCORE_INTEGRATION.md` §6) — tetapi tidak ada laporan yang menggabungkannya. Perlu dicatat: kolom `amount_idr` di `credit_orders_v2` saat ini di-hardcode 0 oleh RPC grant, sehingga derivasi harga Android adalah prasyarat laporan ekonomi (diatur di bagian Definisi). Checkout gagal tidak pernah mendapat status terminal (`failed` tidak pernah ditulis) sehingga funnel pembayaran tidak bisa membedakan abandon vs gagal bayar.

Solusinya: capture akuisisi berlapis (cookie first-touch + hook signup + parameter share) dipasang sebelum launch; verifikasi produksi berbasis verifikasi baris nyata; satu laporan terpadu; gerbang promosi dengan lantai statistik dan status UNRATIFIED sampai pemilik meratifikasinya dari baseline nyata.

## Goals

*   **G1 — Sumber akuisisi tercatat sejak pembaca pertama.** Setiap kunjungan menandai sumbernya di cookie first-touch (kanal dari taksonomi tertutup, parameter UTM, referrer host); saat pembaca mendaftar, tepat satu baris tertulis ke tabel `user_acquisition` — signup tanpa baris adalah pelanggaran kontrak ini. Setiap signup punya nilai sumber; signup tanpa penanda diklasifikasi `direct`, bukan dibiarkan kosong. Konsekuensi OQ1=A yang diterima: kunjungan tamu yang tidak pernah mendaftar tidak membawa kanal; tidak ada event kunjungan baru.
*   **G2 — Kesehatan funnel teramati.** Verifikasi sekali jalan (`pnpm analytics:verify`) membuktikan event kritis sampai ke database produksi (memverifikasi baris nyata, bukan cek kode), plus baris `user_acquisition` dari akun QA. Health-check permanen membedakan "pipeline mati" dari "trafik belum ada": event top-of-funnel nol dalam 24 jam = BREACH; event late-funnel nol = WATCH; seluruh signup `direct` setelah ≥10 signup = sinyal capture akuisisi mati.
*   **G3 — Tiga pertanyaan bisnis terjawab dari satu perintah.** `pnpm analytics:report` menghasilkan: kurva drop-off per bab (dedup sisi server, definisi dibekukan di bagian Definisi), ekonomi pembaca (union dua tabel order, distribusi median + p90), funnel launch-week (tahapan di bagian Definisi), dan retensi D1.
*   **G4 — Keputusan promosi lewat gerbang terukur.** `pnpm analytics:gate` menampilkan `LOLOS | BLOKIR | DATA BELUM CUKUP | MENUNGGU RATIFIKASI` dengan lantai kohort minimum dan jendela observasi; angka ambang berstatus UNRATIFIED sampai pemilik meratifikasinya dari baseline kohort seed. Pembangunan file gerbang ditunda sampai OQ6 terjawab; sebelum itu, keluaran gerbang disediakan sebagai seksi `analytics:report`.

## Non-Goals

*   **Menjawab "kenapa" pembaca berhenti.** Event hanya menjawab "di bab ke berapa". Survei keluar ditunda sampai ada kohort seed nyata.
*   **Dashboard UI.** Laporan teks dari terminal cukup untuk satu pemilik.
*   **Event `purchase_completed` baru.** Dua tabel order adalah sumber kebenaran pendapatan; sumber kedua menimbulkan drift.
*   **Menetapkan angka ambang gerbang sekarang.** Tanpa baseline, semua angka tidak punya dasar statistik.
*   **Model atribusi multi-touch atau parameter UTM mentah bebas teks.** Melanggar schema reader-safe (`.strict()`, tanpa teks bebas) dan menghasilkan kardinalitas tanpa sinyal di kohort kecil.
*   **Memproses refund.** Laporan membawa kaveat tertulis: pendapatan paid-only, buta refund.
*   **Perubahan pada logika naratif dan alur baca.** Tidak ada perubahan pada `lib/narrative/` atau seam `lib/api/`; risiko regresi pembaca rendah dan terlokalisasi di middleware/capture, diverifikasi via CUJ 3.

## Open Questions

Semua OQ berikut dimiliki pemilik (moxsenna) kecuali dinyatakan lain.

*   **OQ1 — Penyimpanan atribusi akuisisi:** DIPUTUSKAN pemilik 2026-10-31 — **Opsi A, tabel baru `user_acquisition`** (catatan keputusan primer: tabel OQ1 di bagian Technical Plan). Konsekuensi yang diterima: tidak ada event `landing_viewed`/field kanal di schema event; kanal hanya terekam untuk kohort signup.
*   **OQ2 — Angka ambang gerbang** (pemilik): retensi D1 ≥ ?, konversi bayar ≥ ?, pendapatan/biaya-AI ≥ ?. Metode: dibaca dari baseline kohort seed pertama.
*   **OQ3 — Rencana 100 pembaca pertama** (pemilik): jika penyebaran memakai link tanpa penanda, capture menghasilkan `direct` untuk hampir semua trafik; komitmen menandai setiap link disebar menentukan nilai capture.
*   **OQ4 — Kebijakan tamu** (pemilik): SISA pertanyaan — apakah tamu pra-signup boleh memicu generasi AI (mempengaruhi atribusi biaya). Bagian "tamu dilaporkan terpisah" SUDAH diputuskan dan dibekukan di bagian Definisi.
*   **OQ5 — Kebijakan refund** (pemilik): apakah refund akan diproses manual via dashboard PayCore (penyedia pembayaran web; `docs/PAYCORE_INTEGRATION.md`) — menentukan kaveat laporan pendapatan.
*   **OQ6 — Tanggal keputusan promosi** (pemilik): tanpa tanggal target, gerbang tidak punya pemicu; file gerbang hanya dibangun setelah OQ6 terjawab (lihat G4).

## Critical User Journeys (CUJs)

### CUJ 1: Calon pembaca dari link berpenanda

*   **Given**: Build produksi dengan capture akuisisi live; belum ada pengguna.
*   **When**: Calon pembaca membuka link `lakoku.id/?utm_source=instagram` dari Instagram, menyelesaikan quiz setup, dan mendaftar.
*   **Then**: Cookie first-touch terisi `c='instagram'` + parameter UTM; saat signup, tepat satu baris di `user_acquisition` mengaitkan user dengan kanal tersebut. Laporan funnel launch-week (kohort signup) menampilkan kanal `instagram`, bukan `direct`.

### CUJ 2: Calon pembaca dari link share tanpa parameter UTM

*   **Given**: Pembaca lama membagikan link share `/s/<slug>` ke WhatsApp.
*   **When**: Penerima membuka link share tersebut.
*   **Then**: `share_link_opened` tercatat dengan `share_slug` (ukuran siklus share antar-pembaca), dan middleware mengklasifikasi kunjungan sebagai `share_link` via path `/s/*` — tidak jatuh ke `direct`. Atribusi durable baru tertulis jika penerima mendaftar; tamu tidak teratribusi by design (OQ1=A).

### CUJ 3: Pemilik memverifikasi funnel sebelum launch

*   **Given**: Deploy Fase 1 selesai; produksi masih nol pengguna.
*   **When**: Pemilik menjalankan `pnpm analytics:verify`; akun QA (UUID tetap) menelusuri funnel.
*   **Then**: Script memverifikasi bahwa baris `story_setup_entry_viewed`/`chapter_viewed`/`paywall_viewed`/`checkout_started` dan baris `user_acquisition` muncul di produksi (dibaca via service-role), lalu menghapus baris QA; exit 0 berarti funnel benar-benar terekam di produksi, bukan sekadar ada di kode.

### CUJ 4: Pemilik mengambil keputusan promosi

*   **Given**: Kohort seed berjalan; status ratifikasi ambang diketahui.
*   **When**: Pemilik menjalankan `pnpm analytics:report` lalu `pnpm analytics:gate`.
*   **Then**: Laporan mencetak drop-off per bab, ekonomi pembaca (median+p90), funnel, retensi D1, dan health-check per event. Gerbang mencetak `DATA BELUM CUKUP` bila lantai kohort/jendela belum terpenuhi, `MENUNGGU RATIFIKASI` bila lantai terpenuhi tetapi OQ2 belum diratifikasi, lalu `LOLOS`/`BLOKIR` terhadap angka yang diratifikasi pemilik.

## Technical Plan

Tiga lapis, semuanya additive terhadap codebase — tidak ada perubahan pada `lib/narrative/`, seam `lib/api/`, atau alur baca:

```text
Calon pembaca (kunjungan pertama)
  │
  │ middleware (matcher diperluas: + /mulai, + /auth/:path*, + /r/:path*;
  │            /s/:path* dan /baca/:path* SUDAH tercakup sejak sekarang)
  ├─► cookie first-touch `lakoku_utm` pada SEMUA response (termasuk redirect),
  │   klasifikasi via path/parameter UTM/referrer; first-touch wins
  │
  ├─ signup ─► hook user.create.after ─► tepat 1 baris ke tabel `user_acquisition` (OQ1=A)
  │
  └─ baca/bayar ─► chapter_viewed / paywall_viewed / checkout_started ──► analytics_events

generation_provider_calls (biaya, user_id) ──┐
credit_orders + credit_orders_v2 (pendapatan)┴─► pnpm analytics:report ─► teks:
                                                  drop-off | ekonomi | funnel | D1 | health
                                              └─► pnpm analytics:gate ─► 4 keadaan (lihat G4)
```

### Lapis 1 — Capture akuisisi (pra-launch)

- **Schema**: field payload baru `share_slug` (regex `^[a-z0-9_-]{1,32}$`) pada `share_link_opened` — menutup celah klasifikasi siklus share. Tidak ada event baru (OQ1=A): anchor funnel paling awal tetap `story_setup_entry_viewed`, dan gap "tidak ada event kunjungan pertama" diterima sebagai konsekuensi pilihan A. Schema zod `.strict()` adalah titik validasi wajib — payload invalid dibuang senyap di produksi, sehingga schema ini satu-satunya jalur validasi.
- **Middleware**: matcher saat ini SUDAH memuat `/s/:path*` dan `/baca/:path*` (deep link share sudah tercakup). Perluasan hanya: `/mulai`, `/auth/:path*`, `/r/:path*`. Catatan: `/baca/*` ada di `PROTECTED_PREFIXES` — tamu yang deep-link ke bab di-redirect sebelum halaman render; capture tetap berjalan karena cookie ditempel di middleware sebelum redirect. Cookie ditempel pada SEMUA response, termasuk `NextResponse.redirect` (menutup kasus pengunjung login yang di-redirect dari `/` ke `/beranda`). First-touch wins: cookie yang sudah ada tidak ditimpa.
- **Cookie first-touch**: nama `lakoku_utm`; nilai = JSON pendek ter-encode: `{"c":"<kanal>","us":"<utm_source>","uc":"<utm_campaign>","rh":"<referrer_host>"}`; maxAge = konstanta mandiri `ACQUISITION_COOKIE_DAYS = 30` (Bukan mirror `RewardPolicy.attributionCookieDays` — itu setting admin live milik referral; dua concern, satu knob = bahaya). Cookie rusak/hilang saat dibaca → fail-open `direct`.
- **Taksonomi kanal (dibekukan)** — 10 nilai:

  | Kanal | Pemicu klasifikasi |
  |---|---|
  | `whatsapp` | `utm_source` ∈ {whatsapp, wa} |
  | `instagram` | `utm_source` ∈ {instagram, ig} |
  | `tiktok` | `utm_source` ∈ {tiktok, tt} |
  | `x_twitter` | `utm_source` ∈ {x, twitter} |
  | `email` | `utm_source` = email, atau referrer host mail provider |
  | `google` | referrer host google (organic search) |
  | `share_link` | path `/s/*` |
  | `referral_code` | path `/r/*` |
  | `direct` | tidak ada penanda sama sekali |
  | `other` | `utm_source` dikenal adanya tetapi di luar daftar |

  `utm_source` tidak dikenal → `other` (bukan `direct`). Tambah nilai belakangan = edit daftar + `ALTER TYPE ... ADD VALUE` tidak diperlukan (representasi `text+CHECK`, lihat file 6).

### Lapis 2 — Verifikasi (sekali jalan post-deploy + health permanen)

- **Probe**: script mengirim event QA dengan `anonymous_id` UUID tetap ke `/api/analytics/track`, memverifikasi baris muncul di produksi via koneksi `getDb()` (satu-satunya bukti kebenaran — transport fire-and-forget menelan error), lalu menghapus baris QA; plus mengasert satu baris `user_acquisition` dari akun QA. Konektivitas mengikuti `scripts/daily-cost-monitor.ts` aktual: `DATABASE_URL` via `getDb()`. One-off, manual, bukan bagian `pnpm smoke` (CI tidak boleh mengakses DB produksi).
- **Health-check**: bagian permanen `analytics:report` (dijalankan manual oleh pemilik; ritme harian disarankan). Semantik (mengikuti pola WATCH/BREACH `cost:daily`: WATCH = peringatan, exit 0; BREACH = pelanggaran, exit 1):
  - `story_setup_entry_viewed` atau `chapter_viewed` nol dalam 24 jam → BREACH (top-of-funnel; pipeline mati).
  - `paywall_viewed`/`checkout_started` nol dalam 24 jam → WATCH saja (late-funnel wajar nol di kohort seed).
  - ≥10 signup dan 100% `source='direct'` → BREACH (capture akuisisi mati senyap).

### Lapis 3 — Laporan & gerbang (dibangun saat trafik mengalir, Fase 3)

- **Satu pintu `pnpm analytics:report`** (bukan tiga script): logika murni di `lib/commercial/` (unit-testable, pola `lib/commercial/daily-cost-report.ts`), script tipis di `scripts/`. Isi: drop-off per bab, ekonomi pembaca, funnel launch-week, retensi D1, health-check.
- **`pnpm analytics:gate`**: konstanta ambang berstatus UNRATIFIED dengan `decisionRef` (preseden: `E0_R1_DECISION_REF` di `lib/commercial/daily-cost-report.ts` — plafon biaya harian produksi yang diratifikasi PM). Lantai statistik: kohort ≥ 100 signup melewati funnel; jendela observasi D1 minimal 7 hari (kandidat final 7–14, ditetapkan pemilik saat ratifikasi); jendela konversi 30 hari. Empat keadaan output (lihat G4). Evaluasi manual oleh pemilik — bukan cron; file gerbang dibangun hanya setelah OQ6 terjawab.

### Definisi metrik dibekukan

Definisi berikut adalah satu blok spesifikasi utuh (bukan tambalan). Referensi "definisi beku" di bagian lain dokumen menunjuk ke blok ini.

- **Zona waktu**: semua "hari" = kalender Asia/Jakarta (pembaca UTC+7), dihitung dari `created_at` kolom tabel (server truth), bukan field payload.
- **First-view**: `min(created_at)` per `(coalesce(anonymous_id, user_id), story_id, chapter_number)` — dedup sisi server; dedup client hilang saat refresh. Kunci memakai `anonymous_id` dulu karena `chapter_viewed` dari client selalu membawanya, dan tamu yang signup di tengah baca tidak terpecah jadi dua identitas.
- **Drop-off bab N** = 1 − tingkat lanjut; tingkat lanjut = (pembaca yang first-view bab N+1 dalam 7 hari sejak first-view bab N) / (pembaca yang first-view bab N dan sudah memiliki peluang observasi ≥7 hari). "Sampai bab N" dioperasionalisasi sebagai first-view bab N — `chapter_viewed` membuktikan pembukaan, bukan penyelesaian. Sensoring 7 hari mencegah kurva bias naik dan angka berubah mundur antar-run.
- **Model identitas**: drop-off berkunci `coalesce(anonymous_id, user_id)`; D1 dan ekonomi berkunci `user_id`. Angka drop-off dan ekonomi tidak akan pernah rekonsiliasi per "orang" — ini desain, bukan bug.
- **Retensi D1**: kohort login; anchor = hari kalender (Asia/Jakarta) dari first `chapter_viewed` ber-user; D1 = mengisi `chapter_viewed` di hari +1.
- **Ekonomi pembaca**: kohort login, jendela 30 hari sejak signup. Pendapatan = union `credit_orders` (`status='paid'`, kolom `price_idr`) + `credit_orders_v2` (`status='succeeded'`). Derivasi harga Android: RPC `play_billing_grant_v1` WAJIB diperbaiki (diluar scope Fase 1 — amendemen NFR: ini perubahan perilaku RPC, bukan additive) agar men-snapshot `price_idr` dari `credit_products` saat grant, mengikuti pola order web; baris historis `amount_idr=0` membawa kaveat tanggal di laporan. Biaya = `generation_provider_calls` GROUP BY `user_id`; baris `cost_source='unavailable'` di-exclude dan dilaporkan sebagai bar error; konversi USD→IDR memakai konstanta beku dengan `decisionRef`. Output median + p90, bukan hanya rata-rata (distribusi biaya heavy-tailed/ekor panjang). Tamu dilaporkan terpisah.
- **Funnel launch-week** (per kanal, kohort signup; plus agregat): kunjungan berpenanda (cookie) → signup → `story_setup_entry_viewed` → `story_setup_story_started` → `chapter_viewed` bab 1 → `chapter_viewed` bab ≥2 → `paywall_viewed` → `checkout_started` → order `paid`/`succeeded`.
- **Health-check**: lihat Lapis 2.

### OQ1 — Bentuk penyimpanan atribusi akuisisi (DIPUTUSKAN pemilik 2026-10-31: Opsi A)

| Opsi | Mekanisme | Trade-off | Gagal jika |
|---|---|---|---|
| A. Tabel baru `user_acquisition` (DIPILIH) | Baris per user saat signup; RLS + service-role, konsisten dengan pola `analytics_events` | Butuh satu migration + RLS baru; SQL laporan bersih (join langsung ke user) | Butuh sejarah atribusi per kunjungan (bukan first-touch per user) |
| B. Field di schema event | Atribusi hidup sebagai baris event; tanpa migration | Pekerjaan terkecil; SQL memetakan event→user via anonymous_id | Identitas anonim rapuh (localStorage hilang, multi-browser) |
| C. Keduanya | Event kunjungan + tabel durable | Cakupan terlengkap | Dua permukaan tulis, sebagian data tumpang tindih |

## Alternatives Considered

### Alternatif A: Dashboard admin penuh

*   **Pros**: Metrik selalu terlihat tanpa terminal.
*   **Cons**: Permukaan UI + maintenance baru; dibangun untuk audiens nol pengguna.
*   **Reason for Rejection**: Satu pemilik; laporan teks dari terminal cukup. Dashboard bisa menyusul saat trafik nyata.

### Alternatif B: Launch dulu, instrumentasi belakangan

*   **Pros**: Nol pekerjaan pra-launch.
*   **Cons**: Sumber akuisisi tidak dapat dipulihkan — kunjungan hari pertama hilang selamanya.
*   **Reason for Rejection**: Ditolak keras untuk capture akuisisi; justru untuk laporan/gerbang, penundaan ke Fase 3 dianjurkan.

### Alternatif C: Analytics pihak ketiga (GA4/PostHog)

*   **Pros**: Tanpa koding; funnel + akuisisi instan.
*   **Cons**: Tidak bisa join `generation_provider_calls` + tabel order (inti laporan ekonomi); script pihak ketiga di produk mobile-first; berisiko melanggar brand guard (aturan AGENT_RULES: istilah teknis tertentu tidak boleh tampak ke pembaca).
*   **Reason for Rejection**: Join biaya-vs-pendapatan adalah inti laporan; alat pihak ketiga tidak menyediakannya. Seam internal sudah selesai dibangun.

### Alternatif D: Event `purchase_completed` baru

*   **Pros**: Funnel pembayaran lengkap dalam satu tabel event.
*   **Cons**: Sumber kedua di samping `credit_orders`/`credit_orders_v2` = drift.
*   **Reason for Rejection**: Tabel order adalah sumber kebenaran uang; laporan mengambil dari sana.

### Alternatif E: Parameter UTM mentah apa adanya

*   **Pros**: Granularitas kampanye penuh.
*   **Cons**: Schema `.strict()` melarang teks bebas; kardinalitas tinggi tanpa sinyal di kohort kecil.
*   **Reason for Rejection**: Taksonomi tertutup + slug tervalidasi menjaga schema tetap reader-safe dan cukup untuk keputusan kanal.

### Alternatif F: Menyamakan atribusi referral dengan sumber akuisisi

*   **Pros**: Infrastruktur sudah ada.
*   **Cons**: Referral = user-ke-user; bukan kanal eksternal.
*   **Reason for Rejection**: Semantik berbeda; polanya ditiru, bukan disalahgunakan.

### Alternatif G: Tabel `reader_progress` khusus (max_chapter per user)

*   **Pros**: Laporan drop-off eksak tanpa dedup SQL.
*   **Cons**: Write path baru di jalur baca — melanggar prinsip paket minimal dan menambah risiko di hot path.
*   **Reason for Rejection**: Dedup first-view cukup di skala ini; dicatat sebagai cadangan bila laporan event terbukti berisik.

### Alternatif H: Menulis tiga script laporan terpisah pra-launch

*   **Pros**: Semua siap sebelum hari-H.
*   **Cons**: Kode laporan atas data imajiner hampir pasti ditulis ulang; dibangun untuk audiens nol.
*   **Reason for Rejection**: Satu pintu `analytics:report` dibangun di Fase 3; kueri dibekukan sebagai spesifikasi di bagian Definisi, bukan kode.

## Non-Functional Requirements

*   **Security & Privacy**: Semua field reader-safe (enum/slug/bucket, tanpa teks bebas). Tabel `user_acquisition`: RLS diaktifkan tanpa read policy — baca hanya service-role, konsisten dengan pola `analytics_events`. Cookie `lakoku_utm` berisi NOL data pribadi (enum + slug + host). **Posisi UU PDP No. 27/2022 dibekukan: jalur NOTICE** — perbarui halaman `/privacy` (cookie atribusi dinyatakan), dasar pemrosesan interest sah untuk identifier non-PII; jalur CONSENT (banner) ditolak karena memblokir cookie first-touch di kunjungan pertama — persis di in-app browser WA/IG — dan membatalkan G1. Preseden cookie tanpa consent: `lakoku_ref` (referral).
*   **Rollout & Rollback**: Semua perubahan schema additive-only (field jsonb + tabel baru) — rollback = deploy versi lama tanpa reverse migration. Satu pengecualian yang DINYATAKAN: perbaikan RPC `play_billing_grant_v1` (snapshot harga Android) adalah perubahan perilaku pada jalur pembayaran, dijadwalkan sebagai pendamping WAJIB Fase 3, bukan Fase 1. Capture WAJIB live sebelum rupiah promosi pertama; verifikasi produksi HANYA setelah deploy (bukan paralel).
*   **Anti-abuse**: Endpoint `/api/analytics/track` publik hanya punya guard ukuran 10KB. Jika rate limit ditambahkan, limit per `anonymous_id` dengan lantai tinggi — BUKAN per-IP (trafik mobile Indonesia di belakang CGNAT; pembaca nyata berbagi IP). Untuk skala seed, risiko bot diterima dan funnel kritis dibaca dengan disiplin itu.
*   **Performance**: Estimasi dengan asumsi dinyatakan: 10 ribu DAU × rata-rata ~3 `chapter_viewed`/hari + event lain ≈ ~1 juta baris/bulan — remeh untuk Postgres di VPS. Transport lossy by design (fire-and-forget, tanpa retry) diterima pra-launch; laporan membawa kaveat: kehilangan event tidak terukur langsung, angka dibaca sebagai batas bawah.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

### Target Files to Create/Modify

Format entri: setiap entri memakai kalimat perintah. Fase masing-masing entri: file 1–9 = Fase 1; file 10 = Fase 2; file 11–14 = Fase 3.

#### 1. `lib/analytics/events.ts` (Modify)

*   **Type / Scope**: Schema zod event analytics.
*   **Proposed Changes**: Tambahkan field payload `share_slug` (regex `^[a-z0-9_-]{1,32}$`) untuk `share_link_opened`. Tidak menambahkan event baru (OQ1=A). Pastikan field baru didefinisikan di schema ini: payload invalid dibuang senyap di produksi, sehingga schema ini satu-satunya jalur validasi.

#### 2. `scripts/analytics-smoke.ts` (Modify)

*   **Type / Scope**: Smoke test schema.
*   **Proposed Changes**: Tambahkan assert bahwa `share_slug` valid diterima; assert bahwa penolakan teks bebas tetap berlaku (reader-safe tidak tergerus).

#### 3. `lib/acquisition/policy.ts` (Create)

*   **Type / Scope**: Modul murni (unit-testable); WAJIB bebas Node builtin (dipakai middleware Edge runtime).
*   **Proposed Changes**: Definisikan konstanta `ACQUISITION_COOKIE_NAME = 'lakoku_utm'`, `ACQUISITION_COOKIE_DAYS = 30` (konstanta mandiri, bukan dari settings referral), taksonomi kanal (10 nilai, lihat bagian Definisi/Taksonomi), serialisasi & parsing nilai cookie (JSON `{c,us,uc,rh}`, encode; rusak/hilang → null), dan fungsi murni `classify({url, referrerHost})` → `{channel, utm_source, utm_campaign, referrer_host}` dengan pemetaan: `utm_source` dikenal → kanal (whatsapp/wa→whatsapp; instagram/ig→instagram; tiktok/tt→tiktok; x/twitter→x_twitter; email→email); path `/s/*` → `share_link`; path `/r/*` → `referral_code`; referrer google → `google`; tanpa penanda → `direct`; `utm_source` tak dikenal → `other`.

#### 4. `middleware.ts` (Modify)

*   **Type / Scope**: Middleware Next.js.
*   **Proposed Changes**: Tambahkan `/mulai`, `/auth/:path*`, `/r/:path*` ke matcher (`/s/:path*`, `/baca/:path*` sudah ada). Tempelkan cookie `lakoku_utm` pada SEMUA response — `NextResponse.next()` dan kedua jalur `NextResponse.redirect` (bounce rute terproteksi; `/` bersesi → `/beranda`) — hanya bila penanda ada DAN cookie belum ada (first-touch wins). Jalankan klasifikasi via modul file 3.

#### 5. `lib/auth.ts` (Modify)

*   **Type / Scope**: Konfigurasi Better Auth.
*   **Proposed Changes**: Perluas hook `databaseHooks.user.create.after` yang sudah ada: selain `lakoku_ref`, baca cookie `lakoku_utm` dari header `cookie`, parse via modul file 3, dan teruskan nilainya ke pencatat atribusi (file 7). Cookie hilang/rusak → teruskan `null` (pencatat menulis `direct`).

#### 6. `supabase/migrations/<timestamp>_user_acquisition.sql` (Create)

*   **Type / Scope**: Migration Postgres (nama: prefix 14 digit, konvensi repo).
*   **Proposed Changes**: Buat tabel `user_acquisition`: `id uuid primary key default gen_random_uuid()`, `user_id uuid not null unique references auth.users on delete cascade`, `source text not null check (source in ('direct','whatsapp','instagram','tiktok','x_twitter','email','google','share_link','referral_code','other'))` (konvensi `text+CHECK`, bukan `CREATE TYPE`), `utm_source text null`, `utm_campaign text null`, `referrer_host text null`, `created_at timestamptz not null default now()`. Aktifkan RLS tanpa read policy (mirror `analytics_events`). UNIQUE(user_id) menegakkan "tepat satu baris per user".

#### 7. `lib/acquisition/record.server.ts` (Create)

*   **Type / Scope**: Server module (service-role, best-effort fail-open).
*   **Proposed Changes**: Buat `recordAcquisition({userId, parsed})`: upsert (`onConflict('user_id')`) satu baris atribusi — `source` dari hasil klasifikasi, default `'direct'` bila parsed null — VIA service-role dengan pola fire-and-forget seperti `trackServerEvent` (`void ... .catch(() => {})`): kegagalan tidak pernah menggagalkan signup. Tabel terdaftar di `lib/supabase/db-types.ts` (file 8).

#### 8. `lib/supabase/db-types.ts` (Modify)

*   **Type / Scope**: Registry tipe database Kysely.
*   **Proposed Changes**: Tambahkan interface `UserAcquisition` (mengikuti pola `AnalyticsEvents` di file yang sama) dan daftarkan `user_acquisition: UserAcquisition` di interface `Database` — tanpa ini `insertInto('user_acquisition')` (file 7) gagal typecheck.

#### 9. `app/s/[slug]/page.tsx` (Modify)

*   **Type / Scope**: Halaman share landing.
*   **Proposed Changes**: Sertakan `share_slug` (dari route param) pada payload `share_link_opened` — menutup celah klasifikasi siklus share antar-pembaca.

#### 10. `scripts/analytics-prod-verify.ts` (Create) + alias `pnpm analytics:verify` di `package.json`

*   **Type / Scope**: Script one-off pre-launch (bukan bagian `pnpm smoke`).
*   **Proposed Changes**: Buat script dengan pola konektivitas `scripts/daily-cost-monitor.ts` aktual (`getDb()`/`DATABASE_URL`, exit code). Kirim event QA (payload minimal valid per event kritis; `anonymous_id` QA tetap) ke `/api/analytics/track` → verifikasi bahwa baris per event kritis DAN satu baris `user_acquisition` (dari signup QA) muncul → hapus baris QA (predikat: by `anonymous_id` QA). Jalankan di Fase 2, setelah deploy.

#### 11. `lib/commercial/analytics-report.ts` (Create)

*   **Type / Scope**: Modul logika murni (unit-testable).
*   **Proposed Changes**: Implementasikan definisi beku (bagian Definisi): drop-off (kunci `coalesce(anonymous_id, user_id)`, sensoring 7 hari, zona Asia/Jakarta), ekonomi (union dua tabel order dengan kaveat `amount_idr=0` historis Android + konstanta konversi USD→IDR ber-`decisionRef` + exclude `cost_source='unavailable'` sebagai bar error; median+p90), funnel launch-week (tahapan sesuai Definisi, per kanal + agregat), D1 (anchor first `chapter_viewed` ber-user), health-check (semantik Lapis 2). Jalankan di Fase 3.

#### 12. `scripts/analytics-report.ts` (Create) + alias `pnpm analytics:report` di `package.json`

*   **Type / Scope**: Script tipis + konfigurasi.
*   **Proposed Changes**: Bungkus file 11; cetak teks satu baris per temuan + exit code, pola `scripts/daily-cost-monitor.ts`. Jalankan di Fase 3.

#### 13. `lib/commercial/promotion-gate.ts` + `scripts/analytics-gate.ts` (Create) + alias `pnpm analytics:gate` di `package.json` — KONDISIONAL OQ6

*   **Type / Scope**: Modul + script gerbang keputusan.
*   **Proposed Changes**: Implementasikan empat keadaan output (`LOLOS | BLOKIR | DATA BELUM CUKUP | MENUNGGU RATIFIKASI`): konstanta ambang UNRATIFIED dengan `decisionRef`; lantai kohort ≥100 signup; jendela D1 minimal 7 hari; jendela konversi 30 hari. BANGUN HANYA setelah OQ6 (tanggal keputusan promosi) terjawab; sebelum itu, keluaran gerbang disediakan sebagai seksi `analytics:report`. Evaluasi manual, bukan cron. Jalankan di Fase 3.

#### 14. Unit tests (Create)

*   **Type / Scope**: Vitest (colocated, diikutkan `pnpm test:unit`).
*   **Proposed Changes**: Buat `lib/acquisition/policy.test.ts` (pemetaan kanal, first-touch, validasi slug, serialisasi/parsing cookie, fail-open) — Fase 1; buat `lib/commercial/analytics-report.test.ts` (dedup first-view, sensoring, union order, D1, health breach) — Fase 3.

### Verification Plan

*   **Compilation/Build**: `pnpm typecheck` + `pnpm build` (Catatan: `ignoreBuildErrors` aktif di `next.config.mjs` — typecheck adalah gerbang nyata, build bukan).
*   **Unit Tests**: `pnpm test:unit` untuk file 3 (Fase 1) dan file 11/13 (Fase 3).
*   **Smoke**: `pnpm smoke` (khususnya `smoke:analytics` + `smoke:web-release`).
*   **E2E produksi (Fase 2)**: `pnpm analytics:verify` — verifikasi baris nyata di produksi + baris QA terhapus; walkthrough manual funnel sesuai checklist, dengan data akun QA disaring dari laporan.
*   **Alarm health**: uji semantik BREACH/WATCH di local dev (hentikan satu event top-of-funnel → laporan exit 1); tidak ada environment staging di setup VPS ini (`docs/VPS_DEPLOY.md`).

### Urutan Kerja

1. **Fase 0**: keputusan OQ1 (SELESAI — Opsi A). OQ2–OQ6 tetap terbuka sampai baseline ada; OQ6 mengondisikan file 13.
2. **Fase 1**: file 1–9 (capture + registrasi tipe, additive-only) → `pnpm exec supabase db push --linked` (migration file 6 — deploy Docker TIDAK menjalankan migration) → deploy ke produksi, semuanya **sebelum** rupiah promosi pertama.
3. **Fase 2**: file 10 — verifikasi produksi post-deploy.
4. **Fase 3**: file 11–14 — laporan (+ perbaikan RPC harga Android sebagai pendamping wajib) + gerbang (kondisional OQ6) saat kohort seed mengalir.

--------------------------------------------------------------------------------

*Drafted with EGM*
