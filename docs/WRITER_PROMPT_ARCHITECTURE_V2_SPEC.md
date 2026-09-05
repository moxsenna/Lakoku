# Lakoku — Writer Prompt Architecture & Authority Propagation Spec v2.2 (Offline)

- **Status:** DRAFT ARSITEKTUR v2.2 / CANDIDATE FOR PM RATIFICATION
- **Document Date:** 2026-09-03
- **Owner:** Architecture & Narrative Systems Team
- **Governs:** `lib/story-engine/`, `lib/ai-gateway/`, `lib/prose/prompt-engine/`, `fixtures/writer-qualification/`
- **Related Specs:** `docs/ARCHITECTURE_v1.1.md`, `docs/NARRATIVE_CONSISTENCY_SPEC.md` (NCS v1.0), `docs/NARRATIVE_TRACEABILITY_MATRIX.md` (NTM v1.0)
- **Constraint Mode:** OFFLINE ONLY (0 provider/model inference, 0 DB migration, 0 production code mutation, 0 commit/push)
- **Implementation Authority:** BLOCKED (Menunggu ratifikasi PM; dilarang melakukan modifikasi kode produksi atau inferensi model)

---

## 1. Executive Summary & Problem Statement

Evaluasi kualifikasi model writer (`WRITER_QUALIFICATION_FIXTURE_V2`) membuktikan bahwa corpus evaluasi berhasil dibangun dengan kepatuhan skema produksi dan proteksi anti-tamper yang fail-closed. Namun, autorisasi kualifikasi model writer produksi saat ini tertahan pada status tata kelola:
```text
qualificationAllowed: false
verdict: BLOCKED_PRODUCTION_PROJECTION_GAP
readyAuthorityManifestHash: null
```

Hambatan utama bukan terletak pada fixture evaluasi, melainkan pada **putusnya rantai propagasi otoritas produksi (authority propagation breakdown)** dan **konflik controller pemformatan pada writer prompt produksi saat ini**:

1. **Authority Propagation Gap:**
   - Otoritas naratif mandatori yang dihitung secara deterministik oleh production engine (`ChapterBrief.lockedEndingKey`, `scheduledReveals`/payoff obligations, dan `plotDebtsToProgress`/`plotDebtsToClose`) berhenti di lapisan runtime dan tidak pernah mencapai antarmuka pembuat prompt writer (`buildProductionChapterWriterPrompt`).
   - Pada Bab 45 (ambang batas penguncian ending), `buildChapterBrief()` telah menetapkan ending lock (misalnya `'rumah-bersama'`), tetapi prompt writer membaca `continuation.lockedEndingKey` yang bersumber dari tabel database `reader_states` yang belum dipersist pada generasi pertama Bab 45 (`continuation.lockedEndingKey === null`). Akibatnya, instruksi penguncian ending tidak pernah sampai ke pandangan LLM writer.
   - Kewajiban penutupan hutang plot (`plotDebtsToClose`) dan scheduled reveal gate kehilangan identitas kanoniknya karena dilebur menjadi string generik atau dipangkas secara diam-diam (*silent trimming*) pada `PreProseChapterBrief`.

2. **Prompt Hierarchy & Controller Contradiction:**
   - Writer prompt produksi (`buildWriterPrompt` dan `mobileDramaSystemPrompt`) memuat kontradiksi controller numerik:
     - Target kata: 800–1000 kata hard acceptance (850–950 kata soft target).
     - Target paragraf: 35–50 paragraf hard (38–48 paragraf soft).
     - Aturan mikroskopis kalimat: mayoritas paragraf 1 kalimat pendek (15–25 kata).
   - Secara matematis, 40 paragraf × 1 kalimat (20 kata) = 800 kata. Pada batas bawah (35 paragraf), panjang teks hanya mencapai ~700 kata.
   - Hal ini memicu "controller war" pada model writer: model memotong kedalaman adegan demi memenuhi batas paragraf pendek (terbukti menyebabkan kegagalan panjang kata ~740 kata). Ketika kontroler numerik paragraf dilepas dalam uji ablasi, panjang narasi pulih secara signifikan.

### Revisi v2.2 (Final-Ratification Amendments)

Dokumen revisi v2.2 ini mengintegrasikan seluruh koreksi final PM sebelum ratifikasi implementasi:
1. **Mode Otoritas Wajib Eksplisit (No Implicit Legacy Default):** Parameter `authorityMode: WriterAuthorityMode` bersifat **wajib (mandatory, non-optional)**. Default implisit dilarang (`authorityMode ?? 'LEGACY'` dihapus). Mode legacy hanya dapat dipanggil secara sadar dan eksplisit oleh harness pengujian lama.
2. **Pemisahan Dua Lapisan Obligasi Naratif (Two-Layer Projection):** Identitas kanonik (`authorityId`) dipertahankan secara utuh pada metadata proyeksi internal untuk kebutuhan penelusuran (*traceability*), tetapi **DILARANG KERAS** ditampilkan ke dalam teks prompt yang dibaca oleh LLM writer. Hanya `writerDirective` (semantik prosa ramah-penulis) yang dirender ke model.
3. **Identitas Kanonik untuk Larangan Bocoran (Forbidden Reveals):** Skema brief mendefinisikan identitas terstruktur untuk larangan bocoran (`forbiddenRevealIds: string[]`), sehingga Pre-Call Contradiction Guard membandingkan ID kanonik dengan ID kanonik, bukan mencocokkan ID teknis dengan deskripsi teks bebas.
4. **Kapasitas Obligasi Terikat Audit Kontrak Produksi:** Batas kapasitas array obligasi (`scheduledReveals`, `plotDebtsToProgress`, `plotDebtsToClose`) tidak lagi menggunakan angka arbitrer yang diada-adakan, melainkan ditetapkan sebagai batasan terikat kapasitas audit kontrak produksi (*TBD bounded capacity determined from production contract audit*). Pemotongan diam-diam (*silent trimming*) tetap diharamkan secara mutlak.
5. **Ritme Paragraf Murni Kualitatif (P5):** Seluruh kontroler numerik paragraf, batasan jumlah kalimat, aturan pemisahan dialog kaku per baris, dan target paragraf cliffhanger dihapus dari prompt writer. Teks panduan kualitatif diadopsi verbatim sesuai arahan PM.
6. **Penegasan Batas Tata Kelola Panjang Kata:** Menegaskan bahwa `WRITER_LENGTH_REPAIR_V1` berstatus **CLOSED / OFF** (out-of-range adalah kegagalan terminal). Fungsi `clampChapterParagraphs` ditegaskan murni sebagai penjaga memori defensif, **bukan** mekanisme validasi word-band.
7. **Koreksi Pemetaan Otoritas NTM v1.0:** Tabel Section 8 mencatat status resmi kelima gap pada dokumen otoritas `NARRATIVE_TRACEABILITY_MATRIX.md` (NTM v1.0) apa adanya, yaitu **TODO** (pada baris 33, 34, 42, 48, 57). Bukti observasi repositori saat ini dicatat pada kolom terpisah. Catatan historis rentang 500–800 kata pada draf `NCS v1.0` dibedakan secara tegas dari otoritas aktif repositori yang lebih baru (`800–1000 / 850–950`).
8. **Pengondisian Dampak Fixture V2:** Dampak terhadap Fixture V2 diposisikan sebagai **hasil yang diharapkan (expected effect)** dan **syarat validasi pasca-implementasi (required post-implementation result)**. Implementasi sambungan (*seam*) tidak serta-merta menjamin fixture lulus otomatis; status `READY` hanya dapat diputuskan setelah validator penuh Fixture V2 dijalankan ulang.

---

## 2. Current Data Flow & Exact Gap Points

### 2.1 Alur Data Produksi Saat Ini (As-Is Pipeline)

```text
[StoryContract / Blueprint / CanonSnapshot]
       │
       ▼
[buildChapterBrief()] ──(Menghitung lockedEndingKey, plotDebts, mustInclude, endingRunway)
       │
       ▼
[loadContinuationContextForChapter()] ──(Membaca reader_states DB; Bab 45 awal -> lockedEndingKey = null)
       │
       ▼
[buildPreProseChapterBrief()] ──(DROP: plotDebts, endingRunway; Flatten/Slice mustInclude)
       │
       ├─────────────────────────────────────────┐
       ▼                                         ▼
[generatePlan(brief)]                     [writeChapter(brief)]
       │ (Hanya memuat beats, goal,              │ (Menerima brief via WriteInput,
       │  usesReveals; DROP ending lock)         │  TETAPI diabaikan di gateway-provider)
       │                                         │
       ▼                                         ▼
  ChapterPlan                             [generateProse(args TANPA brief)]
                                                 │
                                                 ▼
                                  [buildProductionChapterWriterPrompt(args)]
                                                 │ (HANYA menerima snapshot, plan, continuation)
                                                 ▼
                                        [buildWriterPrompt()]
                                                 │ (Membaca continuation.lockedEndingKey == null)
                                                 ▼
                                        PROMPT TANPA ENDING LOCK!
```

### 2.2 Analisis Titik Putus Otoritas (Gap Points)

#### GAP POINT 1: Ending Lock Authority Lost & Dual Source of Truth
- **Lokasi Kode:**
  - `lib/runtime/personalized-generation.ts:1074-1087` (`buildChapterBrief` menetapkan `brief.lockedEndingKey`).
  - `lib/ai-gateway/gateway-provider.ts:1288-1296` (`generateProse` dipanggil tanpa meneruskan `input.brief`).
  - `lib/ai-gateway/chapter-writer-contract.ts:169-174` (`buildProductionChapterWriterPrompt` tidak menerima `brief`).
  - `lib/prose/prompt-engine/build-writer-prompt.ts:75-77` (`cc?.lockedEndingKey` bernilai `null`).
- **Mekanisme Kegagalan:**
  `buildChapterBrief()` secara sah mengunci ending pada Bab 45 melalui kalkulasi deterministik `endingKeyFor()`. Namun, representasi yang diperiksa oleh prompt engine hanyalah `continuation.lockedEndingKey`. Karena reader state pada database belum dipersist untuk bab 45 yang sedang digenerasi, nilainya adalah `null`. Terjadi ambiguitas dua sumber kebenaran: kalkulasi runtime (`ChapterBrief`) vs rekaman database (`ContinuationContext`), di mana runtime menjatuhkan data dari `ChapterBrief`.

#### GAP POINT 2: Scheduled Reveal & Payoff Identity Loss via Silent Trimming
- **Lokasi Kode:**
  - `lib/story-engine/chapter-brief.ts:276-281` (menggabungkan `mustInclude`, target reveal, dan beat menjadi array string generik `mustInclude`).
  - `lib/story-engine/pre-prose-brief.ts:107-113` (`beats.slice(0, 8)` melakukan silent trimming).
  - `lib/prose/prompt-engine/build-writer-prompt.ts:46-78` (hanya menampilkan larangan negatif `mustNotReveal`; tidak ada penegasan positif untuk reveal terjadwal pada bab berjalan).
- **Mekanisme Kegagalan:**
  Kewajiban membuka rahasia atau payoff terjadwal kehilangan identitas kanonik (`authorityId`). Di tingkat prompt, model hanya diberitahu apa yang *dilarang* diungkap, tanpa instruksi tingkat tinggi bahwa rahasia tertentu *wajib* diungkap sebagai titik balik plot bab ini. Selain itu, pemotongan `slice(0, 8)` berisiko membuang obligasi penting tanpa kesalahan yang terlihat.

#### GAP POINT 3: Plot Debt & Closure Obligations Dropped
- **Lokasi Kode:**
  - `lib/story-engine/chapter-brief.ts:294-315` (menghitung `plotDebtsToProgress` dan `plotDebtsToClose`).
  - `lib/story-engine/pre-prose-brief.ts:28-41` (`PreProseChapterBriefSchema` tidak memiliki field hutang plot).
  - `lib/prose/prompt-engine/build-writer-prompt.ts:107-170` (Layer 3 mengabaikan hutang plot yang jatuh tempo).
- **Mekanisme Kegagalan:**
  Hutang plot yang jatuh tempo untuk diselesaikan (`plotDebtsToClose`) tidak diproyeksikan ke dalam `PreProseChapterBrief`. LLM menulis cerita tanpa panduan mengenai janji naratif apa yang harus ditutup, memicu finding konsistensi naratif bahwa hutang plot tidak terselesaikan.

#### GAP POINT 4: Formatting Controller Contradiction (Numeric Wars)
- **Lokasi Kode:**
  - `lib/prose/mobile-drama-style.ts:81-100` (`mobileDramaSystemPrompt()`).
  - `lib/prose/prompt-engine/build-writer-prompt.ts:187-198` (Layer 5 Kerangka & Gaya).
- **Mekanisme Kegagalan:**
  Instruksi menuntut "Target 850–950 kata" bersamaan dengan "Mayoritas paragraf = 1 kalimat pendek (15–25 kata)" dan "Target 38–48 paragraf". Tekanan pembatasan paragraf dan kalimat memaksa model menghentikan narasi terlalu dini guna menghindari penalti paragraf panjang, mengakibatkan teks berhenti di bawah batas minimal penerimaan (< 800 kata).

---

## 3. Proposed Authority Flow & Ownership Model

### 3.1 Single Source of Truth & Explicit Required Authority Mode

Untuk memastikan kepatuhan deterministik dan melarang fallback implisit yang dapat menyembunyikan galat arsitektur:

1. **Mode Otoritas Eksplisit dan Wajib (Mandatory Non-Optional):**
   Kontrak pembuat prompt writer mewajibkan parameter `authorityMode`:
   ```typescript
   export type WriterAuthorityMode = 'CHAPTER_BRIEF_V2' | 'LEGACY'
   ```
   - **Tanpa Nilai Bawaan (No Implicit Fallback):** Penggunaan `args.authorityMode ?? 'LEGACY'` **DIHARAMKAN**. Nilai `authorityMode` wajib dipasok secara eksplisit oleh setiap pemanggil.
   - **Mode `CHAPTER_BRIEF_V2` (Standar Produksi Baru):**
     - Parameter `brief: PreProseChapterBrief` bersifat **WAJIB (MANDATORY)**.
     - Ketiadaan `brief` (`null` atau `undefined`) wajib menghasilkan kegagalan terminal seketika: `throw new Error('CHAPTER_BRIEF_V2_BRIEF_REQUIRED')` **sebelum** pemanggilan provider model (0 inferensi).
   - **Mode `LEGACY` (Isolasi Kompatibilitas Khusus):**
     - Hanya boleh dipanggil secara sadar oleh suite pengujian unit lama yang memang menguji perilaku sebelum V2. Jalur produksi aktif dilarang memanggil mode ini.

2. **Aturan Otoritas Tunggal Ending Lock (Sole Authority Principle):**
   Dalam mode `CHAPTER_BRIEF_V2`, `ChapterBrief.lockedEndingKey` adalah **satu-satunya otoritas kanonik arah ending**. `ContinuationContext.lockedEndingKey` diperlakukan murni sebagai rekaman bukti historis:
   - **Kasus A (Batas Kunci Pertama):** Jika `brief.lockedEndingKey !== null` dan `continuation.lockedEndingKey === null` (terjadi pada generasi pertama Bab 45 saat database belum mencatat status kunci), status dinyatakan **VALID**. Nilai dari `brief` digunakan sebagai otoritas tunggal.
   - **Kasus B (Konsistensi Historis):** Jika `brief.lockedEndingKey !== null` dan `continuation.lockedEndingKey !== null`:
     - Jika `brief.lockedEndingKey === continuation.lockedEndingKey` → **VALID**.
     - Jika `brief.lockedEndingKey !== continuation.lockedEndingKey` → **GAGAL KERAS (FAIL CLOSED)** sebelum pemanggilan model dengan error: `ContradictionError('ENDING_LOCK_CONFLICT_BETWEEN_BRIEF_AND_CONTINUATION')`.
   - **Kasus C (Belum Terkunci):** Jika `brief.lockedEndingKey === null` dan `continuation.lockedEndingKey === null` → **VALID** (bab-bab awal sebelum penguncian ending).

| Domain Obligasi | Otoritas Kanonik Tunggal | Sumber Data | Jalur Propagasi Resmi ke Writer |
|---|---|---|---|
| **Ending Lock & Runway** | `ChapterBrief.lockedEndingKey` & `.endingRunway` | `buildChapterBrief()` (dievaluasi dari kontrak & status rute) | `ChapterBrief` → `PreProseChapterBrief` → `buildProductionChapterWriterPrompt` → Prompt P1 |
| **Scheduled Reveal / Payoff** | `ChapterBrief.scheduledReveals` (Structured) | `buildChapterBrief()` (dari `StoryContract.chapterTargets` & reveal gate) | `ChapterBrief` → `PreProseChapterBrief` → `buildProductionChapterWriterPrompt` → Prompt P1 |
| **Plot Debts Due** | `ChapterBrief.plotDebtsToProgress` & `.plotDebtsToClose` (Structured) | `buildChapterBrief()` (dari `effectivePlotDebtState`) | `ChapterBrief` → `PreProseChapterBrief` → `buildProductionChapterWriterPrompt` → Prompt P1 |
| **Canon & Safety Invariants** | `CanonSnapshot` + `ChapterBrief.forbiddenRevealIds` | `loadCanonSnapshot()` + `StoryContract` | `CanonSnapshot` + `PreProseChapterBrief` → Prompt P0 |
| **Reader History & Choice** | `ContinuationContext` | `loadContinuationContextForChapter()` | `ContinuationContext` → Prompt Context Block (Mendukung P0–P2) |
| **Dramatic Execution & Beats**| `ChapterPlan` | `generatePlan()` | `ChapterPlan` → Prompt P2 |

### 3.2 Two-Layer Structured Narrative Obligations (Pemisahan Lapisan Obligasi)

Untuk mencegah kebocoran identifier teknis ke model sekaligus menjamin keterlacakan audit (*audit traceability*), obligasi naratif dirancang memiliki dua lapisan:

```typescript
export type NarrativeObligationKind =
  | 'SCHEDULED_REVEAL'
  | 'PLOT_DEBT_PROGRESS'
  | 'PLOT_DEBT_CLOSE'

export interface WriterNarrativeObligation {
  readonly authorityId: string       // Identifier kanonik stabil untuk penelusuran audit internal
  readonly kind: NarrativeObligationKind
  readonly writerDirective: string  // Prosa semantik ramah-penulis untuk model
}
```

**Kontrak Pemisahan Dua Lapisan:**
1. **Lapisan Metadata Proyeksi (Internal Traceability Layer):**
   Objek hasil proyeksi (`ChapterWriterPromptProjection`) mempertahankan array objek obligasi lengkap beserta `authorityId`, `kind`, dan asal kanoniknya. Ini membuktikan rantai pembuktian:
   ```text
   Canonical Secret/Debt X ──► ChapterBrief.obligation[X] ──► PreProse.obligation[X] ──► Projection Metadata[X]
   ```
2. **Lapisan Teks Prompt Writer (LLM-Visible Layer):**
   Teks prompt yang dirender untuk model **HANYA MEMUAT `writerDirective`**. Nilai `authorityId` teknis (seperti `secret:id_kartu_keluarga_palsu` atau `debt:pembagian_warisan_mertua`) **DILARANG KERAS** muncul di dalam teks prompt model guna mencegah pelanggaran panduan merek (*brand guard*) dan kebingungan persepsi model.

### 3.3 Zero-Silent-Trimming Contract & Audit-Determined Capacity

- **Larangan Pemotongan Diam-Diam:** Obligasi P0 (Kanon & Rahasia Terlarang) dan P1 (Ending Lock, Scheduled Reveals, Plot Debts) **TIDAK BOLEH** dipangkas menggunakan fungsi seperti `.slice(0, N)`.
- **Kapasitas Terikat Audit Kontrak Produksi (Audit-Determined Capacity):**
  Batas maksimal entri obligasi per bab tidak ditetapkan secara arbitrer, melainkan diturunkan dari kapasitas batas atas kontrak produksi blueprint (*bounded capacity determined from production contract audit*).
  Jika kalkulasi engine menghasilkan jumlah obligasi yang melebihi kapasitas audit yang disahkan skema, sistem wajib **GAGAL KERAS (FAIL CLOSED)** saat kompilasi brief dengan error `ProjectionBudgetExceededError`, bukan membuang kelebihan obligasi secara diam-diam.

### 3.4 Pre-Call Contradiction Guards (Penjaga Kontradiksi Deterministik)

Sebelum pemanggilan provider model writer dilakukan, sistem wajib menjalankan 4 evaluasi deterministik. Jika terdeteksi kontradiksi, eksekusi wajib berhenti seketika tanpa melakukan inferensi (0 model call):

1. **Reveal vs Forbidden Invariant Guard:**
   Membandingkan `authorityId` pada `scheduledReveals` terhadap daftar ID rahasia terlarang (`forbiddenRevealIds: string[]`):
   ```typescript
   if (brief.scheduledReveals.some(r => brief.forbiddenRevealIds.includes(r.authorityId))) {
     throw new ContradictionError('SCHEDULED_REVEAL_CONTRADICTS_FORBIDDEN_REVEAL_ID')
   }
   ```
2. **Debt Closure State Guard:**
   Membandingkan `authorityId` pada `plotDebtsToClose` terhadap status kanonik debt di `snapshot` atau `effectiveState`:
   ```typescript
   if (brief.plotDebtsToClose.some(d => isDebtAlreadyResolved(snapshot, d.authorityId))) {
     throw new ContradictionError('PLOT_DEBT_TO_CLOSE_ALREADY_RESOLVED')
   }
   ```
3. **Ending Lock Reconciliation Guard:**
   Jika `continuation.lockedEndingKey !== null` dan `brief.lockedEndingKey !== null` dan keduanya tidak sama:
   ```typescript
   if (continuation?.lockedEndingKey && brief.lockedEndingKey &&
       continuation.lockedEndingKey !== brief.lockedEndingKey) {
     throw new ContradictionError('ENDING_LOCK_CONFLICT_BETWEEN_BRIEF_AND_CONTINUATION')
   }
   ```
4. **Reveal Gate Chronology Guard:**
   Memeriksa bahwa nomor bab saat ini tidak mendahului bab gerbang pengungkapan resmi rahasia:
   ```typescript
   if (brief.scheduledReveals.some(r => brief.chapterNumber < getRevealGateChapter(snapshot, r.authorityId))) {
     throw new ContradictionError('SCHEDULED_REVEAL_BEFORE_GATE_CHAPTER')
   }
   ```

### 3.5 Proposed Authority Flow Diagram

```text
[StoryContract + CanonSnapshot + ReaderState + EffectivePlotDebtState]
                                │
                                ▼
                      [buildChapterBrief()]
         (Menghasilkan ChapterBrief dengan obligasi terstruktur:
          - lockedEndingKey (Canonical Authority)
          - scheduledReveals: WriterNarrativeObligation[]
          - plotDebtsToProgress: WriterNarrativeObligation[]
          - plotDebtsToClose: WriterNarrativeObligation[]
          - forbiddenRevealIds: string[])
                                │
                                ▼
                  [buildPreProseChapterBrief()]
         (Memvalidasi skema; fail-closed jika melebihi kapasitas audit;
          tanpa silent trimming pada P0/P1)
                                │
       ┌────────────────────────┴────────────────────────┐
       ▼                                                 ▼
[generatePlan(brief)]                             [writeChapter({
                                                     brief,
                                                     authorityMode: 'CHAPTER_BRIEF_V2'
                                                   })]
       │                                                 │
       ▼                                                 ▼
  ChapterPlan                                     [generateProse({
                                                     ...,
                                                     brief,
                                                     authorityMode: 'CHAPTER_BRIEF_V2'
                                                   })]
                                                         │
                                                         ▼
                                          [Pre-Call Contradiction Guards]
                                          (Cek 4 guard deterministik; fail-closed jika ada konflik)
                                                         │
                                                         ▼
                                          [buildProductionChapterWriterPrompt({
                                             snapshot,
                                             plan,
                                             continuation,
                                             brief, // MANDATORI
                                             authorityMode: 'CHAPTER_BRIEF_V2'
                                           })]
                                                         │
                                                         ▼
                                                [buildWriterPrompt()]
                                          (Merender P0-P5 secara deterministik;
                                           authorityId disimpan di metadata,
                                           hanya writerDirective dirender ke model)
```

---

## 4. Writer Prompt Precedence Hierarchy (P0–P5)

Hierarki precedensi menetapkan urutan penegakan aturan yang konsisten di seluruh dokumen dan implementasi:

```text
┌─────────────────────────────────────────────────────────────┐
│ P0: CANON & SAFETY INVARIANTS (Tertinggi — Zero Compromise) │
├─────────────────────────────────────────────────────────────┤
│ P1: CHAPTER MANDATORY OBLIGATIONS (Ending Lock, Reveals)    │
├─────────────────────────────────────────────────────────────┤
│ [CONTEXT: History, Previous Choice, Canonical State]        │
├─────────────────────────────────────────────────────────────┤
│ P2: COMPLETE DRAMATIC SCENE EXECUTION (Scene Flow & Drama)  │
├─────────────────────────────────────────────────────────────┤
│ P3: LENGTH AUTHORITY (Target 850–950, Hard 800–1000 kata)   │
├─────────────────────────────────────────────────────────────┤
│ P4: VOICE & MOBILE READABILITY (POV "aku", Voice Sheet)     │
├─────────────────────────────────────────────────────────────┤
│ P5: QUALITATIVE PARAGRAPH RHYTHM (Tanpa Kontroler Numerik)  │
└─────────────────────────────────────────────────────────────┘
```

### 4.1 Rincian Tingkat Precedensi

#### P0: CANON & SAFETY INVARIANTS (Invarian Mutlak Kanon & Keamanan)
- **Cakupan:**
  - Tokoh yang boleh tampil harus terdaftar dalam kanon aktif (`characterNames`). Dilarang memunculkan tokoh bernama baru di luar daftar.
  - Dilarang membocorkan rahasia kanon yang belum waktunya (`forbiddenRevealIds`).
  - Dilarang membocorkan istilah teknis, AI, atau metadata internal (Brand Guard).
- **Penegakan:** Kegagalan Layer A deterministik atau deteksi kebocoran instan.

#### P1: CHAPTER MANDATORY OBLIGATIONS (Kewajiban Naratif Mandatori Bab)
- **Cakupan:**
  - **Ending Lock Directive:** Jika ending terkunci (`brief.lockedEndingKey !== null`), alur adegan wajib mengarah pada pencapaian akhir tersebut.
  - **Scheduled Reveals:** Menampilkan pengungkapan rahasia atau payoff yang dijadwalkan pada bab ini secara nyata dalam adegan melalui `writerDirective`.
  - **Plot Debts to Close:** Menyelesaikan janji naratif yang jatuh tempo penutupan melalui `writerDirective`.
  - **Global Story Anchors:** Menjaga keselarasan dengan Janji Inti Cerita, Konflik Utama, dan Pertanyaan Akhir Cerita.
- **Penegakan:** Tidak boleh dipotong diam-diam. Pelanggaran memicu kegagalan audit integritas naratif.

#### [CONTEXT BLOCK: RIWAYAT PEMBACA & STATE KANONIK]
- **Peran:** Blok input pendukung (bukan level precedensi independen) yang memuat konsekuensi pilihan pembaca sebelumnya (`previousChoice`), kutipan akhir bab sebelumnya, dan status relasi aktif. Menjadi dasar pijakan logis bagi P0–P2.

#### P2: COMPLETE DRAMATIC SCENE EXECUTION (Penyelesaian Adegan Dramatis)
- **Cakupan:**
  - Membangun 2–4 adegan berkesinambungan di lokasi fisik nyata yang jelas.
  - Meneruskan secara organik konsekuensi pilihan pembaca sebelumnya tanpa menganulir atau membatalkannya.
  - Prinsip dramaturgi: *Show, Don't Tell* (tindakan fisik, reaksi tubuh, dialog bermuatan tensi, dan monolog batin).
  - Terminal dramatic closure: Bab harus ditutup dengan resolusi dramatis yang utuh dan cliffhanger bermakna (tanpa batasan numerik paragraf).
- **Penegakan:** Evaluator kelengkapan `evaluateWriterCompleteness()` menolak teks jika kehilangan terminal closure atau adegan kosong.

#### P3: LENGTH AUTHORITY (Otoritas Panjang Kata)
- **Cakupan:**
  - **Target Optimal:** 850–950 kata.
  - **Batas Keras Penerimaan:** 800–1000 kata (hard acceptance gate).
  - Jika model membutuhkan penambahan volume narasi, model diinstruksikan untuk memperdalam interaksi sensorik, memperpanjang dialog subtil, atau memperluas ketegangan adegan—bukan menulis ringkasan naratif atau filler kosong.
- **Penegakan & Batas Tata Kelola:**
  - `WRITER_LENGTH_REPAIR_V1` berstatus **CLOSED / OFF**. Tidak ada perbaikan inferensi otomatis putaran kedua.
  - Panjang kata di luar 800–1000 kata menghasilkan penolakan terminal: `WRITER_LENGTH_OUT_OF_RANGE`.
  - Fungsi `clampChapterParagraphs()` di runtime codebase **BUKAN** mekanisme validasi word-band. Output >1000 kata tetap ditolak keras oleh evaluasi kelengkapan writer.

#### P4: VOICE & MOBILE READABILITY (Suara Karakter & Keterbacaan Mobile)
- **Cakupan:**
  - Sudut pandang wajib orang pertama ("aku") sebagai tokoh utama.
  - Menjaga register bicara unik tiap tokoh sesuai panduan suara (`voiceGuidance`).
  - Format dialog: pergantian antar-pembicara dipisahkan secara bersih.
  - Kalimat lugas dan bertenaga dalam bahasa Indonesia modern.
- **Penegakan:** Evaluasi suara Layer B / audit keterbacaan.

#### P5: QUALITATIVE PARAGRAPH RHYTHM (Ritme Paragraf Kualitatif)
- **Cakupan:**
  - **HAPUS SEMUA KONTROLER NUMERIK PARAGRAF:**
    - Dilarang menyertakan target jumlah paragraf (misal 35–50 atau 38–48 paragraf).
    - Dilarang menyertakan batasan jumlah kalimat per paragraf (misal maksimal 2–3 kalimat).
    - Dilarang menyertakan aturan pemisahan mekanis kaku (misal 1 baris dialog = 1 paragraf).
    - Dilarang menyertakan target jumlah paragraf cliffhanger (misal 3–4 paragraf akhir).
  - **PANDUAN KUALITATIF VERBATIM (ARAHAN PM):**
    ```text
    Gunakan paragraf yang nyaman dibaca di layar ponsel.
    Hindari dinding teks panjang.
    Pisahkan pergantian pembicara dan perubahan fokus dengan jelas.
    Biarkan panjang paragraf mengikuti kebutuhan aksi, reaksi, dialog, dan tensi adegan.
    ```
- **Tujuan:** Mengeliminasi "controller war" agar model leluasa mencapai target 850–950 kata secara alami.

---

## 5. Pseudostructure of Writer Prompt V2

### 5.1 System Prompt V2 (Cleaned from Numeric Paragraph Traps)

```text
Kamu adalah novelis profesional spesialis drama interaktif web novel Indonesia.
Tugasmu adalah menulis prosa narasi bab cerita yang imersif untuk pembaca akhir.

PRINSIP DASAR:
- Tulis HANYA prosa cerita (diawali JUDUL: <Judul Bab>).
- DILARANG memuat meta-komentar, penjelasan di luar cerita, sapaan pembaca, atau catatan penulis.
- DILARANG menggunakan istilah teknis internal: AI, sistem, prompt, model, token, rute, flag, variabel.
- POV: Selalu gunakan sudut pandang orang pertama ("aku") sebagai tokoh utama.

STANDAR KELENGKAPAN & PANJANG:
- Target utama: 850–950 kata (wajib berada dalam rentang ketat 800–1000 kata).
- Bangun adegan secara utuh dan detail: kedalaman interaksi dialog, monolog batin, dan deskripsi fisik.
- Jangan terburu-buru meringkas atau menutup bab sebelum tensi dramatis terbangun matang.
```

### 5.2 User Prompt V2 Structure (Strictly Without Technical Authority IDs)

```text
=== [P0] INVARIAN CANON & KEAMANAN (MANDATORI / HARUS DIPATUHI) ===
- Tokoh yang boleh tampil (nama persis): {characterNames}
- DILARANG memunculkan tokoh bernama baru yang tidak ada dalam daftar di atas.
- RAHASIA DILARANG UNTUK DIUNGKAP/DIBOCORKAN: {mustNotRevealDirectives}

=== [P1] KEWAJIBAN NARATIF MANDATORI BAB INI ===
[Jika ending terkunci (brief.lockedEndingKey !== null)]:
- ARAH AKHIR CERITA (ENDING TERKUNCI): Cerita telah mengunci arah resolusi menuju ending terpilih.
  Makna penutupan yang wajib dicapai: {lockedEndingClosureDirective}.
  Semua tindakan, ketegangan, dan akibat adegan bab ini WAJIB mengarah ke penyelesaian tersebut.

[Jika ada scheduled reveals pada bab ini (brief.scheduledReveals)]:
- REVEAL / TITIK BALIK WAJIB:
  * {scheduledRevealWriterDirective}
  Adegan WAJIB memperlihatkan penemuan, konfrontasi, atau pengungkapan fakta ini secara nyata.

[Jika ada plot debts jatuh tempo (brief.plotDebtsToClose)]:
- HUTANG PLOT HARUS DITUTUP: Selesaikan janji naratif berikut:
  * {plotDebtCloseWriterDirective}

[Jangkar Global Cerita]:
- Janji Inti Cerita: {corePromise}
- Konflik Utama: {mainConflict}
- Pertanyaan Akhir Cerita: {finalQuestion}

=== KONTEKS: RIWAYAT PEMBACA & AKIBAT PILIHAN ===
Potongan Paragraf Akhir Bab Sebelumnya:
> {previousChapterEnding}

Pilihan Pembaca Sebelumnya yang Mengikat:
- Pilihan: "{previousChoiceLabel}"
- Konsekuensi Kanonik: {previousChoiceConsequences}
- KONSEKUENSI DI ATAS TELAH TERJADI DAN MENGIKAT. Buka bab ini dengan menyambung langsung akibat tersebut. DILARANG menganulir atau membatalkan pilihan pembaca.

=== [P2] PENYELESAIAN DRAMATIS ADEGAN & RENCANA BAB ===
- Tujuan Bab: {chapterGoal}
- Beat Wajib yang Harus Dijalani Tokoh:
  * {plannedBeat1}
  * {plannedBeat2}
  * {plannedBeat3}
- Tulis 2–4 adegan berkesinambungan di lokasi fisik nyata yang mengalir tanpa lompatan waktu drastis.
- Terapkan Show, Don't Tell: fokus pada aksi fisik, reaksi emosional tubuh, dan subteks dialog.
- Bangun penutupan dramatis yang tuntas pada akhir bab, mengerucut pada cliffhanger yang tajam dan bermakna.

=== [P3] OTORITAS PANJANG KATA ===
- Target utama penulisan: 850–950 kata.
- Batas penerimaan keras: 800–1000 kata.
- Kembangkan interaksi sensorik dan dinamika dialog untuk mencapai rentang target; hindari ringkasan naratif tergesa-gesa.

=== [P4] SUARA TOKOH & KETERBACAAN MOBILE ===
- Pertahankan sudut pandang orang pertama ("aku") secara konsisten.
- Panduan Suara Karakter:
  {voiceGuidance}
- Format pergantian ucapan tokoh dipisahkan dengan jelas agar pembaca mudah mengikuti percakapan.

=== [P5] RITME PARAGRAF KUALITATIF ===
Gunakan paragraf yang nyaman dibaca di layar ponsel.
Hindari dinding teks panjang.
Pisahkan pergantian pembicara dan perubahan fokus dengan jelas.
Biarkan panjang paragraf mengikuti kebutuhan aksi, reaksi, dialog, dan tensi adegan.

=== KONTRAK KELUARAN ===
Keluaran WAJIB diawali dengan:
JUDUL: <Judul Bab yang Menggugah>
<Prosa lengkap...>
```

---

## 6. Seam Impact & Contract Modifications (Proposed Interface Changes)

### 6.1 `lib/story-engine/pre-prose-brief.ts`

Memperluas skema dengan obligasi terstruktur, identitas rahasia terlarang, dan kapasitas terikat audit:

```typescript
import { z } from 'zod'

export const WriterNarrativeObligationSchema = z.object({
  authorityId: z.string().trim().min(1).max(120),
  kind: z.enum(['SCHEDULED_REVEAL', 'PLOT_DEBT_PROGRESS', 'PLOT_DEBT_CLOSE']),
  writerDirective: z.string().trim().min(1).max(500),
}).strict()

export type WriterNarrativeObligation = z.infer<typeof WriterNarrativeObligationSchema>

// Batas kapasitas terikat hasil audit kontrak blueprint produksi (TBD bounded capacity audit)
export const PreProseChapterBriefSchema = z.object({
  storyId: z.string().min(1),
  chapterNumber: z.number().int().min(1).max(50),
  phase: z.string().min(1),
  lockedEndingKey: z.string().trim().min(1).max(80).nullable(),
  endingRunway: z.object({
    lockedEndingKey: z.string(),
    remainingChapters: z.number().int().min(0),
    requiredClosures: z.array(z.string()),
  }).optional(),
  lockedEndingClosure: z.array(z.string()).optional(),
  chapterGoal: z.string().min(1),
  mustInclude: z.array(z.string().trim().min(1).max(700)),
  mustNotInclude: z.array(z.string().trim().min(1).max(400)),
  mustNotReveal: z.array(z.string().trim().min(1).max(240)),
  forbiddenRevealIds: z.array(z.string().trim().min(1).max(120)).default([]),
  scheduledReveals: z.array(WriterNarrativeObligationSchema).default([]),
  plotDebtsToProgress: z.array(WriterNarrativeObligationSchema).default([]),
  plotDebtsToClose: z.array(WriterNarrativeObligationSchema).default([]),
  routeStateSummary: z.string().max(4096),
  previousChoiceSummary: z.string().max(4096),
  previousChoiceApplied: z.boolean(),
}).strict()

export type PreProseChapterBrief = z.infer<typeof PreProseChapterBriefSchema>
```

### 6.2 `lib/ai-gateway/chapter-writer-contract.ts`

Kontrak proyeksi mewajibkan mode eksplisit dan mengembalikan proyeksi teks beserta metadata penelusuran internal:

```typescript
export type WriterAuthorityMode = 'CHAPTER_BRIEF_V2' | 'LEGACY'

export interface BuildProductionChapterWriterPromptArgs {
  readonly snapshot: CanonSnapshot
  readonly plan: Record<string, unknown>
  readonly continuation?: ContinuationContext | null
  readonly brief?: PreProseChapterBrief | null
  readonly authorityMode: WriterAuthorityMode // WAJIB (NON-OPTIONAL)
  readonly repairFindings?: Finding[]
}

export interface ChapterWriterPromptProjection {
  readonly system: string
  readonly prompt: string
  readonly metadata: {
    readonly authorityMode: WriterAuthorityMode
    readonly endingLockProjected: boolean
    readonly obligations: readonly WriterNarrativeObligation[]
  }
}

export function buildProductionChapterWriterPrompt(
  args: BuildProductionChapterWriterPromptArgs
): ChapterWriterPromptProjection {
  if (args.authorityMode === 'CHAPTER_BRIEF_V2') {
    if (!args.brief) {
      throw new Error('CHAPTER_BRIEF_V2_BRIEF_REQUIRED: brief is mandatory in CHAPTER_BRIEF_V2 authority mode')
    }

    // Pre-Call Contradiction Guards
    assertAuthorityContradictionGuards({
      snapshot: args.snapshot,
      brief: args.brief,
      continuation: args.continuation,
    })
  }

  return compilePromptV2(args)
}
```

### 6.3 `lib/ai-gateway/gateway-provider.ts`

Meneruskan `input.brief` dan secara eksplisit menyetel `authorityMode: 'CHAPTER_BRIEF_V2'`:

```typescript
// Di dalam writeChapter:
const { title, paragraphs: rawParagraphs } = await generateProse({
  chain,
  snapshot: input.snapshot,
  plan: input.plan as Record<string, unknown>,
  continuation: input.continuation,
  brief: input.brief,
  authorityMode: 'CHAPTER_BRIEF_V2', // EKSPLISIT
  repairFindings: input.repairFindings,
  options,
  route: aiRoute,
})
```

---

## 7. Migration, Compatibility & Regression Analysis

### 7.1 Backward Compatibility & Explicit Mode Boundary

1. **Isolasi Mode Legacy:**
   - Harness pengujian lama yang membutuhkan kompatibilitas wajib secara eksplisit mengirimkan `authorityMode: 'LEGACY'`.
   - Kode produksi baru tidak boleh menggunakan mode legacy. Jika `authorityMode` dihilangkan, kompilasi TypeScript akan menolaknya (*compile-time rejection*).
2. **Standard & Personalized Generation:**
   - Seluruh alur kerja produksi aktif (`personalized-generation.ts`) mengirimkan `authorityMode: 'CHAPTER_BRIEF_V2'`.
   - Karena `buildChapterBrief()` telah dijalankan sebelum `writeChapter`, menghubungkan `brief` ke `writeChapter` tidak menimbulkan penambahan operasi database baru.
3. **Hard Acceptance Invariants (800–1000 kata):**
   - Batas keras penerimaan 800–1000 kata pada evaluasi Layer A deterministik dan `evaluateWriterCompleteness()` tetap 100% aktif dan tidak berubah.

### 7.2 Dampak terhadap Fixture V2 & Kualifikasi Model

- **Dampak yang Diharapkan (Expected Effect):**
  - Blocker proyeksi untuk penguncian ending (`PRODUCTION_PROJECTION_ENDING_LOCK_NOT_WRITER_VISIBLE`) pada Bab 45 terangkat secara arsitektural.
  - Pengungkapan rahasia terjadwal (`scheduledReveals`) dan penutupan hutang plot (`plotDebtsToClose`) menjadi terproyeksi secara terstruktur dan traceable.
- **Syarat Validasi Pasca-Implementasi (Required Post-Implementation Result):**
  - Implementasi sambungan (*seam*) **TIDAK SECARA OTOMATIS** mengubah status fixture menjadi `READY`.
  - Setelah implementasi selesai, validator penuh `writer-qualification-fixture-v2.test.ts` **WAJIB DIJALANKAN ULANG**.
  - Hanya jika seluruh pengujian sumber fixture, representativeness, semantic artifact, anti-tamper, determinisme, dan proyeksi produksi lolos secara absolut, barulah status kualifikasi resmi bertransisi menjadi:
    ```text
    qualificationAllowed = true
    verdict = PASS
    readyAuthorityManifestHash != null (SHA-256 terhitung sah)
    ```

### 7.3 Governance Boundaries on Length (Penegasan Batas Tata Kelola)

1. **Status Perbaikan Panjang Kata (Length Repair):**
   - Status tata kelola: `WRITER_LENGTH_REPAIR_V1 = CLOSED / OFF`.
   - Kegagalan panjang kata (<800 atau >1000 kata) adalah kegagalan terminal produksi (*terminal fail-closed*).
   - Tidak ada inferensi perbaikan putaran kedua (*no second-pass repair inference*) di bawah kebijakan produksi saat ini.
2. **Status Penjepit Paragraf (Paragraph Clamping):**
   - Fungsi `clampChapterParagraphs()` yang ada pada codebase hanya bertindak sebagai pemotong defensif memori lokal, **BUKAN** mekanisme validasi word-band.
   - Setiap draf narasi yang memiliki panjang kata >1000 kata tetap ditolak keras oleh `evaluateWriterCompleteness()` (`WRITER_LENGTH_OUT_OF_RANGE`). Clamp paragraf dilarang digunakan untuk memaksakan draf invalid menjadi valid.

---

## 8. Narrative Consistency Spec (NCS) & Traceability Matrix (NTM) Mapping

### 8.1 Prinsip Pemetaan Tata Kelola

Spesifikasi arsitektur ini **TIDAK MENGUBAH** status baris pada dokumen tata kelola `NARRATIVE_TRACEABILITY_MATRIX.md` (NTM v1.0). Status baris NTM hanya dapat dipindahkan ke `DONE` melalui bukti row-level yang terverifikasi penuh pada gate rilis resmi.

Spesifikasi ini mencatat status otoritas NTM v1.0 yang tercatat secara sah, memisahkannya dari bukti observasi repositori saat ini, serta menetapkan peran pendukung arsitekturalnya:

| Gap ID | Nama Kontrol NTM | Status NTM v1.0 (Tercatat Resmi) | Observasi Bukti Repositori Saat Ini | Peran Pendukung Arsitektur Prompt V2 |
|---|---|---|---|---|
| **G1-REACH** | Ending reachability check tiap checkpoint | `TODO` (baris 33) | `IN_PROGRESS` (checkEndingReachability soak pass, namun bukti M10-C unratified dengan payload ncs14Proven: false) | Menghubungkan ending reachable ke instruksi writer di P1 (Bab 45+). Tidak menutup G1-REACH sendirian. |
| **G1-SPINE** | Reconciliation tak boleh langgar spine/reveal gate/ending | `TODO` (baris 34) | `IN_PROGRESS` (checkSpineIntegrity pass di soak, belum di-gate runtime penuh) | Memproyeksikan scheduled reveal gates secara terstruktur ke P1 tanpa melanggar kronologi gate (dijaga Guard #4). |
| **G2-LOADBEAR** | `LOAD_BEARING` tak pernah dipangkas sebelum dibayar | `TODO` (baris 42) | `IN_PROGRESS` (load-bearing tak terpangkas terbukti di compiler, namun brief-only fields drop sebelum prompt) | Menyediakan propagasi hutang plot (`plotDebtsToClose`) agar janji naratif tidak gugur di tengah jalan. |
| **G3-LAYERA** | Cek deterministik (tanpa LLM): karakter, reveal, timeline, alias | `TODO` (baris 48) | `DONE` di repo runtime (`validateLayerA` 8 cek aktif; *lihat Catatan Otoritas*) | Menghilangkan friksi instruksi internal pada prompt writer sehingga draf model lebih konsisten mematuhi Layer A. |
| **G4-STATUS** | Thread status lifecycle: `OPEN→DEVELOPING→PAYOFF_DUE→RESOLVED` | `TODO` (baris 57) | `DONE` di repo runtime (post-publication lifecycle mem-persist transisi status di act boundary) | Memproyeksikan hutang plot yang jatuh tempo ke P1 writer sehingga model secara konkret mengeksekusi penyelesaian narasi di teks prosa. |

### 8.2 Catatan Otoritas Panjang Kata (Word-Band Supersession)
- Dokumen draf `NARRATIVE_CONSISTENCY_SPEC.md` (NCS v1.0 baris 104) dan NTM v1.0 baris 48 secara historis mencatat rentang **500–800 kata**.
- Otoritas repositori yang lebih baru (Architecture v1.1, test suites, dan `evaluateWriterCompleteness()`) telah menggantikan rentang tersebut menjadi **800–1000 kata hard acceptance (850–950 kata target)**.
- Spesifikasi V2 ini beroperasi penuh di bawah **otoritas repositori yang lebih baru (800–1000 kata)**, bukan rentang historis draf awal.

---

## 9. Implementation Roadmap & Readiness Criteria

Implementasi fisik rancangan ini **DITUNDA** hingga ada otorisasi eksplisit dari Project Lead / PM (`APPROVED_FOR_IMPLEMENTATION`). Setelah ratifikasi PM diberikan, roadmap eksekusi teknis adalah sebagai berikut:

```text
[Fase 1: Kontrak & Skema]
  - Update PreProseChapterBriefSchema dengan WriterNarrativeObligationSchema & forbiddenRevealIds.
  - Implementasi Pre-Call Contradiction Guards di chapter-writer-contract.ts.
  - Tambahkan tipe WriterAuthorityMode non-optional ('CHAPTER_BRIEF_V2' | 'LEGACY').

[Fase 2: Prompt Engine V2]
  - Refactor mobileDramaSystemPrompt (hapus kontrol numerik paragraf/kalimat).
  - Refactor buildWriterPrompt dengan hierarki P0–P5 dan P5 kualitatif murni.
  - Pastikan authorityId hanya disimpan di metadata, tidak dirender ke user prompt LLM.
  - Pastikan P0/P1 no-silent-trimming.

[Fase 3: Gateway Wiring]
  - Sambungkan input.brief pada generateProse di gateway-provider.ts.
  - Aktifkan authorityMode: 'CHAPTER_BRIEF_V2' secara eksplisit pada alur produksi.

[Fase 4: Verifikasi Deterministik Pasca-Implementasi]
  - Jalankan unit tests prompt engine & gateway contract.
  - Evaluasi ulang writer-qualification-fixture-v2.test.ts.
  - Verifikasi apakah syarat readyAuthorityManifestHash terhitung secara sah.

[Fase 5: Quality Gates]
  - pnpm typecheck
  - Scoped ESLint
  - git diff --check
  - Verifikasi 0 provider/model calls selama fase offline.
```

Kriteria kesiapan (*Readiness Criteria*) untuk membuka autorisasi kualifikasi model:
1. `writer-qualification-fixture-v2.test.ts` berhasil menghasilkan `verdict: PASS` dan `qualificationAllowed: true`.
2. Hash manifes otoritas terhitung secara sah (`readyAuthorityManifestHash !== null`).
3. Seluruh unit test deterministik lolos 100% tanpa inferensi jaringan.
