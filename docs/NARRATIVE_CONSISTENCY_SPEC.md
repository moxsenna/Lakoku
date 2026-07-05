# Lakoku — Narrative Consistency Spec (NCS) v1.0

Status: DRAFT untuk review
Melengkapi: PRD v0.2 (§6, §8) dan ARCHITECTURE (§9, §11, §12)
Tujuan: menjamin konsistensi cerita hingga Bab 50 dengan mekanisme yang dapat diukur dan di-QA.

---

## 0. Kenapa Dokumen Ini Ada

Arsitektur saat ini sudah benar secara struktur (canon ledger, context compiler, validator gate, atomic publish), tetapi meninggalkan lima area tanpa spesifikasi operasional. Kelima area ini adalah titik gagal paling umum pada generasi naratif panjang:

| # | Gap | Gejala tanpa perbaikan | Bab rawan |
|---|---|---|---|
| G1 | Blueprint statis tanpa rekonsiliasi | Chapter goal bertentangan dengan state aktual | 25–40 |
| G2 | Tidak ada policy kompaksi memori | Fakta penting terpotong dari context → kontradiksi | 30+ |
| G3 | Validator continuity tidak terspesifikasi | Kontradiksi lolos publish | semua |
| G4 | Thread tanpa lifecycle | Mystery tidak dibayar / dilupakan di Act 7 | 41–50 |
| G5 | Entitas tanpa kanonikalisasi | Fakta ganda untuk karakter yang sama | 10+ |

---

## 1. G1 — Blueprint Reconciliation (Adaptive Re-planning)

### 1.1 Prinsip

Blueprint 50 bab tetap menjadi **spine yang dilindungi** (PRD §8.4), tetapi level detail per-bab bersifat **adaptif per-act**. Blueprint memiliki dua lapisan:

- **Spine layer (immutable):** batas act, mandatory reveals, reveal gates, ending rules, konflik inti. Tidak pernah berubah setelah lock.
- **Trajectory layer (reconcilable):** chapter goal, beat detail, scene alternatif per bab. Boleh direvisi oleh Reconciliation step, dalam batas spine.

### 1.2 Reconciliation Checkpoint

Checkpoint wajib dijalankan pada **akhir setiap act** (setelah publish Bab 5, 12, 20, 32, 40, 45, 48) dan **on-demand** bila plan validator mendeteksi konflik goal-vs-state.

Langkah checkpoint (step baru di GenerateChapterWorkflow, berjalan sebelum step "Plan chapter" pada bab pertama act berikutnya):

1. Bandingkan trajectory layer act berikutnya dengan: relationship_states, story_flags, clue availability, thread status aktual.
2. Hitung **drift score** per chapter goal (0 = konsisten, 3 = mustahil dieksekusi).
3. Goal dengan drift ≥ 2 diregenerasi oleh planner dengan constraint: spine layer, ending rules, dan reveal gates tidak boleh berubah.
4. Hasil rekonsiliasi disimpan sebagai `chapter_blueprints` versi baru (versioned, auditable), bukan overwrite.
5. Jika rekonsiliasi tidak dapat memenuhi spine (mis. ending tidak reachable dari state manapun), attempt masuk `FAILED_REVIEW_REQUIRED` — bukan dipaksa publish.

### 1.3 Tabel/kolom baru

- `chapter_blueprints.version`, `chapter_blueprints.reconciled_from_version`, `reconciliation_reason`.
- Event baru di ledger: `BLUEPRINT_RECONCILED` dengan correlation ID.

### 1.4 Aturan keras

- Reconciliation tidak boleh menghapus mandatory reveal, memindah reveal gate lebih awal, atau menutup semua ending.
- **Ending reachability check** wajib lulus pada setiap checkpoint: minimal 2 ending utama + jalur menuju secret ending harus tetap reachable dari state saat ini. Gagal = review manusia.

### 1.5 Status implementasi (T5.1 + T7.5)

- Logika inti di `lib/narrative/reconciliation.ts`: `runReconciliation()` (sinkron, deterministik) + `runReconciliationAdaptive(input, goalAuthor?)` (T7.5).
- **Regenerasi goal (step 3) kini adaptif LLM-authored:** `goalAuthor` (`lib/authoring/reconcile-goal.ts` — `makeGoalAuthor`/`authorChapterGoal`) menulis ulang chapter goal drift ≥ 2 dengan spine + forbidden reveals sebagai constraint read-only. `validateAuthoredGoal()` menolak goal yang membocorkan istilah teknis (`scanForLeaks`) atau menyinggung reveal terlarang. Bila author gagal/menolak/throw → **fallback deterministik** (`[rekonsiliasi vN]`) sehingga checkpoint tak pernah buntu.
- Spine layer (mandatory beats, forbidden reveals, reveal gate, ending reachability) ditegakkan identik pada kedua jalur; pelanggaran → `FAILED_REVIEW_REQUIRED`. Versioning + event `BLUEPRINT_RECONCILED` tetap; `authoredChapters` melacak bab yang benar-benar ditulis LLM.
- Bukti: `scripts/m7b-reconcile-smoke.ts` 23/23, regresi `scripts/m5-soak.ts` hijau. Wiring ke WF step R runtime nyata menyusul di M6.

---

## 2. G2 — Memory Compaction & Context Budget Policy

### 2.1 Hierarki memori (4 tingkat)

| Tingkat | Isi | Kapan dibuat | Selalu masuk context? |
|---|---|---|---|
| T0 — Canon core | Story contract summary, karakter inti + motivasi, konflik utama, ending rules | Saat lock | Ya, selalu |
| T1 — Act rollup | Rangkuman 1 act (≤ 250 kata) + delta state penting act itu | Otomatis saat act selesai | Ya, semua act sebelumnya |
| T2 — Chapter summary | Rangkuman per bab (≤ 120 kata) + state delta | Saat publish | Hanya act berjalan + 2 bab terakhir act sebelumnya |
| T3 — Scene archive | Prosa detail (vector retrieval) | Saat publish | Hanya hasil retrieval, non-otoritatif |

Konsekuensi: pada Bab 45, context berisi T0 + 5–6 rollup act (T1) + ±8 summary bab (T2), bukan 44 summary mentah.

### 2.2 Budget token Chapter Context Packet

Total packet maksimal ditetapkan per model policy version. Alokasi baseline:

| Seksi | Porsi | Aturan overflow |
|---|---|---|
| Safety + hard rules | 5% | Tidak boleh dipotong |
| T0 canon core | 15% | Tidak boleh dipotong |
| Blueprint goal + forbidden reveals bab ini | 10% | Tidak boleh dipotong |
| Current state (relasi, flags, threads aktif) | 20% | Prune flag non-relevan via relevance scoring |
| T1 rollups + T2 summaries | 25% | Kompres T2 tertua terlebih dahulu |
| Deterministic facts/timeline/secrets relevan | 15% | Relevance scoring, fakta ber-tag `LOAD_BEARING` tidak boleh dipotong |
| T3 retrieval + writer instructions | 10% | Retrieval dipotong pertama |

### 2.3 Fact relevance & load-bearing facts

- Setiap fakta di `facts_ledger` memiliki `salience` (recomputed saat publish: disebut di bab terakhir? terkait thread aktif? terkait chapter goal berikutnya?).
- Fakta yang menjadi prasyarat reveal gate, ending rule, atau mandatory beat di-tag `LOAD_BEARING` dan **selalu** masuk packet hingga dibayar.
- Compiler mencatat fakta apa yang di-exclude (`retrieval_logs`), sehingga kontradiksi bisa diaudit balik ke keputusan pruning.

---

## 3. G3 — Continuity Validator Specification

### 3.1 Dua lapis: deterministik dulu, model kemudian

**Lapis A — Deterministic checks (wajib, murah, tanpa LLM):**

| Cek | Sumber | Severity |
|---|---|---|
| Karakter yang muncul terdaftar & masih hidup/aktif | `characters`, `character_states` | CRITICAL |
| Tidak ada reveal sebelum gate | `secrets_reveals`, `knowledge_scopes` vs extracted events | CRITICAL |
| Karakter tidak mengetahui info di luar knowledge scope-nya | `knowledge_scopes` vs dialog attribution | CRITICAL |
| State delta ⊆ allowed_state_delta | packet vs proposal | CRITICAL |
| Timeline monoton (tidak ada event mundur tanpa flashback marker) | `timeline_events` | MAJOR |
| Panjang bab 500–800 kata, 2–4 scene, ada choice/gate | struktur draft | MAJOR |
| Nama/alias karakter cocok dengan registry (lihat G5) | `character_aliases` | MAJOR |
| Karakter baru bernama setelah Bab 30 ada di blueprint | blueprint | CRITICAL |

**Lapis B — Model-based checks (validator model terpisah dari writer):**

- Kontradiksi fakta lunak (sifat, motivasi, detail fisik) terhadap T0/T1/fakta relevan.
- Konsistensi suara karakter terhadap voice sheet (lihat §5).
- Emosi/reaksi konsisten dengan relationship score saat ini.
- Output lapis B berupa findings terstruktur dengan severity; CRITICAL memblokir publish, MAJOR masuk repair, MINOR dicatat.

### 3.2 Aturan repair

- Repair menerima **hanya** findings + potongan context relevan, bukan izin menulis ulang.
- Maksimal 2 repair attempt per lapis; setelah itu `FAILED_REVIEW_REQUIRED`.
- Repair tidak boleh memperbaiki kontradiksi dengan cara menghapus fakta canon — hanya merevisi draft.

### 3.3 Metrik konsistensi (masuk dashboard Narrative quality, ARCHITECTURE §17.3)

- `continuity_critical_rate` per bab-ke-N (target beta: < 2% pada Bab 1–20, < 5% pada Bab 21–50).
- `repair_success_rate`, `review_required_rate` per act.
- `reader_inconsistency_report_rate` (dari Laporkan Masalah Cerita, dipisah per kategori "cerita tidak nyambung").
- Alert bila `continuity_critical_rate` naik monoton terhadap nomor bab (indikasi kompaksi gagal).

---

## 4. G4 — Story Thread Lifecycle

### 4.1 Status thread

`OPEN → DEVELOPING → PAYOFF_DUE → RESOLVED | ABANDONED_APPROVED`

- Setiap thread memiliki `payoff_window` (rentang bab dari blueprint, mis. "dalang terungkap: Bab 46–48").
- `ABANDONED_APPROVED` hanya via keputusan reconciliation checkpoint yang ter-audit — thread tidak boleh hilang diam-diam.

### 4.2 Aturan budget & staleness

- Maksimal **7 thread aktif** (OPEN/DEVELOPING) bersamaan; planner tidak boleh membuka thread baru bila penuh.
- Thread yang tidak disentuh **6 bab berturut-turut** ditandai `STALE` → wajib direferensikan (minimal callback 1 kalimat) dalam 3 bab berikutnya, atau dieskalasi ke checkpoint.
- Mulai Bab 41 (Act 6): planner **dilarang** membuka thread baru; setiap bab wajib memajukan ≥ 1 thread `PAYOFF_DUE`.
- Publish Bab 48 diblokir bila masih ada thread mystery utama berstatus non-RESOLVED (deterministic check).

---

## 5. G5 — Entity Canonicalization & Character Voice

### 5.1 Alias registry

- Tabel baru `character_aliases (character_id, alias, alias_type)` — nama panggilan, sebutan relasi ("ibu mertua", "Bu Ratna", "mama"), julukan.
- Extractor wajib me-resolve setiap mention ke `character_id` via registry sebelum mengusulkan fakta/event. Mention yang tidak ter-resolve = finding MAJOR, bukan karakter baru otomatis.
- Fakta baru yang konflik dengan fakta existing untuk entitas sama → CRITICAL finding, tidak pernah "last write wins".

### 5.2 Character voice sheet

- Setiap karakter inti memiliki voice sheet di canon (dibuat saat opening package): register bahasa, kebiasaan bicara, kata larangan/khas, 2–3 contoh kalimat dialog.
- Voice sheet masuk T0 untuk karakter yang tampil di bab yang sedang ditulis.
- Validator lapis B memeriksa dialog terhadap voice sheet.

---

## 6. Perubahan pada GenerateChapterWorkflow (delta terhadap ARCHITECTURE §11.2)

| Step | Perubahan |
|---|---|
| 1. Compile context | Ikuti hierarki T0–T3 + budget §2.2; log fakta yang di-exclude |
| 2. Plan chapter | Tambah input: thread status + payoff window; larangan thread baru sesuai §4.2 |
| 3. Validate plan | Tambah: drift check goal-vs-state; drift ≥ 2 → trigger reconciliation on-demand |
| 6. Validate continuity | Ganti dengan spesifikasi §3 (lapis A deterministik + lapis B model) |
| 9. Final commit | Tambah: update thread status, salience recompute, T1 rollup bila act selesai |
| BARU: Reconciliation | Berjalan pada akhir act atau on-demand, sesuai §1.2 |

---

## 7. Tambahan Fixtures (delta terhadap ARCHITECTURE §18.2)

- Simulasi penuh 50 bab pada 3 jalur berbeda (high-trust, low-trust, mixed) sebagai **long-run soak test** per template release; diukur dengan metrik §3.3.
- Fixture drift: state yang sengaja dibelokkan di Bab 20 → checkpoint Act 4 harus merekonsiliasi tanpa melanggar spine.
- Fixture kompaksi: fakta `LOAD_BEARING` dari Bab 3 harus tetap muncul benar di Bab 47.
- Fixture alias: karakter dirujuk dengan 3 sebutan berbeda dalam 1 bab → tidak boleh menghasilkan entitas ganda.
- Fixture thread: thread dibiarkan stale → sistem memaksa callback; Bab 48 dengan thread unresolved → publish diblokir.

---

## 8. Definisi Sukses

Arsitektur dinyatakan siap 50 bab bila pada soak test staging:

1. 0 kontradiksi CRITICAL lolos publish pada 3 jalur simulasi penuh.
2. `reader_inconsistency_report_rate` beta < 3% per story yang mencapai Bab 30+.
3. Semua ending reachable pada setiap checkpoint di ketiga jalur.
4. Biaya per bab tetap dalam guardrail §20.2 ARCHITECTURE meski context tumbuh (bukti kompaksi bekerja).
