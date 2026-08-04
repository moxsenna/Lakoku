# M10-A — Story Bible End-to-End Dataflow Audit

> Status audit: **EXECUTION: SUCCESS** | **VERDICT: HOLD**
> Baseline: `b7961311cf70b91cb7245149e400075c4e454d74` | Branch: `audit/m10-a-story-bible-dataflow` | Head: koreksi R1 (uncommitted)
> Artifak mesin: `.zcode/artifacts/m10-a/audit.json`, `.zcode/artifacts/m10-a/context-pressure.json` (diregenerasi via `scripts/m10-story-bible-audit.ts` dan `scripts/m10-context-pressure-audit.ts`, koreksi R1)
> Koreksi (M10-A/R1): hasil review cross-check terhadap baseline produksi. Beberapa temuan salah-klasifikasi dikoreksi: +2 BLOCKER (Living Canon write-back hilang; effective state plot debt tidak diproyeksikan), ENDING_LOCK_NOT_DURABLE dihapus sebagai false claim (lock memang durable lewat persistEndingLock sebelum publish), CHOICE_HISTORY_RECENT_LOSS false-positive diperbaiki (expected = N−1), dsb. Rincian: §14.

---

## 1. Executive Summary

**Objective.** M10-A mengaudit dataflow Story Bible end-to-end: dari persistence (tabel-tabel kanon), selection/compression context (`compileContext`), `ChapterBrief`, `ContinuationContext`, `PreProseBrief`, planner, writer prompt, validator, publish, hingga evolusi state (reader state, checkpoint, plot-debt ledger) untuk 17 domain. Audit bersifat **read-only**: tanpa mutasi database produksi, tanpa real-model generation, tanpa migration, tanpa worker flip (plan §19).

**Metode.** Source discovery → evidence catalog → characterization → detector (12 modul pure di `lib/narrative-qa/`, termasuk `canon-writeback-audit.ts` dari koreksi R1) → test (111 test di `tests/narrative-qa/`) → CLI runner → report ini.

**Verdict (koreksi R1).** `executionStatus: SUCCESS`; `auditVerdict: HOLD`. Total **19 findings: 2 BLOCKER, 7 HIGH, 7 MEDIUM, 1 LOW, 2 INFO**. Dua BLOCKER adalah (a) `LIVING_CANON_WRITEBACK_MISSING` — jalur publish (sync `publishChapterV2` dan worker `publishGenerationJobChapterV4`) tidak membawa canon delta apa pun sehingga Story Bible tetap bootstrap/read-model dan tidak pernah berevolusi setelah chapter events; (b) `PLOT_DEBT_EFFECTIVE_STATE_NOT_PROJECTED` — ledger `reader_plot_debt_closures` sudah punya closures persisten, tapi `buildChapterBrief` menghitung `plotDebtsToProgress/ToClose` dari contract status saja (tanpa overlay ledger), sehingga debt yang sudah closed di ledger tetap ditagih di bab berikut. Kombinasi keduanya (ditambah 7 HIGH di jalur finalisasi 45–50) mengharuskan **M10-A HOLD**.

**Rekomendasi.** **M10-A HOLD — jangan lanjut otomatis ke M10-B.** Detail lengkap tiap temuan BLOCKER/HIGH ada di §14 (Proven Gaps). Audit ini tidak memperbaiki apa pun (plan §15/§19); perbaikan yang disarankan hanyalah "recommended narrow fix" untuk PR lanjutan (§16).

## 2. Production Baseline SHA

| Item | Nilai |
|---|---|
| Base SHA | `b7961311cf70b91cb7245149e400075c4e454d74` |
| Branch | `audit/m10-a-story-bible-dataflow` |
| Head SHA (audit ini) | koreksi R1, uncommitted (sebelumnya 13f7fe5) |
| Komit pendukung | `372283a` (detectors awal), `601ffde` (tests awal, 94 test), `82a5f0a` (CLI runners), `9843bf7` (reports v1), `13f7fe5` (scratch untrack); koreksi R1: detector updates + 111 test narrative-qa (sebelumnya 94) |

## 3. Story Bible Architecture

Alur data utama (nama modul riil):

```text
Story Contract                        lib/story-engine/contract-generation.server.ts
   │  persist                          lib/story-engine/contract-persistence.server.ts
   ▼
Persistent Story Bible                 supabase tables: characters, character_states,
   │                                   character_voice_sheets, facts_ledger, knowledge_scopes,
   │                                   secrets_reveals, timeline_events, story_threads,
   │                                   act_rollups, chapter_blueprints, story_generation_contracts
   ▼
CanonSnapshot                          lib/narrative/loader.ts :: loadCanonSnapshot
   │
   ├──► Context selection/compression  lib/narrative/compiler.ts :: compileContext
   │        └── ChapterContextPacket   (actRollups, contextBudgetReport, storyContractSummary, dsb.)
   ▼
ChapterBrief                           lib/story-engine/chapter-brief.ts :: buildChapterBrief
   │  (blueprint find, choice-history 4096-char summary, plotDebtsToProgress/ToClose, endingKeyFor)
   ▼
ContinuationContext                    lib/narrative/continuation-context.ts :: buildContinuationContext
   │  (anchorFacts, openThreads, recentTimeline, routeStateSummary, mustNotReveal)
   ▼
PreProseBrief                          lib/story-engine/pre-prose-brief.ts :: buildPreProseChapterBrief
   │
   ▼
Planner                                lib/ai-gateway/plan-continuation.ts :: composeChapterGoal
   │                                    lib/ai-gateway/gateway.ts :: generatePlan / projectChoiceInput
   ▼
Writer Prompt                          lib/ai-gateway/gateway-provider.ts :: buildPrompt
   │  └── lib/prose/prompt-engine/build-writer-prompt.ts :: buildWriterPrompt (layer 1/2/3)
   ▼
Draft                                  lib/ai-gateway/schemas.ts :: ChapterDraftSchema (parseDraft)
   │
   ▼
Validators                             lib/ai-gateway/generate.ts :: runLayerA
   │                                    lib/narrative/threads.ts :: validateThreadLifecycle
   │                                    lib/narrative/continuity-checks.ts :: runContinuityChecks
   │                                    lib/story-engine/plot-debt.ts :: auditPlotDebts
   │                                    v4 RPC SQL validations (DEBT_CLOSURE_DEADLINE_VIOLATION, dsb.)
   ▼
Publish                                publish_generation_job_chapter_v4 (worker)
   │                                    publish_chapter_v2 (sync/legacy, lifecycle.ts)
   ▼
State / Canon evolution                reader_states (route_state, choice_history, locked_ending_key),
   │                                    chapter_generation_checkpoints,
   │                                    reader_plot_debt_closures (ledger)
   ▼
next chapter (loop ch1 → ch50)
```

Catatan arsitektur penting dari hasil audit:

- **Writer prompt tidak menerima ChapterBrief/PreProseBrief.** `lib/ai-gateway/gateway-provider.ts :: buildPrompt` memanggil `buildWriterPrompt` hanya dengan field turunan plan + continuation; tidak ada referensi `brief` di file tersebut. Akibatnya seluruh field yang hanya hidup di brief (corePromise, mainConflict, finalQuestion, plotDebts, endingCandidates, closureRunway, lockedEndingKey) tidak pernah prompt-visible.
- **`ContinuationContext` adalah proyeksi sempit**: hanya `openThreads`, `anchorFacts`, `recentTimeline`, `routeStateSummary`, `mustNotReveal`. Tidak ada field `actRollups`, `lockedEndingKey`, ataupun budget report.
- **Dua jalur publish** berjalan paralel: worker v4 (atomic, dengan ending lock + closure ledger + checkpoint) dan sync v2 (`publishChapterV2`) yang tidak punya ending lock, closure ledger, maupun checkpoint.

## 4. Source-of-Truth Matrix

Matriks 17 domain dari `lib/narrative-qa/story-bible-audit.ts :: buildSourceOfTruthMatrix` (output riil: `.zcode/artifacts/m10-a/audit.json` → `matrix`, 17 baris). Status mengikuti definisi plan §2: `PROVEN_READ_ONLY` (terbuktikan oleh static source trace; tidak ada eksekusi E2E live), `PARITY_RISK`, `BOUNDED_LOSS_RISK`, `CONSUMER_UNPROVEN`, `DEAD_PATH_CANDIDATE`.

| # | Domain | Source of Truth | Status | Bukti kunci (`file :: symbol`) |
|---|---|---|---|---|
| 1 | Character | `characters` + `character_states` | PROVEN_READ_ONLY | `lib/narrative/loader.ts :: loadCanonSnapshot` — dibaca as-of `throughChapter`; `lib/ai-gateway/gateway-provider.ts :: activeCharacterNames` — sampai layer 1 prompt |
| 2 | Voice | `character_voice_sheets` | PROVEN_READ_ONLY | `gateway-provider.ts :: voiceGuidance` — sampai writer prompt layer 5 |
| 3 | Facts | `facts_ledger` | PROVEN_READ_ONLY | `lib/narrative/compiler.ts :: compileContext` — `loadBearingFacts`/`relevantFacts` dengan caps + exclusion ids; layer 3 prompt |
| 4 | Knowledge | `knowledge_scopes` | CONSUMER_UNPROVEN | `lib/narrative/types.ts :: KnowledgeScope` — shape saja; tidak ada proyeksi downstream ditemukan |
| 5 | Secret | `secrets_reveals` | PROVEN_READ_ONLY | `lib/narrative/continuation-context.ts :: buildContinuationContext` — `mustNotReveal` (revealGateChapter > n) → layer 1 |
| 6 | Timeline | `timeline_events` | PROVEN_READ_ONLY | `buildContinuationContext` — `recentTimeline` desc, `CAP_TIMELINE = 5`; layer 3 (trim pertama saat overflow) |
| 7 | Thread | `story_threads` | PARITY_RISK | `lib/runtime/personalized-generation.ts :: generateNextPersonalizedChapter` — `threadContext = { threads, advancedThreadIds: [], opensNewThread: false }` (hardcoded); HIGH child dari BLOCKER `LIVING_CANON_WRITEBACK_MISSING` (`THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED`) |
| 8 | Act Rollup | `act_rollups` | DEAD_PATH_CANDIDATE (HIGH) | `buildContinuationContext` — `ContinuationContext` tidak punya field `actRollups`; prompt tidak punya section rollup; 25% budget compiler (`rollupsSummaries 0.25`) terbuang |
| 9 | Blueprint | `chapter_blueprints` | PARITY_RISK | `lib/story-engine/chapter-brief.ts :: buildChapterBrief` — `snapshot.blueprints.find(...)` tanpa sort versi; runtime/compiler pakai highest version |
| 10 | Story Contract | `story_generation_contracts` | BOUNDED_LOSS_RISK | `gateway-provider.ts :: buildPrompt` — brief/preProse tidak pernah sampai prompt; corePromise/mainConflict/finalQuestion persisted tapi invisible ke generation |
| 11 | Reader Route | `reader_states.route_state` | PROVEN_READ_ONLY | `lib/runtime/choice-context.ts :: choiceNarrativeContextFromReader` — route_state → RouteState; `chapter-brief.ts :: summarizeRouteStateForPrompt` → layer 3 |
| 12 | Choice History | `reader_states.choice_history` | PROVEN_READ_ONLY | `lib/runtime/continuation-context.server.ts :: loadContinuationContextForChapter` — fail-closed trigger; `chapter-brief.ts :: summarizeChoiceHistory` — slice 4096 char |
| 13 | Ending | `reader_states.locked_ending_key` | PARITY_RISK | Sync path mem-persist lock via `persistEndingLock` → `persist_ending_lock_v1` SEBELUM publish (durable), tapi lock → publish = 2 transaksi (non-atomic); worker v4 atomik (lock + chapter + closures). Lihat `ENDING_LOCK_LEGACY_NONATOMIC_PUBLISH` |
| 14 | Plot Debt | `story_generation_contracts.plot_debts_json` + `reader_plot_debt_closures` | BOUNDED_LOSS_RISK | `lib/story-engine/plot-debt-closure.ts :: resolveDebtClosures` — proyeksi pure; contract tidak pernah dimutasi; ledger tidak dikonsultasikan `buildChapterBrief` (PLOT_DEBT_EFFECTIVE_STATE_NOT_PROJECTED) |
| 15 | Chapter | `chapters` | PROVEN_READ_ONLY | `lifecycle.ts :: publishChapterV2` — publish atomik idempoten; v4 RPC publication proof via `idempotency_keys` |
| 16 | Checkpoint | `chapter_generation_checkpoints` | PROVEN_READ_ONLY | `supabase/migrations/20260728050000_publish_generation_job_chapter_v4_common_checkpoint.sql :: transition_checkpoint_published_atomic_v4` — transisi PUBLISHED atomik di bawah fencing |
| 17 | Retrieval | `retrieval_logs` | DEAD_PATH_CANDIDATE | `lib/narrative/loader.ts :: persistRetrievalLog` — fungsi ada, wired di deps, tidak pernah dipanggil di production |

## 5. Creation Paths

Siapa yang menciptakan tiap domain:

- **Authoring compile (seed)**: `lib/authoring/compile.ts :: compileStoryBible` — characters, character_states, character_voice_sheets, facts, knowledge_scopes, secrets_reveals, timeline_events, story_threads, chapter_blueprints (template deterministik), dan **act_rollups hanya seed act 1** (komentar: "Seed act rollup (act 1) agar rollup chain punya titik awal"; `stateDelta {}`). Persistensi lewat `lib/authoring/persist.ts :: persistStoryBible` (story-bible replace).
- **Story Contract**: `lib/story-engine/contract-generation.server.ts` menciptakan `story_generation_contracts`; ditulis oleh `lib/story-engine/contract-persistence.server.ts` yang sekaligus **menulis ulang field contract ke kanon**: corePromise → `character_voice_sheets.sample_lines`, mainConflict → `facts_ledger`, finalQuestion → `facts_ledger` + baris secret.
- **Runtime chapter publish**: `lib/runtime/personalized-generation.ts :: generateNextPersonalizedChapter` — membuat `chapters`, `chapter_generation_checkpoints` (PROSE_READY / RUNNING_CHOICES → `persistProseReadyCheckpoint` / `markCheckpointStatus`), `reader_states` (route_state, choice_history append, locked_ending_key via `persist_ending_lock_v1`), dan `reader_plot_debt_closures` (melalui v4 RPC).
- **Choice outcome**: `lib/runtime/lifecycle.ts :: publishChapterV2` (outcomes) — menulis `reader_states.route_state` dan append `choice_history`.
- **Retrieval**: `retrieval_logs` — tidak ada pencipta production (`persistRetrievalLog` tidak pernah dipanggil).

## 6. Mutation Paths

Seluruh write path yang ditemukan:

| Write path | Bentuk | Tabel yang disentuh | Catatan |
|---|---|---|---|
| `publish_generation_job_chapter_v4` (worker, komit RPC `20260728050000_publish_generation_job_chapter_v4_common_checkpoint.sql`) | RPC, transaksi atomik | `chapters`, `chapter_generation_checkpoints` (transisi PUBLISHED), `reader_states` (ending lock), `reader_plot_debt_closures` (ledger) | Plot-debt closure **dan** ending lock dalam satu transaksi; advisory locks E1 (120713) / E2 (130600); dual-hash idempotency fast path; validation `CHECKPOINT_CLOSURE_PAYLOAD_MISMATCH`, `DEBT_CLOSURE_CONFLICT`, `INVALID_ENDING_LOCK_TARGET` |
| `publishChapterV2` (sync/legacy, `lib/runtime/lifecycle.ts`) | RPC `publish_chapter_v2` | `chapters`, `reader_states` (route_state via outcomes, choice_history append) | **Tanpa** ending lock, tanpa closure ledger, tanpa checkpoint |
| `persist_ending_lock_v1` | RPC standalone | `reader_states.locked_ending_key` + `ending_name` | Dipanggil sekali saat ch45 hanya jika `locked_ending_key` null (`defaultPersistEndingLock`); re-entrant di dalam transaksi v4 |
| Ledger insert `reader_plot_debt_closures` | INSERT di dalam v4 RPC | `reader_plot_debt_closures` | `on conflict do nothing` — closure duplikat tidak menimpa |
| `lib/authoring/persist.ts :: persistStoryBible` | INSERT/UPDATE story-bible replace | 11 tabel kanon authoring | Trigger: authoring story-bible replace |
| `lib/story-engine/contract-persistence.server.ts` | INSERT/UPSERT | `story_generation_contracts` + kanon rows (voice, facts, secrets) | Trigger: contract generation/persistence |
| `lib/narrative/loader.ts :: persistRetrievalLog` | INSERT append-only (failures ignored) | `retrieval_logs` | **Tidak ada call site production** (grep) — dead write path |

Tidak ditemukan mutasi runtime untuk `story_threads`, `facts_ledger`, `timeline_events`, `act_rollups` setelah seed authoring (update trigger "authoring replace" saja; `act_rollups` bahkan tidak punya kolom `updated_at` — mutasi berarti row replacement, dan tidak ada migration yang melakukannya).

## 7. Read/Compilation Paths

- `lib/narrative/loader.ts :: loadCanonSnapshot` — membaca characters, character_states, character_aliases, character_voice_sheets, facts_ledger, knowledge_scopes, secrets_reveals, timeline_events, story_threads, act_rollups, chapter_blueprints ke dalam `CanonSnapshot`; `status` character resolved as-of `throughChapter`.
- `lib/narrative/compiler.ts :: compileContext` — alokasi budget `BUDGET_ALLOCATION` (rollupsSummaries 0.25, facts 0.15), load-bearing unpaid facts **tidak pernah di-trim**, fakta/rollup di-trim ke `excludedIds`, `latestBlueprint` (sort versi desc), `DEFAULT_BUDGET = 4000`, `estimateTokens` proxy kata. Output `ChapterContextPacket` membawa `actRollups` + `contextBudgetReport` + `storyContractSummary`.
- `lib/runtime/continuation-context.server.ts :: loadContinuationContextForChapter` — `reader_states.choice_history` adalah source of truth untuk previous choice; fail-closed `TRIGGER_CHOICE_REQUIRED_FOR_NON_FIRST_CHAPTER`; memanggil `compileContext` (baris ~148); `checkOutcomeDrift` terhadap `choice_outcomes`.
- `lib/story-engine/chapter-brief.ts :: buildChapterBrief` — `snapshot.blueprints.find(...)` (tanpa sort versi), `summarizeChoiceHistory` (slice 4096 char, oldest di-drop diam-diam), `plotDebtsToProgress`/`plotDebtsToClose` dari **status contract saja** (ledger tidak dibaca), `summarizeRouteStateForPrompt`, `endingKeyFor` → `resolveEnding`.
- `lib/story-engine/pre-prose-brief.ts :: buildPreProseChapterBrief` — mengonsumsi chapterGoal/mustNotInclude/mustNotReveal/routeStateSummary/lockedEndingKey; **menjatuhkan plotDebts**.
- `lib/ai-gateway/gateway.ts :: generatePlan` + `projectChoiceInput` — `pendingReveals` tidak pernah di-trim (semua secret unrevealed + gate); choice snapshot bounds.
- `lib/ai-gateway/gateway-provider.ts :: buildPrompt` — prompt dibangun hanya dari plan + continuation; `activeCharacterNames`, `voiceGuidance` dibaca langsung dari snapshot; **tidak ada referensi `brief`**.
- `lib/prose/prompt-engine/build-writer-prompt.ts :: buildWriterPrompt` — layer 1: nama karakter + `mustNotReveal` (komentar header mengklaim invariant "ending terkunci" tapi tidak ada instruksi lock yang di-emit); layer 2: choice history summary; layer 3: story-state (threads, facts, timeline, routeStateSummary) dengan trim order timeline → facts → threads (4800-char); tidak ada section rollup/debt/ending-lock.
- `lib/runtime/generation-jobs.ts :: publishGenerationJobChapterV4` — memetakan `endingLock` → `p_ending_key`/`p_ending_name` (null kecuali ch45 personalized) dan `closures` dari `auditSignals.closesPlotDebts`.

## 8. Writer Propagation

Per field Story Contract (`lib/story-engine/story-contract.ts :: StoryContractSchema` + hasil `lib/narrative-qa/propagation-audit.ts :: auditPropagation` / `DEFAULT_CONTRACT_FIELD_TRACES`):

| Field | persisted | selected/compressed | propagated | prompt-visible | validator-enforced | write-back aware | Status |
|---|---|---|---|---|---|---|---|
| `corePromise` | Ya (→ voice `sample_lines`, `contract-persistence.server.ts`) | Tidak | Tidak (tidak di brief/preProse/continuation) | **Tidak** | Tidak | Tidak | HIGH `GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED` |
| `mainConflict` | Ya (→ `facts_ledger`) | Tidak | Tidak | **Tidak** | Tidak | Tidak | HIGH `GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED` |
| `finalQuestion` | Ya (→ `facts_ledger`, secret rows) | Tidak | Tidak | **Tidak** | Tidak | Tidak | HIGH `GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED` (kritis di bab 45–50) |
| `chapterTargets[n]` | Ya | Ya (per-chapter) | Ya → `buildChapterBrief` (goal, mustInclude, emotionalTurn, expectedThreadMovement, mustNotReveal) | Tidak langsung (via planner `composeChapterGoal`: continuity > brief.chapterGoal > blueprint) | Sebagian (brief schema) | Tidak | Terpropagasi ke planner |
| `emotionalTurn` | Ya | — | Ya → brief | Tidak langsung | Tidak | Tidak | Terpropagasi ke brief |
| `expectedThreadMovement` | Ya | — | Ya → brief | Tidak langsung | Tidak | Tidak | Terpropagasi ke brief |
| `plotDebts` | Ya (`plot_debts_json`) | Ya (`plotDebtsToProgress`/`ToClose`) | Ya → brief; **jatuh di preProse**; prompt tidak punya section debt | **Tidak** | Sebagian (v4 RPC closure validation) | Tidak (ledger SoT; contract status tidak pernah dimutasi) | MEDIUM `DEPENDENCY_DECLARED_BUT_UNUSED` |
| `endingCandidates` | Ya | Ya (`resolveEnding` → `lockedEndingKey`) | Ya → brief → preProse | **Tidak** (layer-1 komentar mengklaim, kode tidak) | Sebagian (v4 `INVALID_ENDING_LOCK_TARGET`) | Sebagian (lock → reader_states) | MEDIUM `DEPENDENCY_DECLARED_BUT_UNUSED` |
| `closureRunway` | Ya | Ya (policy brief: allowedNewThread/allowedMajorNewConflict/endingRunway/lockEnding) | Ya → brief | **Tidak** | Sebagian (`auditPlotDebts` constants 35/40/45/48/49/50) | Tidak | MEDIUM `DEPENDENCY_DECLARED_BUT_UNUSED` |
| `lockedEndingKey` (reader_states) | Ya | Ya | Ya → brief → preProse | **Tidak** (layer-1 comment vs code mismatch) | Ya (v4 RPC) | Ya | MEDIUM `DEPENDENCY_DECLARED_BUT_UNUSED` |

Akar masalah bersama: `gateway-provider.ts :: buildPrompt` hanya menerima plan + continuation (`grep: no `brief` reference`), sehingga seluruh isi brief/preProse berhenti sebelum prompt. Field yang sampai layer prompt langsung adalah kanon yang dipilih `compileContext`/`buildContinuationContext` (karakter, voice, facts, timeline, thread, routeState, mustNotReveal). Catatan koreksi R1: `corePromise`/`mainConflict`/`finalQuestion` **tetap berpengaruh tidak langsung** — saat bootstrap, `contract-persistence.server.ts` menulisnya ke kanon (voice facts, facts_ledger, secret rows) sehingga anchor bisa mempengaruhi target contract/chapter di authoring; yang hilang adalah *direct propagation* ke prompt runtime (kode `GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED`, `lib/narrative-qa/propagation-audit.ts :: GLOBAL_STORY_ANCHOR_FIELDS`). `finalQuestion` paling kritis di bab 45–50 (finalisasi).

## 9. Validation Coverage

Matriks validator per domain dan apa yang benar-benar mereka terima:

| Validator | Lokasi | Yang divalidasi | Yang diterima di runtime |
|---|---|---|---|
| `validateThreadLifecycle` | `lib/narrative/threads.ts` | THREAD_BUDGET_EXCEEDED, THREAD_NEW_FORBIDDEN, THREAD_STALE_UNADDRESSED, THREAD_PAYOFF_NOT_ADVANCED; constants MAX_ACTIVE_THREADS=7, NO_NEW_THREAD_FROM_CHAPTER=41, STALE_AFTER_CHAPTERS=6, STALE_CALLBACK_WINDOW=3, MAIN_MYSTERY_BLOCK_CHAPTER=48 | `threadContext` dengan `advancedThreadIds: []`, `opensNewThread: false` **hardcoded** di kedua jalur runtime → validator selalu melihat set kosong; `THREAD_STALE_UNADDRESSED`/`THREAD_PAYOFF_NOT_ADVANCED` praktis tidak pernah fire pada draft riil (`THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED`) |
| `runLayerA` | `lib/ai-gateway/generate.ts` | Anchor checks + meneruskan `threadCtx` verbatim ke `validateThreadLifecycle` | Sama — konsumsi nilai hardcoded apa adanya |
| `runContinuityChecks` | `lib/narrative/continuity-checks.ts` | CONT_MISSING_CONTINUITY_ANCHOR, CONT_STRUCTURED_MENTION_UNKNOWN | Snapshot kanon (Character domain: mention tidak dikenal ditolak) |
| `auditPlotDebts` | `lib/story-engine/plot-debt.ts` | Deterministis per-chapter; CLOSURE_RUNWAY: noNewMajorConflictAfter 35, noNewThreadAfter 40, endingLockChapter 45, mainMysteryResolveBy 48, finalEndingChapter 50 | Draft + findings + state delta → `derivePlotDebtAuditFlags` → checkpoint audit signals V2 |
| `resolveEnding` | `lib/story-engine/ending-resolver.ts` | Throw jika chapter < endingLockChapter; lockedEndingKey early-return; ranking via `routeState.endingBias` desc (tie-break index, key) | Contract + reader route state |
| v4 RPC SQL validations | `20260728050000_publish_generation_job_chapter_v4_common_checkpoint.sql :: publish_generation_job_chapter_v4` | `DEBT_CLOSURE_DEADLINE_VIOLATION`, `MAIN_MYSTERY_UNRESOLVED`, `OPEN_DEBT_AT_END`, `DEBT_CLOSURE_CONFLICT`, `CHECKPOINT_CLOSURE_PAYLOAD_MISMATCH`, `INVALID_ENDING_LOCK_TARGET`, idempotency proof | Payload closure + ending lock + checkpoint audit signals |
| `ChapterDraftSchema` | `lib/ai-gateway/schemas.ts` | `opensNewThread` (optional) | **Tidak ada slot `advancedThreadIds`** — sinyal advancement draft tidak bisa mengalir lewat `parseDraft` |
| `StoryContractSchema` | `lib/story-engine/story-contract.ts` | 17 field contract, chapterTargets tepat 50 | Persistence-time validation; tidak ada enforcement prompt-side |

Ringkasan gap validasi: validator thread menerima sinyal kosong hardcoded (HIGH `THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED`, child dari BLOCKER `LIVING_CANON_WRITEBACK_MISSING`); validator kontinuitas hanya melihat kanon (tidak melihat brief); validasi ending lock atomik hanya ada di jalur worker v4 (jalur sync v2 mem-persist lock via `persist_ending_lock_v1` SEBELUM publish — durable, tapi lock→publish = 2 transaksi: MEDIUM `ENDING_LOCK_LEGACY_NONATOMIC_PUBLISH`); ledger plot debt tidak pernah dibaca ulang oleh brief (BLOCKER `PLOT_DEBT_EFFECTIVE_STATE_NOT_PROJECTED`).

## 10. Publish/State Evolution

- **Worker v4** (`publish_generation_job_chapter_v4`): satu transaksi atomik — publish chapter + `transition_checkpoint_published_atomic_v4` (fencing) + ending lock (hanya ch45 personalized) + insert ledger `reader_plot_debt_closures` (`on conflict do nothing`). Publication proof via `idempotency_keys` (dual-hash fast path). Closure payload harus cocok persis dengan checkpoint audit signals (`CHECKPOINT_CLOSURE_PAYLOAD_MISMATCH`); konflik ledger → `DEBT_CLOSURE_CONFLICT`.
- **Sync v2** (`publishChapterV2`, `lib/runtime/lifecycle.ts`): publish chapter atomik idempoten + aplikasi choice outcomes ke `reader_states.route_state` + append `choice_history`. **Tidak ada** ending lock, closure ledger, checkpoint, ataupun transisi state generasi.
- **Plot debt ledger**: hanya insert saat publish v4 dengan closure; contract `plot_debts_json` **tidak pernah dimutasi** (`resolveDebtClosures` proyeksi pure; `reader_plot_debt_closures` tidak dibaca oleh `buildChapterBrief`).
- **Checkpoint evolution**: `persistProseReadyCheckpoint` per attempt → `markCheckpointStatus` → v4 atomic PUBLISHED. Jalur v2 tidak punya checkpoint sama sekali.
- **Reader state updates**: choice branch publish menulis `route_state` + `choice_history`; ch50 → `defaultMarkReaderStateSelesai` menulis status `SELESAI`/ending_name/locked_ending_key/current_chapter 50 setelah publish OK **atau** `CHAPTER_EXISTS` (blok durability ch50 di `generateNextPersonalizedChapter`, baris ~1234–1250).

## 11. Worker vs Legacy Parity

Status per domain parity (plan §11). **Tidak ada mutasi DB live yang dilakukan** — batasan M10-A; semua label berbasis static source trace. Pembuktian parity riil (jalankan publish worker vs sync di DB sandbox, bandingkan state persistent) didelegasikan ke **M10-C** (isolated DB harness).

| Domain parity | Status | Bukti |
|---|---|---|
| Plot debt closure | PARITY_RISK | v4: ledger insert atomik; v2: `publishChapterV2` tanpa closure ledger. `resolveDebtClosures` proyeksi pure, contract tidak pernah dimutasi (BOUNDED_LOSS_RISK) |
| Ending lock | PARITY_RISK | Worker v4: lock + chapter + closure dalam satu transaksi atomik. Jalur sync: `persistEndingLock` → `persist_ending_lock_v1` persist **sebelum** publish (durable), tapi lock→publish = 2 transaksi; `publishChapterV2` sendiri tanpa argumen lock (`ENDING_LOCK_LEGACY_NONATOMIC_PUBLISH`, MEDIUM) |
| Reader state | PROVEN_READ_ONLY | Kedua jalur berbagi `reader_states`; `publishChapterV2` menulis outcomes/route_state/choice_history; jalur v4 menulis via RPC. Parity pada subset ending-lock tidak terbukti (lihat baris di atas) |
| Chapter | PROVEN_READ_ONLY | v4: RPC + idempotency_keys; v2: `publish_chapter_v2` atomik idempoten. Keduanya menulis `chapters` |
| Choice outcomes | PROVEN_READ_ONLY | `choiceNarrativeContextFromReader` membaca `reader_states`; `checkOutcomeDrift` vs `choice_outcomes` di `loadContinuationContextForChapter` |
| Checkpoint | PROVEN_READ_ONLY | Hanya ada di jalur worker (v2 tanpa checkpoint); `transition_checkpoint_published_atomic_v4` |
| Canon delta | AMBIGUOUS | Tidak ada mutasi runtime ditemukan untuk facts/threads/timeline/act_rollups setelah seed; proof riil butuh DB harness (M10-C) |
| Thread state | PARITY_RISK | Kedua jalur hardcode `advancedThreadIds: []` / `opensNewThread: false`; tidak ada mutasi runtime `story_threads` |
| Timeline state | AMBIGUOUS | Hanya authoring replace; tidak ada update runtime ditemukan |
| Fact state | AMBIGUOUS | Hanya authoring replace + contract persistence (corePromise/mainConflict/finalQuestion masuk ke kanon); tidak ada update faktur runtime |

Catatan: ketiadaan proof parity **bukan** kegagalan audit; ini hasil audit (plan §20: temuan seperti itu adalah hasil audit, bukan alasan menyembunyikan failure).

## 12. Chapter 45–50 Finalization

- **Ending lock lifecycle**: ch44 → `lockedEndingKey` null; ch45 → `resolveEnding` memilih kandidat (`ENDING_LOCK_CHAPTER = 45`), `defaultPersistEndingLock` → `persist_ending_lock_v1` dieksekusi **dan di-await SEBELUM publish** (`personalized-generation.ts` baris 1128–1143) hanya jika `reader.locked_ending_key` null; ch46–50 → `resolveEnding` early-return `lockedEndingKey` (tidak bisa switch); v4 RPC menolak payload lock selain ch45 personalized (`INVALID_ENDING_LOCK_TARGET`) di bawah advisory locks E1 (120713)/E2 (130600).
- **Koreksi R1 — durability lock**: `ENDING_LOCK_NOT_DURABLE` **dihapus sebagai false claim**. Pada jalur sync (non-job), lock di-persist via `persistEndingLock` → `persist_ending_lock_v1` **sebelum** `publishChapterV2`, sehingga lock **durable**: retry bab 45 membaca `reader.locked_ending_key` dan tidak re-resolve. Yang tersisa adalah MEDIUM `ENDING_LOCK_LEGACY_NONATOMIC_PUBLISH`: pada jalur legacy, lock→publish menjangkau **dua transaksi** (bukan atomik seperti worker v4). Crash di antara keduanya recoverable via `reader.locked_ending_key`; pada jalur v2 murni, `publishChapterV2` tidak menerima argumen lock sama sekali. Detector retry-divergence (`ENDING_LOCK_RETRY_DIVERGENCE` BLOCKER) tetap eksis untuk sampel di mana lock memang tidak persisted.
- **Chapter 50 reconciliation**: `generateNextPersonalizedChapter` blok durability ch50 (baris ~1234–1250): `defaultMarkReaderStateSelesai` menulis status `SELESAI` + ending_name + locked_ending_key + current_chapter 50 setelah publish sukses **atau** `CHAPTER_EXISTS` (retry → akhirnya konsisten). Pada sampel sintetis, detector `FINAL_STATE_RECONCILIATION_GAP` / `FINAL_READER_STATE_STALE` / `FINAL_CHAPTER_DUPLICATE_STATE_RISK` (`lib/narrative-qa/chapter50-audit.ts`) **tidak terpicu** — reconciliation dikarakterisasi sebagai best-effort dengan recovery owner = jalur retry, bukan jalur deteksi deterministik terpisah. Pembuktian recovery lintas-restart didelegasikan ke M10-C.

## 13. Context Pressure Results

Sumber: `.zcode/artifacts/m10-a/context-pressure.json` (CLI `scripts/m10-context-pressure-audit.ts`; `executionStatus: SUCCESS`, `auditVerdict: HOLD`).

**Milestone Bab 1→50** (declared budget 4000; `lib/narrative/compiler.ts :: compileContext` — `DEFAULT_BUDGET`):

| Chapter | actualUsed | facts incl/excl | loadBearing | rollups incl/excl | threads | timeline | detectors |
|---|---|---|---|---|---|---|---|
| 1 | 27 | 1/0 | 0 | 0/0 | 2 | 1 | — |
| 10 | 246 | 15/0 | 3 | 0/0 | 4 | 10 | — |
| 20 | 507 | 30/0 | 7 | 1/0 | 6 | 20 | — |
| 30 | 699 | 45/0 | 11 | 2/0 | 8 | 20 | — |
| 35 | 781 | 52/0 | 13 | 2/0 | 9 | 20 | — |
| 40 | 875 | 60/0 | 15 | 2/0 | 10 | 20 | — |
| 45 | 952 | 67/0 | 16 | 2/0 | 10 | 20 | — |
| 48 | 1007 | 72/0 | 18 | 2/0 | 10 | 20 | — |
| 49 | 1018 | 73/0 | 18 | 2/0 | 10 | 20 | — |
| 50 | 1040 | 75/0 | 18 | 2/0 | 10 | 20 | — |

Kurva normal (tanpa tekanan buatan): budget 4000 tidak pernah tertekan (puncak 1040/4000 = 26%); tidak ada eviction; tidak ada detector terpicu. `writerLayer3CharLength` = 0 pada milestone normal karena sampel kanon tidak membawa blok `writerLayer3` (projection packet tidak mencatat ukuran layer-3 prompt); kolom terisi hanya pada stress cases yang memodelkan blok tersebut.

**Stress cases** (chapter 50, `totalBudget = 4000`, variasi biaya load-bearing; `writerLayer3` = timeline 8×40=320 char, facts 400-per-fakta, threads 5×40=200 char, `charLimit: 4800` — `lib/prose/prompt-engine/build-writer-prompt.ts :: buildWriterPrompt` baris 83–123):

| loadBearingCost | actualUsed | facts incl/excl | loadBearing | rollups incl/excl | threads | timeline | layer3 chars | detectorsTriggered |
|---|---|---|---|---|---|---|---|---|
| 900 | 3660 | 31/4 | 9 | 1/1 | 5 | 8 | 14520 | RELEVANT_FACT_EVICTION, ROLLUP_EVICTION_PRESSURE, WRITER_CONTEXT_WHOLE_SECTION_EVICTION |
| 1500 | 4260 | 37/4 | 15 | 1/1 | 5 | 8 | 16920 | CONTEXT_DECLARED_BUDGET_OVERSHOOT, LOAD_BEARING_PRESSURE, RELEVANT_FACT_EVICTION, ROLLUP_EVICTION_PRESSURE, WRITER_CONTEXT_WHOLE_SECTION_EVICTION |
| 3000 | 5760 | 52/4 | 30 | 1/1 | 5 | 8 | 22920 | CONTEXT_DECLARED_BUDGET_OVERSHOOT, LOAD_BEARING_PRESSURE, RELEVANT_FACT_EVICTION, ROLLUP_EVICTION_PRESSURE, WRITER_CONTEXT_WHOLE_SECTION_EVICTION |
| 4500 | 7260 | 67/4 | 45 | 1/1 | 5 | 8 | 28920 | CONTEXT_DECLARED_BUDGET_OVERSHOOT, LOAD_BEARING_PRESSURE, RELEVANT_FACT_EVICTION, ROLLUP_EVICTION_PRESSURE, WRITER_CONTEXT_WHOLE_SECTION_EVICTION |

Karakterisasi: di atas 900, budget declared (4000) di-overshoot; eviction dimulai lebih awal (900) karena load-bearing **tidak pernah di-trim** oleh desain (`compileContext` — "load-bearing never trimmed") sehingga tekanan jatuh ke facts non-load-bearing dan rollups. 4 facts selalu ter-eksklusi begitu tekanan muncul.

**Split kompiler vs writer (koreksi R1).** Tekanan di compiler (`compileContext`) bersifat granular trim per-item ke `excludedIds`; tekanan di writer (`buildWriterPrompt` layer 3, limit tetap **4800 char**) bersifat **whole-section eviction** berurutan: timeline dulu, lalu facts, lalu threads. Detector `WRITER_CONTEXT_WHOLE_SECTION_EVICTION` (HIGH) memodelkan kaskade ini dari input pure `writerLayer3 {timelineChars, factsChars, threadsChars, charLimit}`: jika total > limit → timeline di-evict utuh; jika facts+threads > limit → facts ikut di-evict; jika threads > limit → threads hilang sepenuhnya. Ini beda dengan eviction compiler dan tidak tercakup detector lain.

**Choice-history pressure** (49 pilihan, target chapter 50, `summaryAppendsPreviousChoice: true`):

| Chapter | totalChoices | visible | truncated | dupPrev | estTokens | detectorsTriggered |
|---|---|---|---|---|---|---|
| 10 | 49 | 49 | 0 | true | 1363 | CHOICE_HISTORY_DUPLICATE_PREVIOUS |
| 20 | 49 | 49 | 0 | true | 1363 | CHOICE_HISTORY_DUPLICATE_PREVIOUS |
| 30 | 49 | 49 | 0 | true | 1363 | CHOICE_HISTORY_DUPLICATE_PREVIOUS |
| 40 | 49 | 49 | 0 | true | 1363 | CHOICE_HISTORY_DUPLICATE_PREVIOUS |
| 50 | 49 | 49 | 0 | true | 1363 | CHOICE_HISTORY_DUPLICATE_PREVIOUS |

Koreksi R1: `CHOICE_HISTORY_RECENT_LOSS` untuk Bab 50 **false-positive dan dihapus** — untuk target chapter N, expected latest visible = N−1 (49 untuk Bab 50); dengan 49 choices, entri terbaru yang terlihat = 49 = expected, jadi RECENT_LOSS tidak fire. Yang tersisa: `CHOICE_HISTORY_DUPLICATE_PREVIOUS` (MEDIUM) — `choiceNarrativeContextFromReader` mengembalikan history yang sudah mengandung previous choice, lalu `summarizeChoiceHistory` (`lib/story-engine/chapter-brief.ts` baris 194) meng-append `[...history, previousChoice]` tanpa syarat → entri terbaru duplikat.

Detector kunci yang terlibat: `CONTEXT_DECLARED_BUDGET_OVERSHOOT` (estimasi > declared budget), `LOAD_BEARING_PRESSURE` (biaya load-bearing ≥ 25% budget/facts cap), `RELEVANT_FACT_EVICTION` (fakta ter-eksklusi saat budget ≥ 90% terpakai), `ROLLUP_EVICTION_PRESSURE` (rollup ter-eksklusi saat ≥ 90%), `WRITER_CONTEXT_WHOLE_SECTION_EVICTION` (eviction section utuh di layer 3 writer), `CHOICE_HISTORY_DUPLICATE_PREVIOUS` (append previousChoice tanpa syarat).

## 14. Proven Gaps

Temuan BLOCKER: **2**. Temuan HIGH: **7**. Berikut BLOCKER terlebih dahulu (dengan dampak, bukti eksak, dan justifikasi severity), lalu 7 HIGH, masing-masing dengan CODE, observed vs expected, bukti sumber, rentang chapter, dan recommended narrow fix (dari `audit.json` findings + katalog `task-2-report`).

### 14.1 BLOCKER — LIVING_CANON_WRITEBACK_MISSING — Canon/Persistence

- **Observed**: Kedua jalur publish tidak membawa canon delta apa pun. `publish_chapter_v2` (dipanggil `lib/runtime/lifecycle.ts :: publishChapterV2`) hanya membawa chapter/outcomes/route_state/choice_history; `publish_generation_job_chapter_v4` (dipanggil `lib/runtime/generation-jobs.ts :: publishGenerationJobChapterV4`) membawa chapter + ending lock + closures + checkpoint — **tanpa** facts/knowledge/secrets/timeline/thread-transitions/character-states/act-rollup deltas.
- **Expected**: Setelah chapter events, kanon harus berevolusi (write-back) agar bab berikut membaca state terkini, bukan seed authoring.
- **Bukti**: `lib/runtime/lifecycle.ts :: publishChapterV2`; `lib/runtime/generation-jobs.ts :: publishGenerationJobChapterV4`; `supabase/migrations/20260728050000_publish_generation_job_chapter_v4_common_checkpoint.sql :: publish_generation_job_chapter_v4` (daftar payload RPC); `lib/narrative/loader.ts :: loadCanonSnapshot` — read-only, tidak ada runtime writer; `lib/runtime/personalized-generation.ts :: generateNextPersonalizedChapter` — tanpa mutasi facts/threads/timeline/act_rollups pasca-publish; detector `lib/narrative-qa/canon-writeback-audit.ts :: LIVING_CANON_WRITEBACK_MISSING` — observasi "neither publish path carries a canon delta and loadCanonSnapshot has no runtime writer".
- **Dampak**: Story Bible = **bootstrap + read-model**. Setelah authoring, canon membeku di chapter 1 — bab 45–50 masih membaca seed authoring; sementara validators/ledger/checkpoint (plot-debt closures, ending lock) bergerak maju terhadap state yang tidak pernah ditulis balik. Bab 50 ditulis atas konteks canon yang salah-diam-diam.
- **Justifikasi BLOCKER (runtime/severity)**: sesuai plan §17 — "canon state tidak pernah diperbarui" adalah kondisi BLOCKER; temuan ini proven read-only by construction (payload kedua RPC eksplisit, loader tanpa writer), bukan spekulasi; write-path dibuktikan *absen*, bukan hanya `WRITE_PATH_UNPROVEN` pasif. Tenant "canon evolves with the story" dari arsitektur long-horizon dilanggar di sumbernya (publish = satu-satunya titik evolusi runtime).
- **Rentang chapter**: 1–50 (seluruh loop runtime).
- **Recommended narrow fix**: rancang canon-delta minimal pada jalur publish v4 (thread transitions minimal; facts/timeline write-back) atau nyatakan eksplisit bahwa canon = bootstrap-only (kontrak desain) dan downgrade seluruh klaim evolusi state.

### 14.2 BLOCKER — PLOT_DEBT_EFFECTIVE_STATE_NOT_PROJECTED — Plot Debt

- **Observed**: Ledger `reader_plot_debt_closures` berisi closure persisten (ditulis atomik oleh v4 RPC), tetapi `buildChapterBrief` menghitung `plotDebtsToProgress`/`plotDebtsToClose` **dari status contract saja** — `lib/story-engine/chapter-brief.ts :: buildChapterBrief` baris ~245: `storyContract.plotDebts.filter((debt) => debt.status !== 'closed')` tanpa overlay ledger. Detail detektor: `{"chapter":50,"ledgerClosedIds":["main_mystery"],"briefConsultsLedger":false}`.
- **Expected**: effective state plot debt = contract status **overlay** ledger closures — debt yang sudah closed di ledger tidak boleh ditagih lagi di brief bab berikut.
- **Bukti**: `lib/story-engine/chapter-brief.ts :: buildChapterBrief` — filter contract-status-only; `lib/runtime/continuation-context.server.ts :: loadContinuationContextForChapter` — memuat continuation tanpa membaca `reader_plot_debt_closures`; `lib/story-engine/plot-debt-closure.ts :: resolveDebtClosures` — proyeksi pure, contract tidak pernah dimutasi; `supabase/migrations/20260728050000_publish_generation_job_chapter_v4_common_checkpoint.sql` — ledger insert atomik (closure durable); detector `lib/narrative-qa/plot-debt-audit.ts :: PLOT_DEBT_EFFECTIVE_STATE_NOT_PROJECTED`.
- **Dampak**: debt `main_mystery` sudah ter-closure durable di ledger, tetapi brief bab 50 tetap menuntut progress/closure padanya — prompt aksi menulis state yang secara persistent sudah selesai; closure tidak pernah "converge". Berinteraksi dengan 14.1: ledger maju, canon/brief tidak.
- **Justifikasi BLOCKER (runtime/severity)**: plan §17 — divergensi state persistent vs state yang diproyeksikan ke generation adalah silent-wrong-story pada jalur 1→50; proven read-only (brief filter + ledger absen dari `loadContinuationContextForChapter`).
- **Rentang chapter**: 35–50 (post-mustCloseBy `main_mystery`), praktis seluruh jalur begitu ledger pertama terisi.
- **Recommended narrow fix**: `buildChapterBrief`/`loadContinuationContextForChapter` menerapkan overlay `reader_plot_debt_closures` (closed-in-ledger ⇒ excluded) sebelum menghitung `plotDebtsToProgress`/`ToClose`.
- **Catatan**: `PLOT_DEBT_PROGRESS_NOT_PERSISTED` (HIGH, 14.5) menjadi child terkait: payung BLOCKER ini tentang *effective state*; HIGH tentang *progress memory* (tidak bentrok; payung ≠ duplikat karena ledger-consultation dan milestone-recording adalah dua write/read path berbeda).

### 14.3 HIGH — BLUEPRINT_VERSION_RESOLUTION_DIVERGENCE — Blueprint

- **Observed**: `buildChapterBrief` memakai `snapshot.blueprints.find((c) => c.chapterNumber === n)` — first array match, tanpa sort versi; runtime (`resolveBlueprint`) dan compiler (`latestBlueprint`) memakai highest version. Sampel bab 20: `{"resolvedVersions":{"brief":1,"compiler":2,"runtime":2}}`.
- **Expected**: semua konsumen blueprint menyelesaikan ke versi yang sama (highest version wins).
- **Bukti**: `lib/runtime/personalized-generation.ts :: resolveBlueprint` — sort `b.version - a.version` desc; `lib/narrative/compiler.ts :: latestBlueprint` — sort versi desc; `lib/story-engine/chapter-brief.ts :: buildChapterBrief` — `find()` tanpa sort; detector `lib/narrative-qa/blueprint-audit.ts :: BLUEPRINT_VERSION_RESOLUTION_DIVERGENCE`.
- **Rentang chapter**: semua chapter dengan multi-versi blueprint (sampel: bab 20); finalisasi 45–50 rawan di-drive blueprint stale.
- **Recommended narrow fix**: samakan `buildChapterBrief` dengan `resolveBlueprint`/`latestBlueprint` (highest version wins) atau buktikan loader menjamin satu baris blueprint per chapter.

### 14.4 HIGH — THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED — Thread (child dari 14.1)

- **Observed**: `threadContext = { threads, advancedThreadIds: [], opensNewThread: false }` **hardcoded** di kedua jalur runtime; `ChapterDraftSchema` tidak punya slot `advancedThreadIds`, sehingga sinyal advancement draft tidak bisa mengalir lewat `parseDraft` → `runLayerA` → `validateThreadLifecycle`. Detail: `{"chapter":50,"validatorReceivesDraftSignals":false,"parentFinding":"LIVING_CANON_WRITEBACK_MISSING"}`.
- **Expected**: validator thread menerima sinyal advancement riil dari draft.
- **Bukti**: `lib/ai-gateway/generate.ts :: runLayerA` — meneruskan `threadCtx` verbatim; `lib/ai-gateway/schemas.ts :: ChapterDraftSchema` — tanpa slot `advancedThreadIds`; `lib/runtime/personalized-generation.ts :: generateNextPersonalizedChapter` dan `lib/runtime/story-generation.ts :: generateNextChapterReal` — hardcoded `advancedThreadIds: []`/`opensNewThread: false`; detector `lib/narrative-qa/thread-audit.ts :: THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED`.
- **Relasi ke BLOCKER**: dinaikkan MEDIUM → HIGH sebagai child dari `LIVING_CANON_WRITEBACK_MISSING` — thread transitions tidak hanya hilang dari validator, tetapi juga tidak pernah ditulis balik ke `story_threads`.
- **Rentang chapter**: 1–50; paling kritis 48–50 (`MAIN_MYSTERY_BLOCK_CHAPTER = 48`).
- **Recommended narrow fix**: extend parsed draft schema dengan `advancedThreadIds` atau jalankan thread lifecycle validation langsung terhadap field draft; wire-balance transisi thread ke `story_threads`.

### 14.5 HIGH — PLOT_DEBT_PROGRESS_NOT_PERSISTED — Plot Debt (`debt_2`; child terkait 14.2)

- **Observed**: debt `debt_2` milestone 25 ≤ bab 50, status contract tetap `open`, tidak ada progress tercatat (debt-level maupun per-milestone) — `{"chapter":50,"debtId":"debt_2","dueMilestones":[25],"contractStatus":"open"}`. Milestone memory gap semantics dilipat ke sini (kode `PLOT_DEBT_MILESTONE_MEMORY_GAP` lama dihapus).
- **Expected**: milestone yang lewat meninggalkan jejak durable (status → progressing, atau record per-milestone eksplisit).
- **Bukti**: `lib/story-engine/plot-debt-closure.ts :: resolveDebtClosures` — proyeksi pure; `lib/story-engine/chapter-brief.ts :: buildChapterBrief` — debt lists dari status contract saja; `lib/story-engine/story-contract.ts :: PlotDebtSchema` — shape `{id, question, introducedAt, mustProgressBy[], mustCloseBy, status}` tanpa field progress; detector `lib/narrative-qa/plot-debt-audit.ts :: PLOT_DEBT_PROGRESS_NOT_PERSISTED`.
- **Relasi ke BLOCKER**: berbeda domain-recording — BLOCKER (14.2) tentang *effective closure state* tidak diproyeksikan dari ledger; HIGH ini tentang *progress memory* milestone yang tidak pernah dipersist sama sekali.
- **Rentang chapter**: 25–50.
- **Recommended narrow fix**: persist sinyal progress (status → `progressing` atau record per-milestone) saat milestone tercapai.

### 14.6 HIGH — GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED — Story Contract (`corePromise`)

- **Observed**: `corePromise` di-declare `StoryContractSchema`, dipersist ke voice `sample_lines` (`contract-persistence.server.ts`), tapi tidak pernah mencapai ChapterBrief, PreProseBrief, ContinuationContext, maupun writer prompt — `{"field":"corePromise","persisted":true,"inChapterBrief":false,...,"inWriterPrompt":false}`. Koreksi R1: kode di-rename dari `DEPENDENCY_DECLARED_BUT_UNUSED` (severity tetap HIGH) karena anchor **memang** mempengaruhi story saat bootstrap (contract + chapterTargets diturunkan darinya) — yang hilang adalah *direct propagation* ke prompt runtime.
- **Expected**: anchor global dipropagasikan langsung ke writer prompt setiap chapter, atau dideklarasikan sebagai bootstrap-only.
- **Bukti**: `lib/story-engine/story-contract.ts :: StoryContractSchema`; `lib/story-engine/contract-persistence.server.ts` — persist ke `character_voice_sheets.sample_lines`; `lib/ai-gateway/gateway-provider.ts :: buildPrompt` — tidak ada referensi `brief` (grep); `lib/prose/prompt-engine/build-writer-prompt.ts :: buildWriterPrompt` — layer 1 hanya nama karakter + mustNotReveal; detector `lib/narrative-qa/propagation-audit.ts :: GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED` (`GLOBAL_STORY_ANCHOR_FIELDS`).
- **Rentang chapter**: 1–50.
- **Recommended narrow fix**: tentukan konsumen prompt riil `corePromise` (layer 1/2 writer) atau drop dari contract surface.

### 14.7 HIGH — GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED — Story Contract (`mainConflict`)

- **Observed**: `mainConflict` di-declare, dipersist ke `facts_ledger` (`contract-persistence.server.ts`), tidak pernah dibaca brief/continuation/writer prompt — `{"field":"mainConflict","persisted":true,...,"inWriterPrompt":false}`.
- **Expected**: sama dengan 14.6.
- **Bukti**: `StoryContractSchema`; `contract-persistence.server.ts` — persist ke `facts_ledger`; `gateway-provider.ts :: buildPrompt`; detector `lib/narrative-qa/propagation-audit.ts :: GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED`.
- **Rentang chapter**: 1–50.
- **Recommended narrow fix**: tentukan konsumen prompt riil `mainConflict` atau drop dari contract surface.

### 14.8 HIGH — GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED — Story Contract (`finalQuestion`)

- **Observed**: `finalQuestion` di-declare, dipersist ke `facts_ledger` + direferensikan baris secret, tidak pernah muncul di writer prompt — `{"field":"finalQuestion","persisted":true,...,"inWriterPrompt":false}`.
- **Expected**: paling kritis untuk **bab 45–50** — finale harus menjawab `finalQuestion` secara eksplisit; writer tidak bisa menjawab pertanyaan yang tidak pernah dilihatnya.
- **Bukti**: `StoryContractSchema`; `contract-persistence.server.ts` (persist ke `facts_ledger` + secret rows); `gateway-provider.ts :: buildPrompt`; detector `lib/narrative-qa/propagation-audit.ts :: GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED` — risk text memuat "finalQuestion is the most critical anchor for chapters 45–50".
- **Rentang chapter**: 1–50 (kritis 45–50).
- **Recommended narrow fix**: jadikan `finalQuestion` wajib-masuk layer 1 writer prompt mulai `endingLockChapter`.

### 14.9 HIGH — DEAD_PATH_CANDIDATE — Act Rollup

- **Observed**: 2 rollups (act 1, 2) di-seed saat authoring, tidak pernah di-update (tanpa kolom `updated_at`, tanpa migration update), dan tidak pernah sampai prompt — `{"rollupCount":2,"actNumbers":[1,2],"neverUpdated":true}`.
- **Expected**: rollup act terpelihara (update saat act boundary) dan visible ke writer; jika tidak, alokasi budget-nya tidak boleh terbuang.
- **Bukti**: `supabase/migrations/20260707000000_core_runtime_baseline.sql :: act_rollups` — tanpa `updated_at`; `lib/authoring/compile.ts :: compileStoryBible` — "Seed act rollup (act 1)"; `lib/narrative/continuation-context.ts :: buildContinuationContext` — tanpa field `actRollups`; `buildWriterPrompt` — tanpa section rollup; detector `lib/narrative-qa/act-rollup-audit.ts :: DEAD_PATH_CANDIDATE`.
- **Justifikasi HIGH (naik dari MEDIUM, koreksi R1)**: dead path membawa **biaya budget nyata** — `compileContext` mengalokasikan 25% packet ke rollup summaries (`BUDGET_ALLOCATION.rollupsSummaries 0.25`) padahal `buildWriterPrompt` mengecualikan rollup sepenuhnya; writer tidak pernah melihat rollup **dan** 25% budget compiler terbuang.
- **Rentang chapter**: 10–50.
- **Recommended narrow fix**: keputusan desain — maintain rollup saat act boundary + konsumsi prompt, atau tandai write-once seed dan re-alokasi `rollupsSummaries 0.25`.

### 14.10 HIGH — WRITER_CONTEXT_WHOLE_SECTION_EVICTION — Context Pressure (writer layer 3)

- **Observed**: ketika total layer 3 melebihi limit tetap **4800 char**, `buildWriterPrompt` meng-evict **section utuh** secara berurutan: timeline dulu, lalu facts, lalu threads — bukan trim granular seperti compiler. Detail sampel stress (loadBearingCost 4500, 71 fakta × 400 char): `{"layer3TotalChars":28920,"evictedSections":["timeline","facts"]}` — timeline dan facts hilang utuh, threads (200 char) tersisa.
- **Expected**: tekanan budget writer seharusnya trim granular (per-item) seperti `compileContext`, bukan menghapus kategori konteks utuh.
- **Bukti**: `lib/prose/prompt-engine/build-writer-prompt.ts :: buildWriterPrompt` — baris 83–123: limit 4800 + urutan eviction timeline → facts → threads (source-read); detector `lib/narrative-qa/context-pressure-audit.ts :: WRITER_CONTEXT_WHOLE_SECTION_EVICTION` (input pure `writerLayer3 {timelineChars, factsChars, threadsChars, charLimit}`).
- **Justifikasi HIGH**: di bab 45–50, kehilangan utuh timeline/facts/threads dari prompt berarti chapter final ditulis tanpa konteks build-up; berbeda dari detector compiler (`RELEVANT_FACT_EVICTION` dsb.) yang granular, finding ini tentang prompt-pressure riil di writer.
- **Rentang chapter**: saat layer 3 > 4800 char (stress demo; runtime bergantung ukuran facts/timeline/threads).
- **Recommended narrow fix**: ganti whole-section eviction dengan trim granular terukur dalam satu section dulu, atau naikkan limit + sinkronisasi dengan `contextBudgetReport`.

## 15. Unknown / Unproven Paths

Baris dengan status `CONSUMER_UNPROVEN` / `WRITE_PATH_UNPROVEN` / `DEAD_PATH_CANDIDATE` / `AMBIGUOUS`:

| Domain | Status | Yang belum terbukti | Cara membuktikan (M10-C) |
|---|---|---|---|
| Knowledge | CONSUMER_UNPROVEN | `knowledge_scopes` termuat ke snapshot tapi tidak ada proyeksi downstream (prompt/validator) ditemukan | Harness DB: cek apakah knowledge assertions dipakai layer prompt mana pun |
| Story Contract (`corePromise`/`mainConflict`/`finalQuestion`) | WRITE_PATH_UNPROVEN | Anchor global persisted tapi tidak pernah sampai brief/continuation/prompt secara langsung (`GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED`, HIGH) — pengaruh terbatas bootstrap | Harness DB + trace prompt lengkap |
| Story Contract (`plotDebts`/`endingCandidates`/`closureRunway`/`lockedEndingKey`) | CONSUMER_UNPROVEN | Mati antara brief/preProse dan writer prompt | Trace end-to-end prompt dengan brief terisi |
| Act Rollup | DEAD_PATH_CANDIDATE + CONSUMER_UNPROVEN | Seed act 1 saja; tidak pernah di-update (tanpa `updated_at`); `buildContinuationContext` tidak punya field `actRollups`; prompt tanpa section rollup | Keputusan desain: maintain rollup saat act boundary, atau tandai write-once seed |
| Retrieval | DEAD_PATH_CANDIDATE | `persistRetrievalLog` terdefinisi + wired di `defaultDeps` tapi tidak pernah dipanggil; excluded/included ids + budget report dihitung `compileContext` lalu di-drop | Invoke di generation path, atau hapus dari packet contract |
| Canon delta / timeline state / fact state | AMBIGUOUS (parity) | Tidak ada mutasi runtime ditemukan pasca-seed; parity worker vs sync belum dibuktikan | M10-C: jalankan publish worker + sync di DB sandbox, reload canon, bandingkan state persistent |

Tidak ada domain `AMBIGUOUS` tanpa evidence: setiap baris di atas punya bukti source (plan §21 — AMBIGUOUS hanya boleh jika dicatat sebagai finding dengan bukti dan risiko; di sini dicatat di register §14/§15).

## 16. Follow-up PR Recommendations

Daftar PR lanjutan yang **tidak** dikerjakan di M10-A (plan §19: audit bukan fix PR; M10-A Must NOT fix). Diurutkan berdasarkan dampak, BLOCKER dulu (§14.1–§14.10):

1. **PR-1: Canon write-back pada jalur publish** (BLOCKER `LIVING_CANON_WRITEBACK_MISSING`, §14.1). Scope: `lib/runtime/lifecycle.ts :: publishChapterV2` RPC payload + `lib/runtime/generation-jobs.ts :: publishGenerationJobChapterV4`/SQL RPC + runtime canon writer. Tulis delta facts/knowledge/secrets/timeline/thread-transitions/character-states/act-rollup pasca-publish agar Story Bible berevolusi. Di luar mandat: perubahan RPC + migration + semantics canon.
2. **PR-2: Proyeksikan effective plot-debt state** (BLOCKER `PLOT_DEBT_EFFECTIVE_STATE_NOT_PROJECTED`, §14.2). Scope: `lib/story-engine/chapter-brief.ts :: buildChapterBrief` + `lib/runtime/continuation-context.server.ts` — overlay `reader_plot_debt_closures` sebelum menghitung `plotDebtsToProgress`/`ToClose`. Di luar mandat: perubahan logika brief.
3. **PR-3: Sinyal advancement thread riil** (HIGH child `THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED`, §14.4). Scope: slot `advancedThreadIds` di `ChapterDraftSchema` (`lib/ai-gateway/schemas.ts`) + hapus hardcode `advancedThreadIds: []`/`opensNewThread: false` di kedua jalur runtime + persist transisi ke `story_threads`. Di luar mandat: skema draft + validator + write-path.
4. **PR-4: Prompt-visible global story anchors** (HIGH ×3 `GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED`, §14.6–14.8). Scope: `lib/ai-gateway/gateway-provider.ts :: buildPrompt` + `buildWriterPrompt` — teruskan `corePromise`/`mainConflict`/`finalQuestion` dari brief ke layer writer; `finalQuestion` wajib prompt-visible mulai bab 45. Di luar mandat: perubahan business logic generation.
5. **PR-5: Samakan resolusi blueprint** (HIGH `BLUEPRINT_VERSION_RESOLUTION_DIVERGENCE`, §14.3). Scope: `buildChapterBrief` — highest version wins, konsisten dengan `resolveBlueprint`/`latestBlueprint`. Di luar mandat: perubahan perilaku selection.
6. **PR-6: Keputusan act rollup + realokasi budget** (HIGH `DEAD_PATH_CANDIDATE` + LOW `CONSUMER_UNPROVEN`). Scope: `lib/authoring/compile.ts`/`lib/narrative/continuation-context.ts`/budget `rollupsSummaries 0.25` — maintain rollup saat act boundary + konsumen prompt, atau tandai write-once seed dan kembalikan 25% budget. Di luar mandat: keputusan desain.
7. **PR-7: Trim granular di writer layer 3 + de-duplikasi choice history** (HIGH `WRITER_CONTEXT_WHOLE_SECTION_EVICTION` follow-up implementation, §14.10 + `CHOICE_HISTORY_DUPLICATE_PREVIOUS` MEDIUM). Scope: `buildWriterPrompt` (trim granular; eviction whole-section saat ini HIGH finding, §14.10) + `summarizeChoiceHistory` (append previousChoice hanya jika belum ada di history). Di luar mandat: perubahan prompt builder.
8. **PR-8: Atomisasi lock→publish jalur legacy** (MEDIUM `ENDING_LOCK_LEGACY_NONATOMIC_PUBLISH`). Scope: routing bab 45 melalui `publishGenerationJobChapterV4`, atau gabungkan persist lock ke transaksi publish v2. Di luar mandat: perubahan publish path.
9. **PR-9: Persist progress plot debt** (HIGH `PLOT_DEBT_PROGRESS_NOT_PERSISTED`, §14.5). Scope: field/record progress saat milestone tercapai (`plot-debt.ts` + v4 RPC). Di luar mandat: perubahan persistence.
10. **PR-10: Invoke `persistRetrievalLog`** (INFO `RETRIEVAL_LOG_WRITE_PATH_UNPROVEN`). Scope: wire di generation path sesudah `compileContext`. Di luar mandat: observability change.
11. **PR-11 (M10-C): Isolated DB harness untuk parity worker vs sync** — pembuktian parity riil §11 (canon delta, thread/timeline/fact state, reader state, ending lock). Di luar mandat M10-A: butuh DB sandbox + publish live.

---

*Lampiran teknis: seluruh angka pada laporan ini berasal dari `.zcode/artifacts/m10-a/audit.json` (19 findings: 2 BLOCKER / 7 HIGH / 7 MEDIUM / 1 LOW / 2 INFO) dan `.zcode/artifacts/m10-a/context-pressure.json` (memuat `WRITER_CONTEXT_WHOLE_SECTION_EVICTION` pada stress rows) — diregenerasi 2026-08-04 pada koreksi R1 (uncommitted di atas baseline `b7961311cf70b91cb7245149e400075c4e454d74`). Register temuan lengkap: `docs/audits/M10A_RISK_REGISTER.md`.*
