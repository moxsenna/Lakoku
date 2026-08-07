# M10-A Subagent-Driven Development Progress Ledger

Plan: docs/superpowers/plans/M10A_STORY_BIBLE_DATAFLOW_AUDIT_PLAN.md
Branch: audit/m10-a-story-bible-dataflow
Base: b7961311cf70b91cb7245149e400075c4e454d74

## Tasks

- Task 1 (contracts + fixtures): DONE — created lib/narrative-qa/story-bible-audit-contract.ts, fixtures/long-horizon/story-bible-pressure.ts
- Task 2 (detectors lib/narrative-qa/*): DONE — 10 modules, 27 detectors, review clean (fix round: 9× PROVEN_E2E→PROVEN_READ_ONLY, PLOT_DEBT_MILESTONE_MEMORY_GAP reachable, doc path, detectorsTriggered populated)
  - Minor carry-forward: fixture ChoiceHistoryItemFixture.consequence:string vs detector ChoiceHistoryItem.consequence:string[] → Task 3 must adapt; propagation HIGH severity calibration → Task 5 report; PROGRESS_NOT_PERSISTED suppressed when per-milestone progress exists (gap fires instead)
- Task 3 (unit tests tests/narrative-qa/*): DONE — 94/94 tests, 10 files + sample-builder.ts, review clean
  - Minor carry-forward: choice-history slice test fragile (±1 char fixture change flips it); token comment arithmetic off by 1 (cosmetic)
- Task 4 (CLI scripts scripts/m10-*.ts): DONE — both scripts, 18 findings SUCCESS/HOLD exit 0, artifacts audit.json 95KB + context-pressure.json 7KB, review clean
  - Minor carry-forward: ROOT=process.cwd() cwd-dependent (ok when run from repo root); stress rows share chapter 50 (distinguishable via detectorsTriggered); writerLayer3CharLength always 0 (detector-side); scripts pin deterministic timestamp (good for reproducibility)
- Task 5 (reports docs/audits/*.md): pending
- Task 5 (reports docs/audits/*.md): DONE — 16-section DATAFLOW + 18-row RISK_REGISTER, verdict SUCCESS/HOLD (0 BLOCKER/8 HIGH/7 MEDIUM/1 LOW/2 INFO), review clean + stale-symbol fix verified grep-zero
- Task 6 (gates + diff allowlist verification): DONE — typecheck PASS; unit 1688 pass/1 skip; both smokes SUCCESS exit 0; diff-check clean; committed diff = allowlist exact (27 files/5 dirs); lint M10-A scope clean (repo-wide failure only pre-existing user file canary-prod-db-e2e.ts); final whole-branch review: ready to merge, 0 Critical/0 Important, all ledger minors triaged keep

## M10-A COMPLETE — head 13f7fe5773443efa1b4444a2f224cd6802c15fef
EXECUTION: SUCCESS | VERDICT: HOLD (0 BLOCKER / 8 HIGH / 7 MEDIUM / 1 LOW / 2 INFO = 18 findings)
Recommendation: HOLD before M10-B — 8 HIGH fixes dalam follow-up PR terpisah (bukan M10-A scope)

## M10-A/R1 AUDIT CORRECTION — head 9b2621d1 (committed), pushed origin/audit/m10-a-story-bible-dataflow
EXECUTION: SUCCESS | VERDICT: HOLD (2 BLOCKER / 7 HIGH / 7 MEDIUM / 1 LOW / 2 INFO = 19 findings)
Reviewer 10-point mandate applied:
- ADD BLOCKER LIVING_CANON_WRITEBACK_MISSING (new detector canon-writeback-audit.ts + test; publish v2/v4 no canon-delta)
- ADD BLOCKER PLOT_DEBT_EFFECTIVE_STATE_NOT_PROJECTED (ledger durable, brief/audit read contract status only); child HIGH PLOT_DEBT_PROGRESS_NOT_PERSISTED (PLOT_DEBT_MILESTONE_MEMORY_GAP folded in)
- THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED MEDIUM→HIGH (child of canon-writeback BLOCKER)
- REPLACE ENDING_LOCK_NOT_DURABLE (false claim) → MEDIUM ENDING_LOCK_LEGACY_NONATOMIC_PUBLISH (lock durable via persist_ending_lock_v1, non-atomic window)
- FIX CHOICE_HISTORY_RECENT_LOSS false positive (expectedLatest = targetChapter − 1; ch50 sample clean, no emission)
- ADD MEDIUM CHOICE_HISTORY_DUPLICATE_PREVIOUS ([...history, previousChoice] duplicate tail)
- KEEP HIGH BLUEPRINT_VERSION_RESOLUTION_DIVERGENCE
- RENAME anchor finding → GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED (HIGH ×3); DEPENDENCY_DECLARED_BUT_UNUSED retained as MEDIUM for non-anchor fields
- Act rollup DEAD_PATH_CANDIDATE MEDIUM→HIGH (25% compiler budget wasted); CONSUMER_UNPROVEN stays LOW
- Retrieval log stays INFO
- Context pressure split: COMPILER_BUDGET_PRESSURE vs writer layer-3; ADD HIGH WRITER_CONTEXT_WHOLE_SECTION_EVICTION (4800-char whole-section eviction timeline→facts→threads, verified lib/prose/prompt-engine/build-writer-prompt.ts:83-123)
- Fix: milestone writerLayer3CharLength hardcode 0 → computed from sample.writerLayer3 (stress rows 14520/16920/22920/28920); doc §13 updated
GATES (post-R1, rerun): typecheck PASS; eslint M10-A scope exit 0; unit 1705 pass/1 skip; both smokes SUCCESS exit 0; artifact 19 findings; diff vs base b796131 = 29 files/5 allowlisted dirs; CI (PR #48) success
PUSHED: origin/audit/m10-a-story-bible-dataflow, PR https://github.com/moxsenna/Lakoku/pull/48
NEXT: reviewer decision on PR #48 → M10-A1 (Living Canon State Evolution), then A2/A3/A4, then M10-B (NOT started)

## M10-A MERGED — PR #48 squash-merged to main as fe4cb11347c02776a6eedef9f5e181c2fa4062f8 (2026-08-04)
Reviewer: substance approve; 1 doc cleanup (stale header "uncommitted" → exact SHA) done in 3aba883, CI green, then squash merge.
Audit branch deleted (remote pruned; local branch removed by gh).
VERDICT: HOLD (2 BLOCKER / 7 HIGH / 7 MEDIUM / 1 LOW / 2 INFO). M10-B NOT started.
NEXT (reviewer-locked): M10-A1 Living Canon State Evolution — typed allowlisted ChapterStateDelta, canonicalize+validate (CanonSnapshot, Blueprint.allowedStateDelta, reveal gates, alias registry, thread transition rules), checkpoint stores exact delta, ATOMIC publish (chapter, choice outcomes, facts, knowledge, secrets/reveals, timeline, character states, thread touch/transitions, plot-debt progression/closures, act-rollup at boundary), Bab N+1 loadCanonSnapshot sees exact evolved state. NO proposedStateDelta: Record<string,unknown> as DB mutation. Worker/sync parity, retry/idempotency, forward-only migration/RPC. NTM stays TODO until A1/A2/A3 done (schema+runtime+fixture+metric+release gate, unit green insufficient). Reviewer will write M10-A1 implementation plan .md next.

## M10-C LONG-HORIZON HARNESS (CLOSED AS BLOCKED — see tail entry)
Plan: docs/superpowers/plans/M10_B_TO_G_EXECUTION_PLAN.md (stage C)
Branch: feature/m10-b-deterministic-evaluators
Base: 401f0f8
- C-pre (accepted-choice seam split): DONE — lib/api/personalized-choice.server.ts applyPersonalizedChoiceAuthorized extracted (uncommitted)
- C-1 (harness lib modules): WRITTEN, NOT YET EXECUTED — lib/narrative-qa/harness/{run-spec,fixture,seed,choice,capture,run}.ts + scripts/m10-c-harness{,-cli}.ts; typecheck PASS
- C-2 (execute 1..50 sync+worker on local Supabase, fix runtime defects): pending
- C-3 (gates + report + commit): pending
KNOWN BLOCKER CANDIDATES (must be reported, not simulated):
  1. CONTEXT_MEMORY_PROMPT_LAYERS_UNOBSERVABLE — buildWriterPrompt only called by gateway-provider (real model); deterministic path has no layer1a/layer3 text
  2. CONTEXT_BUDGET_NOT_PERSISTED_BY_RUNTIME — persistRetrievalLog wired into deps but zero call sites; retrieval_logs stays empty
  3. story_thread_transitions table absent — transitions derived from chapter_state_commits.state_delta_json; approvedByCheckpointId has no source

### C-2 REVIEW (task reviewer, dispatched)
Verdict: SPEC COMPLIANCE **FAIL**, TASK QUALITY **PASS**.
Global constraints all upheld (isolation non-bypassable, zero model spend, no prod mutation,
no fabricated inputs, blockers kept, no secrets/PII). Failure is DoD scope, not dishonesty.
Must-fix before gate clears:
- B1 act-boundary hooks (C.4.4) not implemented; HarnessCaptureBundle.actRollups unreferenced
- B2 "altered provenance/delta fails closed" (C.4.3) negative case absent
- B3 resume mode 'new-attempt' declared but step.mode never read -> silent contract violation
- H1 branch-fork primitive (C.4.5) absent; forkPlan validated but never used
- H2 C_BASELINE_SHA hardcoded literal, no head SHA in manifest (plan 4.5)
- H3 horizon evaluators re-run per chapter with no dedupe -> ~50x finding inflation
- H4 unchecked PostgREST reads fail OPEN (threadRows null -> ending BLOCKER disappears)
- H5 choice-policy drift check compares a pure fn against itself (structurally dead)
- Q3 headline BLOCKER ENDING_LEAVES_UNRESOLVED_THREAD is FIXTURE ARTIFACT:
  contract-persistence.server.ts:312 derives story_threads exclusively from validated.plotDebts,
  and apply_validated_chapter_state_v1 only UPDATEs (never INSERTs), so on personalized_ai every
  thread is debt-backed and the debt gates DO cover it. Fixture seeded a non-debt-backed
  'thread:conviction' it never closes. Genuine (narrow) gap exists on the AUTHORING path only
  (lib/authoring/persist.ts:96 replace_authoring_story_bible_v1 inserts arbitrary threads) ->
  file separately, do not claim it from a path M10-C never exercised.

### C-2 FIXES (all reviewer must-fix items resolved) — commit eea7de9
Every item from the C-2 review addressed in lib/narrative-qa/harness/** and
scripts/m10-c-harness.ts. No production file touched beyond the pre-approved
behavior-preserving seam split in lib/api/personalized-choice.server.ts.
- B1 act-boundary hooks: capture.ts captureActBoundary + run.ts findings
  ACT_ROLLUP_MISSING_AT_BOUNDARY (BLOCKER) / ACT_NEXT_BLUEPRINT_VERSION_MISSING
  (HIGH) + completion check ACT_BOUNDARY_HOOKS_PROVEN + artifact act-boundaries.json.
  Proven: boundaries Bab 5/12/50 rollup=true, next-act blueprint version=1.
- B2 tamper fail-closed: tamper.ts probePublicationTamper resubmits mutated
  identity/payload through the REAL checkpoint RPCs (sync_v1 / fenced_v2):
  state-delta / attempt-id / job-id tamper all REJECTED; completion check
  PROVENANCE_TAMPER_FAILS_CLOSED PASS both modes; artifact fencing.json.
- B3 new-attempt resume: run-spec HarnessResumeMode now consumed in run.ts;
  DEFAULT_RESUME_PLAN {20 same-attempt, 33 new-attempt, 46 same-attempt};
  sync new-attempt answers EXACT_REPLAY from the commit ledger (no
  double-advance, proven by CANON_REVISION_ADVANCED_ONCE_PER_CHAPTER=50);
  worker new-attempt REJECTED.
- H1 fork primitive: fork.ts rewritten to TWO ISOLATED STORIES (m10c-fork-a/b,
  both owned by harness user) because applyPersonalizedChoiceAuthorized
  requires owner_user_id === userId — two readers on one personalized story is
  not a legal production shape. Snapshot equivalence proven by pre-fork
  captureHash parity (TRUE through Bab 10), divergence on two different legal
  choices (buka-jejak vs hadap-lawan), both branches to the Bab 12 boundary
  with single canon spines, no cross-leak.
- H2 provenance: C_BASELINE_SHA = 401f0f8 (verifiable branch HEAD, was a fake
  literal) + manifest headSha/workingTreeDirty recorded at runtime (git-sha.ts).
- H3 run-once: repetition/comment horizon evaluators run once per run, not per
  chapter (finding mass 12582 -> 592).
- H4 fail-closed reads: every PostgREST read in capture.ts checks `error` and
  throws; null data can no longer suppress findings.
- H5 dead drift check removed (was comparing a pure fn against itself).
- Q3 fixture corrected: thread:conviction removed; fixture seeds only
  debt-backed threads (main_mystery, debt:a). ENDING_LEAVES_UNRESOLVED_THREAD
  BLOCKERs gone. Authoring-path gap (lib/authoring/persist.ts:96-106 inserts
  arbitrary threads; no terminal-thread gate on completion) filed as
  OUT-OF-SCOPE observation — not a defect on the exercised personalized path.
- M1 report note: CHOICE_HISTORY_DUPLICATE_PREVIOUS (98) is deterministic
  harness-policy artifact (same choice id+label accepted consecutively by design).
- M2 parity scope: PARITY_SCOPE declared (compared vs excluded + reasons),
  stateDeltaHashPresentBothModes asserted in result gate, written to parity.json.
- M3 previousDeltaHash removed; M4 blockers deduped by code; M5 HarnessCaptureBundle
  removed; run-report §4.6/§6/§7.1/§7.2 corrected in place.
GATES: typecheck PASS; pnpm lint exit 0; pnpm test:unit 1967 pass / 8 skipped
(DB tests; 2 consecutive green solo runs — one concurrent-run flake of 27 tests
not reproducible in isolation).
RUNS: 2 pre-commit runs + 2 post-commit runs on clean committed tree — all four
findingsHash identical: 41852d4cbec3769cad10d2b9c7396f754212c067e207868392f1d16388f60b9b
(plan C.6 reproducibility). Result BLOCKED by 6 honest capture blockers:
CONTEXT_MEMORY_PROMPT_LAYERS_UNOBSERVABLE, CONTEXT_BUDGET_NOT_PERSISTED_BY_RUNTIME,
EMOTIONAL_RESOLUTION_BEATS_NOT_PERSISTED, ENDING_LOCK_PUBLICATION_TX_UNOBSERVABLE,
ACT_RECONCILIATION_TRIGGER_UNOBSERVABLE, ENDING_REACHABILITY_PER_ACT_NOT_PERSISTED.
No blocker removed to force green. No model calls. No production contact.
COMMITS: eea7de9 (harness code/contracts/seam) + 57c138e (stage report +
annotated DoD). Final 2 runs on committed tree: headSha eea7de90a0b68ebc7bf09db60ede8603970c8858,
findingsHash STILL 41852d4cbec3769cad10d2b9c7396f754212c067e207868392f1d16388f60b9b
(4 identical runs total). M10-C CLOSED AS BLOCKED — STOP for review recorded
in docs/qa/m10/M10_C_HARNESS_REPORT.md. Next: M10-E (deterministic
fault-injection; D/F/G assessed after).

## M10-E RELIABILITY & COST (CLOSED AS BLOCKED — 2026-08-04)
Plan: docs/superpowers/plans/M10_B_TO_G_EXECUTION_PLAN.md (stage E)
Branch: feature/m10-b-deterministic-evaluators
- Entry-gate deviation RECORDED (not waived): plan gates E on "M10-C PASS" but
  C closed BLOCKED (6 observability capture blockers, none reliability
  invariants). Proceeded per standing user goal; deviation is stated in the
  report so no reader mistakes E evidence for a clean gate chain.
- Built (all NEW files, zero production edits):
  lib/narrative-qa/fault/deps.ts — buildProductionMirrorDeps(): rebuilds the
    module-private defaultDeps() from the same production primitives (21 direct
    imports + 7 cited mirrors) so `overrides` is the sole fault seam.
  lib/narrative-qa/fault/provider.ts — 7 faulty deterministic providers
    (throw-before-first-byte, throw-after-partial, 429, non-retryable,
    malformed prose, repairable-once defect, repair-surviving SHORT defect).
    Zero model calls in every mode.
  lib/narrative-qa/fault/invariants.ts — checkPostFaultInvariants(): 9 E.5
    recovery invariants read from the real isolated DB; accounts for declared
    fault residue (knownExtraChapterRows) and the legal reader canon+1 position.
  lib/narrative-qa/fault/scenarios.ts — runFaultMatrix(): 17 scenarios over the
    REAL runtime + real V3/V5 publishers on 4 isolated harness stories
    (m10c-e-provider/-worker/-pub/-post). Faults enter ONLY via the deps seam
    or harness-owned-row fault setup; recovery ONLY via production paths
    (finish_generation_job_attempt_v1 RETRY_WAIT, cancel_generation_job_v1,
    clean re-entry) — never a manual canon/chapter/commit mutation.
  scripts/m10-e-reliability{,-cli}.ts + package.json `m10:e:reliability`.
- RUN RESULT: BLOCKED. 17 scenarios, 0 invariant violations, 0 duplicate
  publications, 0 canonical corruption, 0 terminal failures. Checkpoint reuse
  (fromCheckpoint) proven at MID (Bab 25-27) and LATE (Bab 46-50) horizons.
  P8 proves the bounded repair loop (MAX_REPAIR_ATTEMPTS=2/layer) terminates —
  no unbounded retry. PB4 race has exactly 1 winner, loser fail-closed. POST1
  proves a post-publish analytics failure cannot roll back a valid publication.
  All stories continue after every recoverable fault without manual DB mutation;
  m10c-e-pub reaches Bab 50 SELESAI + ending lock.
- BLOCKERS (honest, recorded in report + evidence JSON):
  E4_COST_CEILING_NOT_APPROVED — plan E.4 needs a business-approved numeric
    unit-economics ceiling frozen before M10-F; plan forbids inventing it, none
    exists in repo → NOT SET. M10-F must not start until supplied.
  E3_NO_TOKEN_OR_COST_DATA — deterministic provider (no model calls permitted)
    → token/cost/real-latency unmeasurable; latency figures are local-DB-bound.
  E2_FAULT_MATRIX_PARTIAL — 7 declared E.2 bullets not exercised (malformed
    choices output; malformed state proposal/delta; provider fallback; stale
    lease reclamation; attempt-ahead/expired/schema/hash checkpoint mismatches
    (already covered by M10-C tamper probes); applier-vs-terminalization seam
    (no TS seam without editing production SQL); notification/outbox (none on
    this path)). Each reason recorded per bullet.
- Cumulative failure estimate: deliberately NOT modeled — deterministic
  failure rates carry no predictive information; publishing one would be
  fabrication (observed/modeled/assumed separation honored).
- Artifacts: docs/qa/m10/M10_E_RELIABILITY_COST_REPORT.md (result BLOCKED) +
  docs/qa/m10/m10-e-fault-evidence.json (full per-scenario evidence, sha256 in
  report). STOP for review recorded. Next: D/F/G assessment (all gated).
