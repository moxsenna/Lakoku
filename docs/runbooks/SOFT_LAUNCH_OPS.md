# Runbook Operasional Soft Launch (G13e Handoff)

Dokumen panduan operasional harian bagi operator sistem dan PM selama periode Soft Launch Lakoku (Gate G13e).

---

## 1. Konteks & Batasan Operasional

- **Status Gate:** G13a–G13d telah ditutup dan diverifikasi hijau pada commit `f633fe8`. Sub-gate G13e adalah handoff manusia (dogfood beta reader, baca 50 bab utuh, keputusan go/no-go harian PM).
- **Standing Boundaries:**
  - Status M10-G: `IN CLOSEOUT`.
  - Otoritas plafon: `LAKOKU-E0-2026-08-26-LOOSE-200-R1` ($2.10 per bab, $200.00 per novel).
  - `hardInferenceLimit` (G-1): `null`.
  - Mutasi kode atau prompt saat uji coba: **DILARANG** tanpa otorisasi PM.

---

## 2. Rutinitas Operasional Harian (Daily Operator Cadence)

Setiap pagi dan sore selama soft launch, jalankan tiga langkah verifikasi berikut:

### Langkah 1: Uji Jalur Pembaca Produksi (Smoke E2E)

Pastikan seluruh rantai pembaca publik dan terproteksi berfungsi normal tanpa intervensi manual:

```bash
pnpm smoke:production-reader
```

**Hasil yang diharapkan:**
- `PRODUCTION-READER-SMOKE-PASS` (9/9 cek hijau).
- Landing page (`lakoku.biz.id`) dan App (`app.lakoku.biz.id`) merespons HTTP 200.
- Katalog memuat cerita explore (`demo:selasa-akhir` 50/50 bab utuh, panjang kata 800–1000).
- Rute baca terproteksi redirect 307 ke `/auth/login`.
- Tidak ada kebocoran istilah terlarang (*brand guard* bersih dari "AI", "Narraza", "RAG", "token", "prompt").

Jika gagal: Periksa log sistem VPS (`journalctl --user -u mox-lakoku`) dan status Cloudflare Tunnel.

---

### Langkah 2: Pemantauan Biaya Harian Provider (Daily Cost Monitor)

Jalankan skrip pembacaan DB produksi untuk memantau konsumsi biaya provider terhadap plafon E0 R1:

```bash
# Pantau 24 jam terakhir (default)
pnpm cost:daily

# Pantau rolling 7 hari terakhir
pnpm cost:daily -- --days 7
```

**Arti Status Terminal:**
1. **`DAILY-COST-MONITOR-OK` (Exit 0):**
   Seluruh panggilan terukur berada di bawah ambang batas watchpoint (< 97% dari $2.10 = $2.037/bab).
2. **`DAILY-COST-MONITOR-WATCH` (Exit 0):**
   Ada bab yang menghabiskan biaya antara $2.037 s.d. $2.100. Sistem mendekati batas atas; laporkan ke PM untuk evaluasi token/panjang konteks.
3. **`DAILY-COST-MONITOR-UNMEASURED` (Exit 0):**
   Ditemukan transaksi model tanpa data biaya tertagih dari provider (`cost_source != provider_actual`).
   *Penting:* Ini adalah konsekuensi dari defect **CI-6** (OpenRouter tidak menerima payload `usage: { include: true }`). Status ini sengaja diprioritaskan agar operator **TIDAK menganggap biaya $0**. Segera lakukan Langkah 3 di bawah.
4. **`DAILY-COST-MONITOR-BREACH` (Exit 1):**
   Biaya bab melampaui $2.10000000 atau biaya total novel mencapai >= $200.00000000.
   **TINDAKAN SEGERA:** Hentikan sementara pembuatan cerita baru, kumpulkan log `job_id` terkait, dan eskalasi ke PM.

---

### Langkah 3: Rekonsiliasi Saldo Manual (Mitigasi Defect CI-6)

Selama **CI-6** belum ditutup dalam kode produksi, guard E0 di server berstatus inert (722/722 transport produksi tercatat `unavailable`).

Operator wajib melakukan rekonsiliasi manual:
1. Buka dashboard OpenRouter: [https://openrouter.ai/activity](https://openrouter.ai/activity).
2. Buka dashboard 9Router VPS (jika rute 9Router aktif).
3. Bandingkan jumlah pemanggilan (`calls` pada output `pnpm cost:daily`) dengan log pemakaian pada dashboard provider.
4. Pastikan saldo kredit tersisa mencukupi untuk kelanjutan uji coba beta.

---

## 3. Protokol Pembaca Beta (Beta Reader Guidelines)

1. **Perekrutan & Akses:**
   - Pembaca mengakses `https://app.lakoku.biz.id/`.
   - Autentikasi menggunakan Google OAuth atau Email OTP.
   - Kredit sambutan (*welcome credit*) diberikan otomatis saat pendaftaran.
2. **Observasi Pengalaman Membaca:**
   - Amati apakah pembaca mengalami hambatan saat memilih cabang (*choice branching*).
   - Pastikan progres bab tersimpan di profil pembaca (`/koleksiku`).
   - Konfirmasi tidak ada pesan error teknis mentah atau istilah AI yang bocor ke pembaca.
3. **Penyelesaian 50 Bab:**
   - Minimal satu pembaca manusia membaca cerita personalisasi hingga bab 50 untuk memvalidasi penutupan cerita (*ending payoff*).

---

## 4. Kriteria Keputusan Harian PM (Daily Go/No-Go)

Setiap akhir hari uji coba, PM menentukan status keberlanjutan soft launch berdasarkan checklist:

| Kriteria | Indikator Go | Indikator No-Go |
|---|---|---|
| **Ketersediaan Layanan** | `smoke:production-reader` 100% PASS | Layanan down / 500 error berulang |
| **Plafon Biaya Bab** | Biaya bab <= $2.10 (tidak ada BREACH) | Biaya bab > $2.10 |
| **Plafon Biaya Novel** | Proyeksi novel <= $200.00 | Proyeksi novel > $200.00 |
| **Kredit Provider** | Saldo dashboard provider memadai | Saldo habis tak terduga / spike token |
| **Integritas Narasi** | Tidak ada halusinasi fatal / loop cabang | Cerita putus / gagal generate terus-menerus |
| **Brand Guard** | Nol temuan kata terlarang oleh pembaca | Istilah AI / RAG / prompt bocor ke pembaca |
