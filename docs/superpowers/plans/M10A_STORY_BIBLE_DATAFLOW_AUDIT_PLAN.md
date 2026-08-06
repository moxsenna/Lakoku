# M10-A — Story Bible End-to-End Dataflow Audit

## Objective

M10-A harus menjawab satu pertanyaan besar:

> Untuk setiap informasi penting cerita, dari mana data dibuat, di mana disimpan, bagaimana diperbarui setelah chapter publish, bagaimana dipilih kembali untuk Bab N+1, apakah benar-benar sampai ke writer, dan apakah validator menegakkannya?

Target alur:

```text
Story Contract
      ↓
Persistent Story Bible
      ↓
CanonSnapshot
      ↓
Context selection / compression
      ↓
ChapterBrief
      ↓
ContinuationContext
      ↓
PreProseBrief
      ↓
Planner
      ↓
Writer Prompt
      ↓
Draft
      ↓
Validators
      ↓
Publish
      ↓
State / Canon evolution
      ↓
Bab berikutnya
```

M10-A belum membuat LLM evaluator baru, belum menjalankan 50 bab, dan tidak mengubah production DB.

---

## 1. Base dan Branch

Mulai dari exact production baseline:

```text
base:
b7961311cf70b91cb7245149e400075c4e454d74

branch:
audit/m10-a-story-bible-dataflow
```

Rules:

- Tidak membawa perubahan dari working tree lain.
- Tidak ada deploy.
- Tidak ada migration.
- Tidak ada production mutation.
- Tidak ada real-model generation.
- Tidak ada worker flip.
- Tidak ada historical story regeneration.

---

## 2. Audit Domains

Buat source-of-truth matrix untuk seluruh domain berikut:

| Domain | Yang harus dilacak |
|---|---|
| Character | identity, role, motivation, status, alias |
| Voice | register, speech habits, forbidden words |
| Facts | statement, established chapter, salience, load-bearing, paid-off |
| Knowledge | siapa mengetahui fakta apa dan sejak kapan |
| Secret | reveal gate, revealed state |
| Timeline | chapter, ordinal, chronology, flashback |
| Thread | open/developing/payoff/resolved/stale |
| Act rollup | kapan dibuat, isi, state delta, kapan dipakai |
| Blueprint | versioning, reconciliation, latest-version resolution |
| Story Contract | 50 targets, core promise, final question, plot debt |
| Reader route | truth/risk/secrecy/empathy/flags |
| Choice history | exact choice, consequence, long-term compression |
| Ending | candidate, lock at 45, persisted lock, final resolution |
| Plot debt | open, progress milestone, closure, persistence |
| Chapter | prose, choices, outcomes |
| Checkpoint | prose identity, audit signals, resume semantics |
| Retrieval | included/excluded context dan budget |

Untuk setiap persistent field, matrix wajib mempunyai:

```text
SOURCE OF TRUTH
CREATED BY
WRITTEN BY
READ BY
PROMPT CONSUMER
VALIDATOR
UPDATE TRIGGER
PERSISTENCE
WORKER PATH
LEGACY/SYNC PATH
STATUS
EVIDENCE
```

Status hanya boleh:

```text
PROVEN_E2E
PROVEN_READ_ONLY
WRITE_PATH_UNPROVEN
CONSUMER_UNPROVEN
PARITY_RISK
BOUNDED_LOSS_RISK
DEAD_PATH_CANDIDATE
AMBIGUOUS
```

Jangan menggunakan status seperti “sepertinya bekerja”.

---

## 3. Persistence Writer Audit

Audit seluruh write path terhadap sumber Story Bible berikut:

```text
characters
character_states
character_aliases
character_voice_sheets
facts_ledger
knowledge_scopes
secrets_reveals
timeline_events
story_threads
act_rollups
chapter_blueprints
```

Cari seluruh:

```text
INSERT
UPDATE
UPSERT
RPC mutation
publish-side mutation
post-publish reconciliation
```

Contoh hasil:

| Table | Reader | Writer | Trigger | Proven? |
|---|---|---|---|---|
| facts_ledger | loadCanonSnapshot | ??? | after chapter publish? | ? |
| story_threads | loadCanonSnapshot | ??? | chapter delta? | ? |
| act_rollups | compileContext | ??? | act boundary? | ? |
| character_states | loader | ??? | state delta? | ? |

Jika suatu tabel hanya di-seed saat awal cerita dan tidak pernah diperbarui, laporkan apa adanya.

Audit PR tidak boleh diam-diam memperbaiki temuan tersebut.

---

## 4. Story Contract → Actual Writer Trace

Jangan berhenti pada fakta bahwa StoryContract tersimpan.

Trace seluruh field berikut sampai actual prose writer:

```text
corePromise
mainConflict
finalQuestion
chapterTargets[n]
emotionalTurn
expectedThreadMovement
plotDebts
endingCandidates
closureRunway
```

Contoh tracing:

```text
corePromise
StoryContract
  → storage
  → ChapterBrief
  → PreProseBrief
  → planner
  → writer
  → validator
```

Untuk tiap field, laporkan apakah:

```text
persisted
selected
compressed
propagated
prompt-visible
validator-enforced
write-back aware
```

Jika field tersimpan tetapi tidak pernah mencapai writer, status harus eksplisit.

---

## 5. Choice History Pressure Audit

Buat fixture dengan 49 pilihan realistis:

```text
Bab 1 → Bab 49
label realistic
consequence realistic
effectSummary realistic
flags realistic
```

Uji ChapterBrief / choice summary pada:

```text
Bab 10
Bab 20
Bab 30
Bab 40
Bab 45
Bab 50
```

Capture:

```text
pilihan bab berapa yang masih tersedia
pilihan mana yang terpotong
pilihan terbaru hilang atau tidak
previousChoice terduplikasi atau tidak
total karakter summary
estimated token pressure
```

Detector:

```text
CHOICE_HISTORY_RECENT_LOSS
CHOICE_HISTORY_DUPLICATE_PREVIOUS
CHOICE_HISTORY_BUDGET_PRESSURE
```

M10-A tidak boleh memperbaiki compression policy. Hanya characterize dan laporkan.

---

## 6. Blueprint Version Resolution Audit

Buat fixture:

```text
Bab 20 blueprint v1
Bab 20 blueprint v2
```

Bandingkan:

```text
runtime resolved blueprint
ChapterBrief resolved blueprint
compiler resolved blueprint
writer planned beats
```

Detector:

```text
BLUEPRINT_VERSION_RESOLUTION_DIVERGENCE
```

Jika runtime memilih versi terbaru tetapi komponen lain mengambil versi berbeda, laporkan sebagai finding terpisah.

---

## 7. Context Degradation Audit Bab 1→50

Buat synthetic CanonSnapshot yang tumbuh seiring chapter.

Milestone:

```text
Bab 1
Bab 10
Bab 20
Bab 30
Bab 35
Bab 40
Bab 45
Bab 48
Bab 49
Bab 50
```

Setiap milestone menambah:

```text
facts
load-bearing facts
threads
timeline
voice sheets
act rollups
choice history
```

Capture:

```text
declared context budget
actual used
facts included
facts excluded
load-bearing included
rollups included
rollups excluded
threads retained
timeline retained
writer Layer-3 char length
```

Stress case khusus:

```text
totalBudget = 4000
loadBearingCost = 900
loadBearingCost = 1500
loadBearingCost = 3000
loadBearingCost = 4500
```

Detector:

```text
CONTEXT_DECLARED_BUDGET_OVERSHOOT
LOAD_BEARING_PRESSURE
RELEVANT_FACT_EVICTION
ROLLUP_EVICTION_PRESSURE
```

Overshoot tidak otomatis BLOCKER. Tujuan audit adalah mengukur tekanan nyata.

---

## 8. Compiler → ContinuationContext Audit

Trace hubungan:

```text
compileContext()
      ↓
ChapterContextPacket

buildContinuationContext()
      ↓
ContinuationContext
```

Buktikan:

```text
selected fact
→ masuk ContinuationContext atau tidak

active thread
→ masuk atau tidak

act rollup
→ masuk writer lewat jalur mana

voice sheet
→ masuk writer lewat jalur mana

timeline
→ dibatasi bagaimana

excluded retrieval
→ dicatat atau tidak
```

Khusus act rollup:

- Cari siapa yang membuatnya.
- Kapan dibuat.
- Bagaimana diperbarui.
- Siapa yang membacanya.
- Apakah summary benar-benar masuk ke writer setelah compile.

Jika hanya tersimpan tapi tidak load-bearing, tandai.

---

## 9. Thread Lifecycle Audit

Trace:

```text
story_threads
draft.advancedThreadIds
draft.opensNewThread
threadContext
validateThreadLifecycle
```

Buktikan apakah runtime mengirim signal actual draft ke validator atau selalu memakai placeholder/default.

Detector:

```text
THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED
THREAD_OPEN_SIGNAL_DISCONNECTED
THREAD_STALENESS_NOT_LOAD_BEARING
```

Characterize dahulu. Jangan fix di M10-A.

---

## 10. Plot Debt Lifecycle Audit

Trace:

```text
StoryContract.plotDebts
      ↓
ChapterBrief.plotDebtsToProgress / ToClose
      ↓
draft.closesPlotDebts
      ↓
auditPlotDebts
      ↓
publish path
      ↓
persistent source of truth
      ↓
next chapter reload
```

Buktikan skenario:

```text
Bab 5 debt OPEN

Bab 10 debt progressed
→ state apa berubah?

Bab 20 milestone kedua
→ bagaimana engine tahu milestone pertama selesai?

Bab 35 debt close
→ source of truth setelah publish?

Bab 36 reload contract
→ debt sudah CLOSED atau masih OPEN?
```

Detector:

```text
PLOT_DEBT_PROGRESS_NOT_PERSISTED
PLOT_DEBT_CLOSE_NOT_PERSISTED
PLOT_DEBT_NEXT_CHAPTER_STATE_STALE
PLOT_DEBT_MILESTONE_MEMORY_GAP
```

---

## 11. Worker vs Synchronous Parity Audit

Buktikan state persistence parity untuk:

```text
same story
same chapter
same choice
same canon state
```

Bandingkan:

```text
WORKER PATH
after publish persistent state = X

LEGACY / SYNC PATH
after publish persistent state = X
```

Domain yang wajib dibandingkan:

```text
plot debt closure
ending lock
reader state
chapter
choice outcomes
checkpoint
canon delta
thread state
timeline state
fact state
```

Detector:

```text
PLOT_DEBT_WORKER_LEGACY_PARITY_RISK
ENDING_LOCK_WORKER_LEGACY_PARITY_RISK
CANON_DELTA_WORKER_LEGACY_PARITY_RISK
READER_STATE_WORKER_LEGACY_PARITY_RISK
```

Jika parity benar-benar berbeda, STOP dari fixing dan laporkan.

---

## 12. Ending Lock Bab 45→50 Audit

Characterization sequence:

```text
Bab 44
lockedEnding = null

Bab 45
resolve ending = A
persist lock

Bab 46
route berubah ekstrem
expected ending tetap A

Bab 49
ending tetap A

Bab 50
final ending = A
reader status SELESAI
```

Test tambahan:

```text
retry Bab 45
```

Tidak boleh menghasilkan ending lock berbeda.

Detector:

```text
ENDING_LOCK_NOT_DURABLE
ENDING_LOCK_RETRY_DIVERGENCE
ENDING_LOCK_POST45_SWITCH
ENDING_LOCK_WORKER_LEGACY_PARITY_RISK
```

---

## 13. Chapter 50 Finalization Audit

Uji:

```text
chapter 50 published
reader state update succeeds
→ expected OK

chapter 50 published
reader state update fails sekali
→ recovery path?

process restart
→ siapa memperbaiki?

CHAPTER_EXISTS retry
→ SELESAI akhirnya konsisten?
```

Detector:

```text
FINAL_STATE_RECONCILIATION_GAP
FINAL_CHAPTER_DUPLICATE_STATE_RISK
FINAL_READER_STATE_STALE
```

Audit harus membuktikan apakah reconciliation deterministic atau hanya best-effort tanpa recovery owner.

---

## 14. Audit Contract

Buat pure contract:

```ts
type AuditSeverity =
  | 'BLOCKER'
  | 'HIGH'
  | 'MEDIUM'
  | 'LOW'
  | 'INFO'

type AuditStatus =
  | 'PROVEN_E2E'
  | 'PROVEN_READ_ONLY'
  | 'WRITE_PATH_UNPROVEN'
  | 'CONSUMER_UNPROVEN'
  | 'PARITY_RISK'
  | 'BOUNDED_LOSS_RISK'
  | 'DEAD_PATH_CANDIDATE'
  | 'AMBIGUOUS'

interface StoryBibleAuditFinding {
  code: string
  severity: AuditSeverity
  domain: string
  status: AuditStatus

  sourceOfTruth: string[]
  producers: string[]
  consumers: string[]
  validators: string[]

  evidence: string[]
  risk: string
  recommendedFollowUp: string
}
```

Rules:

- Tidak perlu LLM.
- Output deterministic.
- Semua code harus allowlisted.
- Tidak ada free-form raw DB dump.
- Tidak ada production secrets/log payload.

---

## 15. Proposed Files

Boleh membuat:

```text
docs/audits/
  M10A_STORY_BIBLE_DATAFLOW.md
  M10A_RISK_REGISTER.md

lib/narrative-qa/
  story-bible-audit.ts
  story-bible-audit-contract.ts

scripts/
  m10-story-bible-audit.ts
  m10-context-pressure-audit.ts

fixtures/long-horizon/
  story-bible-pressure.ts

tests/narrative-qa/
  story-bible-audit.test.ts
  context-pressure.test.ts
  choice-history-pressure.test.ts
  blueprint-version-audit.test.ts
  plot-debt-lifecycle-audit.test.ts
  ending-lock-parity-audit.test.ts
  thread-signal-audit.test.ts
```

Existing production files sebaiknya tidak diubah kecuali export pure/test seam benar-benar diperlukan.

Jika agent merasa perlu mengubah business logic agar audit hijau:

> STOP.

Audit bukan fix PR.

---

## 16. Audit Report Structure

### `docs/audits/M10A_STORY_BIBLE_DATAFLOW.md`

```text
1. Executive Summary
2. Production Baseline SHA
3. Story Bible Architecture
4. Source-of-Truth Matrix
5. Creation Paths
6. Mutation Paths
7. Read/Compilation Paths
8. Writer Propagation
9. Validation Coverage
10. Publish/State Evolution
11. Worker vs Legacy Parity
12. Chapter 45–50 Finalization
13. Context Pressure Results
14. Proven Gaps
15. Unknown / Unproven Paths
16. Follow-up PR Recommendations
```

### `docs/audits/M10A_RISK_REGISTER.md`

| Severity | Code | Domain | Evidence | Effect at Chapter 50 | Proposed Fix |
|---|---|---|---|---|---|

---

## 17. Severity Rules

### BLOCKER

Dapat membuat story Bab 1→50 salah secara diam-diam.

Contoh:

```text
ending berubah setelah lock
plot debt closure tidak pernah persist
canon state tidak pernah diperbarui
worker dan sync menghasilkan Story Bible berbeda
```

### HIGH

Long-horizon quality degradation nyata.

Contoh:

```text
recent choices hilang dari context
thread advancement tidak pernah sampai validator
act rollup dead-path
```

### MEDIUM

Quality/observability degradation tetapi ada fallback lain yang masih aman.

### LOW

Maintainability, efficiency, atau cleanup.

### INFO

Characterization saja.

Jangan menjadikan seluruh temuan BLOCKER.

---

## 18. Tests Wajib

Minimum acceptance suite:

```text
StoryContract
✓ exactly 50 targets
✓ acts contiguous 1→50
✓ cutoff 35/40/45/48/49/50

Choice history
✓ pressure at 10/20/30/40/50
✓ detect recent choice truncation
✓ detect duplicate previous choice jika terjadi

Blueprint
✓ multi-version selection characterization
✓ compiler/runtime/brief parity

Context
✓ growing facts
✓ growing load-bearing
✓ growing rollups
✓ excluded/included IDs
✓ budget overshoot characterization

Thread
✓ actual advancement signal traced
✓ staleness lifecycle traced

Plot debt
✓ milestone source-of-truth traced
✓ closure persistence traced
✓ next-chapter reload traced

Ending
✓ lock 45
✓ retry 45
✓ 46–50 cannot switch ending

Runtime
✓ worker/legacy state parity characterized

Chapter 50
✓ publish + SELESAI reconciliation characterized
```

---

## 19. M10-A Must NOT Do

```text
NO real-model generation
NO 50-chapter generation
NO semantic quality judge
NO production DB writes
NO production story creation
NO deploy
NO worker flip
NO migration
NO historical story regeneration
NO schema rewrite
NO automatic fix of failed audit
```

M10-A harus murah, deterministic, dan aman.

---

## 20. STOP Conditions

Agent harus STOP dan lapor jika:

```text
perlu migration hanya untuk audit

audit script mencoba INSERT/UPDATE/DELETE/RPC mutation

target Supabase production hendak disentuh write operation

temuan BLOCKER hendak diperbaiki dalam PR audit

tidak bisa menentukan source of truth critical field

worker dan legacy terbukti menghasilkan persistent Story Bible state berbeda

contract state ternyata tidak pernah diperbarui setelah chapter publish

canon writer path untuk fakta/thread/timeline ternyata hilang

ending lock tidak durable across retry

Bab 50 tidak punya deterministic reconciliation path
```

Temuan seperti itu adalah hasil audit, bukan alasan untuk menyembunyikan failure.

---

## 21. Definition of Done

M10-A baru PASS jika:

```text
100% Story Bible domains terinventarisasi
100% persistent fields punya status explicit
0 critical field berstatus tanpa evidence
writer propagation matrix lengkap
validator coverage matrix lengkap
worker/legacy parity matrix lengkap
choice-history pressure report lengkap
context-budget pressure report lengkap
ending 45→50 lifecycle lengkap
plot-debt lifecycle lengkap
act-rollup lifecycle lengkap
all audit tests green
typecheck green
lint green
full unit suite tidak regress
0 production mutation
```

`AMBIGUOUS` diperbolehkan hanya jika dicatat sebagai finding dengan bukti dan risiko.

---

## 22. Deliverables Agent

Setelah selesai, agent harus mengirim:

```text
exact head SHA
changed files
full test results

BLOCKER findings
HIGH findings
MEDIUM findings

source-of-truth matrix summary
worker vs legacy parity summary
choice-history pressure result
context-pressure result
plot-debt lifecycle result
act-rollup lifecycle result
ending-lock 45→50 result

recommendation:
M10-A PASS / HOLD
```

Untuk setiap BLOCKER/HIGH:

```text
CODE
observed behavior
expected behavior
exact source evidence
chapter range affected
recommended narrow fix
```

Jangan lanjut otomatis ke M10-B.

---

# Agent Mandate

> Mulai **M10-A — Story Bible End-to-End Dataflow Audit** dari exact base `b7961311cf70b91cb7245149e400075c4e454d74`.
>
> Tujuan M10-A bukan memperbaiki narrative engine dan bukan menjalankan novel 50 bab. Tujuannya membuktikan secara source-backed dan deterministic bagaimana Story Bible Lakoku dibuat, disimpan, diperbarui, dikompilasi, dikirim ke writer, divalidasi, lalu dipersist kembali dari Bab 1 sampai Bab 50.
>
> Audit semua domain: characters, character states, aliases, voice, facts, knowledge, secrets, timeline, threads, act rollups, blueprints, StoryContract, plot debts, route state, choice history, ending lock, chapters, choice outcomes, checkpoints dan retrieval logs.
>
> Untuk setiap persistent field, catat source of truth, producer, writer, reader, prompt consumer, validator, update trigger, worker path, legacy path dan evidence.
>
> Wajib characterization khusus:
> - `choice_history` pressure sampai 49 pilihan;
> - blueprint multi-version resolution;
> - context-budget pressure Bab 1/10/20/30/35/40/45/48/49/50;
> - plot-debt progression/closure persistence;
> - thread advancement;
> - act-rollup creation/use;
> - ending lock 45→50;
> - worker-vs-legacy persistence parity;
> - Bab 50 final-state reconciliation.
>
> Jangan mengubah production behavior agar audit hijau. Jika menemukan BLOCKER/HIGH, dokumentasikan dan STOP dari fixing; fix dibuat dalam follow-up PR terpisah.
>
> Tidak ada production mutation, deploy, migration, worker change, real-model call, atau story regeneration.
>
> Deliver:
> - `docs/audits/M10A_STORY_BIBLE_DATAFLOW.md`
> - `docs/audits/M10A_RISK_REGISTER.md`
> - deterministic audit tooling/tests
> - exact head SHA
> - gates
> - prioritized findings
>
> Setelah hasil M10-A tersedia, review temuannya sebelum merancang M10-B.
