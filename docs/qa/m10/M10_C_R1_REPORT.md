# M10-C — C-R1 Closure Report

**Date:** 2026-08-08 (rerun finished 2026-08-07T19:16:41Z UTC)
**Branch:** `feature/m10-c-recovery` @ `e02a3a7` (C-R1 corrective package)
**C baseline:** `21cb68279eb024f9922f8b05a939d43eb2ae3e16`
**Run:** `m10-c-ceccff8be159` — artifacts at `.zcode/artifacts/m10-c/m10-c-ceccff8be159/`
**Environment:** `isolated-qa` (local Supabase, harness-owned stories only).
**Constraints honored:** no LLM calls (deterministic provider asserted; `NARRATIVE_PROVIDER` never `gateway`); no production activation; no production DB mutation; no real reader data; evaluators evidence-only; no validation weakening; no fabricated evaluator inputs.

This report closes the reviewer's ordered next step (verdict 2026-08-08, ledger Entry 2):
a **narrow C-R1 corrective package** for gaps #2, #3, #4, #5, #6, G4-STALE, plus the
V5-vs-V6 proof and migration forensics, followed by a **clean 1→50 sync+worker rerun**.

---

## 1. Verdict per reviewer gap

| Gap | Reviewer ruling | C-R1 action | Evidence |
|---|---|---|---|
| #1 prompt layers | APPROVED → F | Reclassified to M10-F scope (real-model prompt observability), `ratifiedByReviewer: true` | `blockers.json` disposition; `blocker-dispositions.ts` |
| #2 context budget | REJECTED → fix capture seam in C | Production wire + capture read-back ( §2.1 ) | retrieval_logs DB rows; captures.json `contextBudget` |
| #3 Bab-49 beats | REJECTED AS-IS → formal B-contract decision | Formal decision adopted within B 1.1.0 semantics ( §2.2 ) | `M10_C_R1_DECISION_3_BEAT_CONTRACT.md` |
| #4 ending-lock durability | CLOSE IN C if atomic proof adapter fixed | Evaluator 1.1.0 → 1.2.0 canonical publication proof ( §2.3 ) | ending-runway envelope; fencing probes |
| #5 reconciliation call site | REJECTED → C/G1 blocker | Production post-publication lifecycle hook ( §2.4 ) | story_events ACT_RECONCILIATION |
| #6 ending reachability | REJECTED → C/G1 blocker | Same hook, per-act reachability audit ( §2.4 ) | story_events ACT_ENDING_REACHABILITY |
| G4-STALE | C-BLOCKER-7 — Option A chosen | Runtime marking side-effect + unchanged fail-closed enforcement + cadence + regression ( §2.5 ) | DB regression tests; 0 STALE findings in rerun |
| V5 vs V6 | C VERIFICATION GATE | Closed in recovery report §4: worker terminates in V5; V6 unwired wrapper (zero TS callers) | ledger Entry 2; `M10_C_R1_DESIGN.md` |
| Migration duplicate | HOLD pending history proof | Forensics done; NO delete/no-op performed ( §4 ) | `tests/db/migration-version-uniqueness.test.ts` still fails by design of the HOLD |

---

## 2. What C-R1 changed (commit `e02a3a7`, 17 files)

### 2.1 #2 — context-budget capture seam
- `lib/runtime/continuation-context.server.ts` persists a `retrieval_logs` row per
  chapter (`persistRetrievalLog`, best-effort own admin client) after the sole
  production `compileContext()` call. Both sync and worker share
  `loadContinuationContextForChapter` → parity preserved.
- `captureChapter` reads the latest row per `target_chapter` into
  `ChapterCaptureV1.contextBudget` (counts + budgetReport; story-scoped ids excluded
  as provenance). Bab ≤ 1 = `NO_RETRIEVAL_AT_STORY_START`; a missing row at Bab ≥ 2
  throws (fail-closed).

### 2.2 #3 — Bab-49 emotional-resolution beat (formal decision)
- Beat id = `deterministic-ending-evidence:<lockedEndingKey>`, derived in
  `captureEndingRunway` from `reader_states.locked_ending_key` — the committed
  deterministic ending evidence by Bab 49 (ending lock written atomically at Bab 45).
  B 1.1.0 semantics; **no evaluator-logic change**; no prose synthesis.
- Formal decision: `M10_C_R1_DECISION_3_BEAT_CONTRACT.md`, including the veto
  fallback (explicit B contract rebaseline + version bump + fixture update + reviewer
  approval, with the finding reverting to open).

### 2.3 #4 — ending-lock durability from canonical publication proof
- `ending-runway` evaluator 1.1.0 → **1.2.0**: `EndingLockEvidence` now carries
  `canonicalPublicationProof { lockAtCorrectChapter, chapterCommittedRevision,
  chapterPublished }` instead of a transaction id.
- `captureEndingRunway` builds the proof from the three persisted artifacts of the
  publication commit: `ending_lock_json` (lockedAtChapter), the
  `chapter_state_commits` ledger row for Bab 45, and the published chapters row.
  Same-transaction atomicity is proven by publisher SQL inspection + harness
  fencing/tamper probes — the tx identifier was never the requirement.
- Long-horizon fixtures + `EVALUATOR_VERSIONS.endingRunway` bumped; red mutation now
  nulls the canonical proof (not a fake tx id).

### 2.4 #5/#6 — production post-publication lifecycle hook
- New `lib/runtime/post-publication-lifecycle.server.ts`, invoked from
  `lib/runtime/personalized-generation.ts` immediately after schema-3 publication
  success — the single shared point both sync/V3 and worker/V5 pass.
- At act boundaries it runs production `runReconciliation` over a fresh post-commit
  canon snapshot and persists an `ACT_RECONCILIATION` story_event, and runs
  `checkEndingReachability` + `deriveRequiredClosureSatisfiability` over real thread
  statuses and persists an `ACT_ENDING_REACHABILITY` story_event.
- Capture reads the events back verbatim (`captureActBoundary`) — never re-derived.

### 2.5 G4-STALE — Option A (runtime enforcement per NCS)
- `markThreadStaleness()` runs in the same lifecycle hook after every publication:
  deterministic UPDATE with the exact `refreshStaleness` predicate
  (gap ≥ `STALE_AFTER_CHAPTERS`=6, active statuses, idempotent). Marking executes
  after the chapter's own delta applies, so a touch cadence with max gap 6 never
  trips it; the legacy cadence (max gap 20) demonstrably violated.
- Harness cadence now touches `main_mystery` at Bab 1, 6, 12, 18, 24, 30, 32, 38, 44,
  45, 46, 47, 48 (closure → RESOLVED); fixture `expectedThreadMovement` uses the real
  debt-backed thread id.
- Enforcement chain unchanged (not weakened): `validateThreadLifecycle` →
  `THREAD_STALE_UNADDRESSED` MAJOR when `chapter - staleSinceChapter ≥
  STALE_CALLBACK_WINDOW`=3 without advancement → ≤ 2 prose-only repairs →
  `FAILED_REVIEW_REQUIRED` (`generate.ts` runLayerA, personalized v1 path carries
  real delta-derived ThreadContext per `thread-audit.ts` evidence).
- Regression: `tests/runtime/post-publication-lifecycle.test.ts` (11 tests: predicate
  boundary vs `refreshStaleness`, cadence gap ≤ 6, legacy violation, deadline math,
  act-boundary derivation, satisfiability) + `tests/db/m10-c-r1-g4-stale-enforcement.test.ts`
  (4 tests against isolated local DB: mark at gap 6, idempotency, snapshot
  propagation, MAJOR at deadline / silent with callback). All green.

### 2.6 Blocker dispositions
Five blockers CLOSED by production wiring + capture read-back proofs; prompt layer
RECLASSIFIED to M10-F with reviewer ratification #1. Full proof texts in
`lib/narrative-qa/harness/blocker-dispositions.ts` and `blockers.json`.

---

## 3. Closure rerun evidence (run `m10-c-ceccff8be159`)

Started from committed worktree at `e02a3a7` (manifest `headSha` matches),
`environment: isolated-qa`, deterministic provider.

| Gate item (design §Verification) | Expected | Observed |
|---|---|---|
| Result | PASS | **PASS** |
| Chapters | 50 sync + 50 worker | 50 + 50 (+ fork pair to Bab 12) |
| Parity mismatches | 0 | **0** (`parity.json` `mismatches: []`) |
| stateDeltaHash | present both modes | **true** (all 100 captures carry `stateDeltaHash` + `captureHash`) |
| Completion checks | 7/7 × 2, 0 failed | **7/7 × 2 passed, `failedCompletionChecks: []`** (ALL_50_CHAPTERS_PUBLISHED, CANON_REVISION_ADVANCED_ONCE_PER_CHAPTER, READER_REACHED_COMPLETION/SELESAI, ENDING_LOCKED=`ending-open`, CHECKPOINT_RESUME_EXERCISED Bab 20/33/46, PROVENANCE_TAMPER_FAILS_CLOSED, ACT_BOUNDARY_HOOKS_PROVEN) |
| Findings | 0 BLOCKER | **0 blocker / 0 high**; 542 MEDIUM deterministic-provider artifacts: 436 `EXACT_PARAGRAPH_REPETITION`, 98 `CHOICE_HISTORY_DUPLICATE_PREVIOUS`, 6 `REPEATED_CHOICE_LABEL`, 2 `REPEATED_CLOSING_STRING` |
| STALE_THREAD_* findings | 0 | **0** |
| ENDING_LOCK_NOT_DURABLE | 0 | **0** |
| CHAPTER_49_EMOTIONAL_RESOLUTION_MISSING | 0 | **0** |
| story_events per boundary | ACT_RECONCILIATION + ACT_ENDING_REACHABILITY | **DB-verified**: for each of `m10c-sync`/`m10c-worker`, 2 × ACT_RECONCILIATION (Bab 5 act 1, Bab 12 act 2, status NO_CHANGE) + 2 × ACT_ENDING_REACHABILITY (passed=true, reachableMain=2/min=2); act 3 boundary correctly null (no next act) |
| retrieval_logs Bab 2–50 | rows both stories | **DB-verified**: 49 distinct chapters 2–50 per story (52 rows sync / 51 worker — resume re-runs append; latest row wins by design); Bab 1 captured as NO_RETRIEVAL_AT_STORY_START |
| Capture blockers | only ratified prompt layer | `captureBlockers: [CONTEXT_MEMORY_PROMPT_LAYERS_UNOBSERVABLE]`, disposition RECLASSIFIED ratified #1 → `unresolvedCodes: []` |
| Fork evidence | single canon spine, no leak | `singleCanonSpine: true` both branches, `crossLeakDetected: false`, `preForkCaptureParity: true` |
| Fencing probes | tamper fails closed | sync 5 / worker 7 probes; state-delta & attempt-id & job-id tamper → PROVENANCE_CONFLICT / OWNERSHIP_LOST rejected; resume probe proves idempotent replay; completion check `violations: []` both modes |
| Evaluator versions | endingRunway 1.2.0 | manifest: `endingRunway: 1.2.0`, all others unchanged |

`workingTreeDirty: true` in the manifest is fully explained in §5 — every C-R1
code/doc change is committed at `headSha`; the flag reflects two pre-existing
untracked files that are deliberately not committed.

---

## 4. Items carried to the reviewer (not closable in C-R1)

1. **Migration duplicate HOLD** (reviewer algorithm): byte-identical pair
   `20260805015000`/`20260805020000 _living_canon_publication_primitives.sql`
   (SHA256 `940c4643…`) + prefix collision `20260805020000` ×2. **RESOLVED in §7.2
   (Gate 2)**: ledger forensics + forward-only repair `bb3287a`; fresh `supabase db
   reset` + uniqueness test now PASS. No delete/no-op was performed on assumption.
2. **#3 veto fallback**: if the reviewer rejects the formal beat decision, the path is
   the documented B contract rebaseline (version bump + fixture update + reviewer
   approval); until then the decision stands as written.
3. **test:unit suite flakiness (pre-existing) — dispositioned**: the full parallel
   suite is unstable under scheduling load at baseline. Evidence: at pre-C-R1 baseline
   (`git stash` comparison, commit `aa302c7`) the same parallel `vitest run` fails
   **20 files**; with C-R1 applied, the identical parallel command fails **1 file in
   one run and 16 files in the next** from the same code state (same suites:
   api/authoring/gateway/runtime under load). **Deterministic proof:
   `vitest run --no-file-parallelism` over all 165 files is ALL GREEN on the fresh
   post-repair environment** (includes migration-version-uniqueness 5/5 and both C-R1
   regression files). `pnpm typecheck` clean; `pnpm lint` 0 errors. The parallel
   flakiness predates C-R1 and is escalated as infra debt (not a C gate).

## 5. Pre-existing untracked paths (design gate: "committed or documented")

| Path | Resolution |
|---|---|
| `.superpowers/` | Agent tooling cache → added to `.gitignore` (committed in `e02a3a7`) |
| `docs/superpowers/plans/LAKOKU_ANTI_ABUSE_IMPLEMENTATION_PLAN.md` | **Documented only** — product proposal predating C-R1, out of scope for the narrow corrective commit |
| `scripts/canary-prod-db-e2e.ts` | **Documented only, intentionally NOT committed** — contains production wiring (prod project ref, prod base URL, canary credentials); committing it in C-R1 would violate the no-production-artifacts constraint. Belongs to a future deployment/canary stage with its own review |

## 6. Stage state and STOP

- M10-C recovery core: PASS (unchanged). M10-C stage: this rerun satisfies every gate
  item of the C-R1 design verification section; **PASS is the reviewer's to grant**.
- NTM updated: G4-STALE and G4-STATUS IN_PROGRESS → DONE with C-R1 evidence
  (personalized living-canon v1 publication path scope stated).
- M10-D / M10-E remain BLOCKED BY C until the reviewer verdict. M10-F holds ratified
  #1 scope. **No production action taken or planned.**

**STOP — awaiting reviewer verdict on M10-C.**

---

## 7. Closing-gate package (reviewer Entry 4: PASS CANDIDATE → four gates)

Reviewer verdict (ledger Entry 4) accepted the C-R1 substance and ordered four formal
closing gates. This section records their resolution. Branch
`feature/m10-c-recovery` is **pushed to origin** (`https://github.com/moxsenna/Lakoku.git`);
tip at package-completion time: see ledger Entry 5. Commits `e02a3a7` (C-R1 package),
`b45f802` (closure docs), `bb3287a` (migration repair) are all on origin and
independently inspectable.

### Gate 1 — push + V5-vs-V6 call chain conclusion

**Conclusion: the terminal publication authority of the current production commercial
worker is `publish_generation_job_chapter_v5` (V5). V6 is an unwired wrapper that
appears on no production path.** Verified call chain (exact symbols, current branch):

```text
WORKER (commercial production path):
  worker poll/claim seam
    → claimGenerationJobById()                      lib/runtime/generation-worker.ts:72
    → executeClaimedJob(claim.job, …)               lib/runtime/generation-worker.ts:81
    → generateNextPersonalizedChapter(… jobContext) lib/runtime/personalized-generation.ts
        ├─ checkpoint: upsertGenerationCheckpointFencedV2()   (personalized-generation.ts:620)
        ├─ schema-3 validated delta + Layer A/B validation
        └─ defaultPublishChapterSchema3(input)                (personalized-generation.ts:665)
             └─ input.jobContext present →
                publishGenerationJobChapterV5()     lib/runtime/checkpoint-schema-v3.ts:459
                  → SQL public.publish_generation_job_chapter_v5(…)   ← TERMINAL AUTHORITY

SYNC (personalized non-worker path):
  choice/generation route → generateNextPersonalizedChapter(… no jobContext)
    → upsertGenerationCheckpointSyncV1()            (personalized-generation.ts:643)
    → defaultPublishChapterSchema3 → publishChapterStateV3()  (personalized-generation.ts:684)
      → SQL public.publish_chapter_state_v3(…)
```

V6 evidence: `public.publish_generation_job_chapter_v6` exists only as the SQL function
defined by `supabase/migrations/20260805030000_publish_generation_job_chapter_v6.sql`
("Commercial Atomic Publisher V6 — wraps canonical narrative publication (V5 or V4)
with PayCore credit capture"). Repo-wide grep for `publishGenerationJobChapterV6` /
`publish_generation_job_chapter_v6` across `lib/` and `scripts/` (tests excluded)
returns **zero TypeScript callers** — no wrapper, no route, no worker seam invokes it.
Therefore the earlier "preflight V6 + publication V5" concern is moot: V6 is not on
any production path, and the harness exercises the exact production chain
(claim → lease → preflight → generate → V5). Unspent credit-reservation cleanup
remains the real Phase-2B gap, already escalated to D/E as D-OBS-5.

### Gate 2 — migration history resolved from `supabase_migrations.schema_migrations`

**Authoritative-source determination.** No staging/shared Supabase instance exists
anywhere in this environment: repo-wide search finds exactly one project ref
(production), no `SUPABASE_ACCESS_TOKEN`, no second linked project; production use is
forbidden for this gate without separate approval and was not used. The only
inspectable `supabase_migrations.schema_migrations` ledger is the isolated local QA
database; it is the application history applied here, and it records:

```text
20260805015000  living_canon_publication_primitives   APPLIED
20260805020000  living_canon_publication_primitives   APPLIED   (byte-identical duplicate)
20260805021000  story_creation_request_job_binding    APPLIED   (NOT 020000)
```

Git forensics corroborate: the 020000→021000 rename of the job binding was an
intentional earlier collision fix (`af71671` "fix(db): resolve migration version
timestamp collision for story creation request job binding") on a lineage that never
merged into current main; PR #53 (`a2ac23e`) re-added the 020000-named file; PR #54
(`46c68e9`, M10-A1d) added the byte-identical `020000_living_canon…` duplicate.

**Repair decision (reviewer algorithm branch 4 — ever-applied → forward-only; no
deletion without never-applied proof — here the opposite is proven).** Committed in
`bb3287a`:

1. `20260805020000_story_creation_request_job_binding.sql` →
   `20260805021000_story_creation_request_job_binding.sql` (git R100 rename): restores
   the unique version the ledger evidences as actually applied; version 020000 never
   belonged to this migration in any ledger.
2. Both `living_canon_publication_primitives` versions **kept** (both recorded
   applied; deletion would rewrite applied history). The retained `020000` duplicate
   made rerun-safe: its only non-idempotent top-level DDL — three named
   `ADD CONSTRAINT` statements — now guarded by `pg_constraint` existence checks
   (columns already `add column if not exists`; functions `create or replace`; all
   inserts live inside function bodies). Applied-once environments never re-run the
   file (version recorded); fresh environments apply 015000 then 020000 cleanly.

**Proof from a truly fresh environment (post-repair):**

- `supabase db reset` (recreate DB → apply all migrations): **all 66 migrations apply,
  zero errors**. Pre-repair the same command failed with SQLSTATE 42710
  (duplicate constraint) at `020000`.
- `tests/db/migration-version-uniqueness.test.ts`: **5/5 PASS** (pre-existing failure
  resolved; the HOLD is released by this evidence).
- `tests/db/m10-c-r1-g4-stale-enforcement.test.ts` on the fresh schema: **4/4 PASS**.

Production caveat (flagged, out of scope): the production ledger was not consulted
(forbidden). Any future production deployment of this repo must first verify its own
`schema_migrations` under separate approval; the repair is forward-only and preserves
every version recorded applied here.

### Gate 4 — fully clean worktree

The two intentionally-uncommitted pre-existing files were **moved out of the
worktree** to `../lakoku-v2-untracked-quarantine/` (outside the repository) with a
README recording origin paths and reasons (canary script carries production wiring;
anti-abuse plan is an out-of-scope product proposal). `git status` is now empty;
closure runs below execute from that fully clean tree.

### Gate 3 — double closure run on the exact same head

(Filled after both runs complete — see §7.3 results below.)

