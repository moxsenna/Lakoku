# M10-E E3A + E4 Reliability and Economics Design

**Date:** 2026-08-13  
**Status:** Approved architecture; R1 amended 2026-08-15; implementation not yet started
**Closure anchor preserved:** `914cf30f42d4e7f293df79e0d66c014331a696ba` (`M10-E E2 PASS / CLOSED`)

### Amendment history

- **R1 — 2026-08-15 — reviewer-authorized:** adds explicit `chapterStageExchangeabilityAssumption` authority for pooled `stageId` probabilities; freezes expected-cost comparator semantics to maximum of per-chapter means and successful-50-chapter-run conditional novel mean; separates started-attempt generation spend diagnostic; binds `novelCostConditioning = SUCCESSFUL_50_CHAPTER_RUN`; preserves judge, retry-overhead, p95, equality-pass, and E2 closure locks.

## 1. Objective

Build E3A novel-level reliability/economics aggregation and E4 cumulative reliability plus budget-policy engineering as one package. Package may prove its engineering contract while E0 business ceilings remain unresolved.

Required state after successful package execution:

```text
E3A engineering/evidence contract  PASS
E4 model contract                  PASS
engineeringGate                    PASS
budgetGate                         BLOCKED_E0_COST_CEILING_NOT_APPROVED
G2-BUDGET                          OPEN
M10-E                               OPEN
```

This package does not authorize M10-E closure, M10-F, production, or real-provider execution.

## 2. Scope

### Included

- Task, chapter, and 50-chapter novel aggregation.
- Retry, fallback, checkpoint, recovery, terminal-failure, duplicate-publication, and canonical-corruption measurements.
- Provider-call, token, pricing, and cost aggregation contracts.
- Frozen pricing-snapshot format.
- Exact decimal arithmetic.
- Observed cumulative reliability calculation.
- Seeded Monte Carlo reliability/economics model.
- Explicit assumptions and sensitivity bands.
- External E0 budget-authority contract.
- Fail-closed budget evaluation.
- Raw and normalized artifacts with canonical hashes.
- Deterministic report generation.
- Server-only telemetry adapter for authorized isolated data.
- Unit, integration, mutation, determinism, and negative tests.

### Excluded

- E1/E2 catalog, taxonomy, gate, normalization, or closure semantics changes.
- Production runtime or provider instrumentation changes.
- Real provider/model execution or claims based on unavailable real observations.
- Production/shared/linked DB access.
- Migration, RPC, or production schema changes.
- E-OPS-1 / E5.
- Numeric E0 ceilings.
- G2-BUDGET closure.
- M10-E closure or M10-F authorization.

If required telemetry cannot be read without production runtime/schema changes, adapter reports explicit `MISSING`. Implementation must not add instrumentation silently. A missing required measurement produces `HOLD` when engineering completeness cannot be proven.

## 3. Architecture

Create dedicated internal domain:

```text
lib/narrative-qa/reliability/
  contracts.ts
  decimal.ts
  measurements.ts
  aggregation.ts
  seeded-rng.ts
  cumulative-model.ts
  budget-policy.ts
  gate.ts
  normalization.ts
  artifacts.ts
  report.ts

  server/
    telemetry-adapter.server.ts
```

Add thin orchestration only after domain contracts exist:

```text
scripts/m10-e-e3a-e4.ts
scripts/m10-e-e3a-e4-cli.ts
```

Data flow:

```text
Authorized isolated DB / telemetry fixture
                │
                ▼
server-only telemetry adapter
                │
                ▼
strict observations
    │           │               │
    ▼           ▼               ▼
reliability   cost          explicit model
aggregation aggregation      assumptions
    │           │               │
    └───────────┴───────┬───────┘
                        ▼
             seeded cumulative model
                        │
             ┌──────────┴──────────┐
             ▼                     ▼
       engineeringGate         budgetGate
                                     │
                              external E0 only
```

`fault/` remains evidence-source domain. E3A/E4 consumes approved E1/E2 references or strict observations; it does not reinterpret fault-injection frequency as empirical probability.

## 4. Type-level provenance separation

Observed, modeled, assumed, pricing, and business authority use distinct types and constructors. A generic caller-controlled `{ kind: string }` object is insufficient.

Conceptual contracts:

```ts
interface ObservedValue<T> {
  provenance: 'OBSERVED'
  value: MeasurementState<T>
  observationRefs: readonly string[]
}

interface AssumedValue<T> {
  provenance: 'ASSUMPTION'
  value: T
  source: AssumptionAuthority
}

interface ModeledValue<T> {
  provenance: 'MODELED'
  value: T
  modelAuthority: ModelAuthority
  inputHash: string
}

interface PricingDerivedValue<T> {
  provenance: 'MODELED_FROM_PRICING'
  value: MeasurementState<T>
  pricingSnapshotHash: string
}

interface BusinessAuthorityValue<T> {
  provenance: 'BUSINESS_AUTHORITY'
  value: T
  approval: E0ApprovalAuthority
}
```

Public functions accept the specific provenance type they require. Model inputs cannot masquerade as observations. Budget ceilings cannot come from pricing snapshots or observed spend.

## 5. Measurement state

Every measurable surface uses explicit state:

```ts
type MeasurementState<T> =
  | { state: 'PRESENT'; value: T }
  | { state: 'MISSING'; reasonCode: MissingReasonCode; detail: string }
  | { state: 'NOT_APPLICABLE'; authority: NotApplicableAuthority }
```

Rules:

- `0 calls`, `0 tokens`, `0 failures`, or cost `0` require `PRESENT` evidence.
- `MISSING` never participates in sums as zero.
- `NOT_APPLICABLE` requires current-scope authority, not caller assertion alone.
- Partial coverage remains visible through counts and coverage ratios.
- Best-effort telemetry absence cannot prove zero calls or zero cost.

## 6. Observation contracts

### Provider-call observation

Safe projected fields only:

- run-local call alias;
- story alias;
- chapter number;
- generation kind;
- logical task/use case;
- workflow phase;
- attempt number;
- fallback index;
- provider/model policy identity;
- outcome and safe error code;
- input/output/total token counts as measurement states;
- provider actual cost as observed state;
- estimated cost as pricing-derived state;
- currency;
- cost source;
- elapsed milliseconds in raw evidence only.

Forbidden artifact fields:

- credentials or tokens;
- service-role keys;
- private URLs;
- user IDs, email, reader identity;
- production story IDs;
- story prose or titles;
- raw prompts or provider responses.

### Reliability observation

Strict unit identities support:

- task;
- chapter;
- novel;
- generation attempt;
- checkpoint/recovery action;
- publication outcome.

Observation validates identity relationships, chapter range `1..50`, token totals, attempt ordering, and currency/cost-source consistency before aggregation.

## 7. Exact decimal model

Money and percentages do not use binary floating point as authority.

Canonical decimal format:

- nonnegative base-10 string;
- no exponent notation;
- no leading `+`;
- normalized integer part with no leading zeros except zero itself;
- canonical artifacts and hashes always serialize fixed scale by domain: money exactly `8` fractional digits, probability exactly `12`, percentage exactly `6`, and latency milliseconds exactly `3`;
- canonical zero examples are money `"0.00000000"`, probability `"0.000000000000"`, percentage `"0.000000"`, and latency milliseconds `"0.000"`;
- input parsers may accept valid shorter decimals, for example money `"1.2"`, probability `"0.25"`, percentage `"5"`, or latency milliseconds `"12.345"`, then pad to the exact domain scale; canonical artifacts never emit shorter forms or trim trailing fractional zeros;
- inputs exceeding domain scale are accepted only at a contract-declared conversion boundary and rounded to domain scale;
- multiply/divide intermediate scale exactly `20`;
- rounding mode `HALF_UP`, with exact ties rounded away from zero, applies to money, probability, percentage, latency milliseconds, and every declared conversion boundary; for example, conversion of `1.234567895` to money emits `"1.23456790"`;
- aggregate exact coefficients before final output-scale rounding;
- maximum absolute coefficient `10^38 - 1` at every stored or intermediate step; overflow is `FAIL`, never saturation, truncation, or `MISSING`.

`decimal.ts` provides small dependency-free operations:

- parse and canonicalize;
- compare;
- add/subtract nonnegative values;
- multiply/divide at frozen intermediate scale and round only at declared result boundary;
- sum exact coefficients;
- ratio and percentage.

Internal representation uses `bigint` coefficient plus frozen scale. JSON artifacts serialize fixed-scale canonical strings only. Raw and normalized artifacts, authority documents, hashes, reports, golden vectors, modeled outputs, and observed aggregates use same domain serialization. Authority values must already use exact canonical scale.

Unknown and zero remain distinct:

```text
PRESENT_MONEY("0.00000000")       ≠ MISSING
PRESENT_PROBABILITY("0.000000000000") ≠ MISSING
PRESENT_PERCENTAGE("0.000000")    ≠ MISSING
PRESENT_LATENCY_MS("0.000")       ≠ MISSING
```

Mixed currencies cannot be summed. Without frozen conversion authority, mixed-currency totals produce explicit unavailable state and block relevant evaluation.

## 8. Pricing snapshot authority

Pricing snapshot is assumption authority, not observed spend.

Snapshot binds:

- schema and pricing-policy version;
- provider and exact model ID;
- currency;
- input/output prices;
- unit size;
- effective interval;
- source reference;
- frozen canonical hash.

Cost classes remain separate:

```text
providerActualCost = OBSERVED
estimatedCost      = MODELED_FROM_PRICING
budgetCeiling      = BUSINESS_AUTHORITY
```

Rules:

- Actual cost never gets replaced with estimate without changing provenance.
- Missing actual cost may coexist with pricing estimate.
- Missing both remains `MISSING`, not zero.
- Aggregate reports actual, estimated, unavailable, and coverage counts separately.
- Pricing snapshot cannot satisfy E0 approval.

## 9. Aggregation

### Execution profiles and evidence thresholds

Every execution declares exactly one profile:

```text
CONTRACT_FIXTURE
RELEASE_EVIDENCE
```

`CONTRACT_FIXTURE` proves engineering contract correctness with deterministic synthetic or isolated fixture evidence. Within one execution profile and one compatible policy stratum, observations pool by `stageId` across all eligible chapters and executions. Every stage pool requires at least `1` eligible event, and every applicable `(chapterNumber, stageId)` cell must be represented according to declared fixture topology. Complete coverage may earn `engineeringGate = PASS`; it cannot support release readiness, `G2-BUDGET` closure, or M10-E closure.

`RELEASE_EVIDENCE` uses authorized measured observations only. Within one execution profile and one compatible policy stratum, every stage pool requires at least `30` eligible events, every applicable `(chapterNumber, stageId)` cell requires at least `1` eligible event for coverage, and profile requires at least `10` complete executions of one novel from chapter `1` through chapter `50`. Per-cell minimum is `1`, not `30`. Any lower pooled denominator, unrepresented applicable cell, missing stage pool, or fewer complete novels yields `engineeringGate = HOLD` for release evidence and release readiness `HOLD`; assumptions cannot repair gap.

Policy strata cannot be mixed. Compatibility requires exact bound retry/fallback policy, topology, stage catalog, task mapping, provider/model policy, pricing snapshot, and other model-authority identities declared by contract. Multiple compatible-policy strata generate separate normalized inputs, Monte Carlo runs, artifacts, hashes, reports, gates, and budget evaluations; no cross-stratum pooling or merged model output is allowed.

These minimums are engineering evidence thresholds, not business success thresholds. Meeting them proves sample completeness for contract evaluation, not acceptable reliability, cost, retention, or unit economics.

For every stage probability, central estimate is always `OBSERVED` and pooled by `stageId` within selected profile and compatible policy stratum:

```text
centralStageFailureProbability[stageId] =
  sum(observedEligibleFailures across chapters/executions) /
  sum(observedEligibleEvents across chapters/executions)
```

Model input probability key is `stageId`, never `(chapterNumber, stageId)`. Every occurrence of same stage in chapters `1..50` uses same central pooled probability only under valid `chapterStageExchangeabilityAssumption` authority defined in §10. Per-`(chapterNumber, stageId)` failure distributions remain diagnostic and sensitivity evidence only; they cannot populate, replace, blend with, or impute pooled central probability. Strong chapter effects remain mandatory diagnostic/sensitivity findings and must be reported. Assumptions may populate sensitivity lower/upper values or explicit counterfactual scenarios only; `chapterStageExchangeabilityAssumption` authorizes reuse of measured pooled central probabilities but never supplies or repairs those probabilities. Missing or insufficient pooled central evidence or applicable-cell coverage yields `HOLD` for affected profile and stratum. Missing, malformed, hash-mismatched, unsupported-scope exchangeability authority, or evidence demonstrating an incompatible stratum yields `FAIL`.

### Dimensions

Produce deterministic aggregation at:

1. task;
2. chapter;
3. 50-chapter novel;
4. pricing/cost source;
5. provider/model policy where required for audit.

Input observations are sorted by frozen semantic key before aggregation:

```text
story alias
chapter number
generation kind
task
attempt number
fallback index
call alias
```

### Frozen task and provider-call mapping

Version-1 task mapping is topology authority:

| Stage IDs | `taskId` | Provider-call state |
|---|---|---|
| `PROSE_PRIMARY`, `PROSE_RETRY`, `PROVIDER_FALLBACK` | `CHAPTER_PROSE` | each reached node is exactly one generation provider call |
| `STRUCTURED_OUTPUT`, `STRUCTURED_RETRY` | `CHAPTER_STRUCTURED_OUTPUT` | each reached node is exactly one generation provider call |
| `CHECKPOINT_RECOVERY`, `OWNERSHIP`, `OWNERSHIP_RECOVERY`, `PUBLICATION`, `PUBLICATION_RECOVERY`, `POST_PUBLISH` | `RUNTIME_RECOVERY` | provider call is `NOT_APPLICABLE`; topology proves zero provider calls |

`RUNTIME_RECOVERY` task name groups runtime nodes for aggregation; it does not assert every grouped node is a retry or recovery. Provider-call zero for these nodes is topology evidence, not missing telemetry and not caller-supplied zero. Any task mismatch, extra/missing provider call, or `NOT_APPLICABLE` without matching frozen topology is malformed evidence and `FAIL`.

Provider-call metrics expose three non-overlapping counts:

- `generationProviderCallCount`: reached `CHAPTER_PROSE` plus `CHAPTER_STRUCTURED_OUTPUT` provider nodes;
- `judgeProviderCallCount`: sampled required judge evaluations after successful 50-chapter generation;
- `totalProviderCallCount = generationProviderCallCount + judgeProviderCallCount`.

### Reliability metrics

Every rate stores explicit numerator, denominator, and eligibility boundary. Counts store counted-event boundary. Required E.3 metrics:

| Metric | Numerator/value | Denominator | Eligibility boundary |
|---|---|---|---|
| first-attempt success rate | logical generation units whose attempt `1` succeeds | logical generation units with terminally observed attempt `1` | units reaching first generation attempt in profile scope |
| retry success rate | retried logical generation units that eventually succeed | logical generation units with at least one retry and terminal outcome | units whose attempt number exceeds `1` |
| terminal failure rate | logical generation units ending terminal failure | logical generation units with terminal outcome | units entering generation in profile scope |
| checkpoint reuse rate | recoveries resuming from exact valid prior checkpoint | eligible recovery actions with checkpoint decision observed | recovery actions after a checkpoint-bearing interruption |
| prose-regeneration-on-choice-retry rate | choice retries that invoke prose generation again | eligible choice retries | retries entered after valid prose checkpoint where choice-only retry is contractually allowed |
| ownership-loss recovery rate | ownership-loss incidents that later reach valid terminal success without manual DB mutation | ownership-loss incidents with terminal recovery outcome | incidents where active worker loses lease/heartbeat ownership before publication |
| recovery success rate | recovery actions reaching valid terminal success without manual DB mutation | recovery actions with terminal outcome | retry, checkpoint resume, stale-lease reclaim, or ownership-loss recovery actions |
| provider fallback rate | logical generation units invoking provider fallback | logical generation units eligible under bound fallback policy | units reaching provider selection where fallback policy applies |
| observed full-novel completion rate | complete valid chapter `1..50` novel executions | novel executions started at chapter `1` with terminal observed outcome | executions using one bound profile, catalog, and policy version |
| empirical chapter-stage failure distribution | reached stage executions whose finalized stage outcome is failure at `(chapter, stage)`, including later-recovered failures | eligible reached stage executions with finalized outcome at same `(chapter, stage)` | reached conditional stage nodes, reported for every chapter `1..50` and frozen stage ID; no normalization across unreached nodes |

Required counts and distributions:

- provider call counts: report `generationProviderCallCount`, `judgeProviderCallCount`, and `totalProviderCallCount`, plus generation counts by frozen `taskId`; boundary reached generation provider nodes and required sampled judge evaluations; runtime-only nodes are topology-authorized `NOT_APPLICABLE`;
- retry count by task: count attempts after attempt `1`, boundary logical task units in profile scope;
- duplicate-publication count: count publication attempts producing a second canonical publication for same story/chapter identity, boundary all publication attempts;
- canonical-corruption count: count post-operation invariant checks finding partial, mismatched, or invalid canonical state, boundary all required post-operation invariant checks;
- generation latency p50/p95: distribution of elapsed generation duration, boundary terminally observed generation units with authorized start/end timestamps;
- recovery latency p50/p95: distribution from recovery trigger timestamp through valid terminal recovery outcome, boundary successful and failed terminal recovery actions with authorized start/end timestamps;
- observed completed-novel count: count valid complete chapter `1..50` executions, boundary novel executions started at chapter `1`.

Each metric is produced per chapter and per novel where identity applies; task dimensions are added where task applies. Empty samples produce `MISSING`, never percentile or rate zero. Partial or below-profile-threshold samples retain observed values but produce profile completeness effect defined in §13.

Percentiles use modeled `percentile_cont` linear interpolation: sort `n` values ascending; rank `r = q × (n - 1)` for `q = 0.50` or `0.95`; let `i = floor(r)`, `j = ceil(r)`, and result `x[i] + (r - i) × (x[j] - x[i])`. Interpolation uses decimal intermediate scale `20`, then domain output scale and `HALF_UP`. Latency percentile output uses milliseconds scale exactly `3`; cost percentile output uses money scale exactly `8`. One value returns that value serialized at domain fixed scale. Golden vectors lock behavior.

### Economics metrics

Every E.3 economics metric stores value or numerator, denominator where applicable, and eligibility boundary:

| Metric | Value/numerator | Denominator | Eligibility boundary |
|---|---|---|---|
| input token usage by task/chapter/novel | exact sum of `PRESENT` input tokens | eligible provider calls, also reported as covered/eligible count | provider calls in selected identity scope |
| output token usage by task/chapter/novel | exact sum of `PRESENT` output tokens | eligible provider calls, also reported as covered/eligible count | provider calls in selected identity scope |
| total token usage by task/chapter/novel | exact sum of validated input plus output tokens | eligible provider calls, also reported as covered/eligible count | provider calls in selected identity scope |
| actual provider cost by task/chapter/novel | exact sum of `OBSERVED` actual costs | eligible provider calls, also reported as actual-cost-covered/eligible count | provider calls denominated in canonical currency |
| pricing-estimated cost by task/chapter/novel | exact sum of `MODELED_FROM_PRICING` costs | eligible provider calls, also reported as priced/eligible count | calls matching frozen pricing snapshot and canonical currency |
| cost coverage ratio | calls with complete applicable cost state | eligible provider calls | selected task/chapter/novel scope, reported separately for actual and pricing-estimated cost |
| first-attempt baseline cost | central modeled cost of reached `PROSE_PRIMARY` and first reached `STRUCTURED_OUTPUT` provider calls | eligible chapter generation units, with covered/eligible count | chapters entering frozen generation topology |
| retry/fallback cost | central modeled sum of reached `PROSE_RETRY`, `PROVIDER_FALLBACK`, and `STRUCTURED_RETRY` provider calls; runtime recovery nodes excluded because provider call is `NOT_APPLICABLE` | eligible chapter generation units, with covered/eligible count | chapters entering generation under bound retry/fallback policy |
| retry-overhead percentage | central modeled retry/fallback provider cost | central modeled baseline provider cost | same complete chapter generation set and canonical currency |
| expected chapter cost | arithmetic mean of complete modeled generation spend for chapter; judge excluded | count of modeled iterations that start that chapter and have complete sampled generation spend through that chapter's success or terminal failure boundary | each chapter `1..50`; `maxExpectedCostPerChapter` selects maximum of these 50 equally weighted per-chapter means, never pooled chapter observations |
| chapter cost p50/p95 | interpolated modeled generation chapter-cost sample value; judge excluded | complete modeled chapter executions in selected profile | chapter executions with complete generation provider-node costs |
| `expectedGenerationCostPerSuccessfulNovelRun` | arithmetic mean of modeled generation cost over iterations successfully completing chapters `1..50`; judge excluded | count of successful modeled 50-chapter generation iterations only | successful 50-chapter generation under bound stratum; terminally failed or partial iterations excluded |
| `expectedGenerationSpendPerStartedNovelAttempt` | arithmetic mean generation spend accumulated across all started modeled novel iterations, including partial terminal failures; judge excluded | count of all started modeled novel iterations | diagnostic only; does not compare to `maxExpectedCostPerNovel` in V1 |
| modeled judge total | sum of one sampled cost for every required judge evaluation | complete judge-plan samples after successful 50-chapter generation | exact ordered judge plan bound to model authority |
| modeled total novel cost | successful iteration generation cost plus modeled judge total in same iteration | complete successful generation iterations with complete judge samples | combined budget-applicable modeled novel costs |
| judge-evaluation cost | central modeled judge total | required judge evaluations, with priced/eligible count | judge plan bound to one successful modeled novel execution |

Unavailable counts equal eligible calls minus covered calls and remain explicit; they never alter sums by acting as zero.

Every modeled or observed arithmetic mean in this specification uses exact sum coefficients first, then divides by complete included count at intermediate scale exactly `20`, then applies `HALF_UP` once to money scale exactly `8`. Denominator, included count, excluded incomplete count, eligible count, and coverage ratio are explicit. No hidden default, pooled-observation weighting, or intermediate per-sample rounding is allowed.

Retry overhead definition:

```text
baselineCost = sampled PROSE_PRIMARY + first STRUCTURED_OUTPUT provider-call costs
retryCost    = sampled PROSE_RETRY + PROVIDER_FALLBACK + STRUCTURED_RETRY provider-call costs
retryOverheadPercentage = retryCost / baselineCost × 100
```

Edge cases:

- zero baseline plus positive retry cost: unavailable/infinite-policy condition, never zero;
- incomplete baseline or retry pricing: `MISSING`;
- complete priced baseline and no retries: retry cost `PRESENT("0.00000000")` and retry-overhead percentage `PRESENT("0.000000")`.

## 10. Reliability assumptions

Fault-injection schedule frequency is not an empirical incidence rate and cannot become a model probability.

Central model probabilities must come from `ObservedValue` measurements meeting selected profile completeness. `AssumedValue` probability inputs carrying explicit source/provenance and rationale are permitted only for sensitivity lower/upper values or separately named counterfactual scenarios. They cannot supply, replace, or repair central measured probabilities.

Pooled reuse requires distinct `chapterStageExchangeabilityAssumption` authority. Authority contract binds:

- `provenance` exactly `ASSUMPTION`;
- scope exactly one `stageId` within one exact execution profile plus compatible retry/fallback, topology, task, provider-model, and pricing-policy stratum across chapters `1..50`;
- rationale stating chapter occurrences are assumed exchangeable for central pooled hazard;
- authority version;
- source/decision reference;
- canonical authority hash.

This authority is model authority, never observed truth. It authorizes applying one separately measured pooled central hazard to chapter occurrences in its exact scope; it never substitutes for missing measured pooled central numerator, denominator, probability, profile threshold, or applicable-cell coverage. Missing, malformed, canonical-hash mismatch, unsupported scope, or evidence demonstrating observations belong to an incompatible stratum is `FAIL`. Strong chapter effects remain diagnostic/sensitivity evidence and must be reported. V1 remains valid only under explicit exchangeability assumption. Future chapter-conditioned probability model requires assumption and model version bump plus full rerun; no silent reinterpretation.

Every pooled stage probability records:

- stable `stageId` as sole model probability key and frozen catalog version;
- one execution profile and one exact compatible policy-stratum identity;
- pooled observed failure numerator and eligible-event denominator summed across eligible chapters/executions in that stratum;
- central pooled failure probability with `OBSERVED` provenance; success probability may be derived as `1 - failureProbability` but is never supplied to Monte Carlo threshold evaluation;
- profile-specific pooled minimum denominator and completeness result;
- applicable-cell coverage map showing each `(chapterNumber, stageId)` eligible count separately;
- observation and authority/source references;
- applicability and reached-node boundary;
- diagnostic per-cell values, sensitivity lower/upper values, and their provenance;
- optional counterfactual scenario ID, never merged into central output;
- exact `chapterStageExchangeabilityAssumption` version, scope, source/decision reference, and canonical hash.

Per-cell values never replace pooled central probability. Stage pools or provider/model/policy strata never merge across incompatible identities. Normalized model input, model artifact, report, tests, gate output, and acceptance evidence bind and verify same exchangeability-assumption version and hash.

Observed full-novel completion remains separately reported and never replaced by modeled completion.

## 11. Seeded cumulative model

### Authority

Model artifact binds:

- `modelVersion`;
- execution profile, exact compatible policy-stratum identity, and completeness thresholds/result;
- pooled probability input keyed only by `stageId`, plus applicable `(chapterNumber, stageId)` coverage map;
- exact `chapterStageExchangeabilityAssumption` authority version, exact scope, source/decision reference, and canonical hash for each pooled `stageId` probability;
- frozen stage-catalog version and hash;
- frozen task-mapping version and hash;
- exact `providerModelPolicyId` for model stratum;
- `topologyVersion` and canonical `topologyHash`;
- explicit independent-draw correlation `ASSUMPTION` authority;
- algorithm/method version;
- PRNG algorithm ID;
- seed encoding and seed-to-state version;
- seed;
- iteration count;
- stage-input order;
- draw order;
- numeric precision and rounding;
- percentile/confidence-band method;
- pooled `stageId` probabilities, applicable-cell coverage, and provenance;
- sensitivity bands;
- input observation hash;
- pricing snapshot hash;
- per-generation-node cost-distribution coverage, provenance, and canonical hash;
- post-novel judge-plan authority version, exact ordered `(judgeTaskId, evaluationIndex)` sequence, `providerModelPolicyId`, distribution coverage, and canonical hash;
- output/model hash.

No `Math.random()`.

### Methods

Analytical method is allowed only for independent Bernoulli completion without retries, recovery, fallback, conditional cost, or cost output. Every other topology uses Monte Carlo.

Frozen Monte Carlo contract:

- PRNG: `xoshiro128**`, algorithm version `1`;
- seed bytes: SHA-256 digest of exact UTF-8 seed string;
- initial state: four `uint32` words from digest bytes `0..15`, grouped `0..3`, `4..7`, `8..11`, `12..15`, each decoded big-endian;
- all-zero state replacement: `[0x6d2b79f5, 0, 0, 0]`;
- arithmetic: `uint32` operations, including rotations, multiplication, shifts, XOR, and truncation modulo `2^32`;
- version-1 next-word function, where `rotl(x,k) = ((x << k) | (x >>> (32-k))) mod 2^32`: output `u = rotl((s1 × 5) mod 2^32, 7) × 9 mod 2^32`; then `t = (s1 << 9) mod 2^32`; `s2 ^= s0`; `s3 ^= s1`; `s1 ^= s2`; `s0 ^= s3`; `s2 ^= t`; `s3 = rotl(s3,11)`; returned draw word is `u`;
- uniform draw: output word `u / 2^32`, range `[0,1)`;
- every Monte Carlo stage parameter named or denoted `p` is `failureProbability`, never success probability; valid `p` is in inclusive range `[0,1]` and uses canonical probability serialization at scale `12` in artifacts;
- every reached stage outcome consumes exactly one `uint32` draw `u`; node fails iff `u < floor(p × 2^32)` for `0 < p < 1`; threshold calculation uses exact decimal/integer arithmetic without binary floating point or intermediate probability rounding; `p = "1.000000000000"` always fails and `p = "0.000000000000"` never fails, with both reached cases still consuming outcome draw;
- iterations: exactly `100000`;
- chapter order: integer `1..50` ascending;
- stage order and reachability: frozen version-1 topology below;
- skipped nodes consume no outcome or cost draw.

Frozen stage catalog version `M10_E_STAGE_CATALOG_V1` and exact semantic order:

```text
01.PROSE_PRIMARY
02.PROSE_RETRY
03.PROVIDER_FALLBACK
04.CHECKPOINT_RECOVERY
05.STRUCTURED_OUTPUT
06.STRUCTURED_RETRY
07.OWNERSHIP
08.OWNERSHIP_RECOVERY
09.PUBLICATION
10.PUBLICATION_RECOVERY
11.POST_PUBLISH
```

Frozen conditional topology `topologyVersion = M10_E_TOPOLOGY_V1`:

1. Chapter begins at `PROSE_PRIMARY`.
2. `PROSE_PRIMARY` failure reaches `PROSE_RETRY` exactly once. Primary success skips retry and fallback.
3. `PROSE_RETRY` failure reaches `PROVIDER_FALLBACK` exactly once. Retry success skips fallback.
4. `PROVIDER_FALLBACK` failure reaches `CHECKPOINT_RECOVERY` exactly once. Fallback success skips checkpoint recovery.
5. `CHECKPOINT_RECOVERY` failure is terminal for chapter; success resumes after prose and reaches `STRUCTURED_OUTPUT`.
6. Any successful prose path reaches `STRUCTURED_OUTPUT`. Its failure reaches `STRUCTURED_RETRY` exactly once; retry failure is terminal, retry success continues.
7. Structured-output success reaches `OWNERSHIP`. `OWNERSHIP` failure reaches `OWNERSHIP_RECOVERY` exactly once; recovery failure is terminal, recovery success continues.
8. Ownership success reaches `PUBLICATION`. `PUBLICATION` failure reaches `PUBLICATION_RECOVERY` exactly once; recovery failure is terminal, recovery success continues.
9. Publication success reaches `POST_PUBLISH`. `POST_PUBLISH` failure is non-terminal but counted; success or failure completes chapter.
10. Chapter completes only when prose, structured output, ownership, and publication have reached success through their direct or recovery paths; `POST_PUBLISH` outcome does not change completion. A novel completes only when chapters `1..50`, in ascending order, each complete under this rule; any terminal chapter failure makes that iteration's novel incomplete and skips all later chapters and judge plan without consuming their draws.
11. `generationProviderCallCount` increments exactly once when any of `PROSE_PRIMARY`, `PROSE_RETRY`, `PROVIDER_FALLBACK`, `STRUCTURED_OUTPUT`, or `STRUCTURED_RETRY` is reached. Runtime nodes and recoveries increment no provider-call count.
12. Retry count increments when `PROSE_RETRY`, `STRUCTURED_RETRY`, `CHECKPOINT_RECOVERY`, `OWNERSHIP_RECOVERY`, or `PUBLICATION_RECOVERY` is reached. No other reached node increments retry count.

For each reached generation topology node, fixed draw order is:

```text
1. stage outcome draw
2. generation provider-cost draw only when provider-call state is applicable, after outcome is known, including failed provider nodes
```

Reached runtime-only nodes consume outcome draw but no provider-cost draw because provider-call state is topology-authorized `NOT_APPLICABLE`. Skipped nodes consume neither outcome nor cost draw.

Generation cost model rules:

- cost inputs are empirical discrete distributions keyed by `(chapterNumber, stageId, taskId, attemptClass, providerModelPolicyId)` for frozen generation provider nodes only;
- `attemptClass` is frozen as `PRIMARY`, `RETRY`, or `FALLBACK`: `PROSE_PRIMARY` and `STRUCTURED_OUTPUT` use `PRIMARY`; `PROSE_RETRY` and `STRUCTURED_RETRY` use `RETRY`; `PROVIDER_FALLBACK` uses `FALLBACK`; runtime-only nodes have no provider-cost distribution;
- `taskId` must match frozen task mapping; `providerModelPolicyId` must match exact model stratum;
- each empirical distribution entry binds canonical money cost, stable observation ID, and `OBSERVED` provenance;
- sort entries ascending by canonical numeric money value, then observation ID by UTF-8 byte order; string-lexical money ordering is forbidden because it differs from numeric ordering;
- one distinct cost draw word `c` is consumed for every reached generation provider node after its outcome draw; inverse empirical CDF selects zero-based entry `floor((c / 2^32) × n)`, equivalent to `floor(c × n / 2^32)`, from sorted `n` entries; failed provider nodes still incur this draw and sampled cost;
- pricing-derived fallback distributions are allowed only when empirical cost evidence is unavailable; every entry and distribution carries exact `MODELED_FROM_PRICING` provenance plus bound pricing-snapshot hash, and never masquerades as empirical or `OBSERVED` data;
- compatible provider/model policy strata cannot merge. Each exact `providerModelPolicyId` generates separate model input, artifact, hash, and output;
- required coverage means every generation provider-node key reachable under `M10_E_TOPOLOGY_V1` for every chapter `1..50` has one non-empty valid distribution, including nodes whose observed reach count is zero but whose model probability can make them reachable;
- missing task identity, provider/model policy identity, distribution, entry, required coverage, or valid provenance for any required key produces `HOLD`; no zero-cost default;
- generation provider-node costs aggregate by provenance class before fixed-scale final rounding;
- inverse-CDF sampling models marginal empirical provider costs only. Version 1 does not preserve observed within-chapter, cross-stage, retry-path, provider, or cross-chapter cost correlation; report and artifacts state this limitation beside independent-draw assumption.

Judge cost plan is separate frozen post-novel authority:

- authority binds plan version/hash, exact ordered `judgeTaskIds`, exact evaluation indices, currency, and exact `providerModelPolicyId` per required evaluation;
- canonical order is authority array order of `(judgeTaskId, evaluationIndex, providerModelPolicyId)`; duplicate pairs, missing indices, reordering, or unknown tasks are invalid;
- judge cost distributions are keyed by `(judgeTaskId, evaluationIndex, providerModelPolicyId)` and use same canonical money/observation-ID sorting, empirical inverse-CDF sampling, provenance separation, and pricing-snapshot binding as generation distributions;
- only after successful completion of chapters `1..50`, each iteration samples exactly one cost for every required judge evaluation in fixed authority order and increments `judgeProviderCallCount` once per evaluation;
- each judge evaluation consumes exactly one cost draw and no reliability outcome draw in E3A/E4. Judge execution reliability is out of scope; deterministic traversal of all required evaluations is explicit model `ASSUMPTION`, not observed success evidence;
- failed or incomplete generation runs skip entire judge plan and consume no judge draws;
- missing judge plan authority, task, evaluation index, provider/model policy, distribution, required coverage, or valid provenance produces `HOLD`; no zero-cost default;
- pricing-derived judge fallback distributions remain distinct `MODELED_FROM_PRICING` and cannot merge with `OBSERVED` entries;
- compatible judge provider/model strata cannot merge; different `providerModelPolicyId` bindings generate separate models and artifacts.

Per iteration and aggregate cost identities are frozen:

```text
iterationGenerationSpend = sum(all sampled generation provider-node costs reached before success or terminal failure)
successfulIterationGenerationCost = iterationGenerationSpend only when chapters 1..50 complete
modeledJudgeTotal = sum(all required judge evaluation samples after successful chapter 50)
modeledTotalNovelCost = successfulIterationGenerationCost + modeledJudgeTotal

expectedGenerationCostPerSuccessfulNovelRun =
  exact sum(successfulIterationGenerationCost) /
  count(successful modeled iterations completing chapters 1..50)

expectedGenerationSpendPerStartedNovelAttempt =
  exact sum(iterationGenerationSpend across every started modeled iteration) /
  count(all started modeled iterations)
```

`expectedGenerationCostPerSuccessfulNovelRun` is mandatory comparator for `maxExpectedCostPerNovel`; it excludes judge and all terminally failed or partial iterations from its exact conditional denominator. `expectedGenerationSpendPerStartedNovelAttempt` includes partial terminal failures and is separate diagnostic only. `modeledJudgeTotal` feeds judge comparator. `p95CostGuardrail` uses `modeledTotalNovelCost` across complete successful generation-plus-judge iterations. Every mean follows §9 exact coefficient sum, scale-20 division, and money-scale-8 `HALF_UP` rule.

Version-1 correlation contract assumes independent PRNG draws across generation nodes, chapters, and judge evaluation cost samples. This independence and deterministic judge execution are explicit `ASSUMPTION` values, appear in artifacts and reports, and are not production truth. No fixture frequency, topology shape, independence assumption, judge-success assumption, or modeled output may be claimed as measured production incidence or correlation.

Implementation must encode catalog and topology as frozen versioned authorities, reject unknown, duplicate, missing, or reordered stage IDs and invalid edges, and bind `topologyVersion` plus canonical `topologyHash` in model input and artifacts. Any catalog, topology, reachability, counter, draw-order, or attempt-class change requires new catalog/topology/model version and full rerun.

Monte Carlo produces at minimum:

- probability of completing all 50 chapters;
- probability of at least one terminal failure;
- expected retry count;
- expected `generationProviderCallCount`, `judgeProviderCallCount`, and `totalProviderCallCount`;
- each chapter `1..50` arithmetic-mean expected generation cost and their maximum, with exact successful/completed per-chapter denominators;
- `expectedGenerationCostPerSuccessfulNovelRun`, conditioned only on successful modeled iterations completing chapters `1..50`, judge excluded;
- diagnostic `expectedGenerationSpendPerStartedNovelAttempt` across all started modeled iterations including partial terminal failures;
- modeled judge total and modeled combined total novel cost by provenance class;
- p50/p95 successful modeled generation cost and combined total novel cost using §9 `percentile_cont` linear interpolation;
- lower/central/upper sensitivity results, where central uses only observed profile probabilities under bound `chapterStageExchangeabilityAssumption` authority and lower/upper may use assumed probabilities.

Outputs are always `MODELED`; they never become observed truth.

Same normalized inputs, model authority, seed, and iterations must produce byte-identical normalized output. Golden vectors freeze SHA-256 seed state, PRNG draws, conditional draw consumption, stage order, and final outputs. Algorithm changes require model-version bump and full rerun.

## 12. E0 budget authority

Contract defines five externally supplied dimensions:

```text
maxExpectedCostPerChapter
maxExpectedCostPerNovel
maxJudgeEvaluationCostPerNovel
maxRetryOverheadPercentage
p95CostGuardrail?  // optional only if approved authority omits it explicitly
```

Approved authority also binds:

- policy ID and version;
- currency;
- approval status;
- reviewer/decision reference;
- effective date;
- canonical approval artifact hash;
- superseded policy reference when applicable;
- exact pricing snapshot version and canonical hash;
- measured token-evidence schema version, observation-set version, and canonical hash;
- retry/fallback policy ID, version, and canonical hash;
- approved product unit-economics decision-basis ID, version, and canonical hash;
- `novelCostConditioning` exactly `SUCCESSFUL_50_CHAPTER_RUN` for `maxExpectedCostPerNovel`.

All four bound bases and exact novel-cost conditioning are required and hash-verified. Any absent, superseded, mismatched, or unverifiable binding makes E0 authority invalid. No default values. No inferred values. No use of current spend, pricing, or model outputs as ceilings. Pricing estimates remain `MODELED_FROM_PRICING` model inputs even when their snapshot is bound by E0; binding does not convert estimates into observations or business authority. If business later wants a ceiling on spend per started novel attempt, contract requires separate business dimension, authority/model version bump, and full rerun. V1 must not silently reinterpret `maxExpectedCostPerNovel` or `novelCostConditioning`.

Absence or unapproved authority always yields:

```text
budgetGate = BLOCKED_E0_COST_CEILING_NOT_APPROVED
```

## 13. Gate contracts

### Engineering gate

```text
PASS
FAIL
HOLD
```

`PASS` requires:

- strict contracts valid;
- source authority valid and isolated;
- deterministic aggregation complete for declared selected-profile scope and all profile thresholds met;
- decimal arithmetic and percentile contracts pass;
- observed/modeled/assumed separation preserved;
- missing values remain explicit;
- seeded model reproducible;
- sensitivity bands complete;
- raw/normalized artifact pair validates;
- required security/privacy constraints pass;
- no E1/E2 closure regression.

`FAIL` includes:

- malformed evidence;
- authority/hash mismatch, including missing, malformed, hash-mismatched, unsupported-scope `chapterStageExchangeabilityAssumption` or evidence demonstrating incompatible bound stratum;
- semantic identity conflict;
- token arithmetic inconsistency;
- decimal coefficient overflow above `10^38 - 1`;
- mixed currency incorrectly aggregated;
- non-deterministic model output;
- missing value converted to zero;
- observed/modeled/assumed provenance violation;
- artifact-pair mismatch;
- safety-counter breach.

`HOLD` includes:

- required measurement cannot be read without unauthorized instrumentation;
- required telemetry coverage missing;
- required cost unavailable;
- unresolved currency conversion;
- insufficient observed sample support where assumptions are not authorized;
- required human authority absent outside E0 budget numbers.

### Budget gate

```text
PASS
FAIL
BLOCKED_E0_COST_CEILING_NOT_APPROVED
```

All canonical comparators and ceilings use same E0 currency. Without authorized conversion to that currency, comparator is incomplete and cannot pass.

Frozen modeled and observed comparators:

| Ceiling | Mandatory central modeled comparator | Separate observed comparator when complete observations exist |
|---|---|---|
| `maxExpectedCostPerChapter` | maximum across chapters `1..50` of each chapter's arithmetic mean complete modeled generation cost; judge excluded | maximum across chapter numbers `1..50` of arithmetic mean complete observed generation costs for that chapter; judge excluded |
| `maxExpectedCostPerNovel` | `expectedGenerationCostPerSuccessfulNovelRun`: arithmetic mean modeled generation cost among iterations successfully completing chapters `1..50`; judge excluded | arithmetic mean complete observed 50-chapter generation totals among successful novel runs; judge excluded |
| `maxJudgeEvaluationCostPerNovel` | central modeled judge total sampled from exact post-novel judge plan | maximum judge cost per complete observed novel |
| `maxRetryOverheadPercentage` | central modeled retry cost divided by central modeled baseline cost, expressed as percentage | maximum retry-overhead percentage per complete observed novel |
| `p95CostGuardrail` when authority includes it | `percentile_cont(0.95)` over combined `modeledTotalNovelCost = modeledGenerationNovelCost + modeledJudgeTotal` | `percentile_cont(0.95)` over complete observed combined generation-plus-judge novel total costs |

Observed completeness boundaries:

- complete observed chapter generation cost includes every reached prose or structured generation provider call, including retry and fallback, for one chapter in canonical currency; runtime-only nodes contribute no provider cost because frozen topology marks provider call `NOT_APPLICABLE`;
- observed comparator for `maxExpectedCostPerChapter` first groups complete chapter costs by `chapterNumber`, calculates one arithmetic mean per chapter from exact sum coefficients divided by complete count, then takes maximum across chapter numbers `1..50`; this max of per-chapter means gives each chapter one comparator value and never pools observations across chapters or selects a single-sample maximum;
- complete observed 50-chapter generation total includes complete observed chapter generation costs for chapters `1..50` under one successful novel execution;
- observed comparator for `maxExpectedCostPerNovel` is arithmetic mean of complete observed 50-chapter generation totals among successful runs only; terminally failed or partial runs never enter this exact conditional denominator;
- `expectedGenerationSpendPerStartedNovelAttempt` observed diagnostic, when available, is arithmetic mean generation spend across all started observed novel attempts, including partial terminal failures, with complete spend coverage through each attempt's terminal boundary; it never compares to `maxExpectedCostPerNovel` in V1;
- complete observed judge cost includes every required judge task for one complete observed novel;
- complete observed retry overhead has complete baseline and retry cost for one complete observed novel and uses frozen ratio rules;
- complete observed novel total cost used by p95 includes complete observed 50-chapter generation total plus complete observed judge cost for same novel;
- incomplete observations are excluded from mean, max, and p95 sets, never treated as zero, and reported through included count, excluded count, eligible count, and coverage ratio; an empty complete-observation set yields no observed comparator.

Every observed mean uses exact sum coefficients, division by complete included count at intermediate scale `20`, and `HALF_UP` to money scale `8`. Comparison is exact decimal `comparator <= ceiling`; equality passes. Central modeled comparator is mandatory for every authority dimension and must be complete across all required tasks, stages, chapters, retries, fallbacks, recoveries, distributions, and pricing inputs. Missing modeled input or incomplete modeled comparator cannot produce `PASS` and yields corresponding engineering `HOLD`. Actual observed comparators stay separate and never substitute for modeled comparators. Observed mean breach for `maxExpectedCostPerChapter` or `maxExpectedCostPerNovel` yields `FAIL` only when valid E0 authority exists and comparable complete observations exist; equality passes. Observed single-sample maxima and observed maxima for these two expected ceilings remain diagnostics only and never fail expected-cost ceilings. Judge maximum, retry-overhead maximum, and p95 observed comparator rules remain unchanged and fail above valid corresponding ceilings when complete. Incomplete observations remain excluded and cannot create observed breach or pass, but included, excluded, eligible counts and coverage ratio are mandatory output. Absence or exclusion of incomplete observed values does not excuse, alter, or substitute mandatory modeled comparator.

- Missing/unapproved E0 authority produces exact blocked result.
- Valid approved authority plus every complete modeled comparator within ceiling, and every applicable present complete observed comparable within ceiling, produces `PASS`.
- Valid approved authority plus any modeled comparator above ceiling, either expected-cost observed mean above its ceiling when comparable complete observations exist, or unchanged judge-maximum/retry-maximum/p95 observed comparator above ceiling produces `FAIL`.
- Missing comparable required modeled measurement cannot produce `PASS`; engineering gate reports corresponding `HOLD`/gap.
- Pricing estimates remain `MODELED_FROM_PRICING` inputs throughout budget evaluation.

### Profile completeness and release-readiness matrix

`engineeringGate = PASS` means contract correctness for declared profile only. It never means release readiness, business success, `G2-BUDGET` closure, or M10-E closure.

| Required evidence/metric | `CONTRACT_FIXTURE` completeness | `RELEASE_EVIDENCE` completeness | Missing/below-threshold effect |
|---|---|---|---|
| Frozen stage catalog, pooled central stage probabilities, and chapter-stage exchangeability authority | within one compatible policy stratum, exact declared coverage and `>=1` eligible event per `stageId` pool; central probabilities `OBSERVED` from fixture and keyed only by `stageId`; exact scoped `chapterStageExchangeabilityAssumption` version/hash valid | within one compatible policy stratum, authorized observations and `>=30` eligible events per `stageId` pool; central probabilities `OBSERVED` and keyed only by `stageId`; exact scoped assumption version/hash valid | missing measured probability/coverage gives selected-profile/stratum `HOLD`; missing, malformed, hash-mismatched, unsupported-scope assumption or evidence of incompatible stratum gives `FAIL` |
| Applicable `(chapter, stage)` coverage | every applicable cell represented according to declared fixture topology; per-cell values diagnostic/sensitivity only | every applicable cell represented by `>=1` eligible event; no 30-per-cell requirement; per-cell values diagnostic/sensitivity only | selected-profile/stratum `engineeringGate = HOLD`; per-cell values cannot replace pooled central probability |
| Policy/provider-model strata | one exact compatible policy and provider/model stratum per model/artifact; no merging | same; multiple strata produce separate models/artifacts | mixed stratum is invalid; missing identity/coverage `HOLD` and semantic merge `FAIL` |
| Complete 50-chapter executions | fixture declares exact intended novel coverage; no release claim | `>=10` complete chapter `1..50` novel executions within same stratum | release readiness `HOLD`; release profile `engineeringGate = HOLD` |
| First-attempt success, retry success, terminal failure | numerator, denominator, eligibility boundary present | same, authorized and threshold-complete | affected metric `MISSING`; selected-profile `engineeringGate = HOLD` |
| Checkpoint reuse, prose-regeneration-on-choice-retry, ownership-loss recovery, recovery success | numerator, denominator, eligibility boundary present; `NOT_APPLICABLE` only with authority | same, authorized and threshold-complete | affected metric `MISSING`; selected-profile `engineeringGate = HOLD` |
| Frozen task mapping and provider-call counts | exact mapping; generation nodes counted once, runtime nodes topology-authorized `NOT_APPLICABLE`; `generationProviderCallCount`, `judgeProviderCallCount`, and `totalProviderCallCount` complete | same from authorized observations and judge plan | task/call mismatch `FAIL`; missing required count or judge plan `HOLD` |
| Provider fallback rate/count and retry count by task | complete for bound fixture policy and eligible tasks | complete authorized observations for bound release policy | aggregate/model incomplete; selected-profile `engineeringGate = HOLD` |
| Duplicate publication and canonical corruption counts | all declared publication attempts and invariant checks observed, including evidenced zero | all required publication attempts and invariant checks observed, including evidenced zero | safety evidence incomplete; `engineeringGate = HOLD`; positive count is `FAIL` |
| Generation latency p50/p95 and recovery latency p50/p95 | complete timestamps for declared eligible events | complete authorized timestamps for eligible events | affected percentile `MISSING`; selected-profile `engineeringGate = HOLD` |
| Empirical chapter-stage failure distribution | every applicable declared `(chapter, stage)` cell represented according to fixture topology; diagnostic/sensitivity only | every applicable cell has `>=1` eligible event and explicit eligible count; pooled stage minimum applies only to stage pool | coverage incomplete; selected-profile/stratum `engineeringGate = HOLD`; distribution cannot replace pooled central probability |
| Observed completed-novel count/rate | numerator, denominator, boundary present; fixture-only label | authorized numerator, denominator, boundary plus novel minimum | release readiness `HOLD`; no modeled substitution |
| Input/output/total tokens by task/chapter/novel | every eligible call `PRESENT` or authorized `NOT_APPLICABLE` | every eligible authorized call `PRESENT` or authorized `NOT_APPLICABLE` | economics comparator incomplete; `engineeringGate = HOLD` |
| Actual provider cost and coverage | separate `OBSERVED` state; may be `MISSING` if modeled comparator remains complete | separate authorized `OBSERVED` state and coverage | actual comparator omitted, never zero; does not replace modeled requirement |
| Pricing-estimated generation provider, retry/fallback provider, and judge costs | complete `MODELED_FROM_PRICING` inputs for all required provider-call units; runtime nodes `NOT_APPLICABLE` | complete `MODELED_FROM_PRICING` inputs bound to release policy and judge plan | budget comparator incomplete; `engineeringGate = HOLD`; budget cannot pass |
| Baseline cost, retry cost, retry-overhead percentage | complete central modeled components | complete central modeled components | budget comparator incomplete; `engineeringGate = HOLD` |
| Expected chapter generation means `1..50`, `expectedGenerationCostPerSuccessfulNovelRun`, started-attempt spend diagnostic, judge total, combined total-novel p95 | all frozen modeled comparators complete; chapter ceiling uses max of 50 per-chapter means; novel ceiling uses successful-50-chapter conditional mean; expected generation comparators exclude judge; started-attempt mean remains diagnostic; p95 uses combined successful total | same from release profile observations, exact successful-run conditioning, exact judge plan, and bound pricing; incomplete samples excluded with coverage | budget comparator incomplete; `engineeringGate = HOLD`; budget cannot pass |
| Generation provider-node cost distributions | every reachable `(chapterNumber, stageId, taskId, attemptClass, providerModelPolicyId)` generation provider key has complete empirical or distinct pricing-derived fallback distribution | same, with authorized observations and explicit pricing fallback provenance | selected-profile/stratum `engineeringGate = HOLD`; central economics model unavailable |
| Post-novel judge plan and distributions | exact ordered judge authority and every `(judgeTaskId, evaluationIndex, providerModelPolicyId)` distribution complete; judge reliability explicitly assumed/out of scope | same, with authorized inputs and explicit provenance | missing plan/task/provider/distribution `HOLD`; judge comparator and combined p95 unavailable |
| Complete observed budget comparators | chapter max-of-means and successful-novel mean use complete observations; judge/retry maxima and total p95 unchanged; incomplete excluded with coverage; fixture label prohibits release claim | same using authorized observations and frozen exact mean denominators | absent set produces no observed comparator; applicable present breach under valid E0 `FAIL`s; expected-cost observed maxima remain diagnostic only; modeled comparator remains mandatory |
| Topology, correlation, and chapter-stage exchangeability authority | frozen topology version/hash; independent draws and exact per-stage chapter exchangeability explicit `ASSUMPTION` authorities with version/hash | same; strong chapter effects reported; no production-truth claim | missing/malformed/mismatched/unsupported authority or incompatible-stratum evidence `FAIL`; unsupported rate or correlation claim `FAIL` |
| Sensitivity lower/upper and counterfactual provenance | complete where required; assumptions allowed only here | complete where required; assumptions allowed only here | model completeness `HOLD`; assumptions never repair central evidence |
| Raw/normalized artifacts, hashes, deterministic report | complete and reproducible | complete and reproducible from authorized observations | `engineeringGate = HOLD` or `FAIL` on mismatch |

Profile outcomes:

| Profile result | Engineering meaning | Release-readiness meaning |
|---|---|---|
| `CONTRACT_FIXTURE` complete and valid | may earn `engineeringGate = PASS` for contract correctness | `HOLD`; cannot support release, `G2-BUDGET`, or M10-E closure |
| `RELEASE_EVIDENCE` complete and valid | may earn `engineeringGate = PASS` for authorized release evidence | evaluated separately against all release blockers and E0; never implied by engineering PASS |
| `RELEASE_EVIDENCE` below any threshold | `engineeringGate = HOLD` | `HOLD` |
| Any safety breach, malformed evidence, authority/hash mismatch, overflow, or deterministic mismatch | `engineeringGate = FAIL` | `BLOCKED` |

### Overall M10-E

No mapping may turn:

```text
engineeringGate = PASS
budgetGate      = BLOCKED_E0_COST_CEILING_NOT_APPROVED
```

into M10-E PASS. E-OPS-1/E5 remains independent blocker.

## 14. Artifacts and normalization

Use E2-style raw/normalized pair without changing E2 code.

Artifacts bind:

- schema versions;
- execution profile, exact policy/provider-model stratum, and profile-completeness result;
- pooled `stageId` probability inputs plus applicable-cell coverage;
- exact `chapterStageExchangeabilityAssumption` authorities, scopes, versions, source/decision references, and canonical hashes;
- frozen stage-catalog version and hash;
- frozen task-mapping version and hash;
- `topologyVersion` and canonical `topologyHash`;
- post-novel judge-plan authority and canonical hash;
- independent-draw correlation assumption authority;
- base Git SHA and dirty state;
- source authority;
- pricing snapshot hash;
- observation hash;
- aggregate hash;
- model authority and model hash;
- all 50 modeled and observed per-chapter mean values and exact denominators, `maxExpectedCostPerChapter` comparator, `expectedGenerationCostPerSuccessfulNovelRun` with successful-run denominator, and modeled/observed `expectedGenerationSpendPerStartedNovelAttempt` diagnostics with all-started-attempt denominator and incomplete coverage;
- budget authority hash or explicit absence, including exact `novelCostConditioning`;
- engineering and budget gates;
- ordered reason codes;
- report hash.

Normalization is path-specific:

- remove raw timestamps and elapsed runtime only at declared operational paths;
- alias operational IDs while preserving equality/mismatch graphs;
- preserve monetary values, currencies, pricing identities, chapter/task identity, probability inputs, exact mean conditioning/denominators, `chapterStageExchangeabilityAssumption` versions/hashes/scopes, assumptions, and authority timestamps;
- preserve array order only where contract declares it semantic; otherwise sort before serialization.

Raw/normalized validator recomputes:

- strict schemas;
- aggregation;
- model output;
- gate results;
- canonical hashes.

It does not trust embedded verdicts or hashes.

Physical artifact identity separates execution instance from semantic evidence hash to avoid same-content directory collision.

## 15. Report

Generate deterministic `docs/qa/m10/M10_E_RELIABILITY_COST_REPORT.md` content from validated artifact data.

Report sections:

1. scope and authority;
2. observed reliability;
3. observed token/cost coverage;
4. pricing-derived estimates;
5. assumptions;
6. modeled cumulative reliability;
7. sensitivity bands;
8. engineering gate;
9. E0 budget status;
10. blockers and gaps;
11. prohibited claims.

Every value displays provenance. Report must say:

```text
engineeringGate = PASS  // when earned
budgetGate = BLOCKED_E0_COST_CEILING_NOT_APPROVED
G2-BUDGET = OPEN
M10-E = OPEN
```

until E0 approval exists.

Report cannot claim real-provider economics when input fixture is synthetic or isolated. `CONTRACT_FIXTURE` data proves plumbing, arithmetic, determinism, and engineering contract correctness only. Report shows pooled stage probabilities and per-cell coverage separately, binds and displays every `chapterStageExchangeabilityAssumption` version/hash/scope/source, states exchangeability is model authority rather than observed truth, reports strong chapter effects as diagnostic/sensitivity findings, never presents diagnostic per-cell probabilities as central model inputs, and never merges policy/provider-model strata. Report also shows 50 modeled and observed per-chapter mean denominators, maximum of per-chapter means, successful-run conditional modeled and observed novel means, started-attempt spend diagnostics, and incomplete-sample coverage. Version-1 conditional topology, chapter-stage exchangeability, independent generation-node/chapter/judge-cost draws, deterministic judge execution, pricing-derived fallback distributions, sensitivity values, counterfactuals, and all modeled outputs are assumptions/models, not measured production truth. Report must label each and prohibit claims of production incidence, correlation, reliability, or economics unless separately supported by authorized `RELEASE_EVIDENCE`. Report must show execution profile and separate fields:

```text
engineeringGate
releaseReadiness
budgetGate
G2-BUDGET
M10-E
```

A `CONTRACT_FIXTURE` engineering `PASS` requires `releaseReadiness = HOLD`. A `RELEASE_EVIDENCE` run with insufficient authorized observations requires `engineeringGate = HOLD` and `releaseReadiness = HOLD`. Any engineering `PASS` remains separate from release readiness and cannot imply closure.

## 16. Server-only telemetry adapter

`server/telemetry-adapter.server.ts`:

- accepts only authorized isolated source configuration;
- rejects production/shared/linked targets;
- projects safe fields into strict observations;
- never performs model/provider calls;
- never mutates telemetry or runtime data;
- never serializes secrets or reader data;
- returns explicit missing states for unavailable fields;
- performs no aggregation or policy decisions.

Initial implementation should support deterministic fixture input and governed disposable/local telemetry if existing schema suffices. Production instrumentation changes are forbidden.

## 17. Testing strategy

### Contracts and provenance

- strict schema mutation tests;
- observed cannot substitute modeled/assumed and inverse;
- pricing estimate cannot substitute actual cost;
- pricing snapshot cannot substitute business authority;
- malformed authority fails closed.

### Measurement state

- `PRESENT(0)` remains zero;
- `MISSING` never sums as zero;
- `NOT_APPLICABLE` requires authority;
- partial coverage remains explicit.

### Decimal and statistics

- shorter valid input parsing plus fixed-scale canonical artifact vectors;
- money `8`, probability `12`, percentage `6`, and latency milliseconds `3` fractional-digit enforcement;
- fixed-scale zero vectors for every decimal domain;
- exact add/multiply/divide/compare vectors;
- `HALF_UP` scale and tie boundaries, including latency milliseconds;
- retry-overhead edge cases;
- latency and money percentile golden vectors matching frozen method and domain scale;
- no floating-point money authority.

### Aggregation

- task/chapter/novel rollups;
- exact 50-chapter identity;
- both execution-profile schemas and threshold boundaries;
- contract fixture declared-topology cell coverage and `0/1` eligible-event-per-`stageId`-pool enforcement;
- release evidence `29/30/31` eligible-event-per-stage-pool, `0/1` per applicable `(chapter, stage)` cell, and `9/10/11` complete-novel vectors;
- pooled central probability key is only `stageId`; every chapter occurrence reuses same measured probability only under exact scoped `chapterStageExchangeabilityAssumption`;
- exchangeability authority provenance exactly `ASSUMPTION`, exact one-stage/one-profile/compatible-stratum/chapter-`1..50` scope, rationale, version, source/decision reference, and canonical hash validation;
- missing, malformed, hash-mismatched, unsupported-scope exchangeability authority and evidence demonstrating incompatible stratum fail; missing measured pooled central probability remains `HOLD` and cannot be repaired by assumption;
- per-cell diagnostic probability cannot replace pooled central input; strong chapter effects remain reported diagnostic/sensitivity evidence;
- compatible policy/provider-model stratum separation and mixed-stratum rejection;
- explicit numerator, denominator, and eligibility boundary for every E.3 metric;
- frozen baseline/retry/fallback provider-cost grouping and runtime `NOT_APPLICABLE` exclusion;
- checkpoint reuse, prose-regeneration-on-choice-retry, ownership-loss recovery, and recovery success rates;
- generation and recovery p50/p95 interpolation;
- empirical `(chapter, stage)` failure distribution and reached-node denominators;
- mixed currency rejection;
- unavailable pricing coverage;
- array-order and semantic identity mutations.

### Model

- SHA-256 UTF-8 seed-to-big-endian-state golden vectors, including all-zero replacement;
- exact `xoshiro128**` version-1 next-word golden vectors with `uint32` overflow;
- same seed/input byte identity;
- changed seed or semantic input changes hash;
- exact 100000-iteration enforcement;
- frozen stage-catalog and `M10_E_TOPOLOGY_V1` edge/order rejection vectors plus topology hash mutation;
- `failureProbability` semantics: threshold means failure, `p=0` never fails, `p=1` always fails;
- primary/retry/fallback/checkpoint, structured retry, ownership recovery, publication recovery, and non-terminal post-publish path vectors;
- frozen task-mapping vectors: prose and structured nodes each count one generation provider call; runtime nodes use topology-authorized `NOT_APPLICABLE` and count zero;
- `generationProviderCallCount`, `judgeProviderCallCount`, `totalProviderCallCount`, and retry counter vectors for every path;
- reached provider node consumes outcome then cost draw including failure; reached runtime-only node consumes outcome only; skipped node consumes neither;
- generation `(chapterNumber, stageId, taskId, attemptClass, providerModelPolicyId)` empirical distribution sorting, inverse-CDF, coverage, and provenance vectors;
- exact ordered judge plan and `(judgeTaskId, evaluationIndex, providerModelPolicyId)` distribution vectors; one cost draw and no outcome draw per required evaluation after successful chapter `50`;
- incomplete generation skips judge plan and draws; complete generation samples every judge evaluation;
- pricing-derived fallback distributions remain distinct; missing task/provider/judge distribution or coverage HOLDs;
- separate provider/model strata produce separate models/artifacts and never merge;
- independent generation-node/chapter/judge-cost draw, deterministic judge-execution, and chapter-stage exchangeability assumptions are bound and reported, never represented as observed production correlation, chapter invariance, or judge reliability;
- exchangeability version/hash mutation changes model input/artifact hashes; chapter-conditioned model or assumption change requires version bump and full rerun;
- analytical method accepted only for independent Bernoulli completion without retries/recovery/fallback/cost;
- Monte Carlo deterministic vectors;
- observed versus modeled completion separation;
- central stage probability rejects assumed or below-profile-threshold evidence;
- fault schedule frequency cannot enter as observed probability;
- sensitivity lower/upper and counterfactual provenance completeness.

### Budget

- absent authority gives exact blocked code;
- no hidden defaults;
- E0 pricing, token-evidence, retry/fallback-policy, unit-economics-basis version/hash, and exact `novelCostConditioning = SUCCESSFUL_50_CHAPTER_RUN` binding mutations fail;
- approved values compare exactly;
- each ceiling and each frozen comparator boundary: below, equal, above;
- `maxExpectedCostPerChapter` modeled comparator calculates exact arithmetic mean generation cost separately for every chapter `1..50`, then selects maximum of those 50 means; no pooled-observation weighting;
- observed chapter comparator groups complete observations by chapter number, computes exact arithmetic mean per chapter, then takes maximum of per-chapter means; single-sample maxima remain diagnostic;
- `maxExpectedCostPerNovel` uses `expectedGenerationCostPerSuccessfulNovelRun`, exact modeled mean among successful 50-chapter iterations only; terminal failures/partials excluded from denominator;
- observed novel expected-cost comparator uses exact arithmetic mean complete generation totals among successful observed 50-chapter runs only; observed maxima remain diagnostic;
- modeled and observed `expectedGenerationSpendPerStartedNovelAttempt` include partial terminal failures and remain separate diagnostics that never compare to `maxExpectedCostPerNovel` in V1;
- exact mean vectors sum coefficients then divide by complete count at intermediate scale `20`, `HALF_UP` to money scale `8`;
- expected chapter and novel generation comparators exclude judge; modeled judge comparator uses exact judge-plan total; modeled retry-overhead is generation-only; modeled total-cost p95 uses combined generation-plus-judge cost per successful iteration;
- observed judge-per-novel max, observed retry-overhead-per-novel max, and observed novel-total p95 use only complete observations;
- incomplete observed comparables are excluded with included/excluded/eligible counts and coverage ratio;
- with valid E0 and comparable complete observations, expected-cost mean breach fails; unchanged judge/retry max and p95 breach fails independently; equality passes;
- absent observed comparable never substitutes for modeled comparator;
- unavailable modeled comparable evidence never passes;
- optional p95 handling requires explicit authority shape;
- canonical currency mismatch without authorized conversion holds.

### Artifacts/report

- raw/normalized pair recomputation;
- embedded hash/verdict mutation rejection;
- path-specific normalization preserves financial semantics;
- same input normalized bytes identical;
- report generated from validated artifact only;
- forbidden claims absent;
- secrets and reader data absent.

### Adapter

- authorized isolated identity accepted;
- production/shared/linked targets rejected;
- read-only behavior;
- safe projection;
- missing telemetry surfaced;
- no provider/network attempt beyond authorized DB read.

### Regression

- E1 and E2 focused suites remain green;
- E2 closure catalogs and hashes remain unchanged;
- typecheck, lint, and `git diff --check` pass.

## 18. Acceptance criteria

Package engineering contract is complete when:

1. Approved directory boundary exists with pure domain modules and server-only adapter.
2. Type-level provenance separation prevents ordinary cross-use of observed, modeled, assumed, pricing-derived, and business-authority values.
3. Missing telemetry cannot become zero.
4. Money calculations use deterministic exact decimal representation.
5. Task/chapter/novel reliability and economics aggregation passes golden and mutation tests.
6. Pricing snapshots are frozen and hashed as assumptions, separate from actual cost.
7. Seeded cumulative model binds full authority and reproduces byte-identical normalized output.
8. Sensitivity bands and provenance are explicit.
9. E0 budget contract has no defaults.
10. With no E0 authority, `budgetGate` equals `BLOCKED_E0_COST_CEILING_NOT_APPROVED`.
11. `CONTRACT_FIXTURE` can independently reach engineering PASS within one compatible policy stratum using at least one eligible event per pooled `stageId` and every applicable `(chapter, stage)` cell represented according to declared fixture topology, while release readiness stays HOLD.
12. `RELEASE_EVIDENCE` uses authorized measured observations within one compatible policy stratum, requires at least 30 eligible events per pooled `stageId`, at least one eligible event per applicable `(chapter, stage)` cell, and 10 complete 50-chapter novel executions; no 30-per-cell rule applies.
13. Every central stage probability is OBSERVED, pooled across eligible chapters/executions, and keyed only by `stageId`; each chapter occurrence uses same pooled value only under valid exact-scope `chapterStageExchangeabilityAssumption` with provenance `ASSUMPTION`, rationale, version, source/decision reference, and canonical hash. Authority is model authority, never observed truth, cannot replace missing measured pooled input, and missing/malformed/hash-mismatched/unsupported authority or incompatible-stratum evidence fails. Strong chapter effects remain reported diagnostics/sensitivity; chapter-conditioned change requires assumption/model version bump and full rerun.
14. Policy and provider/model strata never merge; multiple strata produce separate models, artifacts, hashes, reports, and gates.
15. All E.3 reliability/economics metrics include explicit numerator or value, denominator, and eligibility boundary, including prose regeneration on choice retry, ownership-loss recovery, recovery p50/p95, and empirical chapter-stage failure distribution.
16. Canonical artifacts serialize money at scale 8, probability at 12, percentage at 6, and latency milliseconds at 3 using `HALF_UP`; shorter valid inputs canonicalize to fixed scale and all zero values remain fixed-scale.
17. Monte Carlo follows frozen `xoshiro128**` version 1, seed mapping, 100000 iterations, failure-probability semantics, `M10_E_TOPOLOGY_V1`, frozen task mapping, provider-only generation cost draws, counters, and percentile contracts.
18. Generation cost distributions use exact `(chapterNumber, stageId, taskId, attemptClass, providerModelPolicyId)` keys; missing task/provider distribution or coverage produces `HOLD`, and pricing-derived fallback remains distinct.
19. Exact ordered post-novel judge plan binds `(judgeTaskId, evaluationIndex, providerModelPolicyId)` distributions; successful 50-chapter iterations sample every required judge cost with no judge reliability outcome draw, while judge reliability remains explicit out-of-scope assumption.
20. Provider-call metrics expose `generationProviderCallCount`, `judgeProviderCallCount`, and `totalProviderCallCount`; runtime-only nodes are topology-authorized `NOT_APPLICABLE` and prove zero provider calls.
21. `maxExpectedCostPerChapter` uses maximum of 50 exact modeled per-chapter generation means and matching observed maximum of exact per-chapter means; `maxExpectedCostPerNovel` uses modeled and observed arithmetic mean generation cost conditioned only on successful 50-chapter runs. Expected comparators exclude judge, incomplete samples are excluded with coverage, and all means use exact coefficient sum, scale-20 division, then money-scale-8 `HALF_UP`.
22. `expectedGenerationSpendPerStartedNovelAttempt` is separate modeled and, when available, observed diagnostic across all started attempts including partial terminal failures; it never compares to `maxExpectedCostPerNovel` in V1. New started-attempt spend ceiling requires separate business dimension, authority/model version bump, and full rerun.
23. Model authority binds `topologyVersion`, `topologyHash`, task mapping, pooled probabilities, each `chapterStageExchangeabilityAssumption` version/hash/scope, policy/provider-model stratum, generation and judge cost-distribution provenance/coverage, and independent generation-node/chapter/judge-cost draws as explicit assumption; none may be claimed as production truth.
24. E0 authority binds verified versions and hashes for pricing, measured token evidence, retry/fallback policy, approved product unit-economics decision basis, and `novelCostConditioning = SUCCESSFUL_50_CHAPTER_RUN`.
25. Budget evaluation uses complete frozen central modeled comparators; with valid E0 and comparable complete observations, expected-cost observed means fail above ceilings while observed expected-cost maxima remain diagnostics; judge/retry maxima and p95 rules remain unchanged; equality passes and pricing inputs remain `MODELED_FROM_PRICING`.
26. Overall M10-E remains OPEN and G2-BUDGET remains OPEN.
27. Adapter needs no production runtime/schema mutation; otherwise affected measurement is explicit MISSING/HOLD.
28. Validated artifact pair and deterministic report are produced.
29. E1/E2 authority, hashes, versions, semantics, and closure remain unchanged.
30. No production/shared/linked DB or real provider/model access occurs.

## 19. Stop conditions

Stop package and request review if:

- required telemetry needs production runtime/schema instrumentation;
- an observed metric cannot be distinguished from modeled/assumed data;
- cost coverage would require treating missing as zero;
- decimal or Monte Carlo authority is non-deterministic;
- mixed currency requires unapproved conversion;
- `chapterStageExchangeabilityAssumption` is missing, malformed, hash-mismatched, unsupported in scope, or contradicted by evidence of incompatible bound stratum;
- chapter-conditioned central modeling is required without approved assumption/model version bump and full rerun;
- `maxExpectedCostPerNovel` would need reinterpretation as started-attempt spend; this requires separate business dimension, authority/model version bump, and full rerun;
- E1/E2 authority would need modification;
- numeric E0 ceilings are needed to continue engineering work;
- any production/shared/linked access becomes necessary;
- E-OPS-1/E5 scope becomes entangled.

## 20. Governance status after package

Target status, assuming engineering PASS and E0 still unresolved:

```text
M10-D       CLOSED / FROZEN
E0          DECISION-BLOCKED
E1          PASS / CLOSED
E2          PASS / CLOSED
E3A         PASS / PENDING_REVIEW
E4 model    PASS / PENDING_REVIEW
E4 budget   BLOCKED_E0_COST_CEILING_NOT_APPROVED
E5/E-OPS-1  OPEN / OUT OF SCOPE
M10-E       OPEN
M10-F       FORBIDDEN
M10-G       BLOCKED
production  FORBIDDEN
```
