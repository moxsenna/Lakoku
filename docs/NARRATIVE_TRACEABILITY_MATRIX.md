# Lakoku — Narrative Traceability Matrix (NTM) v1.0

**Status:** Build-governance document
**Last updated:** 7 July 2026
**Owner:** Project lead / Narrative Operations
**Governs:** `PRD_Lakoku_Interactive_v0.3.md`, `ARCHITECTURE_v1.1.md`, `NARRATIVE_CONSISTENCY_SPEC.md` (NCS v1.0)

---

## 0. Kenapa Dokumen Ini Ada

PRD, ARCHITECTURE, dan NCS masing-masing benar, tetapi kebenaran itu tersebar. Risiko terbesar sebuah cerita 50 bab **bukan** karena satu mekanisme tidak dirancang — melainkan karena satu **mata rantai** (skema, validator, fixture, metrik, atau release gate) diam-diam terlewat saat implementasi, sehingga mekanisme yang dirancang tidak pernah benar-benar menutup gap-nya.

NTM adalah satu tabel penelusuran *end-to-end* untuk setiap gap konsistensi. Sebuah gap dianggap **DONE** hanya jika **seluruh kolom di barisnya** terbukti ada di kode, migrasi, test, dan dashboard. Ini adalah alat sign-off, bukan spesifikasi baru — spesifikasi tetap milik NCS.

**Aturan penggunaan:**
- Setiap PR yang mengklaim menutup sebagian gap harus mereferensikan ID baris NTM (mis. `G2-COMPACT`).
- Release template diblokir bila ada baris berstatus selain `DONE` untuk gap yang masuk scope release itu (selaras ARCHITECTURE §18.3 + NCS §8).
- Bila NCS berubah, NTM diperbarui di PR yang sama. NTM tidak boleh melenceng dari NCS.

**Audit status 7 July 2026:** status `DONE` di tabel ini hanya diberikan bila bukti row-level sudah ada di repo (runtime/validator, fixture/smoke, dan bila relevan dashboard). Baris yang baru punya core logic + smoke tetapi belum di-wire ke workflow runtime produksi tetap `IN_PROGRESS`. Gate otomatis web release sudah ada di M9/T9.2; gate global beta penuh tetap menunggu seluruh baris in-scope dan staging sign-off.

---

## 1. Matriks Penelusuran Gap → Gate

Kolom: **Gap** (NCS) · **Requirement** · **Skema DB** · **Runtime/Validator** · **Fixture** · **Metrik** · **Release gate** · **Status**.

### G1 — Blueprint Reconciliation (NCS §1)

| ID | Requirement | Skema DB | Runtime/Validator | Fixture | Metrik | Release gate | Status |
|---|---|---|---|---|---|---|---|
| G1-VERSION | Blueprint versioned, bukan overwrite | `chapter_blueprints.version`, `.reconciled_from_version`, `.reconciliation_reason`; event `BLUEPRINT_RECONCILED` | Reconciliation step (WF step R) | drift fixture (Bab 20) | — | ARCH §18.3 soak | IN_PROGRESS (`runReconciliation*` sudah menghasilkan version++ + `reconciledFromVersion` + event `BLUEPRINT_RECONCILED`; terbukti di `m5-soak.ts` dan `m7b-reconcile-smoke.ts`. Belum `DONE` karena `generateNextChapterReal()` belum menjalankan/persist step R act-end ke DB runtime.) |
| G1-DRIFT | Drift score goal-vs-state; ≥2 → regenerate goal | — | WF step 3 (validate plan) | drift fixture | `review_required_rate` | soak | IN_PROGRESS (`computeDriftScore()` 0–3 + `runReconciliationAdaptive()` LLM-authored/fallback deterministik sudah terbukti; `review_required_rate` sudah ada di M8. Belum `DONE` sampai drift checkpoint runtime memanggil step R dan release gate M9 menolak regresi.) |
| G1-REACH | Ending reachability check tiap checkpoint | `ending_rules` | Reconciliation step | soak 3 jalur | "semua ending reachable" (NCS §8.3) | soak | IN_PROGRESS (`checkEndingReachability()` dan soak 3 jalur×50 bab hijau; belum `DONE` karena checkpoint reachability belum menjadi step runtime produksi.) |
| G1-SPINE | Reconciliation tak boleh langgar spine/reveal gate/ending | spine layer immutable | WF step R hard rule; ARCH rule #17 | drift fixture | 0 pelanggaran spine | soak | IN_PROGRESS (`checkSpineIntegrity()` menolak hapus mandatory reveal/majukan reveal gate; 0 pelanggaran di soak. Belum `DONE` sampai step R runtime dipersist dan digate di M9.) |

### G2 — Memory Compaction & Context Budget (NCS §2)

| ID | Requirement | Skema DB | Runtime/Validator | Fixture | Metrik | Release gate | Status |
|---|---|---|---|---|---|---|---|
| G2-TIERS | Hierarki T0–T3; T1 rollup otomatis saat act selesai | `act_rollups` (T1), `chapter_summaries` (T2) | WF step 1 & step 9 | soak (context di Bab 45 = T0+rollup+±8 summary) | cost/bab dalam guardrail (NCS §8.4) | soak | IN_PROGRESS (`compileContext()` + `loadCanonSnapshot()` membaca T0/T1/T2/T3 dan runtime sudah memanggil compiler. Belum `DONE` karena T1 auto-rollup WF step 9 belum menjadi side-effect runtime.) |
| G2-BUDGET | Alokasi budget packet + aturan overflow | — | Context compiler; `context_budget_report{}` | load-bearing fixture | — | soak | IN_PROGRESS (budget policy + `context_budget_report` aktif dan `m5-soak` biaya/bab hijau; belum `DONE` sampai guardrail biaya menjadi release gate M9.) |
| G2-LOADBEAR | `LOAD_BEARING` tak pernah dipangkas sebelum dibayar; exclusion di-log | `facts_ledger.load_bearing`, `.salience`; `retrieval_logs` | Context compiler; ARCH rule #16 | load-bearing fixture (fakta Bab 3 muncul benar Bab 47) | — | soak | IN_PROGRESS (load-bearing tak terpangkas terbukti, `persistRetrievalLog()` sudah dipanggil runtime; masih menunggu release gate M9 untuk status final `DONE`.) |

### G3 — Continuity Validator (NCS §3)

| ID | Requirement | Skema DB | Runtime/Validator | Fixture | Metrik | Release gate | Status |
|---|---|---|---|---|---|---|---|
| G3-LAYERA | Cek deterministik (tanpa LLM): karakter hidup/terdaftar, no reveal pre-gate, knowledge scope, state delta ⊆ allowed, timeline, struktur bab, alias, karakter baru >Bab30 | `characters`, `character_states`, `secrets_reveals`, `knowledge_scopes`, `timeline_events`, `character_aliases` | WF step 6 Layer A | seeded contradiction, prohibited early reveal | `continuity_critical_rate` per bab | ARCH §18.3 | DONE (`validateLayerA()` 8 cek lengkap; dipanggil oleh `generateChapter()` dan runtime nyata via `generateNextChapterReal()`. Bukti: `narrative-layer-a` 13/13, `m4`, `m5-soak`, dashboard M8 memuat `continuity_critical_rate`.) |
| G3-LAYERB | Cek berbasis model: kontradiksi lunak, voice, emosi vs relationship | `character_voice_sheets` | WF step 6 Layer B | voice fixture | `continuity_critical_rate` | soak | DONE (`validateLayerB()` validator terpisah dari writer; dipanggil oleh `generateChapter()`. Bukti: `m5-soak` targeted Layer B + 3 jalur×50 bab; metrik G3-METRICS aktif di M8.) |
| G3-REPAIR | Maks 2 repair/lapis → `FAILED_REVIEW_REQUIRED`; repair tak hapus canon | — | WF step 8 | retry fixture | `repair_success_rate` | soak | DONE (`lib/ai-gateway/generate.ts` menerapkan maks 2 repair per lapis, `FAILED_REVIEW_REQUIRED`, dan fingerprint canon read-only. Bukti: `m4-generation` + `m5-soak`; `repair_success_rate` tampil di dashboard M8.) |
| G3-METRICS | Dashboard + alert monotonic | — | Observability (ARCH §17.3/§17.4) | `m8-metrics`, `m8-alert` | `continuity_critical_rate`, `repair_success_rate`, `review_required_rate`, thread staleness, `reader_inconsistency_report_rate` | beta gate (PRD §5.3) | DONE (`lib/observability/*`, runtime `recordGenerationAttempt()`, `/admin/consistency`, `/api/admin/metrics`, `/api/admin/alerts`, alert monotonic + dispatcher. Bukti: `m8-metrics` 29/29, `m8-alert` 24/24.) |

### G4 — Story Thread Lifecycle (NCS §4)

| ID | Requirement | Skema DB | Runtime/Validator | Fixture | Metrik | Release gate | Status |
|---|---|---|---|---|---|---|---|
| G4-STATUS | `OPEN→DEVELOPING→PAYOFF_DUE→RESOLVED\|ABANDONED_APPROVED` | `story_threads.status`, `.payoff_window` | WF step 2 & step 9 | thread fixture | thread staleness | soak | IN_PROGRESS (`transitionThread()` + skema status DB sudah selaras dan terbukti di `m5-soak`; belum `DONE` karena status transition/ABANDONED audit belum menjadi side-effect runtime produksi.) |
| G4-BUDGET | Maks 7 thread aktif; no new thread ≥ Bab 41 | — | WF step 2 (plan) | thread fixture | — | soak | DONE (`canOpenNewThread()`/`validateThreadLifecycle()` + schema plan `opensThreadId` menolak Bab ≥41; dipanggil dari `generateChapter()`. Bukti: `m5-soak` targeted + 3 jalur.) |
| G4-STALE | Stale 6 bab → wajib callback ≤ 3 bab | `story_threads.stale`, `.stale_since_chapter` | Validator/planner | thread fixture | thread staleness | soak | IN_PROGRESS (`refreshStaleness()` + `THREAD_STALE_UNADDRESSED` dan metrik thread staleness ada; belum `DONE` karena refresh/touch stale masih disimulasikan di soak, belum side-effect runtime produksi.) |
| G4-BLOCK48 | Publish Bab 48 diblokir bila mystery utama non-RESOLVED | `story_threads.status` | Deterministic check (Layer A) | Bab 48 unresolved fixture | — | soak | DONE (`checkChapter48Block()` dipanggil oleh `generateChapter()`; `MAIN_MYSTERY_UNRESOLVED_AT_48` CRITICAL memblokir. Bukti: `m5-soak` targeted + runtime validator.) |

### G5 — Entity Canonicalization & Voice (NCS §5)

| ID | Requirement | Skema DB | Runtime/Validator | Fixture | Metrik | Release gate | Status |
|---|---|---|---|---|---|---|---|
| G5-ALIAS | Setiap mention di-resolve ke `character_id`; unresolved = MAJOR, bukan karakter baru | `character_aliases (character_id, alias, alias_type)` | WF step 5 (extract) | alias fixture (3 sebutan, 1 bab) | — | soak | DONE (`buildAliasResolver()`/`resolveMentions()` dipakai di Layer A runtime; `character_aliases` dimuat loader. Bukti: `narrative-layer-a` alias relasi + `m5-soak`.) |
| G5-NOCONFLICT | Fakta baru konflik utk entitas sama = CRITICAL, no last-write-wins | `facts_ledger` | WF step 6 Layer A | seeded contradiction | `continuity_critical_rate` | soak | TODO |
| G5-VOICE | Voice sheet dibuat saat opening package; masuk T0 utk karakter tampil; dicek Layer B | `character_voice_sheets` | Opening package WF; WF step 6 Layer B | voice fixture | — | soak | DONE (`enrichOpeningVoiceSheets()` + `makeVoiceSheetAuthor()` + `voiceGuidance()` masuk prompt T0; Layer B memeriksa voice sheet. Bukti: `m7d-opening-smoke` 17/17 + `m5-soak` Layer B.) |

---

## 2. Definisi "Siap 50 Bab" (ringkas, mengikat NCS §8)

Release template diblokir sampai, pada soak test staging:

1. **0 kontradiksi CRITICAL** lolos publish pada 3 jalur (high-trust, low-trust, mixed).
2. `reader_inconsistency_report_rate` beta **< 3%** untuk story Bab 30+.
3. **Semua ending reachable** pada setiap checkpoint di ketiga jalur.
4. **Biaya per bab** tetap dalam guardrail ARCHITECTURE §20.2 meski konteks tumbuh (bukti kompaksi bekerja).

Keempat butir ini identik dengan NCS §8 dan PRD §5.3; NTM hanya memastikan tiap butir punya baris yang bisa di-sign-off di §1.

---

## 3. Fase vs Gap (menegaskan ARCHITECTURE §24)

| Fase | Gap yang wajib DONE sebelum fase berikutnya | Alasan |
|---|---|---|
| Phase B — Narrative core | G2 (T0–T3 + budget), G3-LAYERA, G5-ALIAS | Fondasi memori + validator murah + kanonikalisasi adalah prasyarat generasi panjang. |
| Phase C — Reader beta | G1 (reconciliation), G3-LAYERB, G4 (lifecycle), soak test penuh | Tanpa ini, cerita rusak justru pada pembaca yang mencapai bab jauh. |

---

## 4. Cara Menutup Sebuah Baris (Definition of Done per baris)

Sebuah baris berpindah ke `DONE` hanya bila bukti row-level berikut benar:

1. Skema ada di DB/repo dan punya bukti migrasi atau seed/admin path yang jelas.
2. Perilaku runtime/validator ada di owner module yang benar (`lib/*` sementara repo belum monorepo `packages/*`) dan punya test/smoke.
3. Fixture/smoke terkait ada dan lulus lewat gate lokal (`pnpm test` atau script smoke yang dirujuk).
4. Metrik muncul di dashboard yang benar (bukan hanya di-log).
5. Ada gate lokal/test negatif yang gagal bila baris ini regresi. Gate M9/T9.2 dibutuhkan sebelum beta release; gate web otomatis sudah ada, sedangkan gate global penuh tetap harus menutup seluruh baris in-scope sebelum release beta.

Baris tanpa bukti kolom lengkap tetap `TODO`/`IN_PROGRESS`, apa pun klaim PR-nya.
