# M10-C Stage Report — Long-Horizon 1→50 Harness (RECOVERY RUN)

**Status:** PASS — pending reviewer ratification of six proof-backed blocker reclassifications.
**Without ratification, the honest result is BLOCKED.** This report does not hide that.

| Field | Value |
|---|---|
| Run id | `m10-c-41852d4cbec3` |
| Result | `PASS` (gate formula below) |
| Started / finished (UTC) | 2026-08-07T17:27:41.455Z → 2026-08-07T17:28:56.690Z |
| Baseline SHA (recovery start = current main incl. M10-B) | `21cb68279eb024f9922f8b05a939d43eb2ae3e16` |
| Head SHA at run time | `d06c85227b793af6058c7f56e7231ade98b2bb39` (branch `feature/m10-c-recovery`) |
| `workingTreeDirty` at run time | `true` — see §3.1 for the exact, benign composition |
| Environment | `isolated-qa` (local Supabase, API `127.0.0.1:55321`, container `supabase_db_lakoku-v2`) |
| Stories | `m10c-sync`, `m10c-worker`, `m10c-fork-a`, `m10c-fork-b` (all harness-owned, single harness user) |
| Artifacts | `.zcode/artifacts/m10-c/m10-c-41852d4cbec3/` (`manifest.json`, `summary.json`, `findings.json`, `blockers.json`, `parity.json`, `fork.json`, `captures.json`, `fencing.json`, `act-boundaries.json`) |
| Findings hash | `41852d4cbec3769cad10d2b9c7396f754212c067e207868392f1d16388f60b9b` |
| Summary hash | `853209651cd7f1d5356d5f87f682d12e1a872068850a399d3969cf9bcde77b2d` |
| Evaluator versions | all `1.1.0` except `factConflict 0.0.0-blocked` (M10-B frozen set) |
| Personalized runtime policy | `1.0.0`; harness spec `1`; choice policy `m10c-first-choice-v1`; route profiles `high-trust` ×2 |

This report supersedes the old-branch report preserved at
`docs/qa/m10/reference/M10_C_HARNESS_REPORT_OLD_BRANCH_REFERENCE.md` (that evidence was
invalidated by the reviewer's stage reset; it is retained for history only).

## 0. Governance context — why this run exists

Reviewer verdict (controlling): **"STOP / RESET stage state setelah M10-B"** — M10-C was
`BLOCKED — must achieve PASS`; stage entry for E was invalid until C PASS; D/F/G blocked by C.
Recovery mandate, verbatim: *"Mulai M10-C dari main baru yang sudah memuat B + current
runtime. Enam observability blocker harus ditutup atau direclassify dengan proof sampai C PASS."*

Recovery sequence executed:

1. M10-B R1 integrated onto current main and closed (PR #56 squash `7d0dd03`, closure docs
   `21cb682`, CI run `31197911530` success). This is the new baseline.
2. Current main was surveyed against the old C base. The narrative generation path is
   byte-identical; the only new worker seam is **commercial worker preflight**
   (`executeClaimedJob` step 3.5, Phase 2B). The harness worker mode was adapted to it (§4)
   instead of bypassing it.
3. The six capture blockers were dispositioned with a code-evidenced proof dossier (§5).
   **No blocker was removed.** The gate now blocks only on `UNRESOLVED` blockers; all six are
   `RECLASSIFIED` with `ratifiedByReviewer: false`, and the CLI/artifacts state plainly that
   PASS rests on pending ratification.
4. Full 1→50 sync + worker run on the isolated local DB, fork probe, evaluators, artifacts.

Standing constraints honored in this run: no production target (assertIsolatedTarget),
no real model (deterministic provider only; `NARRATIVE_PROVIDER=gateway` never set),
no production file edited (recovery code lives in `lib/narrative-qa/` + `scripts/` only),
no evaluator input fabricated (blockers recorded instead), no capture blocker removed,
no secrets/reader data in any artifact.

## 1. What M10-C is

The long-horizon gate that proves the personalized living-canon runtime survives a full
50-chapter story **twice, on two execution modes, with byte-comparable canonical state**:

- **Clone S (`m10c-sync`)** — reader-facing sync path (`generateNextPersonalizedChapter`).
- **Clone W (`m10c-worker`)** — worker path: job claim → lease → **commercial preflight**
  → `executeClaimedJob`-equivalent generation order → V5 publication.
- Both clones run the identical deterministic choice sequence through the production
  accepted-choice seam (`apply_personalized_choice_v2`), including a checkpoint-resume plan
  at Bab 20 (same-attempt), Bab 33 (new-attempt), Bab 46 (same-attempt).
- A **fork probe** at Bab 10 splits into `m10c-fork-a` / `m10c-fork-b`, each running Bab 11–12,
  asserting single-canon-spine and no cross-branch leak.
- The M10-B deterministic evaluator suite runs over both canons; findings are evidence only.

Gate formula (unchanged from plan §M10-C):

```
BLOCKED  if any UNRESOLVED capture blocker
PASS     iff parityMismatches == 0
       && stateDeltaHash present in both modes
       && failedCompletionChecks == 0
       && BLOCKER-severity findings == 0
FAIL     otherwise
```

## 2. Exact-head evidence

- Commit **before** the run: `git commit d06c852` on `feature/m10-c-recovery`
  (recovery port + commercial preflight adaptation + blocker dispositions). The manifest
  records `headSha = d06c852…` and `baselineSha = 21cb682…`.
- `pnpm typecheck` — clean. `pnpm lint` — 0 errors (11 pre-existing warnings, all in files
  untouched by the recovery).
- Run command: `pnpm m10:c:harness` (→ `scripts/m10-c-harness-cli.ts`). Exit code 0.
- Artifacts written by the run itself; `findings.json`/`summary.json` hashes recomputed and
  recorded in `manifest.json` at write time.

### 2.1 Completion checks — 7/7 passed in BOTH modes (`parity.json`)

| Check | sync | worker | Detail |
|---|---|---|---|
| `ALL_50_CHAPTERS_PUBLISHED` | ✅ | ✅ | 50/50 in both |
| `CANON_REVISION_ADVANCED_ONCE_PER_CHAPTER` | ✅ | ✅ | final revision 50; resumed chapters [20, 33, 46] |
| `READER_REACHED_COMPLETION` | ✅ | ✅ | chapter 50, status `SELESAI` |
| `ENDING_LOCKED` | ✅ | ✅ | `ending-open`, matches Bab-50 publication key |
| `CHECKPOINT_RESUME_EXERCISED` | ✅ | ✅ | [20 same-attempt, 33 new-attempt, 46 same-attempt] |
| `PROVENANCE_TAMPER_FAILS_CLOSED` | ✅ | ✅ | 5 probes (sync) / 7 probes (worker), zero violations |
| `ACT_BOUNDARY_HOOKS_PROVEN` | ✅ | ✅ | rollup true at acts 1, 2, 3; next-act blueprints 1, 1, — |

## 3. Parity result

- **Parity mismatches: 0** across the compared canonical fields: `canonRevision`,
  `baseCanonRevision`, `committedStateDeltaContent`, `checkpointSchemaVersion`, `choiceIds`,
  `acceptedChoiceId`, `canonDriftInput`, `plotDebtInput`, `threadInput`, `choiceInput`,
  `perChapterFindingCodes`.
- **`stateDeltaHash` present in both modes** (`stateDeltaHashPresentBothModes: true`).
- Excluded-from-parity fields are recorded with reasons in `parity.json` (DB-scoped digest,
  presentation fields, provenance-only fields) — unchanged from the M10-B-approved set.
- Fork probe (`fork.json`): `forkChapter 10`, both branches reached chapter 12 with exactly
  one canon commit per chapter, `singleCanonSpine: true`, `crossLeakDetected: false`,
  `preForkCaptureParity: true`.

### 3.1 The `workingTreeDirty: true` flag — exact composition

The manifest honestly records a dirty tree. At run time `git status --porcelain` showed
exactly three **untracked** paths, all predating the recovery and untouched by it:

```
?? .superpowers/                                             (tooling state)
?? docs/superpowers/plans/LAKOKU_ANTI_ABUSE_IMPLEMENTATION_PLAN.md
?? scripts/canary-prod-db-e2e.ts                             (deliberately not committed)
```

No tracked file had modifications (`git diff HEAD` empty); `.zcode/` is gitignored. The run
code itself is fully committed at `d06c852`. We did not move or commit these paths to force
`dirty:false`: that would be provenance theater. Reviewer may direct their disposition.

## 4. Recovery work — commercial worker preflight seam (the only new runtime seam on current main)

Phase 2B added `executeClaimedJob` step 3.5: `resolveCommercialWorkerPreflight`
(`lib/commercial/worker-preflight.server.ts`) after claim+lease, before generation;
non-`AUTHORIZED` ⇒ job `FAILED COMMERCIAL_PREFLIGHT_FAILED TERMINAL PREFLIGHT`. The harness
worker mode reproduces the executor order with the **production function and byte-exact
inputs**, fail-closed on non-AUTHORIZED (`lib/narrative-qa/harness/run.ts` +
`lib/narrative-qa/harness/commercial.ts`). Per paid chapter (Bab 4–50), in order:

1. Choice seam (`apply_personalized_choice_v2`) creates the `WAITING_FOR_CREDITS` intent via
   `ensure_commercial_generation_intent_v1` — production RPC, never hand-inserted.
2. One-time idempotent harness credit grant: a single `credit_ledger` row
   (`delta 5000`, ref `m10c:harness-grant:{userId}`) — the only direct row write, permitted
   as isolated fault setup.
3. `reserve_chapter_unlock_v1` (production RPC) → `RESERVED`; harness asserts `ok && RESERVED`.
4. `transition_commercial_generation_intent_v1`: `WAITING_FOR_CREDITS → AUTHORIZED` (job null),
   then `AUTHORIZED → QUEUED` bound to the exact `jobId` — production state machine only.
5. `resolveCommercialWorkerPreflight` with `{jobId, userId, storyId, chapterNumber,
   triggerChoiceId, jobStatus:'RUNNING', claimedByWorkerId, claimToken, expectedClaimToken}`
   — identical to `lib/runtime/generation-worker.ts:206-218`. Any non-AUTHORIZED aborts the run.

Origin choice: `LEGACY_GRANDFATHERED` (seed change `STARTER_FREE → LEGACY_GRANDFATHERED`).
Reason: `account_commercial_states.starter_story_id` is a per-user singleton and one harness
user owns all four harness stories, so at most one story could ever be the "starter";
legacy-included requires no account state and exercises the identical Bab 4+ intent +
reservation seam. Bab 1–3 remain auto-AUTHORIZED exactly as in production.

**DB evidence after the run (isolated local DB):**

| Trail | Count | State |
|---|---|---|
| `commercial_generation_intents` (m10c-worker, Bab 4–50) | 47 | all `QUEUED`, job-bound |
| `credit_reservations` (m10c-worker) | 47 | all `ACTIVE` (V5 does not capture; V6 does — recorded) |
| `credit_ledger` harness grant | 1 | `delta 5000`, reason `m10c-harness-grant` |
| `generation_jobs` (m10c-worker) | 50 | all `SUCCEEDED` |

Because V5 marks jobs SUCCEEDED and never re-claims them, preflight runs exactly once per
chapter (first attempt) — matching production semantics. Sync mode and fork probes run the
sync path, which has no preflight in production; they need no commercial seeding.

## 5. The six capture blockers — preserved, dispositioned with proof (pending ratification)

All six original blockers are preserved **verbatim** in `blockers.json` (`blockers[]`).
Each gained a disposition (`dispositions[]`) per the recovery mandate: close or reclassify
**with proof**. All six are `RECLASSIFIED`, all `ratifiedByReviewer: false`. No blocker was
deleted; any future `UNRESOLVED` blocker forces `BLOCKED` again. Consequence findings are
retained in every run, not suppressed.

| # | Blocker | Disposition | Recorded consequence finding |
|---|---|---|---|
| 1 | `CONTEXT_MEMORY_PROMPT_LAYERS_UNOBSERVABLE` | RECLASSIFIED → **M10-F scope** (real-model prompt observability) | — |
| 2 | `CONTEXT_BUDGET_NOT_PERSISTED_BY_RUNTIME` | RECLASSIFIED → **D-OBS-1** (dead wire, tracked) | — |
| 3 | `EMOTIONAL_RESOLUTION_BEATS_NOT_PERSISTED` | RECLASSIFIED → **D-OBS-2** (no beat persistence anywhere) | `CHAPTER_49_EMOTIONAL_RESOLUTION_MISSING` (HIGH) retained |
| 4 | `ENDING_LOCK_PUBLICATION_TX_UNOBSERVABLE` | RECLASSIFIED → **D-OBS-3** (atomicity proven; tx-id unpersisted) | `ENDING_LOCK_NOT_DURABLE` (HIGH) retained |
| 5 | `ACT_RECONCILIATION_TRIGGER_UNOBSERVABLE` | RECLASSIFIED → **D-OBS-4** (no publication-path call site) | — |
| 6 | `ENDING_REACHABILITY_PER_ACT_NOT_PERSISTED` | RECLASSIFIED → **D-OBS-5** (enforcement proven; projection unpersisted) | — |

Proof summaries (full text in `blockers.json`):

- **#1** Writer prompt layers 1a/3 are real-model artifacts. `buildWriterPrompt` has exactly
  one production caller on current main: `lib/ai-gateway/gateway-provider.ts:421`. M10-C is
  deterministic-only by contract (the harness refuses `NARRATIVE_PROVIDER=gateway`), so no
  prompt text exists to observe on the C path — the absence is structural. Populating the
  fields would violate the no-fabrication rule. The evaluator contract retains the fields
  for M10-F, where the gateway path runs.
- **#2** `persistRetrievalLog` (`lib/narrative/loader.ts:221`) is wired into
  `PersonalizedGenerationDeps` (`lib/runtime/personalized-generation.ts:206` declaration,
  `:705` deps object) but has **zero** invocation sites anywhere in `lib/runtime` or
  `lib/narrative` on current main. The retrieval budget affects no canonical state and never
  has — identical for sync, worker, and real-model paths. Both clones drop the identical
  nothing, so parity cannot be invalidated. Fixing requires a call site in a read-only file.
- **#3** No production table, checkpoint field, or audit signal records an
  emotional-resolution beat (grep across `lib/runtime`, `lib/prose`, `supabase/migrations`
  returns zero matches outside `lib/narrative-qa`). `CheckpointAuditSignalsV2` carries only
  opensNewThread / opensMajorMystery / opensNewConflict / closesPlotDebts;
  `chapter_blueprints.mandatory_beats` is pre-generation intent, not committed canon. The
  capture leaves the field empty; the HIGH finding stays in every run as the recorded
  consequence.
- **#4** The load-bearing claim — the ending lock commits **atomically** with its
  publication — IS proven two ways. Code: V3 (sync) and V5 (worker) in
  `20260805015000_living_canon_publication_primitives.sql` both call `persist_ending_lock_v1`
  **inside** the publication transaction (~lines 1289 / 2050), re-acquiring advisory lock
  130600 in the same tx. Runtime: `ENDING_LOCKED` verifies the lock and matching
  `reader_states.locked_ending_key` after Bab 50 in both modes. What is missing is only a
  persisted transaction **identifier** — an observability column, not the behavior. Adding it
  requires a migration, which recovery constraints forbid.
- **#5** `runReconciliation` / `runReconciliationAdaptive` have no call site on any
  publication path on current main — invocations exist only in evidence tooling
  (`scripts/m5-soak.ts`, `scripts/m7b-reconcile-smoke.ts`). Reconciliation is an
  authoring-side instrument. The act-boundary obligations the runtime does execute (rollup
  commit + next-act blueprint) are positively verified by `ACT_BOUNDARY_HOOKS_PROVEN` at
  every boundary in both modes, and a missing rollup is itself a BLOCKER finding
  (`ACT_ROLLUP_MISSING_AT_BOUNDARY`). Capturing a trigger for a function the runtime never
  calls would be fabrication.
- **#6** The closure runway is enforced **fail-closed** by the publication SQL state machine
  (`apply_validated_chapter_state_v1`): any violation rejects publication and aborts the
  run. `ALL_50_CHAPTERS_PUBLISHED` + `ENDING_LOCKED` + zero BLOCKER ending findings in both
  modes is positive runtime proof the enforcement held for all 50 chapters ×2. What does not
  exist is a persisted per-act reachability **projection** — an observability artifact
  (D-OBS-5), not missing behavior.

## 6. Findings (592 total, both clones; `findings.json`)

Severity: **BLOCKER 0**, HIGH 32, MEDIUM 560, LOW 0, INFO 0.

| Code | Severity | Count | Reading |
|---|---|---|---|
| `ENDING_LOCK_NOT_DURABLE` | HIGH | 2 | Recorded consequence of blocker #4 (tx-id column absent); atomicity itself proven in §5 |
| `CHAPTER_49_EMOTIONAL_RESOLUTION_MISSING` | HIGH | 2 | Recorded consequence of blocker #3 (no beat persistence exists) |
| `STALE_THREAD_CALLBACK_DEADLINE_MISSED` | HIGH | 28 | Deterministic fixture threads whose callback windows elapse by construction; evidence for D scope, not a gate input |
| `EXACT_PARAGRAPH_REPETITION` | MEDIUM | 436 | Known artifact of the deterministic synthetic prose provider (fixed templates), not model behavior |
| `CHOICE_HISTORY_DUPLICATE_PREVIOUS` | MEDIUM | 98 | Same cause — repeated deterministic choice labels across 50 chapters ×2 |
| `STALE_THREAD_DETECTED` | MEDIUM | 18 | Fixture thread lifecycle evidence |
| `REPEATED_CHOICE_LABEL` | MEDIUM | 6 | Same cause as above |
| `REPEATED_CLOSING_STRING` | MEDIUM | 2 | Same cause as above |

Zero BLOCKER findings: locked ending key matches publication (`ending-open`), all plot debts
closed by Bab 50, all threads resolved — the fixture's closure runway is intact in both modes.

## 7. Escalations — observations, NOT fixed (no production mandate)

1. **D-OBS-1..5 defect ledger** (from §5): five production observability defects for stage D.
   None are runtime-behavior defects; all are missing persistence/call-site wires. Fixes
   require editing read-only production files and/or migrations — out of C scope by constraint.
2. **Duplicate-migration defect (decision needed):** `20260805015000_living_canon_publication_primitives.sql`
   and `20260805020000_…` are **byte-identical** on current main. This breaks fresh
   `supabase db reset` (duplicate object creation) and fails
   `tests/db/migration-version-uniqueness.test.ts`. The local DB for this run was bootstrapped
   with a documented workaround (apply once + bookkeeping rows). **Reviewer decision required:**
   delete the duplicate file vs convert it to a no-op — either touches `supabase/migrations/`
   and needs approval; blocked by G5-NOCONFLICT / production-DB forbiddance otherwise.
3. **`factConflict` evaluator remains `0.0.0-blocked`** (M10-B frozen state) — unchanged.
4. **V5 does not capture/spend `credit_reservations`** (V6 does). Reservations stay `ACTIVE`
   after SUCCEEDED publication on the V5 path. Observed, not judged here — commercial-stage
   evidence for D/E.
5. **`workingTreeDirty: true` composition** — see §3.1.

## 8. What this stage does NOT prove

- Nothing about real-model quality (deterministic provider only; M10-F territory).
- Nothing about production activation or production data (isolated local DB only).
- The six blocker reclassifications are **proposals with proof**, not ratified closures —
  `ratifiedByReviewer: false` in every artifact.
- M10-E fault-matrix evidence from the superseded branch remains **preliminary**; it must be
  rerun on this valid C harness/current runtime before any E claim.
- The PASS does not authorize D entry by itself; D additionally requires judge/model
  authorization + human calibration per the reviewer's recovery order.

## 9. Gate verdict

| Gate input | Value | Required | ✓ |
|---|---|---|---|
| Unresolved capture blockers | 0 (six RECLASSIFIED, pending ratification) | 0 for non-BLOCKED | ✓ (conditional) |
| Parity mismatches | 0 | 0 | ✓ |
| stateDeltaHash both modes | present | present | ✓ |
| Failed completion checks | 0 | 0 | ✓ |
| BLOCKER findings | 0 | 0 | ✓ |

**Result: PASS — conditional on reviewer ratification of the six reclassifications.**
If the reviewer rejects any reclassification, that blocker reverts to `UNRESOLVED` and this
run's honest result is `BLOCKED` again; the artifacts already carry everything needed to
re-derive that state (`blockers.json.unresolvedCodes` recomputes from dispositions).

**STOP for review.** Next actions require reviewer direction: ratify/reject dispositions,
decide the duplicate-migration repair, then (and only then) reopen D and rerun E.
