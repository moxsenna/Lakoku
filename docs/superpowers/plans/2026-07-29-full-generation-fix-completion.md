# Full Generation Fix Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove and complete durable prose checkpoint recovery so choice failures never regenerate valid prose, then publish worker jobs atomically through V4.

**Architecture:** Keep existing generation jobs, leases, checkpoints, mode dispatcher, and publication RPC family. Redefine existing V4 contract additively so both worker modes bind exact schema-V2 checkpoints and atomically publish chapter/checkpoint/job/lease; worker-OFF paths remain unchanged. Add vertical programmable proofs and isolated local soak before any readiness verdict.

**Tech Stack:** TypeScript 5.7, Next.js 16 App Router, Vitest 4, Supabase PostgreSQL/pgTAP, pnpm 11.

---

## File map

**Create**

- `docs/superpowers/specs/2026-07-29-full-generation-fix-completion-design.md` — approved design and constraints.
- `supabase/migrations/20260728050000_publish_generation_job_chapter_v4_common_checkpoint.sql` — additive V4/helper redefinition.
- `scripts/full-generation-worker-soak.ts` — isolated programmable 10/30-job reliability harness.
- Integration test file only if existing runtime suites cannot express whole worker flow without duplication.

**Modify**

- `docs/plans/lakoku-full-generation-fix-completion.md` — PR1–PR7 evidence and final command results.
- `supabase/tests/plot_debt_closures_functional_test.sql` — common V4 checkpoint binding and rollback cases.
- `supabase/tests/generation_job_recovery_test.sql` — stale reclamation through production RPC.
- `lib/runtime/generation-jobs.ts` — V4 input/parser/wrapper and audit V2 types.
- `lib/runtime/generation-job-execution.ts`, `generation-worker.ts`, `generation-mode.ts` — preserve `triggerChoiceId`.
- `lib/runtime/story-generation.ts` — standard worker V4; legacy unchanged; dead fallback removal.
- `lib/runtime/personalized-generation.ts` — one audit-V2 closure artifact and personalized worker V4.
- `lib/runtime/chapter-generation-checkpoint.pure.ts`, `chapter-generation-checkpoint.ts` only where V2 serialization currently blocks exact closure payload.
- `lib/runtime/choice-generation.ts` — remove dead generic fallback after call-graph proof.
- `lib/ai-gateway/gateway-provider.ts` only if candidate execution cannot be observed through existing seam.
- Existing runtime/API/provider tests named in tasks below.
- `package.json` — explicit local soak scripts.

Historical migration `supabase/migrations/20260728030000_publish_generation_job_chapter_v4.sql` stays untouched.

### Task 1: Freeze completion audit before runtime edits

**Files:**
- Modify: `docs/plans/lakoku-full-generation-fix-completion.md`
- Create: `docs/superpowers/specs/2026-07-29-full-generation-fix-completion-design.md`

- [ ] **Step 1: Record exact baseline**

Run:

```bash
git status --short --untracked-files=all
git rev-parse HEAD
git log -1 --oneline
git branch --show-current
node --version
pnpm --version
```

Observed for Task 1: HEAD `21eae2eb527e093ca8cdc976ea860cd7af789a6e`, branch `review/full-generation-fix-completion`; pre-existing untracked files were `.commandcode/taste/taste.md`, `.omo/run-continuation/ses_05585bf83ffe1bK24eIh6YDSre.json`, `docs/plans/lakoku-full-generation-fix-completion.md`, and this plan. `.commandcode` and `.omo` remain foreign and must never be staged.

- [ ] **Step 2: Read all normative sources and nested rules fully**

Read `AGENT_RULES.md`, `AGENTS.md`, relevant nested `AGENTS.md`, canonical plan, architecture, NCS, NTM, worker ops, amendments, and `package.json`. Record conflicts using docs as authority.

- [ ] **Step 3: Verify migration ordering**

Run:

```bash
pnpm run check:migration-versions
```

Observed: exit 0. Migration inventory ends at `20260728040000_enqueue_contract_provenance.sql`; no `20260728050000*` file exists. Reserve `20260728050000` as next unused version for planned additive common-checkpoint V4 redefinition.

- [ ] **Step 4: Run targeted baseline**

Run:

```bash
pnpm exec vitest run \
  tests/runtime/choice-generation-baseline.test.ts \
  tests/runtime/choice-only-resume.test.ts \
  tests/runtime/checkpoint-persistence.test.ts \
  tests/runtime/checkpoint-freshness.test.ts \
  tests/runtime/generation-worker.test.ts \
  tests/runtime/generation-job-execution.test.ts \
  tests/runtime/generation-mode-dispatch.test.ts \
  tests/runtime/personalized-generation.test.ts \
  tests/api/chapter-status.test.ts
```

Observed: initial run exited 1 with 149/150 tests. Systematic isolated and full-runtime investigation passed; failure was non-reproducible and likely Vitest mock/cache contamination. Exact targeted rerun exited 0 with 9 files/150 tests passed in 33.18s. Preserve both results in audit; green rerun does not erase transient failure.

- [ ] **Step 5: Finish audit/design docs**

Matrix must separately state `CODE EXISTS`, `TEST WRITTEN`, `TEST EXECUTED`, `PRODUCTION PATH WIRED`; PR status stays PARTIAL/MISSING where vertical or soak proof is absent. Design explicitly requires `PROSE_READY → RUNNING_CHOICES → V4 → PUBLISHED`, no required `READY_TO_PUBLISH`, worker-ON-only V4, exact audit artifact identity, and production HOLD.

- [ ] **Step 6: Self-review docs**

Search for unresolved placeholder markers, contradictory state transitions, claims without command output, and accidental deployment-readiness wording. Fix before code changes.

- [ ] **Step 7: Commit audit docs**

```bash
git add docs/plans/lakoku-full-generation-fix-completion.md docs/superpowers/specs/2026-07-29-full-generation-fix-completion-design.md docs/superpowers/plans/2026-07-29-full-generation-fix-completion.md
git commit -m "docs(generation): add full-fix completion audit and design"
```

Do not stage `.commandcode/` or `.omo/`.

### Task 2: Write failing common V4 checkpoint DB tests

**Files:**
- Modify: `supabase/tests/plot_debt_closures_functional_test.sql`

- [ ] **Step 1: Add standard RUNNING_CHOICES success fixture**

Seed worker job, ACTIVE lease, and schema-V2 checkpoint where both `attempt_id` and `job_id` equal job ID, audit pair is null, and status is `RUNNING_CHOICES`. Call existing `publish_generation_job_chapter_v4` with `p_closures := '[]'::jsonb`. Assert chapter count 1, checkpoint `PUBLISHED`, job `SUCCEEDED`, lease `RELEASED`.

- [ ] **Step 2: Add personalized matching audit-V2 success fixture**

Persist valid V2 `closesPlotDebts`; pass canonically equivalent closure payload. Assert publication and closure ledger exactly once.

- [ ] **Step 3: Add failure classification cases**

Assert exact results:

```text
standard non-null audit       CHECKPOINT_INVALID_STATE
standard non-empty closures   INVALID_CLOSURE_PAYLOAD
personalized closure mismatch CHECKPOINT_CLOSURE_PAYLOAD_MISMATCH
foreign attempt/job identity  PROVENANCE_CONFLICT
```

Also assert correlation, generation mode, target, and attempt-ahead provenance reject without chapter insert.

- [ ] **Step 4: Add accepted source/replay states**

Cover `PROSE_READY`, `RUNNING_CHOICES`, compatibility-only `READY_TO_PUBLISH`, and idempotent `PUBLISHED`. Replay must not duplicate chapter or closure rows.

- [ ] **Step 5: Add forced terminalization rollback**

Inject failure through existing test trigger/payload constraint after publication work but before terminal tuple completion. Assert chapter, checkpoint, job, lease, choices/outcomes, and closures all retain pre-call state.

- [ ] **Step 6: Run RED test**

```bash
pnpm exec supabase test db --local supabase/tests/plot_debt_closures_functional_test.sql
```

Expected: failure because current V4 skips standard checkpoint binding, rejects `RUNNING_CHOICES`, or leaves standard checkpoint nonterminal. Record exact failure.

### Task 3: Redefine V4 additively and pass DB seam tests

**Files:**
- Create: `supabase/migrations/20260728050000_publish_generation_job_chapter_v4_common_checkpoint.sql`
- Test: `supabase/tests/plot_debt_closures_functional_test.sql`

- [ ] **Step 1: Copy current function signatures and security contract**

Use `create or replace function` for existing `transition_checkpoint_published_atomic_v4` and `publish_generation_job_chapter_v4`. Preserve SECURITY DEFINER/search path/revoke/grant behavior. Do not create V5 or edit historical SQL.

- [ ] **Step 2: Bind exact checkpoint for every worker job**

Lookup must constrain story, chapter, `attempt_id = job.id`, and `job_id = job.id`. Validate schema version 2, correlation, generation mode/kind, target, and `job_attempt_number <= job.attempt_count`.

- [ ] **Step 3: Accept truthful source states**

Permit `PROSE_READY`, `RUNNING_CHOICES`, `READY_TO_PUBLISH`, and replay `PUBLISHED`. Do not make `PUBLISHED` reusable for choice generation; this acceptance belongs only to publication replay.

- [ ] **Step 4: Enforce mode invariants**

Standard requires null audit JSON/version and canonical empty closures. Personalized requires audit version 2, V2 validator success, mandatory contract provenance, and exact canonical equality between supplied closures and checkpoint `closesPlotDebts`.

- [ ] **Step 5: Terminalize atomically for both modes**

After publication proof: closure ledger where applicable, exact checkpoint `PUBLISHED`, job `SUCCEEDED`, lease `RELEASED`, all in same transaction and existing lock order.

- [ ] **Step 6: Run migration/version and DB tests**

```bash
pnpm run check:migration-versions
pnpm exec supabase db reset
pnpm exec supabase test db --local supabase/tests/plot_debt_closures_functional_test.sql
pnpm exec supabase test db --local \
  supabase/tests/checkpoint_versioning_test.sql \
  supabase/tests/generation_checkpoint_fencing_test.sql \
  supabase/tests/checkpoint_audit_signals_test.sql
```

Expected: all pgTAP plans pass; no historical migration modified.

- [ ] **Step 7: Commit DB contract**

```bash
git add supabase/migrations/20260728050000_publish_generation_job_chapter_v4_common_checkpoint.sql supabase/tests/plot_debt_closures_functional_test.sql
git commit -m "fix(generation): bind worker checkpoints in V4 publication"
```

### Task 4: Add typed V4 wrapper with TDD

**Files:**
- Modify: `tests/runtime/generation-jobs.test.ts`
- Modify: `tests/contracts/generation-job-contracts.test.ts`
- Modify: `lib/runtime/generation-jobs.ts`

- [ ] **Step 1: Write failing wrapper tests**

Require named export `publishGenerationJobChapterV4`, exact RPC name, standard `p_closures: []`, personalized exact `{ debtId, closureForm }[]`, nullable ending lock, and pre-RPC rejection of malformed closures.

- [ ] **Step 2: Run RED**

```bash
pnpm exec vitest run tests/runtime/generation-jobs.test.ts tests/contracts/generation-job-contracts.test.ts
```

Expected: missing V4 export/schema.

- [ ] **Step 3: Implement minimal wrapper**

Add exact Zod input/result schemas and `PublishGenerationJobChapterV4Input`; reuse V3 fields rather than duplicate unrelated contracts. Keep V1–V3 wrappers for legacy path.

- [ ] **Step 4: Run GREEN**

Run same command. Expected: all tests pass.

### Task 5: Preserve triggerChoiceId through durable dispatch

**Files:**
- Modify: `tests/runtime/generation-worker.test.ts`
- Modify: `tests/runtime/generation-mode-dispatch.test.ts`
- Modify: `lib/runtime/generation-job-execution.ts`
- Modify: `lib/runtime/generation-worker.ts`
- Modify: `lib/runtime/generation-mode.ts`

- [ ] **Step 1: Write discriminating failing tests**

Use `explicit triggerChoiceId = choice-A` and latest history `choice-B`; require personalized generator receives and uses `choice-A`. Also assert null remains null.

- [ ] **Step 2: Run RED**

```bash
pnpm exec vitest run tests/runtime/generation-worker.test.ts tests/runtime/generation-mode-dispatch.test.ts
```

Expected: context/dispatcher drops trigger ID.

- [ ] **Step 3: Forward exact identity**

Add `triggerChoiceId: string | null` to execution context, copy claimed job value, add dispatcher input, and pass it only to personalized generator without synthesizing latest choice.

- [ ] **Step 4: Run GREEN**

Run same command. Expected: `choice-A` observed despite `choice-B` being latest.

- [ ] **Step 5: Commit**

```bash
git add lib/runtime/generation-job-execution.ts lib/runtime/generation-worker.ts lib/runtime/generation-mode.ts tests/runtime/generation-worker.test.ts tests/runtime/generation-mode-dispatch.test.ts
git commit -m "fix(worker): preserve trigger choice identity"
```

### Task 6: Persist one personalized audit-V2 closure artifact

**Files:**
- Modify: `tests/runtime/personalized-generation.test.ts`
- Modify: `tests/runtime/checkpoint-persistence.test.ts`
- Modify: `lib/runtime/personalized-generation.ts`
- Conditional: `lib/runtime/chapter-generation-checkpoint.pure.ts`
- Conditional: `lib/runtime/chapter-generation-checkpoint.ts`

- [ ] **Step 1: Write failing identity tests**

Require audit output includes booleans plus exact `closesPlotDebts`; checkpoint audit version is 2; V4 receives same closure array; audit failure persists/publishes nothing; resumed checkpoint uses stored artifact rather than recomputing mutable state.

- [ ] **Step 2: Run RED**

```bash
pnpm exec vitest run tests/runtime/personalized-generation.test.ts tests/runtime/checkpoint-persistence.test.ts
```

Expected: current writer lacks exact closure payload or schema rejects version 2.

- [ ] **Step 3: Build one typed result**

Derive canonical closure set once from successful existing plot-debt audit. Use same typed object for `persistProseReadyCheckpoint` and later V4 call. Extend checkpoint parser/types only where current schema blocks V2; do not weaken V1 compatibility.

- [ ] **Step 4: Run GREEN**

Run same command. Expected: persisted and published closures match exactly.

### Task 7: Wire worker paths to V4, preserve legacy paths

**Files:**
- Modify: `tests/runtime/story-generation-post-publish.test.ts`
- Modify: `tests/runtime/personalized-generation.test.ts`
- Modify: `tests/runtime/generation-job-execution.test.ts`
- Modify: `lib/runtime/story-generation.ts`
- Modify: `lib/runtime/personalized-generation.ts`
- Modify: `lib/runtime/generation-job-execution.ts`

- [ ] **Step 1: Write failing path-selection tests**

With job context, both modes call V4 once and never V2/V3. Without job context, both retain existing publication contracts. Standard sends closures `[]`; personalized sends same audit artifact closures. Worker success does no post-publish checkpoint reconciliation.

- [ ] **Step 2: Run RED**

```bash
pnpm exec vitest run tests/runtime/story-generation-post-publish.test.ts tests/runtime/personalized-generation.test.ts tests/runtime/generation-job-execution.test.ts
```

Expected: worker uses V2/V3.

- [ ] **Step 3: Replace worker publication only**

Standard and personalized job-context branches call V4. Keep `PROSE_READY → RUNNING_CHOICES`; do not add `READY_TO_PUBLISH`. Remove worker-only post-publish checkpoint write because V4 owns terminalization. Keep legacy behavior untouched.

- [ ] **Step 4: Run GREEN and worker regressions**

```bash
pnpm exec vitest run \
  tests/runtime/story-generation-post-publish.test.ts \
  tests/runtime/personalized-generation.test.ts \
  tests/runtime/generation-job-execution.test.ts \
  tests/runtime/generation-worker.test.ts
```

Expected: all pass; worker success only follows V4 proof.

- [ ] **Step 5: Commit worker V4 wiring**

```bash
git add lib/runtime/generation-jobs.ts lib/runtime/story-generation.ts lib/runtime/personalized-generation.ts lib/runtime/chapter-generation-checkpoint.pure.ts lib/runtime/chapter-generation-checkpoint.ts tests/runtime/generation-jobs.test.ts tests/contracts/generation-job-contracts.test.ts tests/runtime/story-generation-post-publish.test.ts tests/runtime/personalized-generation.test.ts tests/runtime/checkpoint-persistence.test.ts tests/runtime/generation-job-execution.test.ts
git commit -m "fix(generation): publish worker jobs atomically through V4"
```

### Task 8: Remove generic fallback after call-graph proof

**Files:**
- Modify: `lib/runtime/choice-generation.ts`
- Modify: `lib/runtime/story-generation.ts`
- Modify: `tests/runtime/choice-generation.test.ts`
- Modify: `tests/runtime/choice-generation-baseline.test.ts`

- [ ] **Step 1: Prove reachability**

```bash
git grep -n -E 'fallbackChoicesFromDraft|fallbackChoicesFromDraftFn|GENERATION_CHOICES_FALLBACK_USED'
```

Expected: definitions/imports/tests only; no production caller to publication.

- [ ] **Step 2: Write regression test**

Provider exhaustion must return structured failure, move checkpoint/job to retry state through production seam, and never invoke publication with hard-coded choices.

- [ ] **Step 3: Remove dead production helper/import/wrapper**

Move only necessary fixture data into test file. Remove stale comments claiming production uses fallback.

- [ ] **Step 4: Verify no symbol and run tests**

```bash
if git grep -n -E 'fallbackChoicesFromDraft|fallbackChoicesFromDraftFn|GENERATION_CHOICES_FALLBACK_USED'; then exit 1; fi
pnpm exec vitest run tests/runtime/choice-generation.test.ts tests/runtime/choice-generation-baseline.test.ts tests/runtime/story-generation-post-publish.test.ts
```

Expected: grep empty; tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/runtime/choice-generation.ts lib/runtime/story-generation.ts tests/runtime/choice-generation.test.ts tests/runtime/choice-generation-baseline.test.ts
git commit -m "fix(choices): remove production generic fallback surface"
```

### Task 9: Prove stale reclamation and restart recovery

**Files:**
- Modify: `supabase/tests/generation_job_recovery_test.sql`
- Modify: `scripts/generation-job-recovery-race.ts`
- Modify: `tests/runtime/generation-worker.test.ts`

- [ ] **Step 1: Audit production recovery endpoint/RPC sequence**

Confirm recovery endpoint invokes stale recovery before global claim. If absent, first add failing route/runtime test and minimally wire existing RPC; do not mutate DB statuses directly in vertical test.

- [ ] **Step 2: Add stale RUNNING_CHOICES fixture**

Seed claimed RUNNING job, ACTIVE lease, exact schema-V2 checkpoint; expire heartbeat/lease through test clock fields; invoke production stale recovery RPC; claim globally as worker B.

- [ ] **Step 3: Assert old/new worker fencing**

Old token V4 call must fail without side effects. New token resumes same prose fingerprint and V4 publishes one chapter with terminal tuple.

- [ ] **Step 4: Run RED/GREEN recovery tests**

```bash
pnpm exec supabase test db --local supabase/tests/generation_job_recovery_test.sql
node scripts/run-smoke.cjs scripts/generation-job-recovery-race.ts
pnpm exec vitest run tests/runtime/generation-worker.test.ts
```

Expected: one claimant, one publication, old claimant rejected, no deadlock.

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/generation_job_recovery_test.sql scripts/generation-job-recovery-race.ts tests/runtime/generation-worker.test.ts
git commit -m "test(worker): prove stale restart resumes choices"
```

### Task 10: Prove candidate-level retry and provider fallback

**Files:**
- Modify: `tests/story-engine/choice-provider.test.ts`
- Modify: `tests/ai-gateway/gateway-provider-observability.test.ts`
- Modify: `tests/runtime/choice-generation.test.ts`
- Conditional: `lib/ai-gateway/gateway-provider.ts`

- [ ] **Step 1: Write candidate-seam sequence**

Program observations:

```text
A initial -> TIMEOUT
A continuation/retry -> INVALID_JSON
B fallbackIndex > 0 -> VALID
```

Assert provider IDs, actual call order, available workflow phase/fallback index, one prose call at vertical level, one publication, and call budget per actual request. Do not require new production `retryReason` field.

- [ ] **Step 2: Run RED**

```bash
pnpm exec vitest run tests/story-engine/choice-provider.test.ts tests/ai-gateway/gateway-provider-observability.test.ts tests/runtime/choice-generation.test.ts
```

Expected: missing observability/injection seam or fallback behavior not fully asserted.

- [ ] **Step 3: Add smallest candidate-call injection if required**

Keep seam internal and injectable through existing provider factory/dependencies. Do not replace `buildChoiceBranch`, expose prompts, or add test-only production telemetry fields.

- [ ] **Step 4: Run GREEN and commit**

Run same command; then:

```bash
git add lib/ai-gateway/gateway-provider.ts tests/story-engine/choice-provider.test.ts tests/ai-gateway/gateway-provider-observability.test.ts tests/runtime/choice-generation.test.ts
git commit -m "test(provider): prove bounded cross-provider choice fallback"
```

### Task 11: Add exact original-bug, exhaustion, status, and final-chapter proofs

**Files:**
- Modify existing production-flow runtime integration suite or create one focused test file.
- Modify: `tests/api/chapter-status.test.ts`
- Modify: `tests/reader-final-chapter.test.ts`

- [ ] **Step 1: Original bug RED test**

Run production generator/worker dependencies with programmable prose success, choice timeout/invalid then valid. Assert prose calls 1, choices >1, same fingerprint, publish 1, checkpoint `PUBLISHED`, job `SUCCEEDED`, lease `RELEASED`, reader `ready`, readable chapter, no generic fallback.

- [ ] **Step 2: Exhaustion RED test**

All choice candidates fail. Assert `CHOICES_RETRY_WAIT`, job `RETRY_WAIT`, no chapter/publication/generic choices; next attempt uses same prose and does not call prose provider.

- [ ] **Step 3: Reader-status precedence test**

Active/retryable reusable checkpoint yields `preparing_choices` before generic queued/retry status; stale failed attempt cannot override current checkpoint; chapter remains highest-priority `ready`.

- [ ] **Step 4: Final chapter test**

Production flow calls choice provider zero times, passes `choicePrompt = null`, `choices = null`, `outcomes = []`, publishes successfully, and UI hides choice section.

- [ ] **Step 5: Run focused tests**

```bash
pnpm exec vitest run \
  tests/runtime/choice-only-resume.test.ts \
  tests/runtime/personalized-generation.test.ts \
  tests/api/chapter-status.test.ts \
  tests/reader-final-chapter.test.ts
```

Include new integration file in command. Expected: all assertions pass through production functions, not pure counter simulation.

- [ ] **Step 6: Commit by concern**

Use canonical messages, separating status fix from generation tests if both production and test code change.

### Task 12: Build isolated programmable 10/30-job soak

**Files:**
- Create: `scripts/full-generation-worker-soak.ts`
- Modify: `package.json`

- [ ] **Step 1: Write deterministic harness unit tests if extraction needed**

Test fixture allocation uniqueness, percentile calculation, active/queued counters, failure schedule, and cleanup on failure.

- [ ] **Step 2: Implement isolated topology**

Use unique story+chapter or unique story per job; never violate one-active-lease policy. Force worker behavior only in local harness. Cleanup fixtures in `finally`.

- [ ] **Step 3: Program required failures**

Include timeout, rate limit, HTTP 5xx, network error, invalid JSON, schema invalid, ungrounded, non-distinct, restart after `PROSE_READY`, and duplicate recovery tick.

- [ ] **Step 4: Measure actual concurrency and reliability**

Emit max observed generation active, max choice active, queued choice count, initial/eventual rates, retries/repair/fallback, prose regeneration, checkpoint recovery, duplicate/stale publication, lease expiry, and p50/p95 choice/end-to-end latency. Emit no prose/prompts/credentials.

- [ ] **Step 5: Add explicit scripts**

```json
"soak:full-generation:10": "node scripts/run-smoke.cjs scripts/full-generation-worker-soak.ts --jobs=10 --generation-concurrency=1 --choice-concurrency=1",
"soak:full-generation:30": "node scripts/run-smoke.cjs scripts/full-generation-worker-soak.ts --jobs=30 --generation-concurrency=6 --choice-concurrency=2"
```

- [ ] **Step 6: Run baseline and reliability soak**

```bash
pnpm run soak:full-generation:10
pnpm run soak:full-generation:30
```

Expected: 10/10 and 30/30 eventual publish; prose regenerated due choice failure 0; duplicates/manual intervention/stale publishes 0; restart recovery 100%; reliability run observes generation concurrency target, choice max exactly 2 and never above 2, queued choices >0.

- [ ] **Step 7: Commit**

```bash
git add scripts/full-generation-worker-soak.ts package.json
git commit -m "test(generation): add programmable worker reliability soak"
```

### Task 13: Run full verification and finalize evidence

**Files:**
- Modify: `docs/plans/lakoku-full-generation-fix-completion.md`

- [ ] **Step 1: Run targeted aggregate**

Run all changed Vitest files. Record exact file/test/pass/fail counts.

- [ ] **Step 2: Run static/full unit gates**

```bash
pnpm typecheck
pnpm lint
pnpm run test:unit
pnpm run check:migration-versions
pnpm run build
git diff --check
```

- [ ] **Step 3: Run local DB gates**

```bash
pnpm exec supabase db reset
pnpm exec supabase test db --local
pnpm run test:db:generation-jobs
pnpm run test:db:personalized
pnpm run test:db:plot-debt-closures
```

- [ ] **Step 4: Run required race gates**

Run existing generation checkpoint fencing, publication lock order, plot-debt closure, plot-debt V4, and publish V2 race scripts through package commands.

- [ ] **Step 5: Re-run both soak gates**

```bash
pnpm run soak:full-generation:10
pnpm run soak:full-generation:30
```

- [ ] **Step 6: Complete evidence report**

For every command record command, exit code, tests, passed, failed. Add changed-file table, migration additions/modifications, reset/pgTAP/race/soak results, linked push `NOT RUN`, real remaining risks, root-cause old/new flow, exact counters and transitions.

- [ ] **Step 7: Determine verdict honestly**

Use `COMPLETION GREEN — READY FOR PRODUCTION READINESS REVIEW` only if integrated proof and soak acceptance all pass. Otherwise use `COMPLETION HOLD — BLOCKERS REMAIN`. Never claim deployment approval.

- [ ] **Step 8: Final repository check and evidence commit**

```bash
git diff --check
git status --short --untracked-files=all
git add docs/plans/lakoku-full-generation-fix-completion.md
git commit -m "docs(generation): add full-fix completion evidence"
```

Ensure `.env*`, `.commandcode/`, `.omo/`, keys, credentials, build outputs, and local Supabase temp files are not staged.
