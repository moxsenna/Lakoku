# Client Sequencing — Web Reader First, Android Second

**Versi:** 1.0
**Status:** Normatif (mengikat untuk agen & kontributor)
**Keputusan sumber:** AMENDMENTS v0.4 — LD-CLIENT-SEQ, LD-CONTRACT-SEAM
**Dokumen terkait:** `PRD_Lakoku_Interactive_v0.3.md`, `ARCHITECTURE_v1.1.md`, `IMPLEMENTATION_PLAN.md` (M6-WEB), `NARRATIVE_CONSISTENCY_SPEC.md`, `NARRATIVE_TRACEABILITY_MATRIX.md`

> Dokumen ini menjelaskan **urutan pengerjaan client** dan **mengapa** kita membangun web reader lebih dulu. Ini adalah orientasi untuk agen/kontributor masa depan agar tidak salah kerja. Dokumen ini **tidak** menambah requirement baru — ia merangkum keputusan yang sudah dikunci di AMENDMENTS v0.4 dan aturan yang sudah ada di ARCH/NCS/NTM.

---

## 1. Keputusan (satu kalimat)

Bangun **web reader mobile-first sampai produksi** sebagai client pertama; bangun **aplikasi Android native (Kotlin/Jetpack Compose)** sebagai client kedua **di atas kontrak API yang sama**, setelah metrik retensi & monetisasi web terbukti.

---

## 2. Mengapa web-first (rasional)

1. **Arsitektur sudah API-first.** ARCH v1.1 memisahkan backend (Reader API) dari client. Web dan Android adalah **dua client di atas satu kontrak**, bukan dua produk terpisah. Membangun web dulu tidak membuang kerja backend.
2. **Iterasi & validasi lebih cepat & murah.** Taruhan produk Lakoku adalah *apakah orang mau membaca 50 bab sebagai tokoh utama dan mau bayar per-cerita* — bukan teknologi. Web menjawab ini paling cepat: deploy instan, tanpa review store, funnel/analitik & A/B test mudah.
3. **Distribusi awal lebih lancar.** Link dapat dibagikan langsung (penting untuk drama Indonesia yang viral lewat WhatsApp/TikTok) tanpa terkunci billing store selama fase eksperimen monetisasi.

---

## 3. Yang WAJIB dijaga agar Android nanti mulus (invariants)

Ini kondisi yang membuat "web dulu" tidak menjadi utang teknis saat Android dibangun:

1. **Kontrak API adalah satu sumber kebenaran** (`packages/contracts`, ARCH §11.1). Kunci bentuk request/response; client hanya konsumen.
2. **Nol logika naratif di client mana pun.** Memori T0–T3, validator Layer A/B, alias registry, thread lifecycle, reveal gates, reconciliation — semuanya di backend (NCS/NTM). Jika bocor ke React, harus ditulis ulang untuk Kotlin.
3. **Nol panggilan AI dari client** (ARCH §23). Client tidak pernah memanggil provider AI atau mengirim parameter model.
4. **Seam data client-agnostic di tiap client.** Di web itu `lib/api/` (LD-CONTRACT-SEAM): komponen UI **tidak boleh** bergantung langsung pada sumber data. Mengganti fixtures → `fetch()` Reader API tidak boleh menyentuh komponen.
5. **Mobile-first, bukan desktop-first.** Layar sentuh vertikal, gestur, sesi baca pendek (PRD).
6. **Brand guard identik.** "Narraza" & framing "AI story generator" tidak boleh muncul di UI web maupun Android (ARCH §16.3).

---

## 4. Dua-jalur M6-WEB (jangan tertukar)

M6-WEB punya dua jalur dengan gate berbeda. Ini titik yang paling sering disalahpahami:

| Jalur | Isi | Gate |
| --- | --- | --- |
| **UX (fixtures)** | Bangun/validasi UI/UX reader web di atas data fixture deterministik | **Tidak** dikunci di belakang M3/M5. Boleh sekarang. Repo saat ini ada di jalur ini. |
| **Cerita nyata (AI ke pembaca)** | Menyajikan bab hasil generasi AI ke pembaca sungguhan | **Terkunci** di belakang M5 hijau (NTM §3), sama seperti Android. |

**Implikasi praktis:** membangun tampilan reader web di atas fixtures **bukan** pelanggaran gate. Yang dikunci M5 adalah *menyajikan cerita AI ke pembaca* — baik lewat web maupun Android.

---

## 5. Status saat ini

- Web reader mobile-first prototype **sudah ada** dan on-brand (Next.js App Router, Tailwind v4).
- Seam `lib/api/` **sudah terpasang** (`types.ts`, `client.ts`, fixtures internal); komponen UI tidak lagi mengimpor sumber data langsung.
- Reader menampilkan bab **sesuai cerita** (bug "sample statis" telah diperbaiki).
- Posisi: **M6-WEB jalur UX** sedang berjalan; jalur cerita nyata menunggu backend (M1–M5).

---

## 6. Kapan Android dimulai

Android native dimulai (M6) setelah:
- metrik retensi bab-per-bab & konversi per-cerita di web terbukti cukup, **dan**
- Reader API nyata + M5 (gate konsistensi 50 bab) hijau.

Saat itu, Android cukup membangun **UI baru** di atas kontrak yang sama — tanpa memindahkan logika naratif apa pun.
