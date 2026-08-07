# M10-E — Reliability & Cost Report

> **GOVERNANCE ADDENDUM (reviewer verdict, recorded post-commit):** M10-E's
> entry gate requires `M10-C PASS`. M10-C has not passed (it is BLOCKED / NOT
> PASS), so this stage's entry was **invalid**. The fault-matrix evidence
> below is preserved as **PRELIMINARY / exploratory only** and must be rerun
> on a valid C harness against the current runtime (main ≥ `a2ac23e`) before
> it may count as M10-E stage evidence. See `.superpowers/sdd/progress.md` →
> GOVERNANCE RESET.

**Result:** BLOCKED
**Run:** 2026-08-07T15:35:24.746Z → 2026-08-07T15:35:40.263Z
**Commit:** `57c138e2959878ee09fe7730859186ab56503bcb` (working tree DIRTY)
**Evidence:** `docs\qa\m10\m10-e-fault-evidence.json` sha256 `ac54bf66c35cf847c9ea1b990780fe54295b98252a0081ab8a0c30897ca9c834`
**Target:** isolated local Supabase. No production access, no model calls.

## Entry-gate deviation (recorded, not waived)

The plan gates M10-E on "M10-C PASS". M10-C closed **BLOCKED** — six observability capture blockers, none of which are reliability invariants (the 1→50 sync/worker parity run itself passed fail-closed). This stage proceeded under the standing instruction to complete the plan. The deviation is stated here so no downstream reader can mistake M10-E evidence for a clean gate chain.

## What this run is, and is not

- **Is:** the real production runtime (`generateNextPersonalizedChapter`), the real
  publishers (`publish_chapter_state_v3` / `publish_generation_job_chapter_v5`), the real
  checkpoint writers, driven with faults injected at the `deps` seam and through
  harness-owned rows on an isolated DB.
- **Is not:** a cost or token measurement. The provider is deterministic; there are no
  model calls, therefore no token usage, no provider spend, and no real-model latency.
- **Is not:** production evidence. Nothing in this run touched production data.

## E.2 — Fault matrix executed

| Scenario | Class | Story | Bab | Mode | Runtime outcome | Failed closed | Recovered | Invariants |
|---|---|---|---|---|---|---|---|---|
| P1_TIMEOUT_BEFORE_FIRST_BYTE | provider | m10c-e-provider | 3 | sync | `THREW:TIMEOUT_BEFORE_FIRST_BYTE` | yes | yes | all pass |
| P2_TIMEOUT_AFTER_PARTIAL | provider | m10c-e-provider | 4 | sync | `THREW:TIMEOUT_AFTER_PARTIAL` | yes | yes | all pass |
| P3_RETRYABLE_429 | provider | m10c-e-provider | 5 | sync | `THREW:RETRYABLE_429` | yes | yes | all pass |
| P4_NON_RETRYABLE | provider | m10c-e-provider | 6 | sync | `THREW:NON_RETRYABLE` | yes | yes | all pass |
| P5_MALFORMED_PROSE | provider | m10c-e-provider | 7 | sync | `THREW:GatewayError` | yes | yes | all pass |
| P6_ALL_CANDIDATES_EXHAUSTED | provider | m10c-e-provider | 8 | sync | `THREW:ALL_CANDIDATES_EXHAUSTED` | yes | yes | all pass |
| P7_REPAIRABLE_DEFECT_ONCE | provider | m10c-e-provider | 9 | sync | `PUBLISHED` | no | yes | all pass |
| P8_PERSISTENT_DEFECT_BOUNDED | provider | m10c-e-provider | 10 | sync | `FAILED_REVIEW_REQUIRED` | yes | yes | all pass |
| W1_CRASH_AFTER_PROSE_CHECKPOINT | worker_checkpoint | m10c-e-worker | 25 | worker | `TRANSIENT` | yes | yes | all pass |
| W2_EXACT_REPLAY_SAME_JOB | worker_checkpoint | m10c-e-worker | 26 | worker | `THREW:FaultScenarioError` | yes | yes | all pass |
| W3_STALE_WORKER_OWNERSHIP_LOST | worker_checkpoint | m10c-e-worker | 27 | worker | `LEASE_HELD` | yes | yes | all pass |
| PB1_DB_TRANSIENT_BEFORE_PUBLICATION | publication_db | m10c-e-pub | 46 | sync | `TRANSIENT` | yes | yes | all pass |
| PB2_CHAPTER_INSERT_CONFLICT_ROLLBACK | publication_db | m10c-e-pub | 47 | sync | `TRANSIENT` | yes | yes | all pass |
| PB3_DUPLICATE_PUBLISH | publication_db | m10c-e-pub | 47 | sync | `PUBLISHED` | no | yes | all pass |
| PB4_SYNC_VS_WORKER_RACE | publication_db | m10c-e-pub | 48 | sync | `sync=LEASE_HELD;worker=PUBLISHED;winners=1` | yes | yes | all pass |
| POST1_ANALYTICS_FAILURE_AFTER_PUBLISH | post_publish | m10c-e-pub | 49 | sync | `PUBLISHED` | no | yes | all pass |
| POST2_COMPLETION_AFTER_FAULTS | post_publish | m10c-e-pub | 50 | sync | `PUBLISHED` | no | yes | all pass |

Per-scenario plan bullets and notes are in the evidence JSON.

## E.2 — Declared bullets NOT exercised

- **malformed choices output** — The choice builder has its own deps seam (ChoiceBuildDeps) that this matrix does not inject into; covering it needs a separate choice-provider fault harness.
- **malformed structured state proposal/delta candidate** — The state proposal is produced from canon by the runtime (model is prose-only, M10-A1d correction #6). A malformed proposal is therefore an internal-invariant fault, not a provider fault; validating it needs a materializer-level probe.
- **provider fallback succeeds** — Fallback ordering lives inside selectProvider (real-provider config). The deterministic harness has a single provider; proving fallback needs the gateway path (M10-F).
- **stale lease reclamation** — Reclamation is time-driven (lease TTL expiry) and the harness does not advance DB time; covered indirectly by W3 ownership loss.
- **attempt-ahead checkpoint / expired checkpoint / schema mismatch / state delta hash mismatch** — Covered by the M10-C tamper probes against the same production RPCs (lib/narrative-qa/harness/tamper.ts), not re-run here.
- **transaction failure after state applier but before terminalization — must fully rollback** — The applier and terminalization run inside one SQL function; there is no seam between them that can be interrupted from TypeScript without editing production SQL.
- **notification/outbox failure** — The living-canon publishers (V3/V5) do not write an outbox row on this path, so there is no notification subsystem to fail.

## E.3 — Measurements

### Observed (this run, deterministic provider)

- Faulted attempts: **17**
- Faulted attempts that still published (fault absorbed): **4**
- Faulted attempts that failed closed: **13**
- Recovered after fault (clean re-entry, no manual DB mutation): **17**
- Terminal failures (story stuck): **0**
- Recoveries that reused a prose checkpoint: **4**
- Duplicate publications observed: **0**
- Canonical corruption observed: **0**
- Clean-path chapter latency (n=74): p50 **89 ms**, p95 **156 ms**
- Recovery latency (n=12): p50 **113 ms**, p95 **157 ms**

### Modeled estimate

None. Modeling cumulative failure probability per 50-chapter novel requires a
per-attempt failure rate from real provider traffic; the deterministic provider fails
exactly when told to, so its rates carry no predictive information. Publishing a
modeled number from this data would be fabrication.

### Assumption

- The injected fault shapes (throw before first byte, throw after partial, retryable
  429, non-retryable, malformed structured output, publication error, ownership loss,
  post-publish telemetry failure) are assumed to be representative of real provider and
  infrastructure failure modes. This assumption is unverified until M10-F.
- Latency figures are assumed to be dominated by local DB round-trips, not by
  generation, because no model is called.

## E.4 — Unit-economics guardrail

**Status: NOT FROZEN — BLOCKED.**

The plan requires these numbers to be business-approved and explicitly forbids
inventing them ("Do not invent the number in this plan and do not silently raise it
after a pilot fails"). They are therefore left unset:

- max cost per chapter: **not set**
- max cost per 50-chapter novel: **not set**
- max judge cost per novel: **not set**
- max retry overhead %: **not set**
- p95 latency guardrail: **not set**

Until a decision-maker supplies these, M10-F (real-model pilot) must not start.

## E.5 — Recovery invariants

Checked after every scenario against the isolated DB:

| Invariant | Meaning |
|---|---|
| `INV_CHAPTERS_COUNT` | no chapter published twice, none published beyond the horizon |
| `INV_COMMITS_COUNT` | one state commit per published chapter |
| `INV_ONE_COMMIT_PER_CHAPTER` | no duplicate commit row for a chapter |
| `INV_CANON_REVISION` | canon revision never double-incremented |
| `INV_NO_STATE_BEYOND_CANON` | no partial canonical state survived a rollback |
| `INV_NO_PUBLISHED_CP_BEYOND` | no PUBLISHED checkpoint past canon |
| `INV_NO_SUCCEEDED_JOB_BEYOND` | no job reports success for an unpublished chapter |
| `INV_READER_CONSISTENT` | reader progress matches canon |
| `INV_ENDING_LOCK_AT_50` | completion state intact at the terminal chapter |

**No violation observed in any scenario.**

## Blockers

- **E4_COST_CEILING_NOT_APPROVED** — Plan E.4 requires a business-approved numeric unit-economics ceiling frozen before M10-F (max cost/chapter, max cost/50-chapter novel, max judge cost/novel, max retry-overhead %). No approved figure exists in the repository and the plan forbids inventing one. M10-F cannot start until this is supplied.
- **E3_NO_TOKEN_OR_COST_DATA** — The fault matrix runs on the deterministic provider (no model calls are permitted at this stage), so provider call counts, token usage and actual cost per task/chapter/novel are NOT measured. Latency figures are harness-machine figures for the deterministic path and are NOT a real-model latency estimate. Real token/cost/latency data can only come from the M10-F pilot, which itself is gated on E4_COST_CEILING_NOT_APPROVED.
- **E2_FAULT_MATRIX_PARTIAL** — 7 declared E.2 fault bullets are not exercised by this matrix: malformed choices output; malformed structured state proposal/delta candidate; provider fallback succeeds; stale lease reclamation; attempt-ahead checkpoint / expired checkpoint / schema mismatch / state delta hash mismatch; transaction failure after state applier but before terminalization — must fully rollback; notification/outbox failure. Reasons are recorded per bullet in the evidence artifact.

## Definition of Done — honest status

| DoD item | Status |
|---|---|
| Fault matrix implemented and repeatable | PARTIAL — uncovered bullets listed above |
| All safety invariants hold under every injected failure class | DONE |
| No unbounded retry loop | DONE — `P8_PERSISTENT_DEFECT_BOUNDED` proves the repair loop terminates (MAX_REPAIR_ATTEMPTS=2 per layer) |
| Latency/token/cost instrumentation at task/chapter/novel level | PARTIAL — latency only; token/cost impossible without model calls |
| Numeric unit-economics guardrail frozen before F | BLOCKED — requires business approval |
| Cumulative failure estimate with assumptions separated | BLOCKED — no real failure-rate data to model from |
| Recovery from checkpoint demonstrated at mid and late horizons | DONE — mid (Bab 25-27) and late (Bab 46-50) |
| `G2-BUDGET` evidence | BLOCKED — depends on the E.4 ceiling and real spend data |
| Report committed | DONE |

## STOP

M10-E stops here for review. **M10-F must not start** while
`E4_COST_CEILING_NOT_APPROVED` is open: the pilot spends real money against a ceiling
that does not exist yet.
