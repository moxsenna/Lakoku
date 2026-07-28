# Full Generation Fix Completion Design

**Date:** 2026-07-29
**Status:** Approved design; implementation and release evidence incomplete
**Canonical plan:** `docs/superpowers/plans/lakoku-full-generation-fix-plan.md`
**Execution plan:** `docs/superpowers/plans/2026-07-29-full-generation-fix-completion.md`
**Production deployment / linked push:** NOT RUN

## Objective

Complete and prove durable prose-checkpoint recovery so valid prose survives every choice-stage failure. Worker publication must atomically bind checkpoint, generation job, lease, chapter, choices, outcomes, and personalized closure audit through existing V4 publication RPC family.

This design does not authorize production rollout. Worker remains OFF until vertical recovery proof, DB/race gates, and required 10/30-job programmable soak pass.

## Authority and constraints

Normative precedence follows `AGENT_RULES.md`: current amendments and narrative documents override implementation notes when they conflict. Applicable constraints:

- Preserve fixed 50-chapter spine, reveal gates, validators, consumer-safety checks, and reader-safe terminology.
- Keep provider calls, prompts, credentials, drafts, canon logic, and generation mechanics server-side.
- Never publish hard-coded generic choices after provider exhaustion.
- Never bypass atomic publication with direct chapter inserts.
- Do not edit historical migrations. Current inventory ends at `20260728040000_enqueue_contract_provenance.sql`; reserve next unused version `20260728050000` to redefine existing V4 functions additively.
- Do not push linked migrations or deploy production from this work.
- Worker-OFF legacy paths remain behaviorally unchanged.

## Required worker state flow

Canonical successful worker flow:

```text
PROSE_READY
→ RUNNING_CHOICES
→ publish_generation_job_chapter_v4
→ PUBLISHED
```

`READY_TO_PUBLISH` is not required in runtime flow. V4 may accept it only for compatibility with already persisted states.

Choice exhaustion flow:

```text
PROSE_READY or RUNNING_CHOICES
→ CHOICES_RETRY_WAIT
→ job RETRY_WAIT
→ reclaim/retry
→ reuse exact prose checkpoint
→ RUNNING_CHOICES
```

Choice failures must not delete checkpoint, publish fallback choices, or call prose provider again while checkpoint is valid and current.

## Publication boundary

V4 is worker-ON-only. Existing V2 standard and V3 personalized calls remain for legacy worker-OFF execution.

For every worker job, V4 must bind exact checkpoint using:

- same story and chapter;
- `attempt_id = generation_jobs.id`;
- `job_id = generation_jobs.id`;
- schema version 2;
- matching correlation ID, generation mode/kind, target chapter, and valid attempt provenance;
- current fenced lease owner/token.

Accepted publication source states are `PROSE_READY`, `RUNNING_CHOICES`, compatibility-only `READY_TO_PUBLISH`, and idempotent replay `PUBLISHED`.

One transaction must either complete all terminal effects or none:

- insert or confirm one chapter publication;
- persist choices and outcomes;
- persist personalized plot-debt closures when applicable;
- set exact checkpoint `PUBLISHED`;
- set generation job `SUCCEEDED`;
- release lease;
- preserve lock order and stale-worker fencing.

## Mode invariants and audit identity

### Standard

- checkpoint audit JSON and audit version are null;
- supplied closure payload is canonical empty array;
- non-null audit or non-empty closures fail closed.

### Personalized

One typed audit-V2 artifact is created after successful plot-debt validation. It contains existing audit booleans plus exact canonical `closesPlotDebts` entries `{ debtId, closureForm }`.

Artifact identity is strict:

```text
validated audit-V2 artifact
= persisted checkpoint audit artifact
= V4 closure payload source
```

Resume reads stored artifact. It does not recompute closure identity from mutable runtime state. V4 requires canonical equality between supplied closures and checkpoint artifact. Mismatch fails without publication side effects.

## Durable dispatch identity

Worker claim context must preserve persisted `triggerChoiceId` exactly through execution and central mode dispatch. Personalized generation receives stored value, including explicit null. It must not infer a different latest choice from history.

All worker and recovery entry points use central dispatcher. Continuation paths that select generators directly remain gaps until audited and corrected.

## Provider and recovery proof

Programmable vertical proof must exercise production seams, not pure counters or source inspection:

```text
prose success
→ provider A timeout
→ provider A invalid JSON/schema on bounded retry/repair
→ provider B valid choices
→ one V4 publication
```

Required assertions:

- prose provider call count is one;
- actual choice candidate order and provider identities are observed;
- retries, repair, fallback index, and workflow phases stay within budget;
- chapter publishes once;
- checkpoint/job/lease terminal tuple is consistent;
- no generic fallback choice reaches publication.

Exhaustion proof must retain checkpoint, return job to retry state, publish nothing, and resume with same prose fingerprint.

Restart proof must reclaim stale job through production recovery RPC, reject old worker publication, let new worker resume exact checkpoint, and publish once.

## Reader status

Resolution precedence:

1. published chapter returns `ready`;
2. reusable `PROSE_READY`, `RUNNING_CHOICES`, or `CHOICES_RETRY_WAIT` checkpoint returns `preparing_choices`;
3. current job queue/running state maps to reader-safe progress;
4. only current terminal attempt may return `failed`;
5. stale failures cannot override current checkpoint or chapter.

Chapter 50 remains zero-choice: no choice provider call, null prompt/choices, empty outcomes, successful atomic publication, and no reader choice section.

## Verification and soak

Required local evidence before readiness review:

- targeted Vitest suites for V4 wrapper, dispatch identity, both generators, retry/exhaustion, status, and final chapter;
- migration uniqueness check;
- local Supabase reset and all affected pgTAP tests;
- checkpoint, publication lock-order, plot-debt, V4, and recovery race scripts;
- typecheck, lint, full unit suite, build, and `git diff --check`;
- isolated programmable 10-job run at generation/choice concurrency 1/1;
- isolated programmable 30-job run at generation/choice concurrency 6/2.

Soak acceptance requires 10/10 and 30/30 eventual publication, zero prose regeneration caused by choice failure, zero duplicate or stale publication, zero manual intervention, complete restart recovery, and observed choice concurrency exactly bounded at two in reliability run.

Every matrix claim remains separated into `CODE EXISTS`, `TEST WRITTEN`, `TEST EXECUTED`, and `PRODUCTION PATH WIRED`. No row becomes `DONE` until all applicable evidence exists.

## Current release position

**COMPLETION HOLD — BLOCKERS REMAIN**

Current targeted baseline eventually passed, but vertical original-bug proof, common V4 worker wiring, stale restart proof, full DB/race gates, and 10/30-job soak are not complete. Initial targeted run also had one non-reproducible failure likely caused by Vitest mock/cache contamination; isolated/full-runtime investigation and exact rerun passed, but this remains recorded evidence rather than hidden.

Worker flag stays OFF. No production deployment, linked migration push, or production-readiness claim is permitted from this state.
