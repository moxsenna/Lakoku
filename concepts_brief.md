# Brief Konsep: Instrumentasi Funnel & Gerbang Promosi Lakoku

Penulis: ZCode + tinjauan Goldfish 6 lensa (design, codebase, zoom-out, comprehension, implementation-readiness, structural)
Tanggal: 2026-10-31

## Ikhtisar (Overview)

Lakoku sudah live secara teknis di VPS tapi belum diluncurkan — nol pengguna. Pemilik ingin produk bisa mengevaluasi tiga hal: (a) kapan layak buang uang promosi soft-launch, (b) di bab ke berapa pembaca berhenti, (c) apakah satu pembaca menghasilkan rupiah lebih besar daripada biaya AI-nya.

Kesimpulan tinjauan: hampir semua capture sudah terpasang dan ter-wire di kode. Yang benar-benar hilang dan tidak bisa dipulihkan setelah launch hanya **sumber akuisisi** (dari kanal mana pembaca datang). Sisanya adalah pekerjaan yang lebih kecil dari hipotesis awal: satu verifikasi produksi sekali jalan, satu laporan terpadu (bukan tiga script), dan kerangka gerbang promosi yang angkanya diisi pemilik belakangan. Kamus singkat: *event* = baris catatan otomatis di tabel `analytics_events` setiap pembaca berbuat sesuatu; *UTM* = kode di ujung link (`?utm_source=instagram`) penanda kanal; *retensi D1* = persentase pembaca baru yang kembali membaca keesokan harinya; *drop-off* = persentase yang berhenti di tiap bab; *kohort seed* = sekelompok pembaca awal sungguhan.

## Analisis (Analysis)

### Kondisi Saat Ini

- Event funnel sudah ter-wire di kode, bukan cuma didefinisikan: `chapter_viewed` (`components/reader-view.tsx:285`), `paywall_viewed` (`components/chapter-locked.tsx:38`), `checkout_started` web+android, funnel story setup, `share_link_opened` (`app/s/[slug]/page.tsx:56`).
- Transport event bersifat fire-and-forget: kegagalan kirim ditelan (`lib/analytics/client.ts:52-57`), payload invalid didrop senyap di produksi (`lib/analytics/server.ts:36-39`), schema zod `.strict()`. `analytics_events` write-only — tidak ada satu pun pembaca di seluruh kodebase.
- Biaya AI per pembaca SUDAH tercatat: `generation_provider_calls` punya `user_id NOT NULL` + `cost_amount` per panggilan.
- Pendapatan tercatat di DUA tabel: `credit_orders` (web, `created→paid`) dan `credit_orders_v2` (Play billing, `succeeded`). Status `failed`/`duplicate` tidak pernah ditulis siapa pun; refund tidak diproses di jalur PayCore; checkout terbengkalai tetap `created` selamanya.
- Tidak ada capture UTM/referrer sama sekali. Atribusi referral user-ke-user SUDAH ada (`lib/auth.ts:65-79`, cookie `lakoku_ref` + hook signup) — pola siap ditiru untuk UTM.
- Tidak ada event kunjungan pertama: `landing_cta_clicked` hanya menembak saat klik; pengunjung yang pulang sebelum klik tidak pernah tercatat.

### Sasaran Bisnis Pemilik

- (a) Go/no-go belanja promosi soft-launch.
- (b) Di bab ke berapa pembaca berhenti.
- (c) Apakah 1 pembaca menghasilkan rupiah > biaya AI-nya.
- (tersembunyi, dilayani capture akuisisi) Kanal mana yang pantas diberi uang iklan.

### Pemetaan Sasaran → Komponen

| Sasaran | Dijawab oleh | Catatan |
|---|---|---|
| (a) | Gerbang promosi (K4) + laporan terpadu + capture akuisisi (K2) | Gerbang butuh angka retensi D1 — karena itu D1 masuk laporan terpadu, bukan laporan terpisah |
| (b) | Laporan drop-off per bab (K6: dedup sisi server) | Menjawab "di bab ke berapa"; "kenapa" adalah Non-Sasaran |
| (c) | Laporan ekonomi pembaca (K5: union dua tabel order) | Kohort login; distribusi, bukan cuma rata-rata |
| — | Verifikasi produksi (K1) | Prasyarat semua laporan; laporan atas event yang mati = keputusan dari data kosong |

### Fakta yang Sudah Ada di Kode

| Artefak | Bukti | Implikasi |
|---|---|---|
| Event funnel wired | reader-view.tsx:285, chapter-locked.tsx:38, buy-credit-button.tsx:19 | Tidak ada pekerjaan wiring tersisa |
| Tabel `analytics_events` | migration 20260711000001; RLS tanpa read policy | Skrip laporan wajib pola service-role seperti `scripts/daily-cost-monitor.ts` |
| Biaya per pembaca | migration 20260718100000; `user_id NOT NULL` | Laporan (c) sisi biaya = GROUP BY, nol capture baru |
| `pnpm cost:daily` | scripts/daily-cost-monitor.ts | Separuh laporan (c) sudah jadi; pola exit-code bisa ditiru |
| `admin_generation_cost_breakdown_v1` | migration 20260718110000 | Biaya per user per use_case tersedia sebagai RPC |
| `lib/admin/dashboard.ts` | revenueTodayIdr, paidOrdersToday | Sisi revenue harian sudah terkumpul (tapi baru `credit_orders`, belum v2) |
| Cookie + hook referral | lib/auth.ts:65-79, lib/rewards/policy.ts | Template capture UTM: cookie first-touch + tulis saat signup |
| `TrackOnView` | components/analytics/track-on-view.tsx | Komponen event-saat-terlihat, reusable untuk `landing_viewed` |

### Tensi Utama

1. **Kehilangan data senyap.** Transport menelan error, schema strict mendrop payload invalid tanpa sinyal, dan tabel write-only — event bisa mati 100% di produksi tanpa ada yang tahu. → K1
2. **UTM-only gagal di kanal Indonesia.** WhatsApp/Instagram/TikTok memakai in-app browser yang sering menghapus query param dan mengirim referrer kosong; mayoritas trafik akan jadi "unknown". Slug share sendiri (`/s/[slug]`) tidak masuk payload. → K2
3. **Tiga script laporan sebelum ada data = membangun untuk audiens nol.** Kode laporan yang ditulis sebelum data nyata hampir pasti ditulis ulang; tapi tanpa ritual laporan yang jelas, kueri ad hoc juga tidak akan pernah dijalankan. → K3
4. **Ambang gerbang tanpa baseline adalah numerologi.** Belum ada benchmark novel interaktif AI berbahasa Indonesia; angka yang ditetapkan sekarang pasti direvisi. Dengan kohort kecil, D1 dan konversi berayun liar (n=30, p=0,1 → rentang kepercayaan 3–27%). → K4
5. **Pendapatan terpecah dua tabel dan tanpa status terminal.** Dashboard admin hanya menghitung `credit_orders` — pendapatan Android (Play billing) hilang jika laporan meniru pola itu. Checkout gagal tetap `created` selamanya → funnel pembayaran tidak bisa membedakan abandon vs gagal. → K5
6. **Definisi metrik belum beku.** Dua implementer akan menghitung D1, "pembaca aktif", dan penyebut drop-off dengan cara berbeda — di n kecil, pilihan definisi mengubah rasio (c) berorde magnitudo. → K6

## Sasaran vs. Non-Goals (Goals vs. Non-Goals)

### Sasaran (In-Scope Goals)

1. **Capture akuisisi pra-launch** (satu-satunya item yang tidak bisa dipulihkan): cookie first-touch berisi kanal (enum tertutup: whatsapp, instagram, tiktok, x_twitter, email, google, direct, share_link, referral_code, other) + hook signup menulis tabel kecil `user_acquisition` (user_id, source, utm_source_slug, utm_campaign_slug, referrer_host, captured_at); event `landing_viewed` via `TrackOnView`; field `share_slug` pada `share_link_opened`; middleware matcher diperluas agar deep link ke bab ikut tertangkap. First-touch wins.
2. **Verifikasi produksi sekali jalan, setelah deploy** (prasyarat laporan): akun QA ber-UUID tetap memwalk funnel lengkap → script asert baris nyata muncul via service-role → baris QA dihapus. Plus health-check permanen di laporan: jumlah minimum per event kritis per 24 jam; nol = alarm.
3. **Satu laporan terpadu** `pnpm analytics:report` (bukan tiga script): kurva drop-off per bab dengan dedup server (`min(created_at)` per pembaca+cerita+bab), ekonomi pembaca (union `credit_orders`+`credit_orders_v2`; median + p90, bukan cuma rata-rata), funnel launch-week, retensi D1, dan health-check. Logika murni di `lib/`, script tipis di `scripts/`, pola `daily-cost-monitor.ts` (read-only, exit code).
4. **Gerbang promosi `analytics:gate` dengan status UNRATIFIED**: struktur jadi (lantai kohort minimum ≥100 pembaca melewati funnel, jendela observasi D1 ≥7–14 hari / konversi ≥30 hari, slot ambang TBD), output "LOLOS | BLOKIR | DATA BELUM CUKUP", evaluasi manual oleh pemilik — bukan cron, bukan angka karangan.

### Non-Goals (Out-of-Scope Non-Goals)

- **Menjawab "kenapa" pembaca berhenti.** Event hanya bisa menjawab "di bab ke berapa". Survei keluar ditunda sampai ada kohort seed nyata.
- **Dashboard UI.** Laporan teks cukup untuk satu pemilik.
- **Event `purchase_completed` baru.** Dua tabel order adalah sumber kebenaran pendapatan; sumber ganda = drift.
- **Menulis angka ambang gerbang sekarang.** Tanpa baseline, semua angka adalah tebakan.
- **Model atribusi multi-touch / UTM mentah bebas teks.** Melanggar schema reader-safe dan menghasilkan kardinalitas tanpa sinyal di kohort kecil.
- **Memproses refund.** Laporan membawa kaveat tertulis: pendapatan paid-only, buta refund.

## Alternatif yang Dipertimbangkan (Alternatives Weighed)

| Alternatif | Alasan ditolak |
|---|---|
| Dashboard admin penuh | Overkill saat nol pengguna; permukaan maintenance baru |
| Exit survey sekarang | Tidak ada kohort nyata; data kosong |
| Launch dulu, instrumentasi belakangan | Capture akuisisi tak-recoverable — ditolak keras untuk komponen itu; untuk laporan/gerbang, penundaan justru dianjurkan |
| Analytics pihak ketiga (GA4/PostHog) | Tidak bisa join `generation_provider_calls` + tabel order (inti laporan c); menambah script pihak ketiga di produk mobile-first; risiko brand guard |
| Event `purchase_completed` baru | Tabel order sudah sumber kebenaran; dua sumber = drift |
| UTM mentah apa adanya di event | Schema `.strict()` melarang teks bebas; in-app browser menghapus param; kardinalitas tinggi tanpa sinyal |
| Menyamakan atribusi referral dengan sumber akuisisi | Referral = user-ke-user; bukan kanal eksternal; semantik beda |
| Tabel `reader_progress` khusus (max_chapter per user) | Write path baru untuk hemat satu dedup SQL; dicatat sebagai cadangan bila laporan drop-off terbukti berisik |

## Keputusan Kunci & Staging untuk Langkah Berikutnya (Key Decisions & Staging for Next Steps)

### Keputusan Kunci

- **K1 — Verifikasi = asert baris nyata, bukan cek kode.** Satu-satunya sinyal "menyala" adalah baris di `analytics_events` produksi. QA walk + assert + delete baris QA; health-check per-event jadi bagian permanen laporan. Baris QA wajib difilter/hapus — tanpa itu, laporan launch-week tercemar permanen.
- **K2 — Atribusi berlapis, bukan UTM-only.** Cookie first-touch + hook signup (tiru pola `lakoku_ref`) untuk atribusi durable di tabel `user_acquisition`; `landing_viewed` + taksonomi kanal enum untuk hitungan kunjungan; `share_slug` menutup loop viral organik yang tidak butuh UTM sama sekali. Deep link dianggap landing (capture di middleware, matcher diperluas).
- **K3 — Satu pintu laporan, bukan tiga script.** `pnpm analytics:report` menghasilkan keempat bagian + health-check. Dibangun saat kohort seed mulai mengalir (bukan sebelum launch), supaya bentuk datanya nyata. Kontrak di docs: kueri final ditulis sekarang sebagai spesifikasi, bukan kode.
- **K4 — Gerbang lahir UNRATIFIED.** Mengikuti preseden ceiling E0 (`decisionRef`): konstanta placeholder + status UNRATIFIED; output memaksa "DATA BELUM CUKUP" sampai lantai kohort dan jendela observasi terpenuhi. Angka final diputuskan pemilik setelah baseline kohort seed terbaca.
- **K5 — Pendapatan = union dua tabel order; status terminal diputuskan sadar.** Laporan menghitung `credit_orders` (web) + `credit_orders_v2` (Play). Pilihan ditulis di header laporan: (a) tambahkan penulisan `failed` di webhook (perubahan kecil, integritas besar) atau (b) kaveat paid-only/abandon-blind sejak hari pertama.
- **K6 — Definisi metrik dibekukan sekarang.** Retensi D1 = `chapter_viewed` di hari 0 dan kembali di hari +1 (kohort login). Drop-off = dari pembaca yang menyelesaikan bab N, berapa sampai bab N+1, dengan first-view dedup sisi server. Ekonomi per pembaca = kohort login, jendela 30 hari sejak signup, distribusi median+p90. Tamu (pra-signup) dilaporkan terpisah karena biaya AI tidak bisa diatribusikan ke anonymous.

### Tahapan (Staging)

1. **Fase 0 — keputusan pemilik** (bloker semua): ratifikasi K2–K6; isi slot TBD di bawah.
2. **Fase 1 — capture pra-launch**: schema `events.ts` (enum kanal, `share_slug`, `landing_viewed`), tabel `user_acquisition` + RLS, cookie + hook, middleware matcher, update `analytics-smoke.ts`. Additive-only; deploy WAJIB sebelum rupiah promosi pertama.
3. **Fase 2 — verifikasi produksi** (SETELAH deploy, bukan paralel): QA walk + assert + delete; catat hasilnya di docs.
4. **Fase 3 — laporan + gerbang**: saat trafik mulai mengalir; script laporan, lalu gerbang. Laporan funnel lengkap dengan split per kanal baru bermakna setelah fase 1 mengalir.

### Slot Keputusan Pemilik (TBD — harus diisi sebelum Fase 3)

1. **Angka ambang gerbang** — D1 ≥ ?, konversi bayar ≥ ?, pendapatan/biaya-AI ≥ ?. Metode: dibaca dari baseline kohort seed pertama, bukarang dari selera. Ditambah taruhan: berapa rupiah promosi yang siap dipertaruhkan.
2. **Rencana 100 pembaca pertama** — kalau penyebarannya link WhatsApp tanpa parameter, capture akan menghasilkan `direct` untuk hampir semua trafik; capture hanya bernilai kalau setiap link disebar terbawa kanal (bahkan manual `?utm_source=wa-grup-a`).
3. **Kebijakan tamu** — apakah tamu pra-signup boleh memicu generasi AI (mempengaruhi atribusi biaya), dan tamu dikeluarkan dari laporan drop-off atau dilaporkan terpisah.
4. **Kebijakan refund** — akan pernah diproses via dashboard PayCore? Menentukan kaveat laporan (K5).
5. **Tanggal keputusan promosi** — tanpa tanggal, gerbang tidak punya pemicu dan boleh tinggal catatan satu paragraf.
