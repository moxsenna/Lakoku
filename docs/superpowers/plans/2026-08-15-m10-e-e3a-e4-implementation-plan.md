# M10-E E3A + E4 Detailed Implementation Plan

**Date:** 2026-08-15  
**Status:** Plan only; implementation not authorized  
**Approved design authority:** `af28b45dcd62544f12415476aa62bd3a09fd8f7e`  
**Approved spec:** `docs/superpowers/specs/2026-08-13-m10-e-e3a-e4-reliability-economics-design.md`  
**E2 closure anchor:** `914cf30f42d4e7f293df79e0d66c014331a696ba`

## 1. Package boundary and required final state

Implement E3A reliability/economics aggregation and E4 cumulative model plus fail-closed budget policy as one reviewed package. `CONTRACT_FIXTURE` is package engineering-PASS target. It proves contract, arithmetic, aggregation, authority binding, deterministic modeling, artifacts, and reporting only.

Required fixture result:

```text
E3A engineering/evidence contract = PASS
E4 model contract                 = PASS
engineeringGate                   = PASS
releaseReadiness                  = HOLD
budgetGate                        = BLOCKED_E0_COST_CEILING_NOT_APPROVED
G2-BUDGET                         = OPEN
M10-E                             = OPEN
M10-F                             = FORBIDDEN
production                        = FORBIDDEN
```

`RELEASE_EVIDENCE` remains a supported strict contract and threshold-validation surface only. This package must not generate, infer, relabel, or pad fixture observations as `RELEASE_EVIDENCE`.

Non-negotiable operational boundary:

```text
no production/shared/linked access
no --linked
do not reset or mutate existing lakoku-v2 local DB
do not modify tracked repo config just to create isolation
do not create/edit migrations or production schema/RPC
no real provider/model
production FORBIDDEN
```

Also forbidden:

- Do not change `lib/narrative-qa/fault/**`, E1/E2 catalogs, gates, hashes, versions, normalization, artifacts, or closure semantics.
- Do not change `lib/ai-gateway/**`, `lib/runtime/**`, provider recorders, migrations, RPCs, client code, or API routes.
- Do not invent numeric E0 ceilings, currency conversion, release observations, production incidence, correlation, or chapter-invariance claims.
- Do not start E5/E-OPS-1, M10-F, G2-BUDGET closure, or M10-E closure.
- If existing telemetry lacks required semantics, emit `MISSING`; do not add instrumentation silently.

## 2. Implementation shape and dependency order

Create pure domain and server-only boundary:

```text
lib/narrative-qa/reliability/
  index.ts
  contracts.ts
  decimal.ts
  authorities.ts
  topology.ts
  measurements.ts
  aggregation.ts
  pricing.ts
  cost-distributions.ts
  seeded-rng.ts
  cumulative-model.ts
  budget-policy.ts
  gate.ts
  normalization.ts
  artifacts.ts
  report.ts
  server.ts
  server/
    telemetry-adapter.server.ts
```

`authorities.ts`, `topology.ts`, `pricing.ts`, and `cost-distributions.ts` split approved responsibilities into small pure modules. `index.ts` and `server.ts` provide named-export barrels. Pure barrel must not import `server-only`, Supabase, provider, or runtime code. Scripts use `../lib/narrative-qa/reliability` and `../lib/narrative-qa/reliability/server`; no new TypeScript alias or ESLint package boundary.

Dependency graph:

```text
P1 contracts
 ├─ P2 decimal/percentile
 ├─ P3 authorities/topology
 └─ P4 observations/aggregation
       └─ P5 pricing/distributions
             └─ P6 RNG/model
                   └─ P7 gates
                         └─ P8 artifacts/report
P9 adapter ─────────────────┘
P10 fixture + E2 authority ─┘
P11 runner and counted evidence uses P1–P10
```

Build sequence is P1 through P11. Every workstream starts with failing tests, adds minimal code, runs focused acceptance, and stops on its listed boundary. Do not commit or push until separately authorized.

## 3. Cross-cutting frozen contracts

### Provenance and measurement

Distinct constructor-controlled values:

```ts
ObservedValue<T>          // OBSERVED
AssumedValue<T>           // ASSUMPTION
ModeledValue<T>           // MODELED
PricingDerivedValue<T>    // MODELED_FROM_PRICING
BusinessAuthorityValue<T> // BUSINESS_AUTHORITY
```

Every measurable field is exactly one of:

```ts
type MeasurementState<T> =
  | { state: 'PRESENT'; value: T }
  | { state: 'MISSING'; reasonCode: MissingReasonCode; detail: string }
  | { state: 'NOT_APPLICABLE'; authority: NotApplicableAuthority }
```

`PRESENT(0)` is evidence. `MISSING` is never zero. `NOT_APPLICABLE` requires frozen current-scope authority.

### Exact decimals

- money scale `8`;
- probability scale `12`;
- percentage scale `6`;
- latency milliseconds scale `3`;
- multiply/divide intermediate scale `20`;
- `HALF_UP`, ties away from zero;
- aggregate exact coefficients before final division/rounding;
- coefficient limit `10^38 - 1` for stored and intermediate values;
- no binary floating-point monetary, probability, percentage, threshold, mean, or percentile authority.

### Central probability and exchangeability

```text
centralStageFailureProbability[stageId] =
  sum(observed eligible failures across chapters/executions) /
  sum(observed eligible reached events across chapters/executions)
```

Central key is only `stageId`. Every stage has exact one-stage, one-profile, one-compatible-stratum, chapters `1..50` `chapterStageExchangeabilityAssumption` with `ASSUMPTION` provenance, rationale, version, decision reference, and canonical hash. Assumption permits reuse across chapters; it cannot create or repair measured probability. Per-cell values remain diagnostic/sensitivity evidence.

Classification lock:

- insufficient measured pool/cell/profile coverage: `HOLD`;
- missing, malformed, hash-mismatched, unsupported exchangeability authority or incompatible stratum: `FAIL`.

### R1 comparator semantics

- `maxExpectedCostPerChapter`: exact arithmetic mean complete generation cost separately for every chapter `1..50`, then maximum of 50 means; judge excluded.
- Observed chapter comparator: same maximum of exact per-chapter means. Single-sample maximum is diagnostic only.
- `maxExpectedCostPerNovel`: `expectedGenerationCostPerSuccessfulNovelRun`, exact arithmetic mean generation cost among successful complete chapter `1..50` runs only; judge excluded.
- Observed novel comparator: exact arithmetic mean complete generation totals among successful observed 50-chapter runs only. Observed maximum is diagnostic only.
- `expectedGenerationSpendPerStartedNovelAttempt`: includes partial terminal failures but remains diagnostic and never compares to `maxExpectedCostPerNovel` in V1.
- Judge maximum, retry-overhead maximum, and combined total p95 comparators retain approved rules.
- Means sum exact coefficients, divide by included count at scale `20`, then `HALF_UP` to money scale `8`.
- Comparator passes on exact `comparator <= ceiling`.

### Hash DAG

Avoid report/artifact self-reference:

1. Authority hash = canonical authority payload with its own hash field omitted.
2. Observation hash = normalized strict observation set.
3. Aggregate hash = aggregate payload plus upstream authority/observation hashes, own hash omitted.
4. Model-input hash = normalized model input plus authority references, own hash omitted.
5. Model-output hash = normalized output with own hash omitted.
6. Artifact semantic hash = validated normalized semantic artifact excluding only `artifactSemanticHash`, `reportHash`, physical execution identity/paths, and declared raw operational timestamps.
7. Report = rendered from revalidated semantic artifact; it may display artifact semantic hash.
8. Report hash = SHA-256 of exact UTF-8 Markdown bytes.
9. Final envelope binds artifact semantic hash and report hash. Report hash never enters artifact semantic hash.

Every exclusion is explicit by schema/path. Never recursively strip keys named `*Hash`.

---

# P1 — Contracts, provenance, and measurement states

## Files

Create:

- `lib/narrative-qa/reliability/contracts.ts`
- `lib/narrative-qa/reliability/index.ts`
- `tests/narrative-qa/m10-e-reliability-contracts.test.ts`
- `tests/narrative-qa/m10-e-reliability-types.test.ts`

Dependencies: Zod already used by repo; existing `lib/narrative-qa/scoring/canonical-serializer.ts` for hash inputs. No server imports.

## Implementation contract

Export strict Zod schemas and inferred types for:

- `ExecutionProfile = CONTRACT_FIXTURE | RELEASE_EVIDENCE`;
- `EngineeringGate = PASS | FAIL | HOLD`;
- `ReleaseReadiness = HOLD | BLOCKED | READY`;
- exact `BudgetGate` union;
- `StageId`, `TaskId`, `AttemptClass`, chapter `1..50`, exact novel identity, compatible stratum identity;
- five provenance wrappers;
- three measurement states;
- stable `MissingReasonCode`, gate reason codes, and `NotApplicableAuthority`;
- safe aliases and observation references;
- coverage/included/excluded/eligible count primitives.

Public constructors/parsers:

```ts
presentMeasurement<T>(value: T): MeasurementState<T>
missingMeasurement<T>(reasonCode: MissingReasonCode, detail: string): MeasurementState<T>
notApplicableMeasurement<T>(authority: NotApplicableAuthority): MeasurementState<T>
observedValue<T>(value: MeasurementState<T>, refs: readonly string[]): ObservedValue<T>
assumedValue<T>(value: T, authority: AssumptionAuthority): AssumedValue<T>
modeledValue<T>(value: T, authority: ModelAuthority, inputHash: string): ModeledValue<T>
pricingDerivedValue<T>(value: MeasurementState<T>, pricingSnapshotHash: string): PricingDerivedValue<T>
businessAuthorityValue<T>(value: T, approval: E0ApprovalAuthority): BusinessAuthorityValue<T>
```

Constructors freeze values and require validated/hash-bound authorities. Keep nominal brand private. Strict schemas reject unknown keys. Type tests use `IsAssignable`/`AssertFalse`; do not use `@ts-expect-error`, `@ts-ignore`, `as any`.

## Tests written with P1

- Runtime strict-schema tests for every union and constructor.
- Compile-time non-assignability for all cross-provenance pairs.
- Chapter bounds, exact 50-chapter sequence, safe alias shape, nonempty observation refs.
- `PRESENT(0)` retained for calls, tokens, failures, and cost.
- `MISSING` retains reason/detail and cannot be accepted where present input is required.
- Runtime-node `NOT_APPLICABLE` accepted only with exact task/topology authority shape.
- Deterministic reason ordering.

Negative/mutation cases:

- extra property; forged provenance tag; empty refs; wrong authority hash; chapter `0/51`; attempt `0`; wrong task/stage; prose node marked `NOT_APPLICABLE`; runtime node caller-supplied `PRESENT(0)` provider calls; pricing-derived value used as observed or business authority.

Acceptance:

```bash
pnpm exec vitest run tests/narrative-qa/m10-e-reliability-contracts.test.ts tests/narrative-qa/m10-e-reliability-types.test.ts
pnpm typecheck
```

STOP if separation needs exported forgeable brands, forbidden TypeScript escapes, E1/E2 type edits, or missing must become zero.

---

# P2 — Exact decimal and percentile primitives

## Files

Create:

- `lib/narrative-qa/reliability/decimal.ts`
- `tests/narrative-qa/m10-e-reliability-decimal.test.ts`

Dependencies: P1 domain types only.

## Implementation contract

Internal representation:

```ts
interface ExactDecimal { coefficient: bigint; scale: number }
type DecimalDomain = 'MONEY' | 'PROBABILITY' | 'PERCENTAGE' | 'LATENCY_MILLISECONDS'
```

Export domain parsers/canonicalizers, exact compare/add/nonnegative subtract/multiply/divide/sum/ratio/percentage/mean, exact failure threshold conversion, and:

```ts
percentileCont<T extends CanonicalDecimal>(
  values: readonly T[],
  quantile: '0.50' | '0.95',
  domain: DecimalDomain,
): MeasurementState<T>
```

Implement `r = q × (n - 1)`, exact `floor/ceil`, scale-20 linear interpolation, then domain rounding. Short valid decimals may be padded. Excess scale only accepted by named conversion boundary. Canonical values always fixed scale. Probability range is inclusive `[0,1]`.

## Tests written with P2

Golden vectors:

- money `1.2` → `1.20000000`;
- money `1.234567895` → `1.23456790`;
- exact fixed-scale zero for all four domains;
- latency `12.3455` → `12.346`;
- exact ties, sums, ratios, percentage, means, equality comparison;
- one-value, odd/even p50, and p95 interpolation for money/latency;
- coefficient `10^38 - 1` accepted where scale permits, `10^38` rejected;
- exact threshold near `0`, `1`, and `2^32` boundaries.

Negative/mutation cases:

- `-1`, `+1`, `01`, `.5`, `1.`, exponent, `NaN`, `Infinity`; probability outside range; zero denominator; early per-item rounding; `HALF_EVEN`; interpolation by nearest rank; binary float conversion; overflow/saturation; mixed scale/domain.

Acceptance:

```bash
pnpm exec vitest run tests/narrative-qa/m10-e-reliability-decimal.test.ts
```

STOP if any authority requires binary floating point, intermediate overflow, ambiguous rounding boundary, or unapproved currency conversion.

---

# P3 — Stage, task, topology, and model authorities

## Files

Create:

- `lib/narrative-qa/reliability/authorities.ts`
- `lib/narrative-qa/reliability/topology.ts`
- `tests/narrative-qa/m10-e-reliability-authorities.test.ts`
- `tests/narrative-qa/m10-e-reliability-topology.test.ts`

Modify:

- `lib/narrative-qa/reliability/index.ts` for named pure exports.

Dependencies: P1, P2, canonical serializer.

## Implementation contract

Freeze and hash:

- `M10_E_STAGE_CATALOG_V1` with exact 11-stage semantic order;
- `M10_E_TASK_MAPPING_V1`;
- `M10_E_TOPOLOGY_V1` exact edges/reachability;
- provider-call applicability;
- attempt classes: primary/retry/fallback;
- retry-count stages;
- `M10_E_CUMULATIVE_MODEL_V1`, `M10_E_MONTE_CARLO_V1`, PRNG/method/numeric identities;
- ordered judge-plan authority;
- independent-draw and deterministic-judge assumptions;
- one exact `chapterStageExchangeabilityAssumption` per stage.

Topology helpers return next reached stage(s), task, provider-call state, attempt class, retry-counter effect, terminal effect, and judge eligibility. Unknown/missing/duplicate/reordered stages or changed edge authority fail. Runtime nodes prove provider-call `NOT_APPLICABLE`; no observation supplies zero.

Exchangeability scope binds one `stageId`, one profile, one complete compatible stratum, chapters `1..50`, rationale, version, source/decision ref, and self-hash. Assumption never contains a central probability.

## Tests written with P3

- Exact stage order/hash, task-map hash, topology hash, model authority hash.
- Every success/failure path: prose retry/fallback/checkpoint, structured retry, ownership recovery, publication recovery, nonterminal post-publish.
- Provider-call and retry-counter truth table for all stages.
- Judge plan exact ordered `(judgeTaskId, evaluationIndex)` sequence.
- Exchangeability one-stage/exact-scope validation for all 11 stages.

Negative/mutation cases:

- reorder/duplicate/remove/add stage; edge change; `POST_PUBLISH` made terminal; fallback counted as retry; runtime node given provider call; wrong task/attempt class; assumption spans multiple stages/profiles/strata or chapters other than `1..50`; missing rationale/ref/hash; topology/model version unchanged after semantic mutation.

Acceptance:

```bash
pnpm exec vitest run tests/narrative-qa/m10-e-reliability-authorities.test.ts tests/narrative-qa/m10-e-reliability-topology.test.ts
```

STOP if approved topology is ambiguous, central model needs chapter-conditioned key, or any authority change would need version bump not approved by reviewer.

---

# P4 — Observations and deterministic aggregation

## Files

Create:

- `lib/narrative-qa/reliability/measurements.ts`
- `lib/narrative-qa/reliability/aggregation.ts`
- `tests/narrative-qa/m10-e-reliability-measurements.test.ts`
- `tests/narrative-qa/m10-e-reliability-aggregation.test.ts`
- `tests/narrative-qa/m10-e-reliability-profile-thresholds.test.ts`

Dependencies: P1–P3.

## Implementation contract

Define strict safe observation records for provider call, stage outcome, logical generation unit, recovery action, publication attempt, canonical invariant check, chapter execution, novel execution, and judge evaluation. Validate identity relationships, attempt order, token totals, cost source/currency, timing, stage/task/provider-call applicability, and compatible stratum before aggregation.

Sort provider-call observations by:

```text
storyAlias, chapterNumber, generationKind, taskId,
attemptNumber, fallbackIndex, callAlias
```

Canonical tie sorting uses UTF-8 byte order, never locale-sensitive comparison.

Aggregate all required E.3 metrics at task/chapter/novel and applicable source/policy dimensions. Each rate/metric carries numerator or exact value, denominator, eligibility boundary, covered/eligible/unavailable or included/excluded counts, coverage ratio, provenance, and observation refs. Include first-attempt success, retry success, terminal failure, checkpoint reuse, prose regeneration on choice retry, ownership-loss recovery, recovery success, provider fallback, full-novel completion, retry counts, provider-call counts, duplicate publication, canonical corruption, generation/recovery p50/p95, tokens, actual/pricing cost, chapter-stage diagnostics, and observed cost comparators/diagnostics.

Central probabilities pool observed reached failures by `stageId` only. Attach exact exchangeability authority and separate per-cell diagnostics. Strong chapter effects remain visible.

Profile completeness:

- fixture: every stage pool `>=1`; every applicable declared `(chapter, stage)` cell represented;
- release contract: each stage pool `>=30`, each applicable cell `>=1`, complete novels `>=10`;
- one exact compatible stratum only.

## Tests written with P4

- Golden task/chapter/novel rollups and semantic sort.
- Every required metric has boundary and counts.
- Stage pooling formula and per-cell diagnostic separation.
- Strong chapter-effect diagnostic preserved.
- Fixture pool/cell `0/1` vectors.
- Release-only schema/gate vectors: pool `29/30/31`, cell `0/1`, novel `9/10/11`; no release artifact generation.
- Observed chapter max-of-means and successful-novel conditional mean.
- Started-attempt diagnostic includes partial failures but is never comparator.
- Incomplete samples excluded and counted.

Negative/mutation cases:

- central key `(chapter, stage)`; assumed central rate; exchangeability used to fill empty pool; mixed strata/pricing hashes/currencies; missing/extra provider call; wrong task; token total mismatch; attempt gap/duplicate; runtime provider call; missing metric boundary; hidden incomplete coverage; E1/E2 fault frequency imported as incidence; observed maxima substituted for approved expected-cost means; started-attempt mean substituted for successful-run mean.

Acceptance:

```bash
pnpm exec vitest run tests/narrative-qa/m10-e-reliability-measurements.test.ts tests/narrative-qa/m10-e-reliability-aggregation.test.ts tests/narrative-qa/m10-e-reliability-profile-thresholds.test.ts
```

STOP if fixture cannot represent all required surfaces, central model needs per-chapter probability, provenance/stratum separation fails, or any metric needs missing-as-zero.

---

# P5 — Pricing authority and cost distributions

## Files

Create:

- `lib/narrative-qa/reliability/pricing.ts`
- `lib/narrative-qa/reliability/cost-distributions.ts`
- `tests/narrative-qa/m10-e-reliability-pricing.test.ts`
- `tests/narrative-qa/m10-e-reliability-cost-distributions.test.ts`

Dependencies: P1–P4.

## Implementation contract

Pricing snapshot binds schema/policy version, provider, exact model ID, currency, canonical input/output prices, unit size, effective interval, source reference, and self-hash. It is `ASSUMPTION` authority. Cost estimation yields only `MODELED_FROM_PRICING`. Actual provider cost remains `OBSERVED`; business ceiling remains `BUSINESS_AUTHORITY`.

Generation distribution key:

```text
(chapterNumber, stageId, taskId, attemptClass, providerModelPolicyId)
```

Required exhaustive coverage is `50 × 5 = 250` generation provider-node keys. Runtime nodes have no cost distribution. Judge key is exact `(judgeTaskId, evaluationIndex, providerModelPolicyId)` from ordered judge plan.

Entries within one distribution are either all `OBSERVED`, or all `MODELED_FROM_PRICING` fallback bound to one matching snapshot hash. Sort by numeric money value then observation ID UTF-8 bytes. Inverse-CDF selection contract is `floor(c × n / 2^32)`.

## Tests written with P5

- Snapshot canonical hash/effective interval/provider-model matching.
- Actual versus estimated provenance separation and missing coexistence.
- All 250 key coverage and exact judge-key coverage.
- Numeric sorting vector containing `2.00000000` and `10.00000000`.
- Inverse-CDF first/last/boundary indexes.
- Mixed currency and provider/model strata rejection.

Negative/mutation cases:

- pricing snapshot used as observed spend/E0; missing price defaulted to zero; empirical/pricing entries mixed; wrong task/attempt class; missing one of 250 keys; extra runtime key; empty distribution; mismatched pricing hash/effective interval; lexical sorting; judge plan reorder/duplicate/missing key; unauthorized currency conversion.

Acceptance:

```bash
pnpm exec vitest run tests/narrative-qa/m10-e-reliability-pricing.test.ts tests/narrative-qa/m10-e-reliability-cost-distributions.test.ts
```

STOP if any reachable generation/judge distribution requires zero/default imputation, pricing must masquerade as observation, or mixed currency needs unapproved conversion.

---

# P6 — Seeded RNG and Monte Carlo engine

## Files

Create:

- `lib/narrative-qa/reliability/seeded-rng.ts`
- `lib/narrative-qa/reliability/cumulative-model.ts`
- `tests/narrative-qa/m10-e-reliability-seeded-rng.test.ts`
- `tests/narrative-qa/m10-e-reliability-model.test.ts`
- `tests/narrative-qa/m10-e-reliability-model-determinism.test.ts`

Dependencies: P1–P5.

## Implementation contract

Implement exact `xoshiro128**` version 1:

- SHA-256 exact UTF-8 seed;
- digest bytes `0..15`, four big-endian `uint32` words;
- all-zero replacement `[0x6d2b79f5, 0, 0, 0]`;
- exact frozen next-word operations;
- uniform semantic `u / 2^32`, but failure threshold evaluated with integer/decimal arithmetic;
- one outcome draw for every reached stage, including `p=0`/`p=1`;
- node fails iff `uint32Draw < floor(failureProbability × 2^32)`;
- no `Math.random()`.

Monte Carlo runs exactly `100000` iterations, chapters `1..50` ascending, frozen topology and draw order. Reached provider node consumes outcome then cost draw even on failure. Reached runtime node consumes outcome only. Skipped node consumes none. Failed chapter skips later chapters and judge plan. Successful chapter 50 executes every judge entry in order, one cost draw and no judge outcome draw.

Central uses only complete `ObservedValue<Probability>` stage pools. Lower/upper sensitivity may use explicit assumptions. Bind all authority/input hashes. Output `MODELED` completion/terminal probabilities, retry and provider-call expectations, 50 chapter means and p50/p95, maximum chapter mean, successful-run conditional generation mean, started-attempt diagnostic, judge total, generation and combined p50/p95, counts/denominators, and lower/central/upper results.

## Tests written with P6

- Golden seed state and first words.
- All-zero replacement through deterministic digest seam.
- `p=0`, `p=1`, and threshold-minus/equal vectors.
- Scripted path draw/counter vectors for every recovery branch.
- Provider/runtime/skipped draw consumption.
- Cost inverse-CDF vectors and judge traversal.
- Exactly 100000 enforcement.
- Two independent runs produce byte-identical normalized model output/hash.
- Same semantic input reordered non-semantically remains identical; seed or semantic mutation changes hash.

Negative/mutation cases:

- little endian; changed xoshiro operation; `<=`; success/failure inversion; skipped-node draw; missing failed-node cost draw; runtime cost draw; wrong retry count; post-publish terminal; 99999/100001 iterations; chapter pooling for expected cost; partial runs in successful denominator; judge included in generation comparators; judge outcome draw; judge on failed run; assumed central probability; missing exchangeability; per-cell central probability; fault schedule frequency; missing distribution.

Acceptance:

```bash
pnpm exec vitest run tests/narrative-qa/m10-e-reliability-seeded-rng.test.ts tests/narrative-qa/m10-e-reliability-model.test.ts tests/narrative-qa/m10-e-reliability-model-determinism.test.ts
```

STOP if output differs across supported Node runs, central model requires assumptions, chapter-conditioned central modeling is required, or successful-run conditioning must change.

---

# P7 — Budget policy and engineering gate

## Files

Create:

- `lib/narrative-qa/reliability/budget-policy.ts`
- `lib/narrative-qa/reliability/gate.ts`
- `tests/narrative-qa/m10-e-reliability-budget.test.ts`
- `tests/narrative-qa/m10-e-reliability-gate.test.ts`

Dependencies: P1–P6.

## Implementation contract

E0 authority strict schema binds policy/version/currency/status/reviewer/effective date/approval hash/supersession plus exact pricing, measured-token-evidence, retry/fallback-policy, product-unit-economics-basis versions/hashes and:

```text
novelCostConditioning = SUCCESSFUL_50_CHAPTER_RUN
```

No defaults. `null`, absent, unapproved, superseded, or unverifiable authority returns exactly:

```text
BLOCKED_E0_COST_CEILING_NOT_APPROVED
```

Approved-authority evaluator compares modeled mandatory comparators and present complete observed comparators using R1 semantics. Expected chapter/novel observed single-sample maxima stay diagnostics. Judge/retry maxima and total p95 retain approved failure behavior. Equality passes.

Engineering gate precedence:

1. malformed evidence, authority/hash/semantic/provenance/overflow/determinism/artifact defect or safety breach → `FAIL`;
2. required measurement/profile/distribution/currency/human authority gap → `HOLD`;
3. complete valid selected profile → `PASS`.

Fixture engineering PASS maps release readiness to `HOLD`, never `READY`. No result mapper can close G2-BUDGET or M10-E.

## Tests written with P7

- Exact absent-E0 blocked result and empty comparisons.
- Strict E0 binding mutations.
- Below/equal/above for each modeled comparator and each applicable observed comparator.
- Chapter max-of-means, successful-novel mean, started-attempt diagnostic separation.
- Missing modeled comparator → engineering `HOLD`, never budget PASS.
- Fixture PASS/release HOLD; release threshold HOLD; safety/E1/E2 regression FAIL.

Negative/mutation cases:

- environment/default ceilings; pricing/current spend/model output as authority; wrong hash/currency/conditioning; superseded authority; observed maximum fails expected ceiling; started-attempt diagnostic compared; fixture mapped READY; blocked budget mapped M10-E PASS; safety count ignored; missing exchangeability classified HOLD instead of FAIL.

Acceptance:

```bash
pnpm exec vitest run tests/narrative-qa/m10-e-reliability-budget.test.ts tests/narrative-qa/m10-e-reliability-gate.test.ts
```

STOP if numeric E0 value is needed for fixture engineering PASS, fixture PASS implies release readiness, or blocked budget cannot remain exact.

---

# P8 — Normalization, artifacts, and report

## Files

Create:

- `lib/narrative-qa/reliability/normalization.ts`
- `lib/narrative-qa/reliability/artifacts.ts`
- `lib/narrative-qa/reliability/report.ts`
- `tests/narrative-qa/m10-e-reliability-normalization.test.ts`
- `tests/narrative-qa/m10-e-reliability-artifacts.test.ts`
- `tests/narrative-qa/m10-e-reliability-report.test.ts`

Generated only by accepted fixture execution:

- `.zcode/artifacts/m10-e-e3a-e4/<execution-instance-id>/m10-e-e3a-e4.raw.json`
- `.zcode/artifacts/m10-e-e3a-e4/<execution-instance-id>/m10-e-e3a-e4.normalized.json`
- `.zcode/artifacts/m10-e-e3a-e4/<execution-instance-id>/M10_E_RELIABILITY_COST_REPORT.md`
- `docs/qa/m10/M10_E_RELIABILITY_COST_REPORT.md`

Dependencies: P1–P7 and existing canonical serializer. Do not modify/reuse E2 normalizer implementation; copy only pattern concepts.

## Implementation contract

Define two strict layers:

1. `ReliabilitySemanticPayload` / `ValidatedReliabilitySemanticArtifact`: all spec authorities, profile/stratum, completeness, observations, aggregates, model input/output, 50 chapter means/denominators, R1 comparators/diagnostics, gates, reasons, base Git SHA/dirty state, source authority, E2 closure reference, and `artifactSemanticHash`; no `reportHash`.
2. Final raw/normalized envelopes: validated semantic artifact plus exact `reportHash` and physical execution metadata.

Use cross-cutting non-cyclic hash DAG. Semantic validator reparses and recomputes schemas, authorities, observation/aggregate/model hashes, aggregation, model output, gates, normalized semantic payload, and `artifactSemanticHash`, then returns constructor-controlled `ValidatedReliabilitySemanticArtifact`. Report generator accepts only that branded semantic result. Final-pair validator accepts raw envelope, normalized envelope, and exact report bytes; it recomputes both semantic hash and report hash. No placeholder `reportHash`. Embedded hashes/verdicts receive no trust.

Path-specific normalization removes only declared execution timestamps/elapsed runtime/physical paths and aliases operational identifiers through shared maps preserving equality/mismatch graphs. Preserve financial fields, currencies, prices, authority dates, assumption scopes/hashes, stage/task/chapter identity, mean conditioning and denominators, stage order, and judge order.

Report generator renders required 11 sections and exact separate statuses. Every value displays provenance. It states fixture limits, pooled-versus-per-cell distinction, exchangeability/independence/judge assumptions, strong chapter effects, pricing fallback, missing coverage, all R1 mean denominators/diagnostics, and prohibited production claims.

## Tests written with P8

- Operational-only raw mutations normalize byte-identically.
- Equality and mismatch alias graphs survive.
- Every semantic/financial/authority mutation changes semantic hash or fails validation.
- Embedded aggregate/model/gate/report/hash mutation rejected by recomputation.
- Hash-DAG golden test proves no self-reference.
- Report bytes/hash deterministic twice and exact section/status order.
- Privacy/secret/forbidden-claim scans.

Negative/mutation cases:

- broad timestamp/ID/hash stripping; authority date removed; money/currency/pricing/exchangeability/denominator mutation ignored; semantic array reordered; unknown property; raw/normalized mismatch; embedded budget PASS without E0; report from unvalidated object; report claims release ready, production reliability/economics, M10-E/G2 closure, observed independence/chapter invariance/judge reliability; user ID/email/prose/prompt/response/private URL/service key leakage.

Acceptance:

```bash
pnpm exec vitest run tests/narrative-qa/m10-e-reliability-normalization.test.ts tests/narrative-qa/m10-e-reliability-artifacts.test.ts tests/narrative-qa/m10-e-reliability-report.test.ts
```

STOP if hash design becomes self-referential, validator cannot recompute embedded results, normalization loses semantic graphs, or safe report needs private data.

---

# P9 — Server-only telemetry adapter

## Files

Create:

- `lib/narrative-qa/reliability/server/telemetry-adapter.server.ts`
- `lib/narrative-qa/reliability/server.ts`
- `tests/narrative-qa/m10-e-reliability-telemetry-adapter.test.ts`

Dependencies: P1/P4 schemas only. File imports `server-only`. No gate, aggregate, model, provider, runtime, or client dependency.

## Implementation contract

Discriminated sources:

```text
CONTRACT_FIXTURE
GOVERNED_DISPOSABLE_LOCAL
```

Reject production/shared/linked/unknown targets before any client/read construction. No generic URL/key callback. Governed local config pins loopback host, port, project identity, authorization reference, and capability declaration.

Initial fixture path projects complete strict safe observations. Existing governed disposable/local telemetry may project only fields existing schema proves. Unsupported stage/recovery/publication/novel/judge semantics return explicit capability-level and field-level `MISSING`; adapter does not infer them. It performs no aggregation/policy decision, writes, provider/model calls, or network action beyond an explicitly authorized isolated DB read.

If no safe existing local read seam is authorized during implementation, governed local branch returns `MISSING(EXISTING_READ_SEAM_UNAVAILABLE)` with zero read/mutation/provider/network counters. Do not add RPC/query/schema solely to fill it.

## Tests written with P9

- Fixture accepted and strictly projected.
- Production/shared/linked rejected before read.
- Unsupported telemetry remains `MISSING`.
- Forbidden raw fields never cross projection.
- Source guards prohibit provider/runtime/AI imports, `fetch`, mutation APIs, migrations/RPC creation.
- Counters prove fixture path performs zero DB/network/provider/mutation actions.

Negative/mutation cases:

- production URL; non-loopback host; shared project identity; linked flag; generic service key; raw user/story/job/correlation ID leak; missing field inferred from outcome; missing converted to zero; adapter returns aggregate/gate; insert/update/delete/upsert/RPC/provider call.

Acceptance:

```bash
pnpm exec vitest run tests/narrative-qa/m10-e-reliability-telemetry-adapter.test.ts
```

STOP before any read if isolation identity cannot be proven. STOP if required telemetry needs instrumentation, migration, RPC, production/shared/linked access, or secret/private data.

---

# P10 — Contract fixture and E2 closure-authority integration

## Files

Create:

- `fixtures/m10-e/reliability-contract-fixture.ts`
- `fixtures/m10-e/pricing-snapshot.json`
- `fixtures/m10-e/model-authorities.json`
- `fixtures/m10-e/judge-plan.json`
- `fixtures/m10-e/e1-e2-closure-authority.json`
- `tests/narrative-qa/m10-e-reliability-fixture.test.ts`
- `tests/narrative-qa/m10-e-e1-e2-closure-regression.test.ts`

Dependencies: P1–P9; Git object/blob reading patterned after existing E2 historical authority. Do not change `lib/narrative-qa/fault/**`.

## Implementation contract

Fixture is deterministic, synthetic/sanitized, one compatible policy/provider-model/pricing/topology stratum. It contains:

- all 11 stage pools with `>=1` eligible reached event;
- every applicable declared `(chapter, stage)` cell;
- complete reliability metric surfaces including retry/fallback/checkpoint/choice retry/ownership/recovery/publication/invariant/latency/novel outcomes;
- evidenced zero duplicate publication and corruption;
- provider token state for every eligible call;
- separate actual and pricing-derived cost coverage;
- all `250/250` generation distribution keys;
- complete ordered judge plan/distributions;
- 11 exchangeability authorities, independent-draw and deterministic-judge assumptions, sensitivity bands;
- successful 50-chapter and terminally failed started-attempt samples for R1 conditioning tests;
- explicit absent E0 authority.

Synthetic data may include deliberate strong chapter effect for diagnostics, but central probabilities remain pooled observed fixture values. No user ID, production ID, prose/title, prompt/response, URL, credential, or real provider claim.

Closure authority binds:

- approved spec SHA `af28b45dcd62544f12415476aa62bd3a09fd8f7e`;
- E2 closure SHA `914cf30f42d4e7f293df79e0d66c014331a696ba`;
- exact E2 19-row ID/order/dispositions;
- reviewed closure file blob hashes for catalog, gate, normalization, artifacts, E2 runner, and closure-reference tests;
- expected focused E1/E2 test list;
- explicit prohibition on using E1/E2 fault schedule frequencies as central probabilities.

Regression verifies both SHAs resolve as Git objects, frozen blob identities/catalog/dispositions match, protected current semantics remain compatible, and focused tests remain green. It does not require descendant files to be byte-equal when existing approved post-anchor corrections are part of current authority; manifest must bind exact reviewed blobs chosen from closure authority rather than guessing all-tree equality.

## Tests written with P10

- Fixture strict parse, deterministic hashes, safe-field scan.
- Exact pool/cell/distribution/judge/mean counts.
- Fixture reaches engineering PASS only while release HOLD and budget blocked.
- Release profile cannot be constructed by relabeling fixture.
- Git authority/object/blob/catalog/disposition checks.
- E1/E2 fault frequency cannot enter observation/model inputs.

Negative/mutation cases:

- missing stage/cell/key/judge entry; mixed stratum; fabricated release label/count; safety count positive; missing authority; SHA/blob/catalog/order/disposition mutation; fixture observation ref points into E2 schedule; protected E1/E2 semantic edit; closure test omitted.

Acceptance:

```bash
pnpm exec vitest run tests/narrative-qa/m10-e-reliability-fixture.test.ts tests/narrative-qa/m10-e-e1-e2-closure-regression.test.ts
pnpm exec vitest run tests/narrative-qa/m10-e1-fault-evidence.test.ts tests/narrative-qa/m10-e2-bindings.test.ts tests/narrative-qa/m10-e2-evidence.test.ts tests/narrative-qa/m10-e2-external-call-guard.test.ts tests/narrative-qa/m10-e2-reset-cleanup.test.ts tests/narrative-qa/m10-e2-rows-1-9.test.ts tests/narrative-qa/m10-e2-runner.test.ts tests/narrative-qa/m10-e2-telemetry-reference.test.ts
```

STOP if approved SHAs/blobs cannot be verified, E1/E2 semantics must change, fixture needs fault frequency as incidence, or fixture needs fabricated release volume.

---

# P11 — Orchestration, full verification, and deterministic counted evidence

## Files

Create:

- `scripts/m10-e-e3a-e4.ts`
- `scripts/m10-e-e3a-e4-cli.ts`
- `scripts/m10-e-e3a-e4-compare.ts`
- `scripts/m10-e-e3a-e4-compare-cli.ts`
- `tests/narrative-qa/m10-e-e3a-e4-runner.test.ts`
- `tests/narrative-qa/m10-e-e3a-e4-counted-comparison.test.ts`
- `tests/narrative-qa/m10-e-reliability-security-regression.test.ts`

Modify:

- `package.json`
- `docs/qa/m10/M10_E_RELIABILITY_COST_REPORT.md` only with accepted deterministic fixture report generated from validated artifact.

Add scripts:

```json
"m10:e:e3a-e4": "node scripts/run-smoke.cjs scripts/m10-e-e3a-e4-cli.ts",
"m10:e:e3a-e4:compare": "node scripts/run-smoke.cjs scripts/m10-e-e3a-e4-compare-cli.ts",
"test:m10:e:e3a-e4": "pnpm exec vitest run tests/narrative-qa/m10-e-reliability-*.test.ts tests/narrative-qa/m10-e-e1-e2-closure-regression.test.ts tests/narrative-qa/m10-e-e3a-e4-runner.test.ts tests/narrative-qa/m10-e-e3a-e4-counted-comparison.test.ts"
```

Do not add command to generic `smoke` or `test` chain before reviewer acceptance.

Dependencies: P1–P10.

## Implementation contract

Public runner accepts injected Git metadata reader, telemetry adapter, clock, and artifact writer. Public CLI accepts only:

```text
--profile=CONTRACT_FIXTURE
--seed=m10-e-e3a-e4-contract-v1
```

`--profile=RELEASE_EVIDENCE` exits nonzero with `RELEASE_EVIDENCE_NOT_AUTHORIZED` before adapter/network access. No DB/provider/URL/key/production option.

Runner order:

1. Verify approved spec and E2 closure authorities.
2. Capture current Git SHA and dirty state once; require clean tree for counted evidence.
3. Reject unauthorized source before reads.
4. Load strict fixture through adapter.
5. Validate authorities, provenance, topology, strata, completeness, and safe projection.
6. Aggregate observations.
7. Build/validate cost distributions and normalized model input.
8. Run exactly 100000 iterations.
9. Evaluate engineering gate, release readiness, and budget gate with `E0 authority = null`.
10. Build normalized semantic payload excluding only declared hash-DAG fields.
11. Recompute authorities, observations, aggregation, model output, gates, and semantic payload; compute `artifactSemanticHash`; return branded validated semantic artifact.
12. Render report only from branded semantic artifact and hash exact UTF-8 report bytes.
13. Build final raw/normalized envelopes binding `artifactSemanticHash` and `reportHash`; no placeholder hash.
14. Validate final pair plus exact report bytes, recomputing both hashes.
15. Write artifacts only after final validation.
16. Print stable execution-directory path plus exact counts, hashes, and locked statuses.

Runner exits `0` only for exact fixture engineering PASS plus release HOLD and blocked budget. It never prints E3A/E4 closed, G2 closed, or M10-E PASS.

## Tests written with P11

- Orchestration order and one-time Git read.
- Dirty-tree/authority/source rejection before adapter.
- No artifact write on any failure.
- Release profile rejection before reads.
- Environment E0/provider/Supabase values ignored or rejected.
- Full embedded recomputation and exact status output.
- Security source scan and no network/provider/mutation proof.
- Two execution instances may have different physical IDs but identical normalized artifact bytes, model bytes/hash, semantic hash, report bytes/hash, and counted evidence.
- Counted comparator accepts exactly two execution directories, validates both complete artifact/report sets first, checks every deterministic equality and raw operational-only difference, scans entire E3A/E4 artifact root for forbidden `RELEASE_EVIDENCE`, and exits nonzero on mismatch.
- Comparator tests cover missing/corrupt pair, changed normalized/model/report/count bytes, semantic raw change, allowed operational raw change, extra third argument, and forbidden release artifact.

Negative/mutation cases:

- wrong spec/closure SHA; dirty tree; unauthorized source; release profile; environment-supplied E0/provider/DB authority; early artifact write; placeholder report hash; corrupt semantic/final pair; normalized/model/report/count mismatch; non-operational raw mismatch; third comparator directory; forbidden release artifact; positive safety count; omitted E1/E2 regression; overclaiming status.

Counted output must include:

```text
stagePools                         11/11
chapterStageCells                 <observed>/<expected>
generationDistributionKeys        250/250
judgeDistributionKeys             <observed>/<expected>
modeledIterations                 100000/100000
modeledChapterMeans               50/50
successfulIterationCount          <exact>
failedIterationCount              <exact>
startedIterationCount             100000
observedComparatorCoverage        included/excluded/eligible per comparator
E2Rows                             19/19
duplicatePublicationCount         0
canonicalCorruptionCount          0
```

Acceptance:

## Final acceptance sequence

Run from exact clean implementation SHA. Counted run directories remain untracked/ignored and unique.

```bash
git status --short
git diff --check
pnpm run test:m10:e:e3a-e4
pnpm exec vitest run tests/narrative-qa/m10-e1-fault-evidence.test.ts
pnpm exec vitest run tests/narrative-qa/m10-e2-bindings.test.ts tests/narrative-qa/m10-e2-evidence.test.ts tests/narrative-qa/m10-e2-external-call-guard.test.ts tests/narrative-qa/m10-e2-reset-cleanup.test.ts tests/narrative-qa/m10-e2-rows-1-9.test.ts tests/narrative-qa/m10-e2-runner.test.ts tests/narrative-qa/m10-e2-telemetry-reference.test.ts
pnpm typecheck
pnpm lint
pnpm run m10:e:e3a-e4
pnpm run m10:e:e3a-e4
pnpm run m10:e:e3a-e4:compare -- <first-execution-directory> <second-execution-directory>
git diff --check
git status --short
```

After both successful counted runs, compare exact files and extracted counts with a repository script/test, not shell text parsing alone:

- normalized JSON byte equality;
- normalized semantic hash equality;
- model output byte/hash equality;
- report Markdown byte/hash equality;
- counted totals equality;
- raw differences limited to explicit operational paths;
- no `RELEASE_EVIDENCE` artifact anywhere under E3A/E4 artifact root.

Expected final status:

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

P11 STOP if any test/typecheck/lint/diff check fails; counted bytes/hashes differ; tree contains unauthorized paths; safety count is positive; E1/E2 authority regresses; release artifact exists; report overclaims; budget status differs; or source access exceeds fixture/authorized isolated boundary.

## 4. Commit boundaries after separate implementation GO

No commit or push during plan review. After implementation GO, use reviewable boundaries:

1. P1–P2: `feat(reliability): add strict contracts and exact decimals`
2. P3: `feat(reliability): freeze E3A E4 model authorities`
3. P4: `feat(reliability): aggregate reliability observations`
4. P5: `feat(reliability): add pricing and cost distributions`
5. P6: `feat(reliability): add deterministic cumulative model`
6. P7: `feat(reliability): add fail-closed engineering and budget gates`
7. P8–P9: `feat(reliability): add validated artifacts and telemetry boundary`
8. P10–P11: `test(reliability): add governed E3A E4 evidence package`

Each commit requires its focused acceptance commands, `pnpm typecheck`, relevant lint, and `git diff --check`. Preserve failed-evidence commits if reviewer policy requires historical evidence. Do not amend, squash, push, merge, or start next phase without explicit authority.

## 5. Package-wide STOP conditions

Stop and request review immediately if any applies:

- exact spec authority `af28b45dcd62544f12415476aa62bd3a09fd8f7e` or E2 closure anchor cannot be resolved/verified;
- required telemetry needs production runtime/schema instrumentation;
- observed, modeled, assumed, pricing-derived, and business-authority values cannot stay distinct;
- missing telemetry/cost must become zero;
- decimal, percentile, PRNG, or Monte Carlo result is non-deterministic;
- mixed currency requires unapproved conversion;
- exchangeability authority is missing, malformed, hash-mismatched, unsupported, or contradicted by incompatible stratum;
- central model must become chapter-conditioned without approved version bump/full rerun;
- any central probability would use fault-injection schedule frequency;
- any required generation/judge cost distribution needs zero/default imputation;
- `maxExpectedCostPerNovel` must use started-attempt spend;
- artifact/report hashing becomes self-referential;
- E1/E2 authority, source, catalog, disposition, hash, version, test, or semantics must change;
- numeric E0 ceilings are needed to continue engineering;
- production/shared/linked DB, `--linked`, real provider/model, runtime/provider change, migration, RPC, or tracked isolation-config edit becomes necessary;
- E5/E-OPS-1, M10-F, G2-BUDGET closure, M10-E closure, or production work becomes entangled.

Plan execution ends after deterministic fixture evidence and verification. Reviewer must separately authorize implementation start, commits/pushes, and any later release-evidence work.
