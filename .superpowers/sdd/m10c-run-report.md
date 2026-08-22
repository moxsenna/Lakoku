# M10-C Long-Horizon Harness — First End-to-End Run Report

Branch: `feature/m10-b-deterministic-evaluators`
Target: LOCAL Supabase only (`http://127.0.0.1:55321`). No production access, no
production mutation, no production activation.
Provider: deterministic (`NARRATIVE_PROVIDER` left unset). Zero model calls, zero token spend.
Nothing committed.

**Status: DONE_WITH_CONCERNS** — all six success criteria met; the concerns are
real findings the harness surfaced, not harness failures.

> **Post-review corrections (M10-C review package):** three claims in this first
> report were wrong and are corrected in place below: §4.6 ("no signal is
> dropped" — the raw DB digest is NOT compared across stories; its normalized
> content is, and digest presence is asserted separately), §6/§7.1
> (`ENDING_LEAVES_UNRESOLVED_THREAD` was a FIXTURE artifact, not a runtime gap
> on the exercised path), and the repetition mass was horizon-evaluator
> duplication, now run-once. See the "CORRECTED" markers. The corrected stage
> record is `M10_C_HARNESS_REPORT.md`.

---

## 1. Reference test (environment ground truth)

Run FIRST, before touching anything.

```
pnpm vitest run tests/db/m10-a1d-validated-state-full-parity.test.ts
 Test Files  1 passed (1)
      Tests  2 passed (2)
   Duration  28.76s
```

The 1..50 sync+worker parity test passed in 15798ms. The environment is healthy,
so every subsequent failure was treated as a harness bug.

---

## 2. Final harness result

```
pnpm m10:c:harness
Artifacts written to D:\Coding\lakoku v2\.zcode\artifacts\m10-c\m10-c-f1c876fb0e60
M10-C Long-Horizon Harness Summary:
  Result: BLOCKED
  Chapters: 50 (sync + worker)
  Parity mismatches: 0
  Total findings: 12582
  Findings hash: f1c876fb0e600926ae42d789e269f95d265e60502c2b39ee33584735d186be5d
    CAPTURE BLOCKER: CONTEXT_MEMORY_PROMPT_LAYERS_UNOBSERVABLE
    CAPTURE BLOCKER: CONTEXT_BUDGET_NOT_PERSISTED_BY_RUNTIME
    CAPTURE BLOCKER: EMOTIONAL_RESOLUTION_BEATS_NOT_PERSISTED
    CAPTURE BLOCKER: ENDING_LOCK_PUBLICATION_TX_UNOBSERVABLE
exit code 1
```

All six artifacts written: `manifest.json`, `findings.json`, `summary.json`,
`blockers.json`, `captures.json`, `parity.json`.

`result: BLOCKED` + exit code 1 is the expected and correct outcome: capture
blockers exist, so the run cannot be PASS. No blocker was removed to make it green.

### Criteria check

| # | Criterion | Result |
|---|---|---|
| 1 | Both clones publish all 50 chapters, no skip, no repair | PASS — `chapters` 50 rows and `chapter_state_commits` 50 rows for both `m10c-sync` and `m10c-worker` |
| 2 | `stories.canon_state_revision == 50` for both; resume at Bab 20 + 46 does not double-advance | PASS — 50 / 50, `resumedChapters: [20,46]` on both |
| 3 | `reader_states.status == 'SELESAI'`, `current_chapter == 50`, `locked_ending_key` non-null | PASS — `SELESAI / 50 / ending-open` for both |
| 4 | Sync vs worker per-chapter `captureHash` identical for all 50 | PASS — `parity.json` `mismatches: []` |
| 5 | `manifest.result == 'BLOCKED'` with capture blockers intact | PASS — 4 blockers recorded (2 pre-existing + 2 newly discovered, see §5) |
| 6 | Two runs produce identical `runId` + `findingsHash` | PASS — both runs `m10-c-f1c876fb0e60` / `f1c876fb0e600926ae42d789e269f95d265e60502c2b39ee33584735d186be5d` |

Direct DB verification after the final run:

```
     id      | canon_state_revision
-------------+----------------------
 m10c-sync   |                   50
 m10c-worker |                   50

  story_id   | status  | current_chapter | locked_ending_key
-------------+---------+-----------------+-------------------
 m10c-sync   | SELESAI |              50 | ending-open
 m10c-worker | SELESAI |              50 | ending-open
```

### Determinism

Run 1 and run 2 produced the identical `runId` `m10-c-f1c876fb0e60` and the
identical `artifactHashes.findingsHash`. `startedAt` / `finishedAt` differ in
`manifest.json` by design; they are not part of either hash. No nondeterminism
hunt was needed once the capture hash was made provenance-normalized (§4.6).

### Validation commands

```
pnpm typecheck                                        # green (tsc --noEmit)
pnpm exec eslint lib/narrative-qa/harness scripts/m10-c-harness.ts scripts/m10-c-harness-cli.ts
                                                      # exit 0, no warnings
```

---

## 3. Files edited

Only files inside the permitted boundary were changed. **No production runtime,
no `lib/runtime/**`, no `lib/narrative/**`, no `supabase/migrations/**`.**

| File | Reason |
|---|---|
| `lib/narrative-qa/harness/seed.ts` | Seed `reader_states.route_state` with `normalizeRouteState({})` (plus `ending_name`/`updated_at`) exactly like the production bootstrap, so the accepted-choice RPC's field-by-field expected-state comparison can succeed. |
| `lib/narrative-qa/harness/run.ts` | Thread the REAL accepted choice id from Bab N-1 into Bab N (both modes) instead of a synthetic id; make a checkpoint resume re-enter the SAME attempt identity in both modes (sync attempt id / claimed worker job) instead of a fresh id. |
| `lib/narrative-qa/harness/capture.ts` | Fix four wrong DB reads (non-existent columns, unchecked errors, positional join, append-only history), stop fabricating `emotionalResolutionBeatIds`, derive `newMajorThreadIds` from canonical `opened_chapter`, and normalize provenance in the capture hash so sync/worker parity is meaningful. Two new capture blockers recorded. |

`lib/api/personalized-choice.server.ts` was already modified before this session
(the `applyPersonalizedChoiceAuthorized` split) and was NOT touched here.

---

## 4. Harness defects found and fixed

Each was found by running, reading the error, and reading the production source
of truth. None was fixed by weakening a runtime gate.

### 4.1 `STALE_READER_STATE` on the first accepted choice (Bab 1)

`seed.ts` inserted `route_state: {}`. `ReaderStateSchema.route_state` is
`RouteStateSchema`, whose fields all carry `.default()`, so the value read back
and posted as `p_expected_state` was the hydrated shape while the stored row was
the raw `{}`. `apply_personalized_choice` compares expected vs stored
field-by-field and rejected every submission.

Fix: seed the normalized shape, mirroring
`lib/api/personalized-stories.server.ts:462-473`.

### 4.2 `capture: chapters read failed: column chapters.content does not exist`

`captureRepetition` selected a column that does not exist. `public.chapters` has
`story_id, number, title, paragraphs, choice_prompt, choices, created_at`.

Fix: read `paragraphs`. The same class of bug in `captureEndingRunway`
(`is_ending`, `ending_key`) was fixed at the same time — chapter-level
terminality lives in `choice_outcomes`, and the committed ending key lives in
`reader_states.locked_ending_key`.

### 4.3 `TRIGGER_CHOICE_NOT_FOUND` at Bab 2

`run.ts` passed a synthetic `'harness-choice'` trigger id. The fail-closed
continuation loader
(`lib/runtime/continuation-context.server.ts:244-255`) requires the trigger id to
exist in `reader_states.choice_history`, and the real accepted id is `buka-jejak`.

Fix: carry the accepted choice id from Bab N-1 into Bab N. The gate was respected,
not relaxed.

### 4.4 Worker resume: pkey violation, then `JOB_ID_MISMATCH`

First attempt reused `attemptId` for the resume; in worker mode that id IS the
`generation_jobs` primary key, so the insert violated
`generation_jobs_pkey`. Switching to a fresh job id then failed differently:

```
CHECKPOINT_STALE_REJECTED { reason: 'JOB_ID_MISMATCH', schemaVersion: 3 }
PERSONALIZED_SCHEMA3_PUBLISH_FAILED { errorCode: 'INTERNAL_ERROR' }
HarnessRunError: checkpoint resume failed: {"ok":false,"reason":"TRANSIENT"}
```

Both were harness misconceptions. The production contract is explicit:

* `lib/runtime/chapter-generation-checkpoint.pure.ts:247` —
  `if (cp.jobId !== ctx.jobId) return mismatch('JOB_ID_MISMATCH')` for worker
  schema-2/3 provenance.
* `publish_generation_job_chapter_v5` selects the checkpoint with
  `attempt_id = v_job.id AND job_id = v_job.id` and raises `PROVENANCE_CONFLICT`
  when it is absent.

A fresh job therefore can never legitimately resume another job's checkpoint —
that is a correctly fenced design, not a bug. A resume is by definition the SAME
attempt re-entering after losing its outcome.

Fix: `runSyncChapter` / `runWorkerChapter` now return a `ChapterAttempt` carrying
a `replay()` closure that re-invokes `generateNextPersonalizedChapter` with the
identical attempt identity (sync: same `attemptId`; worker: the same claimed job,
worker id, claim token and lease). Both resumes now return `ok: true` on the same
chapter, served from the durable commit ledger, and `canon_state_revision` stays
at exactly 50. `assertResumeReplayed` enforces that: `CHAPTER_EXISTS` is no
longer accepted as a pass, because the living-canon publishers answer a genuine
same-attempt replay with success, not a conflict.

### 4.5 100 false `CANON_SNAPSHOT_STALE` BLOCKERs from an unchecked read

`captureCanonDrift` selected `stories.updated_at`, which does not exist. The
PostgREST error was never checked, so `data` was null and the snapshot revision
read as `0` — the evaluator then reported the canon as stale versus the commit
ledger on all 50 chapters of both clones.

Fix: select `created_at`, throw on the error so schema drift stops the run
instead of poisoning findings, and source `canonicalSnapshot.updatedAt` from the
newest publication timestamp — the closest marker the runtime actually persists.

### 4.5b 100 false `CANON_STATE_DELTA_SEQUENCE_MISMATCH` BLOCKERs

`character_states` is append-only, keyed `(character_id, as_of_chapter)`. The
capture read every row, so the seeded `as_of_chapter = 0` row
(`m10c-sync:char:rival = ALIVE`) was compared against the delta-derived
`INACTIVE` at chapter 1 and reported as canonical disagreement.

Fix: project the canonical CURRENT state as the row with the highest
`as_of_chapter` at or below the evaluated chapter.

Also fixed while in the same function: `commitLedgers[i].publishedAt` joined
chapter rows by array position, which silently misaligns whenever the chapter and
commit lists differ in length. Now keyed by chapter number.

### 4.6 All 50 parity comparisons mismatched

The `captureHash` covered story-scoped canonical ids
(`<storyId>:char:hero`, `debtBackedThreadId(storyId, ...)`), wall-clock
timestamps, and the DB-computed `state_delta_hash` (which itself digests a delta
containing those ids). Two clones are two different stories, so the hash could
never match and proved nothing.

Fix: a total, textual provenance normalization before hashing (story id →
`<storyId>`, runtime fact ids → `<hash>`, ISO timestamps → `<timestamp>`),
mirroring `normalizeStory` in the reference test. The raw `state_delta_hash`
digest is NOT compared across stories — it digests a delta embedding
story-scoped ids, so it can never match across two different stories by
construction. Its normalized CONTENT is compared instead, and digest PRESENCE
is asserted separately for every chapter in both modes
(`stateDeltaHashPresentBothModes`, wired into the result gate). Exactly what
parity does and does not cover is declared in `PARITY_SCOPE`
(`scripts/m10-c-harness.ts`) and written to `parity.json`. Result: 0/50
mismatches on both runs.

### 4.7 4 false `NEW_MAJOR_CONFLICT_IN_CLOSURE_RUNWAY` HIGHs

`newMajorThreadIds` was derived from the committed delta's thread TRANSITION
list, so every late-story payoff of the main mystery (Bab 45, 48) looked like a
brand-new conflict inside the closure runway. Touching or transitioning an
existing thread is continuation, not introduction.

Fix: derive it from the canonical `story_threads.opened_chapter`.

---

## 5. Capture blockers (missing production wires, NOT fixed)

Two were already recorded; two were discovered during this run. All four are
inputs the M10-B evaluator contracts require and the production runtime does not
expose. No value was fabricated for any of them.

1. `CONTEXT_MEMORY_PROMPT_LAYERS_UNOBSERVABLE` — `buildWriterPrompt` returns only
   a concatenated `user` string with no per-layer field, and its sole caller is
   the real-model gateway provider. Writer layer 1a/3 text does not exist on the
   deterministic path.
2. `CONTEXT_BUDGET_NOT_PERSISTED_BY_RUNTIME` — `persistRetrievalLog` is wired
   into `defaultDeps` but has zero call sites in
   `lib/runtime/personalized-generation.ts`, so `retrieval_logs` stays empty and
   the `compileContext` budget report is dropped before persistence.
3. **NEW** `EMOTIONAL_RESOLUTION_BEATS_NOT_PERSISTED` — no table or checkpoint
   field records an emotional-resolution beat. `audit_signals_json` carries only
   `opensNewThread` / `opensMajorMystery` / `opensNewConflict` /
   `closesPlotDebts`, and `chapter_blueprints.mandatory_beats` is pre-generation
   intent, not committed canon. The previous harness code fabricated
   `` [`beat:${chapterNumber}`] `` for chapters 49 and 50 — a value with no
   runtime source, which also silently suppressed the evaluator's
   `CHAPTER_49_EMOTIONAL_RESOLUTION_MISSING` check. That fabrication was removed;
   the field is now empty and the blocker is recorded.
4. **NEW** `ENDING_LOCK_PUBLICATION_TX_UNOBSERVABLE` — `persist_ending_lock_v1`
   stores only `{key, name, lockedAtChapter}`. Neither it nor the V3/V5
   publishers persist the publication transaction id, so atomic-commit provenance
   cannot be read back. The lock genuinely IS written inside the publication
   transaction (V5 Phase F calls `persist_ending_lock_v1` under the same
   fencing), but the harness cannot PROVE it from persisted state, so the field
   stays `null`.

---

## 6. Findings summary (12582 total, both clones)

| Count | Severity | Code |
|---|---|---|
| 11978 | MEDIUM | `EXACT_PARAGRAPH_REPETITION` |
| 288 | MEDIUM | `REPEATED_CHOICE_LABEL` |
| 106 | HIGH | `STALE_THREAD_CALLBACK_DEADLINE_MISSED` |
| 98 | MEDIUM | `CHOICE_HISTORY_DUPLICATE_PREVIOUS` |
| 82 | MEDIUM | `REPEATED_CLOSING_STRING` |
| 24 | MEDIUM | `STALE_THREAD_DETECTED` |
| 2 | BLOCKER | `ENDING_LEAVES_UNRESOLVED_THREAD` |
| 2 | HIGH | `CHAPTER_49_EMOTIONAL_RESOLUTION_MISSING` |
| 2 | HIGH | `ENDING_LOCK_NOT_DURABLE` |

Interpretation:

* The repetition mass (11978 + 288 + 82) is an artefact of the **deterministic
  provider**, whose prose is templated and near-identical chapter to chapter. It
  measures the fixture, not the runtime. It is not evidence of a production
  prose defect and should not be read as one until M10-F runs the real model.
  (Count note: these horizon evaluators were later made run-once per run instead
  of per chapter; the post-fix run reports the deduplicated mass.)
* `CHOICE_HISTORY_DUPLICATE_PREVIOUS` (98) is a **harness policy artefact**, not
  a runtime observation: the deterministic choice policy accepts the SAME choice
  id+label at consecutive chapters by design, and the evaluator flags exactly
  that shape. It will be re-interpreted under the real-model run (M10-F).
* `CHAPTER_49_EMOTIONAL_RESOLUTION_MISSING` (2) and `ENDING_LOCK_NOT_DURABLE` (2)
  are downstream consequences of capture blockers 3 and 4 — they will remain
  until those wires exist.
* `STALE_THREAD_CALLBACK_DEADLINE_MISSED` (106) and `ENDING_LEAVES_UNRESOLVED_THREAD`
  (2) are discussed below. **CORRECTED:** the latter was a fixture artefact (see
  §7.1); the staleness count is genuine but partially fixture-driven (see §7.2).

---

## 7. Production observations worth escalating

These are reported, **not fixed** — fixing them would require production changes,
which the brief forbids without escalation.

### 7.1 ~~The runtime lets a story finish with a non-terminal thread~~ CORRECTED: fixture artefact + authoring-path observation

**CORRECTED after review.** The original claim — a "real gap in gate coverage"
on the exercised path — was FALSE for the personalized runtime:

* On the personalized path the harness exercises, a non-debt-backed thread
  CANNOT exist. `contract-persistence.server.ts` derives `story_threads`
  exclusively from `validated.plotDebts`
  (`id = scopedId(storyId, 'thread:' + debt.id)`), and
  `apply_validated_chapter_state_v1` only UPDATEs threads, never INSERTs.
  Every personalized thread is debt-backed by construction, and open DEBTS at
  completion ARE gated (`OPEN_DEBT_AT_END`, `MAIN_MYSTERY_UNRESOLVED`).
* The offending `thread:conviction` was seeded by the HARNESS FIXTURE itself —
  a shape production personalized generation can never produce. The fixture now
  seeds only debt-backed threads; the two
  `ENDING_LEAVES_UNRESOLVED_THREAD` BLOCKERs disappeared in the post-fix run.

What remains, filed as an OUT-OF-SCOPE observation (not an M10-C gate item):
the AUTHORING path (`lib/authoring/persist.ts:96-106`) inserts arbitrary,
non-debt-backed threads for standard/public stories, and completion has no
terminal-thread gate on that path. Whether authored stories may end with a
dangling thread is a product/policy decision. No production change was made.

### 7.2 Thread staleness is not enforced anywhere in the write path (HIGH)

**Updated after the fixture correction:** `thread:conviction` no longer exists,
so the remaining staleness findings concern `main_mystery` only (28
`STALE_THREAD_CALLBACK_DEADLINE_MISSED` + 18 `STALE_THREAD_DETECTED` in the
post-fix run). Part of this is fixture-driven — the act plan keeps the main
mystery debt open and untouchable from Bab 12 until its Bab 48 payoff — but the
structural observation stands: `STALE_AFTER_CHAPTERS` / `STALE_CALLBACK_WINDOW`
are honoured by the M10-B evaluator while nothing in the publication path
rejects or even flags a thread that misses its callback deadline, and
`story_threads.stale` remained `false` for the entire run despite
`main_mystery` being untouched from Bab 1 to Bab 12.

This is exactly the class of long-horizon degradation M10-C exists to detect. It
needs a product decision: either the write path enforces the callback window, or
the evaluator threshold is wrong.

### 7.3 Not a defect: commercial generation intent

The brief flagged `ensure_commercial_generation_intent_v1` as a possible blocker
from chapter 4 onward. It is not. The function only inserts a
`WAITING_FOR_CREDITS` intent row and never blocks the choice, and the required
active `feature_credit_costs['chapter_unlock']` row exists locally
(8 credits, `v1.1-202608`). `seed.ts` verifies the precondition rather than
writing it, so a missing migration would surface as a blocker. No intent row was
forced to `FULFILLED`, no credits were granted.

---

## 8. Blockers where work could not proceed honestly

None. Every failure encountered had an honest fix inside
`lib/narrative-qa/harness/**`. No production change was required, and none was
made.

## 9. Remaining work

* Decide on §7.1 (terminal-thread gate) and §7.2 (staleness enforcement) — both
  need a product/architecture call, not a harness change.
* Wire the four capture blockers if the corresponding evaluators are to reach
  PASS: prompt-layer observability, `persistRetrievalLog` call sites,
  emotional-resolution beat persistence, and ending-lock publication tx
  provenance.
* The repetition finding mass will only become meaningful under M10-F with the
  real model.
