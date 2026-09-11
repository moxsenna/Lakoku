# GATES — M10-G G-1 authority verification

Every gate below is machine-checkable. `CHECK:` is the exact command; `EXPECT:`
is the pass oracle. A gate is PASS only when the command exits as specified and
the oracle holds. "Artifact exists" is never a pass condition.

## Boundary (frozen, still in force)

| Action | Authorized |
|---|---|
| completion inference | 0 |
| DB access / write | 0 |
| commit | NOT AUTHORIZED |
| push | NOT AUTHORIZED |
| publication / deployment | 0 |

`writerLengthRepairV1Enabled = false`; length-repair transports `0`.
`184 / 2663` remain diagnostic topology only — never copied into `hardLimit`.

## G-A — generation policy authority

CHECK: `npx vitest run tests/narrative-qa/m10-g-g1-remaining-authority.test.ts`
EXPECT: exit 0; `evaluateM10GG1GenerationPolicyAuthority().status ===
'BLOCKED_GENERATION_POLICY_AUTHORITY_SOURCE'` with 9 unbound fields.

Blocking evidence: `supabase/migrations/20260711010000_ops_credit_config.sql:197`
seeds `generation_policy` with `on conflict (id) do update`, so the seed cannot
prove current production values. `lib/ops/generation-policy.ts` states the DB is
the source of truth and code holds only a fallback.

STATUS: **BLOCKED** — mutable runtime state cannot supply G-1 authority
(invariant `NO_G1_AUTHORITY_FROM_MUTABLE_RUNTIME_STATE`).

## G-B — token bound authority

CHECK: `npx vitest run tests/narrative-qa/m10-g-g1-token-envelope.test.ts`
EXPECT: exit 0; status `BLOCKED_TOKENIZER_OR_TOKEN_BOUND_AUTHORITY`;
`outputAuthorityStatus === 'BLOCKED_OUTPUT_TOKEN_AUTHORITY_UNBOUND'`;
`choiceRouteBindingResolved === true`.

Blocking evidence: `lib/narrative/compiler.ts:11` documents `estimateTokens` as a
coarse word-count proxy, not a tokenizer authority. No frozen official tokenizer
exists for 6 reachable candidates. `deepseek/deepseek-v3.2` on the long-horizon
semantic judge route has an omitted output cap.

Forbidden shortcut: `bytes ≤ context ⇒ tokens ≤ bytes ⇒ issue hard limit`.

STATUS: **BLOCKED**

## G-C — pricing authority

CHECK: `npx vitest run tests/narrative-qa/m10-g-g1-pricing-snapshot.test.ts`
EXPECT: exit 0; status `BLOCKED_PRICING_AUTHORITY_MISSING`; snapshot canonical
hash unchanged; `additionalEndpointFetched === false`.

Blocking evidence: `fixtures/m10-g/pricing-snapshot-v1.json` omits reasoning
pricing (4/4 models) and tier data (4/4), and cache-write pricing (3/4). Six
required authorities remain unproven, listed in
`M10G_G1_PRICING_REQUIRED_ADDITIONAL_AUTHORITY`.

STATUS: **BLOCKED**

## G-D — economics

CHECK: `npx vitest run tests/narrative-qa/m10-g-g1-inference-projection.test.ts`
EXPECT: exit 0; `hardInferenceLimit === null`;
`nominalProjectedCost === 'UNAVAILABLE'`; minimum 184 / maximum 2663 unchanged.

STATUS: **BLOCKED** — economics is the last consumer and stays closed while any
of A/B/C is blocked.

## G-INV — fail-closed invariant

> If any A/B/C authority is BLOCKED: no executor construction capable of network
> I/O, no `GlobalInferenceBudget` issuance with a hard limit, no chapter
> invocation.

CHECK: `npx vitest run tests/narrative-qa/m10-g-g1-live-authority-failclosed.test.ts`
EXPECT: exit 0, 5 tests pass, using the REAL authority (no mocks):
- `issueM10GG1ExecutionCapability()` throws `M10G_G1_LIVE_AUTHORITY_BLOCKED:…`
- `runM10GG1ProofOrchestrationLive()` rejects on the authority gate *before*
  capability verification or budget construction
- `resolveM10GG1FrozenGenerationPolicy()` throws
  `M10G_G1_GENERATION_POLICY_AUTHORITY_UNBOUND`

Enforcement points: `lib/runtime/m10-g-g1-execution-capability.server.ts`
(`assertM10GG1LiveAuthorityOpen`, called from issuance) and
`lib/narrative-qa/harness/m10-g-g1-runner.server.ts` (called first in the live
entry point).

STATUS: **PASS** — invariant enforced and proven.

## G-REG — regression and typecheck

CHECK: `pnpm typecheck`
EXPECT: exit 0.

CHECK: `npx vitest run tests/narrative-qa tests/runtime tests/ai-gateway`
EXPECT: exit 0, zero failed tests.

## Live-run readiness

Live G-1 execution is authorized only when G-A, G-B, G-C, and G-D all read PASS
*and* the PM issues explicit budget authorization. Today that is
**NOT READY**: four blockers stand.
