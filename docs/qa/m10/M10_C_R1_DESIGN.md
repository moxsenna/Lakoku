# M10-C C-R1 Corrective Package — Design Contract

**Date:** 2026-08-08
**Authority:** Reviewer verdict 2026-08-08 (M10_GOVERNANCE_LEDGER.md Entry 2).
**Baseline:** main `21cb682` + recovery branch `feature/m10-c-recovery` (`d06c852`, `aa302c7`).
**Status lock honored:** production activation FORBIDDEN; production DB mutation FORBIDDEN;
no LLM calls (`NARRATIVE_PROVIDER` never `gateway`); no weakening/stubbing of production
validation; evaluators are evidence only.

This package is the reviewer-ordered narrow corrective set: #2, #3, #4, #5, #6, G4-STALE,
plus the already-completed V5-vs-V6 proof and migration forensics. Nothing else moves.

---

## Completed gates (no code)

### V5 vs V6 seam — VERIFICATION GATE closed
Read-only call-path proof (see ledger Entry 2 + recovery report §4): the current production
commercial worker terminates in `publish_generation_job_chapter_v5` (V5). V6 is an unwired
wrapper (SQL function + tests only; zero TS callers) that would wrap V5/V4 with PayCore
credit capture. The harness exercises the exact production publication chain
(claim → lease → preflight → generate → V5). The 47 ACTIVE credit reservations after
SUCCEEDED publication faithfully reproduce current production behavior (no runtime code
spends reservations); unspent-reservation cleanup is a real Phase-2B gap escalated to D/E
(D-OBS-5). No V6 port needed; preflight V6 + publication V5 concern is resolved because
V6 is not on any production path.

### Migration duplicate — HOLD (reviewer algorithm)
Byte-identical pair (SHA256 `940c4643…`): `20260805015000_living_canon_publication_primitives.sql`
(Phase 2B `a2ac23e`, merged later) vs `20260805020000_living_canon_publication_primitives.sql`
(A1d `46c68e9`, ancestor), plus version-prefix collision with
`20260805020000_story_creation_request_job_binding.sql`. CI never applies migrations.
Shared/staging application history is NOT provable from this workspace → question escalated
to reviewer/operator. No delete, no rename, no no-op until the algorithm's step 2 is answered.

---

## Fix #2 — Context-budget capture seam (REJECT → fix in C)

Reviewer: "C sendiri mewajibkan capture context-budget summary per chapter. Fix capture
seam/runtime observability di C; tidak harus DB-persisted kalau production runtime dapat
mengembalikan evidence secara deterministic."

Design: make it DB-persisted via the EXISTING `retrieval_logs` table (no migration).

1. **Runtime wiring** (`lib/runtime/continuation-context.server.ts`): after the sole
   production `compileContext(snapshot, n)` call (~line 190), call
   `persistRetrievalLog(storyId, n, packet)` — the existing best-effort writer
   (`lib/narrative/loader.ts:221`, inserts `retrieval_logs {story_id, target_chapter,
   included_ids, excluded_ids, budget_report}`). Both sync and worker modes pass through
   `loadContinuationContextForChapter`; parity preserved. Bab 1 early-returns (n≤1): no
   retrieval exists at story start by construction.
2. **Capture** (`lib/narrative-qa/harness/capture.ts`): `captureChapter` gains a
   `contextBudget` section reading `retrieval_logs` for the chapter. Bab 1 records
   `NO_RETRIEVAL_AT_STORY_START` (documented exception, not a finding).
3. **Blocker retirement:** `CONTEXT_MEMORY_BUDGET_BLOCKER` retired with evidence.
   `CONTEXT_MEMORY_PROMPT_LAYER_BLOCKER` stays — ratified to F (#1 APPROVED).

## Fix #3 — Emotional-resolution beats (formal decision)

Reviewer: B 1.1.0 already made emotional-resolution beats deterministic ending evidence;
moving to D needs explicit B contract rebaseline. → Stays in C; no rebaseline requested.

Decision (documented in `M10_C_R1_DECISION_3_BEAT_CONTRACT.md`): implement the capture
adapter per B 1.1.0 semantics — Bab 49's committed deterministic ending evidence (published
ending outcome/lock state) IS the beat evidence. `captureEndingRunway` derives
`emotionalResolutionBeatIds` for Bab 49 from the committed deterministic ending evidence
(`deterministic-ending-evidence:<endingKey>` naming), not from invented prose beats.
CHAPTER_49_EMOTIONAL_RESOLUTION_MISSING clears without evaluator-logic change. Reviewer may
veto → fallback is the rebaseline proposal (included in the decision doc).

## Fix #4 — Closure adapter: durability from canonical publication proof

Reviewer: "durability berasal dari canonical publication proof, bukan keberadaan tx-id."

`EndingLockEvidence.committedInPublicationTxId` is replaced by canonical-proof fields
(evaluator `endingRunway` 1.1.0 → 1.2.0; capture adapter in `captureEndingRunway`):

```ts
interface EndingLockEvidence {
  chapterNumber: number
  lockedEndingKey: string
  canonicalPublicationProof: {
    /** lock row present with lockedAtChapter == ENDING_LOCK_CHAPTER */
    lockAtCorrectChapter: boolean
    /** committed canon ledger row exists for ENDING_LOCK_CHAPTER */
    chapterCommittedRevision: number | null
    /** published chapters row exists for ENDING_LOCK_CHAPTER */
    chapterPublished: boolean
  } | null
}
```

DURABLE predicate = lock at correct chapter ∧ chapter committed ∧ chapter published.
Atomicity (same-tx) is proven by: (a) V3/V5 publication SQL writes lock+chapter+canon in one
function/transaction (code proof, documented in report), (b) harness fencing/tamper probes —
all 5 sync / 7 worker tamper attempts fail-closed, no torn state observable (already in
fencing.json). No tx-id required. Blocker `ENDING_LOCK_TX_BLOCKER` retired.

## Fix #5 + #6 — Runtime G1 at act boundaries (publication path)

Reviewer: publication-path call site must exist; ending reachability must be proven per act
through the production runtime.

New production seam `lib/runtime/post-publication-lifecycle.server.ts`, invoked from
`personalized-generation.ts` immediately after schema-3 publication success (the single
shared point both sync/V3 and worker/V5 pass — `defaultPublishChapterSchema3` result):

1. `insertStoryEvent(admin, storyId, type, payload)` — TS mirror of the established
   `publish_chapter_v2.sql` pattern: `seq = max(seq)+1`, retry ≤5 on unique_violation.
   Uses EXISTING `story_events` table — no migration.
2. **G4-STALE marking** (`markThreadStaleness`): UPDATE `story_threads` SET
   `stale=true, stale_since_chapter=N` WHERE story-scoped, status active
   (OPEN/DEVELOPING/PAYOFF_DUE), `stale=false`, `last_touched_chapter <= N - STALE_AFTER_CHAPTERS`
   (constant reused from `lib/narrative/threads.ts`). Structured log
   `THREAD_STALENESS_MARKED` / `THREAD_STALENESS_MARK_FAILED`. Runs after every
   canonical commit, both modes.
3. **Act-boundary reconciliation + ending reachability** (`runActBoundaryReconciliation`),
   when published chapter N is an act boundary (`contract.actPlan.find(a => a.toChapter === N)`)
   and a next act exists:
   - Fresh `loadCanonSnapshot(storyId, N)` (post-commit state).
   - `ActualState`: `threadStatuses` from snapshot threads; `storyFlags`/`clues` from
     committed facts/knowledge ids (documented mapping; no flag ledger exists yet).
   - `TrajectoryRequirement[]` from CONTRACT `chapterTargets[n].expectedThreadMovement`
     intersected with existing thread ids (production contract field; unknown ids ignored).
   - `endings`: contract `ending_candidates_json` → EndingDef mapping:
     `{id: key, isMain: !isSecret, isSecret: false, blockedByFlags: []}` plus an explicit
     `requiredClosureSatisfiable` predicate (reachable ⟺ every requiredClosure debt's
     backing thread not ABANDONED_APPROVED and debt not closed-incompatible).
   - Run production `runReconciliation` (deterministic variant — no LLM; parity preserved)
     and `checkEndingReachability` (NCS §1.4).
   - Persist `ACT_RECONCILIATION` event `{actNumber, checkpointChapter, status,
     driftByChapter, reconciledChapters, findingCodes}` and `ACT_ENDING_REACHABILITY`
     event `{actNumber, checkpointChapter, reachableMain, minRequired,
     secretReachable, requiredClosure:[{endingId, satisfiable}]}`.
   - RECONCILED → persist regenerated blueprints as new versions (`chapter_blueprints`
     insert, `version+1`, `reconciled_from_version`, `reconciliation_reason` — existing
     columns). FAILED_REVIEW_REQUIRED → event + `console.error` structured log; blueprint
     review workflow is M10-D scope (documented escalation D-OBS-6).
   - The hook NEVER throws into publication: post-commit lifecycle metadata; failures are
     loud structured logs (`POST_PUBLICATION_LIFECYCLE_FAILED`), matching the existing
     `CHECKPOINT_PUBLISHED_RECONCILIATION_NEEDED` pattern. Publication is already
     canonically committed; unwinding it would be worse. Documented in code + report.

**Capture** (`captureActBoundary`): reads the two `story_events` rows for the boundary →
`reconciliationTriggered = event exists`, `reconciliationResult = event.status`,
`endingReachability = payload summary`. Blockers `ACT_RECONCILIATION_TRIGGER_BLOCKER` and
`ACT_ENDING_REACHABILITY_BLOCKER` retired.

## Fix #7 (C-BLOCKER-7) — G4-STALE: OPTION A chosen

Reviewer option A: "implement runtime stale/touch/callback enforcement sesuai NCS +
regression + clean 1→50 rerun."

Analysis (this workspace): NCS §4.2 is fully implementable with existing surfaces —
`refreshStaleness`/`touchThread`/`validateThreadLifecycle` exist and are deterministic;
the SQL applier resets staleness on touch/transition but NOTHING marks stale
(`refreshStaleness` has zero production call sites); enforcement via Layer A
(`THREAD_STALE_UNADDRESSED` MAJOR → repair cannot fix prose-only → FAILED_REVIEW_REQUIRED)
exists but never bites because `story_threads.stale` never becomes true.

Implementation:
1. Marking = runtime side-effect #2 above (post-publication hook, both modes).
2. Enforcement = existing Layer A path (loader reads `stale` column → ThreadContext →
   `validateThreadLifecycle` → MAJOR → fail-closed). No new validation code.
3. Escalation branch ("atau dieskalasi ke checkpoint") = reconciliation at act boundaries
   (#5) receives thread statuses incl. stale flags. Documented.
4. Harness authoring-plan cadence (`harnessProposalFor`): add `main_mystery` callback
   touches at Bab 6, 18, 24, 30, 38, 44 (all active-thread gaps ≤ 6 chapters). Baseline
   policy already permits touches in the debt window (1–48) — no policy change. This is the
   planner discipline NCS §6 step 2 demands; it is a CONSEQUENCE of enforcement becoming
   real — without it the run now fails closed at Bab 22 with THREAD_STALE_UNADDRESSED
   (proven by regression test, not asserted by fiat).
5. Regression tests:
   - pure unit: staleness marking predicate (reuses `STALE_AFTER_CHAPTERS`),
   - pure unit: reconcile-input derivation (requirements/state/endings mapping),
   - DB integration (isolated local DB, harness-owned rows): mark → next chapter without
     touch → generation fails with THREAD_STALE_UNADDRESSED (Layer A).
6. NTM update: G4-STALE/G4-STATUS rows → DONE with evidence pointers (only after the clean
   rerun is green).

## What stays blocked / escalated

- `CONTEXT_MEMORY_PROMPT_LAYER_BLOCKER` → F (ratified #1).
- Full context-memory evaluator activation → F scope.
- Migration duplicate → HOLD pending reviewer/operator staging-history proof.
- V6 unspent-reservation cleanup → D/E (D-OBS-5).
- Reconciliation FAILED_REVIEW_REQUIRED review workflow → D (D-OBS-6).

## Verification gate for C-R1

1. `pnpm typecheck` + `pnpm lint` + `pnpm test:unit` green.
2. Clean worktree (reviewer: final closure run from clean worktree) — all C-R1 changes
   committed; the three pre-existing untracked paths resolved (committed or documented).
3. `pnpm m10:c:harness` full clean 1→50 sync+worker rerun:
   - 0 parity mismatches, stateDeltaHash both modes, 7/7 completion checks ×2,
   - 0 BLOCKER findings; STALE_THREAD_* findings = 0; ENDING_LOCK_NOT_DURABLE = 0;
     CHAPTER_49_EMOTIONAL_RESOLUTION_MISSING = 0,
   - `story_events` carries ACT_RECONCILIATION + ACT_ENDING_REACHABILITY per boundary,
   - `retrieval_logs` rows for Bab 2–50 both stories,
   - unresolved capture blockers = 1 (prompt layer, ratified F) → disposition gate allows.
4. Report `M10_C_R1_REPORT.md` + ledger Entry 3 + STOP for reviewer verdict.
