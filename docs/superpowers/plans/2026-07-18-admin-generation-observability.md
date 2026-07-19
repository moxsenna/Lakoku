# Admin Generation Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record one sanitized row for every real generation-provider request, then expose bounded, read-only operations and cost views to `owner` and `admin` users.

**Architecture:** PostgreSQL owns append-only provider-call records, temporal pricing, retention aggregates, admin authorization, masked identity, and bounded read RPCs. One TypeScript wrapper surrounds each real `streamText()` invocation, receives trusted workflow identity from synchronous generation or a claimed durable job, and records telemetry best-effort without changing generation success or failure. `/admin/generation` becomes a server-rendered RPC consumer with URL-stable filters, cursor pagination, explicit partial-data states, and read-only job drill-down.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.7, AI SDK 7, Zod 4, Supabase/PostgreSQL 15, PL/pgSQL, pgTAP, Vitest, Tailwind CSS.

---

## Scope lock and implementation decisions

This plan implements P0 read-only observability from `docs/superpowers/specs/2026-07-18-admin-generation-observability-design.md`.

Included:

- One row per external model request in standard chapter, personalized contract/chapter, repair, choice, and fallback paths.
- Shared provider boundary reusable by a durable worker.
- Actual provider/model when AI SDK final-step metadata reports it; configured identity plus a data-quality counter when provider metadata cannot resolve it.
- Provider actual cost first, temporal price estimate second, visibly unavailable otherwise.
- Detail retention for 90 days and identity-free daily aggregates for 13 months.
- Six admin RPCs, DB email masking, owner/admin authorization, detail-access audit, and read-only dashboard.
- Provider-call, job, pricing, privacy, retention, query, and UI tests.

Excluded:

- Worker claim loop or API cutover. Existing durable-job contracts only gain a telemetry-context adapter.
- Pricing editor, CSV export, alerts, saved views, budgets, and retention scheduler UI. These are P1.
- Retry, cancel, route editing, provider override, or other controls. These are P2.
- `lib/authoring/model.ts` calls made before a stable story identity exists. P0 enforces the spec rule that synchronous records carry trusted user and story identity. Add a static inventory assertion so this exclusion stays visible; expanding telemetry to pre-story authoring requires a separate identity design.

Locked physical-schema decisions:

1. `story_id` remains `text`; current stories use opaque text IDs.
2. `route_version` is `text`, not `bigint`, because `AiModelRoute.routeVersion` currently contains values such as `2026-07-default`, `fallback-code`, and `chapter-v1`. No lossy cast occurs.
3. `correlation_id` is required for every provider call. Synchronous entry points create it before generation; durable calls reuse `generation_jobs.correlation_id`.
4. A new UUID is created before each actual provider request. Repeated persistence for the same request is idempotent; a genuine retry/fallback receives a new ID.
5. OpenRouter model lists become explicit candidates. This removes hidden request-level model fallback and makes fallback index and selected model attributable.
6. `generation_provider_calls` has no FK to `auth.users` or `stories`. Append-only detail must not block account/story deletion. Trusted IDs remain bounded scalar snapshots; admin output joins current identities when present and masks email in SQL.
7. Initial dashboard range is at most 90 days. P50/P95 use retained detail only; daily aggregates are not used to fabricate long-range percentiles.
8. Admin generation loaders use cookie-scoped `createClient()` so `auth.uid()` reaches DB authorization helpers. They never use `createAdminClient()` for observability RPCs.
9. AI SDK 7 usage comes from `await result.usage`; final response identity and provider metadata come from `await result.finalStep`, including `finalStep.response.modelId` and `finalStep.providerMetadata`. Raw metadata, response headers, request body, prompt, and output never enter recorder input.

## File structure

Create:

- `supabase/migrations/20260718100000_generation_provider_observability.sql` — provider-call, pricing, aggregate, and access-audit tables; constraints; identity trigger; recorder and retention RPCs.
- `supabase/migrations/20260718110000_admin_generation_observability_rpcs.sql` — role check, email masking, and six admin read RPCs.
- `supabase/tests/generation_provider_calls_schema_test.sql` — schema, privacy, ACL, append-only, and job-identity tests.
- `supabase/tests/generation_provider_call_recording_test.sql` — idempotency and cost-source tests.
- `supabase/tests/generation_provider_retention_test.sql` — rollup, cutoff, batching, and retry tests.
- `supabase/tests/admin_generation_observability_rpc_test.sql` — authorization, masking, filtering, pagination, aggregates, job timeline, and audit tests.
- `lib/observability/generation-provider-call.contract.ts` — strict trusted context, candidate, outcome, usage, and write contracts.
- `lib/observability/generation-provider-call.server.ts` — Supabase recorder adapter and bounded error normalization.
- `lib/ai-gateway/observed-model-call.server.ts` — one-call lifecycle wrapper around AI SDK `streamText()`.
- `lib/runtime/generation-provider-context.ts` — synchronous and claimed-job context builders.
- `lib/admin/generation-schemas.ts` — strict RPC reader schemas.
- `lib/admin/generation-filters.ts` — bounded URL parsing, serialization, and cursor contract.
- `components/admin/generation/generation-filter-bar.tsx` — URL filter controls.
- `components/admin/generation/generation-summary-grid.tsx` — operational and cost cards.
- `components/admin/generation/generation-timeseries.tsx` — accessible CSS/SVG trend with table fallback.
- `components/admin/generation/model-performance-table.tsx` — provider/model comparison.
- `components/admin/generation/error-fallback-distribution.tsx` — controlled error and fallback distribution.
- `components/admin/generation/provider-call-ledger.tsx` — cursor-paginated call ledger.
- `components/admin/generation/generation-job-drawer.tsx` — read-only job timeline.
- `components/admin/generation/generation-data-quality.tsx` — partial-data counters.
- `app/admin/generation/loading.tsx` — route loading state.
- `tests/observability/generation-provider-call-contract.test.ts`
- `tests/observability/generation-provider-call-recording.test.ts`
- `tests/ai-gateway/observed-model-call.test.ts`
- `tests/runtime/generation-provider-context.test.ts`
- `tests/admin/generation-schemas.test.ts`
- `tests/admin/generation-filters.test.ts`
- `tests/admin/generation.test.ts`
- `tests/admin/generation-view-model.test.ts`
- `scripts/admin-generation-observability-smoke.ts`
- `scripts/generation-observability-retention.ts`

Modify:

- `lib/ai-gateway/provider.ts` — add execution context and workflow-phase options.
- `lib/ai-gateway/gateway-provider.ts` — structured candidates, explicit OpenRouter fallback, observed call wrapper.
- `lib/ai-gateway/select-provider.ts` — accept trusted execution context.
- `lib/ai-gateway/generate.ts` — pass explicit prose repair phases.
- `lib/ai-gateway/gateway.ts` — forward per-call phase/options.
- `lib/runtime/story-generation.ts` — accept standard user/correlation identity and reuse context.
- `lib/runtime/personalized-generation.ts` — add correlation/job identity and reuse context.
- `lib/api/start-chapter.server.ts` — create correlation ID and pass authenticated user.
- `lib/api/generation-continuation.server.ts` — carry authenticated user and correlation ID.
- `app/api/stories/[id]/choices/route.ts` — pass session user into standard continuation.
- `lib/api/personalized-stories.server.ts` — pass contract-generation identity.
- `lib/story-engine/contract-generation.server.ts` — distinguish initial and repair provider-call phases.
- `tests/story-engine/contract-generation.test.ts` — verify initial/repair phase propagation.
- `lib/runtime/index.ts` — export claimed-job context adapter.
- `lib/admin/generation.ts` — replace broken `story_events` reads with typed RPC loaders.
- `lib/admin/dashboard.ts` — derive generation summary from same overview RPC.
- `app/admin/generation/page.tsx` — operations-first dashboard.
- `components/admin/status-badge.tsx` — provider-call and generation-job statuses.
- `scripts/admin-panel-smoke.ts` — assert read-only observability route.
- `package.json` — focused unit, DB, retention, and smoke gates.

Do not modify:

- Existing `story_events` consistency semantics.
- Existing `credit_ledger` product-credit semantics.
- Existing durable job state machine or publication fencing except test fixtures needed to create linked telemetry rows.
- `lib/authoring/model.ts` provider behavior.

---

### Task 1: Add strict provider-call contracts

**Files:**
- Create: `lib/observability/generation-provider-call.contract.ts`
- Create: `tests/observability/generation-provider-call-contract.test.ts`

- [ ] **Step 1: Write failing contract tests**

Test these exact invariants:

```ts
import { describe, expect, it } from 'vitest'
import {
  ModelCandidateIdentitySchema,
  ProviderCallCompletionSchema,
  ProviderCallContextSchema,
} from '@/lib/observability/generation-provider-call.contract'

const syncContext = {
  userId: '10000000-0000-4000-8000-000000000001',
  storyId: 'story-1',
  chapterNumber: 2,
  generationKind: 'standard',
  jobId: null,
  correlationId: '20000000-0000-4000-8000-000000000002',
  attemptNumber: null,
}

describe('ProviderCallContextSchema', () => {
  it('accepts trusted synchronous identity', () => {
    expect(ProviderCallContextSchema.parse(syncContext)).toEqual(syncContext)
  })

  it('requires job and attempt together', () => {
    expect(() => ProviderCallContextSchema.parse({
      ...syncContext,
      jobId: '30000000-0000-4000-8000-000000000003',
    })).toThrow(/attemptNumber/)
  })

  it('rejects unrestricted metadata', () => {
    expect(() => ProviderCallContextSchema.parse({
      ...syncContext,
      metadata: { prompt: 'secret' },
    })).toThrow()
  })
})

describe('provider result contracts', () => {
  it('accepts structured candidate identity', () => {
    expect(ModelCandidateIdentitySchema.parse({
      providerId: 'openrouter',
      configuredModelId: 'anthropic/claude-sonnet-4',
      routeVersion: 'chapter-v1',
      fallbackIndex: 1,
    }).fallbackIndex).toBe(1)
  })

  it('rejects success with an error code', () => {
    expect(() => ProviderCallCompletionSchema.parse({
      actualProviderId: 'openrouter',
      actualModelId: 'anthropic/claude-sonnet-4',
      endedAt: '2026-07-18T12:00:01.000Z',
      elapsedMs: 1000,
      outcome: 'SUCCEEDED',
      errorCode: 'PROVIDER_FAILED',
      inputTokenCount: 10,
      outputTokenCount: 20,
      totalTokenCount: 30,
      providerActualCostAmount: null,
      providerActualCostCurrency: null,
      actualModelResolved: true,
    })).toThrow(/errorCode/)
  })
})
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
pnpm exec vitest run tests/observability/generation-provider-call-contract.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Add minimal strict contracts**

Create these exports and inferred types:

```ts
import { z } from 'zod'

export const ProviderCallOutcomeSchema = z.enum([
  'SUCCEEDED',
  'PROVIDER_ERROR',
  'TIMEOUT',
  'ABORTED',
  'INVALID_RESPONSE',
  'CONTENT_REJECTED',
])

export const ProviderCallCostSourceSchema = z.enum([
  'provider_actual',
  'price_estimate',
  'unavailable',
])

export const ProviderCallContextSchema = z.object({
  userId: z.string().uuid(),
  storyId: z.string().trim().min(1).max(200),
  chapterNumber: z.number().int().min(1).max(50).nullable(),
  generationKind: z.enum(['standard', 'personalized']).nullable(),
  jobId: z.string().uuid().nullable(),
  correlationId: z.string().uuid(),
  attemptNumber: z.number().int().min(1).max(20).nullable(),
}).strict().superRefine((value, ctx) => {
  if ((value.jobId === null) !== (value.attemptNumber === null)) {
    ctx.addIssue({
      code: 'custom',
      path: ['attemptNumber'],
      message: 'jobId and attemptNumber must be supplied together',
    })
  }
})

export const ModelCandidateIdentitySchema = z.object({
  providerId: z.string().trim().min(1).max(80),
  configuredModelId: z.string().trim().min(1).max(200),
  routeVersion: z.string().trim().min(1).max(100).nullable(),
  fallbackIndex: z.number().int().min(0).max(32),
}).strict()

export const ProviderCallCompletionSchema = z.object({
  actualProviderId: z.string().trim().min(1).max(80),
  actualModelId: z.string().trim().min(1).max(200),
  endedAt: z.iso.datetime({ offset: true }),
  elapsedMs: z.number().int().nonnegative(),
  outcome: ProviderCallOutcomeSchema,
  errorCode: z.string().regex(/^[A-Z0-9_]{1,100}$/).nullable(),
  inputTokenCount: z.number().int().nonnegative().nullable(),
  outputTokenCount: z.number().int().nonnegative().nullable(),
  totalTokenCount: z.number().int().nonnegative().nullable(),
  providerActualCostAmount: z.string().regex(/^\d+(?:\.\d{1,8})?$/).nullable(),
  providerActualCostCurrency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  actualModelResolved: z.boolean(),
}).strict().superRefine((value, ctx) => {
  if ((value.outcome === 'SUCCEEDED') !== (value.errorCode === null)) {
    ctx.addIssue({
      code: 'custom',
      path: ['errorCode'],
      message: 'errorCode must be null only for SUCCEEDED',
    })
  }
})

export type ProviderCallContext = z.infer<typeof ProviderCallContextSchema>
export type ModelCandidateIdentity = z.infer<typeof ModelCandidateIdentitySchema>
export type ProviderCallCompletion = z.infer<typeof ProviderCallCompletionSchema>
export type ProviderCallOutcome = z.infer<typeof ProviderCallOutcomeSchema>
```

- [ ] **Step 4: Run contract tests**

Run same Vitest command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/observability/generation-provider-call.contract.ts tests/observability/generation-provider-call-contract.test.ts
git commit -m "feat: define provider call telemetry contracts"
```

---

### Task 2: Add sanitized append-only provider-call schema

**Files:**
- Create: `supabase/migrations/20260718100000_generation_provider_observability.sql`
- Create: `supabase/tests/generation_provider_calls_schema_test.sql`

- [ ] **Step 1: Write failing pgTAP schema and privacy tests**

Use local marker guard from `supabase/tests/generation_jobs_schema_test.sql`. Assert:

```sql
select has_table('public', 'generation_provider_calls');
select has_column('public', 'generation_provider_calls', 'provider_call_id');
select has_column('public', 'generation_provider_calls', 'provider_id');
select has_column('public', 'generation_provider_calls', 'model_id');
select has_column('public', 'generation_provider_calls', 'cost_source');
select hasnt_column('public', 'generation_provider_calls', 'prompt');
select hasnt_column('public', 'generation_provider_calls', 'response');
select hasnt_column('public', 'generation_provider_calls', 'headers');
select hasnt_column('public', 'generation_provider_calls', 'metadata');
select hasnt_column('public', 'generation_provider_calls', 'payload');
select ok(not has_table_privilege('anon', 'public.generation_provider_calls', 'SELECT'));
select ok(not has_table_privilege('authenticated', 'public.generation_provider_calls', 'SELECT'));
select ok(not has_table_privilege('service_role', 'public.generation_provider_calls', 'UPDATE'));
select ok(not has_table_privilege('service_role', 'public.generation_provider_calls', 'DELETE'));
```

Add `throws_ok` cases for negative elapsed/tokens/cost, `ended_at < started_at`, inconsistent total tokens, unknown outcome, unknown cost source, oversized identifiers, success with error code, failure without error code, forged job identity, update, and delete.

- [ ] **Step 2: Run pgTAP and verify RED**

```powershell
pnpm exec supabase test db --local supabase/tests/generation_provider_calls_schema_test.sql
```

Expected: FAIL because table is absent.

- [ ] **Step 3: Create provider-call table and identity trigger**

Create exact columns:

```sql
create table public.generation_provider_calls (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  provider_call_id text not null unique,
  user_id uuid not null,
  story_id text not null,
  chapter_number integer,
  generation_kind text,
  job_id uuid references public.generation_jobs(id) on delete restrict,
  correlation_id uuid not null,
  attempt_number integer,
  use_case text not null,
  workflow_phase text not null,
  provider_id text not null,
  model_id text not null,
  route_version text,
  fallback_index integer not null,
  actual_model_resolved boolean not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  elapsed_ms bigint not null,
  outcome text not null,
  error_code text,
  input_token_count bigint,
  output_token_count bigint,
  total_token_count bigint,
  cost_amount numeric(20, 8),
  cost_currency text,
  cost_source text not null,
  pricing_version_id uuid,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (length(btrim(provider_call_id)) between 1 and 200),
  check (provider_call_id !~ '[[:cntrl:]]'),
  check (length(btrim(story_id)) between 1 and 200),
  check (chapter_number is null or chapter_number between 1 and 50),
  check (generation_kind is null or generation_kind in ('standard', 'personalized')),
  check ((job_id is null and attempt_number is null) or
         (job_id is not null and attempt_number between 1 and 20)),
  check (length(btrim(use_case)) between 1 and 100),
  check (length(btrim(workflow_phase)) between 1 and 100),
  check (length(btrim(provider_id)) between 1 and 80),
  check (length(btrim(model_id)) between 1 and 200),
  check (route_version is null or length(btrim(route_version)) between 1 and 100),
  check (fallback_index between 0 and 32),
  check (ended_at >= started_at),
  check (elapsed_ms >= 0),
  check (outcome in ('SUCCEEDED','PROVIDER_ERROR','TIMEOUT','ABORTED','INVALID_RESPONSE','CONTENT_REJECTED')),
  check ((outcome = 'SUCCEEDED' and error_code is null) or
         (outcome <> 'SUCCEEDED' and error_code ~ '^[A-Z0-9_]{1,100}$')),
  check (input_token_count is null or input_token_count >= 0),
  check (output_token_count is null or output_token_count >= 0),
  check (total_token_count is null or total_token_count >= 0),
  check (input_token_count is null or output_token_count is null or
         total_token_count is null or
         total_token_count = input_token_count + output_token_count),
  check (cost_amount is null or cost_amount >= 0),
  check (cost_currency is null or cost_currency ~ '^[A-Z]{3}$'),
  check (cost_source in ('provider_actual','price_estimate','unavailable'))
);
```

Create indexes for `(started_at desc, id desc)`, job timeline, correlation, provider/model, user, story/chapter, outcome/error, cost source, and retention cutoff.

Create `generation_provider_calls_enforce_identity_v1()` as `SECURITY DEFINER SET search_path = ''`. For inserts with `job_id`, load `generation_jobs` and require exact user, story, chapter, generation kind, correlation, and `attempt_number between 1 and attempt_count`; raise `GENERATION_PROVIDER_CALL_IDENTITY_MISMATCH` otherwise. Reject update/delete with `GENERATION_PROVIDER_CALL_APPEND_ONLY`.

Enable RLS. Revoke all table privileges from `public`, `anon`, `authenticated`, and `service_role`; grant only `SELECT, INSERT` to `service_role`. Revoke function execution from `PUBLIC`, `anon`, and `authenticated`.

- [ ] **Step 4: Reset local DB and run schema tests**

```powershell
pnpm exec supabase db reset
node scripts/run-smoke.cjs scripts/set-local-db-test-marker.ts
pnpm exec supabase test db --local supabase/tests/generation_provider_calls_schema_test.sql
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260718100000_generation_provider_observability.sql supabase/tests/generation_provider_calls_schema_test.sql
git commit -m "feat: add sanitized provider call schema"
```

---

### Task 3: Add temporal pricing and idempotent recorder RPC

**Files:**
- Modify: `supabase/migrations/20260718100000_generation_provider_observability.sql`
- Create: `supabase/tests/generation_provider_call_recording_test.sql`

- [ ] **Step 1: Write failing pricing and recorder tests**

Create fixtures and prove:

```sql
-- Provider actual cost wins even when matching price exists.
-- Effective price at started_at estimates cost when provider cost is absent.
-- Expired and future prices do not match.
-- Missing price or required token counts yields unavailable with NULL amount.
-- Overlapping effective windows for provider/model/currency are rejected.
-- Same provider_call_id plus identical fields returns duplicate=true.
-- Same provider_call_id plus changed identity/result raises
-- GENERATION_PROVIDER_CALL_IDEMPOTENCY_CONFLICT.
```

Use exact expected estimate:

```sql
-- input 1000 at USD 2 / 1,000,000 plus output 2000 at USD 6 / 1,000,000
select is(cost_amount, 0.01400000::numeric);
```

- [ ] **Step 2: Run test and verify RED**

```powershell
pnpm exec supabase test db --local supabase/tests/generation_provider_call_recording_test.sql
```

Expected: FAIL because pricing table and recorder RPC are absent.

- [ ] **Step 3: Add pricing table and complete cost constraints**

Add:

```sql
create table public.generation_model_pricing_versions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  provider_id text not null check (length(btrim(provider_id)) between 1 and 80),
  model_id text not null check (length(btrim(model_id)) between 1 and 200),
  input_token_price numeric(20, 8) not null check (input_token_price >= 0),
  output_token_price numeric(20, 8) not null check (output_token_price >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  unit_size bigint not null check (unit_size > 0),
  effective_from timestamptz not null,
  effective_to timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (effective_to is null or effective_to > effective_from),
  unique (provider_id, model_id, currency, effective_from)
);
```

Add exclusion/trigger logic rejecting overlapping effective ranges for identical provider/model/currency. Revoke direct access from application roles; grant service role `SELECT` only. Do not seed guessed prices.

Add `generation_provider_calls_cost_shape_check`:

```sql
check (
  (cost_source = 'unavailable' and cost_amount is null and
   cost_currency is null and pricing_version_id is null)
  or
  (cost_source = 'provider_actual' and cost_amount is not null and
   cost_currency is not null and pricing_version_id is null)
  or
  (cost_source = 'price_estimate' and cost_amount is not null and
   cost_currency is not null and pricing_version_id is not null)
)
```

- [ ] **Step 4: Add scalar-only recorder RPC**

Create `record_generation_provider_call_v1` with one scalar parameter per table field except DB-derived cost fields. Use `SECURITY DEFINER SET search_path = ''`; allow service role only. Apply precedence:

```sql
if p_provider_cost_amount is not null and p_provider_cost_currency ~ '^[A-Z]{3}$' then
  v_cost_source := 'provider_actual';
  v_cost_amount := p_provider_cost_amount;
  v_cost_currency := p_provider_cost_currency;
elsif p_input_token_count is not null and p_output_token_count is not null then
  select id, currency,
         (p_input_token_count::numeric / unit_size) * input_token_price
       + (p_output_token_count::numeric / unit_size) * output_token_price
  into v_pricing_version_id, v_cost_currency, v_cost_amount
  from public.generation_model_pricing_versions
  where provider_id = p_provider_id
    and model_id = p_model_id
    and effective_from <= p_started_at
    and (effective_to is null or p_started_at < effective_to)
  order by effective_from desc
  limit 1;
  v_cost_source := case when found then 'price_estimate' else 'unavailable' end;
else
  v_cost_source := 'unavailable';
end if;
```

Insert with `ON CONFLICT (provider_call_id) DO NOTHING`. On conflict, compare every supplied and derived scalar using `IS NOT DISTINCT FROM`; return `{"recorded":false,"duplicate":true}` only for exact match. Raise `GENERATION_PROVIDER_CALL_IDEMPOTENCY_CONFLICT` for mismatch.

- [ ] **Step 5: Run DB tests**

```powershell
pnpm exec supabase test db --local supabase/tests/generation_provider_calls_schema_test.sql supabase/tests/generation_provider_call_recording_test.sql
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260718100000_generation_provider_observability.sql supabase/tests/generation_provider_call_recording_test.sql
git commit -m "feat: record provider calls with versioned cost"
```

---

### Task 4: Add best-effort TypeScript recorder

**Files:**
- Create: `lib/observability/generation-provider-call.server.ts`
- Create: `tests/observability/generation-provider-call-recording.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Mock Supabase RPC and assert:

```ts
it('maps only explicit scalar fields to recorder RPC', async () => {
  await recordGenerationProviderCall(start, completion, { rpc })
  expect(rpc).toHaveBeenCalledWith('record_generation_provider_call_v1', {
    p_provider_call_id: start.providerCallId,
    p_user_id: start.context.userId,
    p_story_id: start.context.storyId,
    p_chapter_number: start.context.chapterNumber,
    p_generation_kind: start.context.generationKind,
    p_job_id: start.context.jobId,
    p_correlation_id: start.context.correlationId,
    p_attempt_number: start.context.attemptNumber,
    p_use_case: start.useCase,
    p_workflow_phase: start.workflowPhase,
    p_provider_id: completion.actualProviderId,
    p_model_id: completion.actualModelId,
    p_route_version: start.candidate.routeVersion,
    p_fallback_index: start.candidate.fallbackIndex,
    p_actual_model_resolved: completion.actualModelResolved,
    p_started_at: start.startedAt,
    p_ended_at: completion.endedAt,
    p_elapsed_ms: completion.elapsedMs,
    p_outcome: completion.outcome,
    p_error_code: completion.errorCode,
    p_input_token_count: completion.inputTokenCount,
    p_output_token_count: completion.outputTokenCount,
    p_total_token_count: completion.totalTokenCount,
    p_provider_cost_amount: completion.providerActualCostAmount,
    p_provider_cost_currency: completion.providerActualCostCurrency,
  })
})

it('does not reject when telemetry persistence fails', async () => {
  await expect(recordGenerationProviderCall(start, completion, {
    rpc: async () => ({ data: null, error: new Error('secret db text') }),
    logCode,
  })).resolves.toBeUndefined()
  expect(logCode).toHaveBeenCalledWith('GENERATION_PROVIDER_TELEMETRY_WRITE_FAILED')
})
```

- [ ] **Step 2: Run test and verify RED**

```powershell
pnpm exec vitest run tests/observability/generation-provider-call-recording.test.ts
```

Expected: FAIL because module is absent.

- [ ] **Step 3: Implement bounded recorder**

Export:

```ts
export interface ProviderCallStart {
  providerCallId: string
  context: ProviderCallContext
  candidate: ModelCandidateIdentity
  useCase: string
  workflowPhase: string
  startedAt: string
}

export interface ProviderCallRecorderDeps {
  rpc?: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown
    error: unknown
  }>
  logCode?: (code: 'GENERATION_PROVIDER_TELEMETRY_WRITE_FAILED') => void
}

export async function recordGenerationProviderCall(
  start: ProviderCallStart,
  completion: ProviderCallCompletion,
  deps: ProviderCallRecorderDeps = {},
): Promise<void>
```

Default RPC uses `createAdminClient()` from `lib/supabase/admin.ts`; this writer is server-only and service-role scoped. Parse start/completion before RPC. Catch all writer errors and emit only `GENERATION_PROVIDER_TELEMETRY_WRITE_FAILED`; never include raw DB text.

- [ ] **Step 4: Run tests**

```powershell
pnpm exec vitest run tests/observability/generation-provider-call-contract.test.ts tests/observability/generation-provider-call-recording.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/observability/generation-provider-call.server.ts tests/observability/generation-provider-call-recording.test.ts
git commit -m "feat: add best effort provider telemetry recorder"
```

---

### Task 5: Wrap one AI SDK request lifecycle

**Files:**
- Create: `lib/ai-gateway/observed-model-call.server.ts`
- Create: `tests/ai-gateway/observed-model-call.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Inject `streamText`, clock, ID, and recorder dependencies. Cover:

```ts
it.each([
  ['TimeoutError', 'TIMEOUT', 'PROVIDER_TIMEOUT'],
  ['AbortError', 'ABORTED', 'PROVIDER_ABORTED'],
  ['AI_InvalidResponseDataError', 'INVALID_RESPONSE', 'PROVIDER_INVALID_RESPONSE'],
  ['Error', 'PROVIDER_ERROR', 'PROVIDER_REQUEST_FAILED'],
])('records controlled failure for %s', async (name, outcome, errorCode) => {
  const error = Object.assign(new Error('raw provider secret'), { name })
  await expect(executeObservedModelCall(input, depsRejecting(error))).rejects.toBe(error)
  expect(record).toHaveBeenCalledWith(
    expect.any(Object),
    expect.objectContaining({ outcome, errorCode }),
  )
  expect(JSON.stringify(record.mock.calls)).not.toContain('raw provider secret')
})
```

Also assert success awaits `result.text`, `result.usage`, and `result.finalStep`; uses `finalStep.response.modelId`; allowlists provider cost; falls back to configured model with `actualModelResolved:false`; recorder failure preserves successful text; recorder failure never replaces original provider error; each invocation creates one ID before calling provider.

- [ ] **Step 2: Run test and verify RED**

```powershell
pnpm exec vitest run tests/ai-gateway/observed-model-call.test.ts
```

Expected: FAIL because wrapper is absent.

- [ ] **Step 3: Implement AI SDK 7 wrapper**

Export:

```ts
export interface ObservedModelCallInput<T> {
  context: ProviderCallContext
  candidate: ModelCandidateIdentity
  useCase: string
  workflowPhase: string
  call: () => ReturnType<typeof import('ai').streamText>
  consume: (text: string) => T | Promise<T>
}

export async function executeObservedModelCall<T>(
  input: ObservedModelCallInput<T>,
  deps: ObservedModelCallDeps = defaultObservedModelCallDeps,
): Promise<T>
```

Lifecycle:

```ts
const providerCallId = deps.createId()
const startedAt = deps.now()
const monotonicStart = deps.monotonicNow()

try {
  const result = input.call()
  const [text, usage, finalStep] = await Promise.all([
    result.text,
    result.usage,
    result.finalStep,
  ])
  const value = await input.consume(text)
  const actualModelId = finalStep.response.modelId || input.candidate.configuredModelId
  const completion = normalizeSuccessfulCompletion({
    usage,
    providerMetadata: finalStep.providerMetadata,
    actualModelId,
    actualModelResolved: Boolean(finalStep.response.modelId),
    endedAt: deps.now(),
    elapsedMs: Math.max(0, Math.round(deps.monotonicNow() - monotonicStart)),
  })
  await recordBestEffort(start, completion, deps)
  return value
} catch (error) {
  await recordBestEffort(start, normalizeFailedCompletion(error, deps), deps)
  throw error
}
```

`input.consume(text)` performs parse, schema validation, or content-leak validation inside observed lifecycle, so `INVALID_RESPONSE` and `CONTENT_REJECTED` become call outcomes rather than false successes. `recordBestEffort()` must guard `deps.record` so recorder failure is swallowed in both branches. Never pass `finalStep.request`, `finalStep.response.headers`, messages, text, prompt, or raw `providerMetadata` to recorder. Cost extraction reads only known numeric `cost` plus ISO currency when supported; all unknown shapes become null.

- [ ] **Step 4: Run tests**

```powershell
pnpm exec vitest run tests/ai-gateway/observed-model-call.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai-gateway/observed-model-call.server.ts tests/ai-gateway/observed-model-call.test.ts
git commit -m "feat: observe shared model call lifecycle"
```

---

### Task 6: Make candidate and fallback identity explicit

**Files:**
- Modify: `lib/ai-gateway/gateway-provider.ts`
- Modify: `tests/story-engine/contract-provider.test.ts`
- Modify: `tests/story-engine/choice-provider.test.ts`

- [ ] **Step 1: Add failing candidate/fallback tests**

Assert final chain entries expose:

```ts
{
  providerId: 'openrouter',
  configuredModelId: 'model-b',
  routeVersion: 'chapter-v1',
  fallbackIndex: 1,
}
```

Add test where `OPENROUTER_MODELS=model-a,model-b`: two separate provider calls occur, first failure gets index `0`, second success gets index `1`, and no single request contains a multi-model `models` fallback array.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
pnpm exec vitest run tests/story-engine/contract-provider.test.ts tests/story-engine/choice-provider.test.ts
```

Expected: FAIL because candidates only expose `label` and OpenRouter groups models.

- [ ] **Step 3: Refactor candidate type and chain expansion**

Use:

```ts
type ModelCandidate = {
  model: LanguageModel
  providerId: 'custom' | 'openrouter' | '9router' | 'gateway'
  configuredModelId: string
  routeVersion: string | null
  fallbackIndex: number
  label: string
}
```

Build raw candidates first, dedupe by `providerId + configuredModelId`, then assign `fallbackIndex` after DB and environment chains are merged. Create one OpenRouter model adapter per configured model. Keep `label` for bounded internal diagnostics only; never parse telemetry identity from it.

- [ ] **Step 4: Run focused regression tests**

```powershell
pnpm exec vitest run tests/story-engine/contract-provider.test.ts tests/story-engine/choice-provider.test.ts tests/story-engine/contract-generation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit isolated behavior change**

```bash
git add lib/ai-gateway/gateway-provider.ts tests/story-engine/contract-provider.test.ts tests/story-engine/choice-provider.test.ts
git commit -m "refactor: make provider fallback identity explicit"
```

---

### Task 7: Propagate trusted context through synchronous generation

**Files:**
- Create: `lib/runtime/generation-provider-context.ts`
- Create: `tests/runtime/generation-provider-context.test.ts`
- Modify: `lib/ai-gateway/provider.ts`
- Modify: `lib/ai-gateway/select-provider.ts`
- Modify: `lib/runtime/story-generation.ts`
- Modify: `lib/runtime/personalized-generation.ts`
- Modify: `lib/api/start-chapter.server.ts`
- Modify: `lib/api/generation-continuation.server.ts`
- Modify: `app/api/stories/[id]/choices/route.ts`
- Modify: `lib/api/personalized-stories.server.ts`
- Modify: `lib/story-engine/contract-generation.server.ts`
- Modify: `tests/story-engine/contract-generation.test.ts`
- Modify: `lib/runtime/index.ts`

- [ ] **Step 1: Write failing context tests**

Define expected builders:

```ts
expect(createSynchronousProviderContext({
  userId,
  storyId,
  chapterNumber: 2,
  generationKind: 'standard',
  correlationId,
})).toEqual({
  userId,
  storyId,
  chapterNumber: 2,
  generationKind: 'standard',
  jobId: null,
  correlationId,
  attemptNumber: null,
})

expect(providerContextFromClaim(claimedJob)).toEqual({
  userId: claimedJob.userId,
  storyId: claimedJob.storyId,
  chapterNumber: claimedJob.chapterNumber,
  generationKind: claimedJob.generationKind,
  jobId: claimedJob.id,
  correlationId: claimedJob.correlationId,
  attemptNumber: claimedJob.attemptCount,
})
```

Update existing standard/personalized/API tests to expect authenticated `userId` and one request-created `correlationId` to reach provider selection.

- [ ] **Step 2: Run tests and verify RED**

```powershell
pnpm exec vitest run tests/runtime/generation-provider-context.test.ts tests/runtime/personalized-generation.test.ts tests/api/generation-continuation.test.ts
```

Expected: FAIL because context builders and parameters are absent.

- [ ] **Step 3: Add context builders and provider options**

Add:

```ts
export interface ModelCallExecutionOptions {
  telemetryContext: ProviderCallContext
  workflowPhase: string
}
```

Extend `GenerationProvider.writeChapter`, `generateChoices`, and `generateStoryContract` with execution options. Deterministic provider accepts and ignores options.

Change standard runtime signature:

```ts
export interface StandardGenerateInput {
  storyId: string
  userId: string
  chapterNumber: number
  correlationId: string
}

export async function generateNextChapterReal(
  input: StandardGenerateInput,
): Promise<RealGenerateResult>
```

Extend personalized input with required `correlationId` and optional paired `jobId`/`attemptNumber`. At authenticated entry points, create `crypto.randomUUID()` once per generation workflow and pass session `user.id`. Contract generation uses `chapterNumber:null` and `generationKind:'personalized'`; `createResilientStoryContract()` passes `STORY_CONTRACT_INITIAL` on first call and `STORY_CONTRACT_REPAIR` on schema-repair call. Export `providerContextFromClaim()` from `lib/runtime/index.ts` for future worker reuse.

- [ ] **Step 4: Run focused tests**

```powershell
pnpm exec vitest run tests/runtime/generation-provider-context.test.ts tests/runtime/personalized-generation.test.ts tests/api/generation-continuation.test.ts tests/authoring/generation-route-authorization.test.ts tests/story-engine/contract-generation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/runtime/generation-provider-context.ts tests/runtime/generation-provider-context.test.ts lib/ai-gateway/provider.ts lib/ai-gateway/select-provider.ts lib/runtime/story-generation.ts lib/runtime/personalized-generation.ts lib/api/start-chapter.server.ts lib/api/generation-continuation.server.ts "app/api/stories/[id]/choices/route.ts" lib/api/personalized-stories.server.ts lib/story-engine/contract-generation.server.ts tests/story-engine/contract-generation.test.ts lib/runtime/index.ts
git commit -m "feat: propagate provider telemetry context"
```

---

### Task 8: Instrument prose, repair, choices, contracts, and fallback calls

**Files:**
- Modify: `lib/ai-gateway/gateway-provider.ts`
- Modify: `lib/ai-gateway/generate.ts`
- Modify: `lib/ai-gateway/gateway.ts`
- Modify: `tests/story-engine/contract-provider.test.ts`
- Modify: `tests/story-engine/choice-provider.test.ts`
- Modify: `tests/runtime/personalized-generation.test.ts`

- [ ] **Step 1: Add failing per-call instrumentation tests**

Cover exact phases:

```text
STORY_CONTRACT_INITIAL
STORY_CONTRACT_REPAIR
CHAPTER_PROSE_INITIAL
CHAPTER_PROSE_LEAK_REPAIR
CHAPTER_PROSE_LAYER_A_REPAIR_1
CHAPTER_PROSE_LAYER_A_REPAIR_2
CHAPTER_PROSE_LAYER_B_REPAIR_1
CHAPTER_PROSE_LAYER_B_REPAIR_2
CHOICES_INITIAL
```

Assert every actual `streamText()` call receives one unique provider-call ID, candidate failure is recorded before fallback success, leak retry uses same fallback index but new ID, response model overrides configured model, missing response model sets `actualModelResolved:false`, and telemetry writer failure does not change generation output.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
pnpm exec vitest run tests/ai-gateway/observed-model-call.test.ts tests/story-engine/contract-provider.test.ts tests/story-engine/choice-provider.test.ts tests/runtime/personalized-generation.test.ts
```

Expected: FAIL because gateway still calls `streamText()` directly.

- [ ] **Step 3: Replace every direct gateway `streamText()` invocation**

For each candidate attempt call:

```ts
const { text } = await executeObservedModelCall({
  context: options.telemetryContext,
  candidate: {
    providerId: candidate.providerId,
    configuredModelId: candidate.configuredModelId,
    routeVersion: candidate.routeVersion,
    fallbackIndex: candidate.fallbackIndex,
  },
  useCase,
  workflowPhase: options.workflowPhase,
  call: () => streamText({
    model: candidate.model,
    system,
    prompt,
    temperature,
    maxOutputTokens,
    abortSignal,
  }),
  consume: (text) => parseAndValidateForThisPhase(text),
})
```

Pass parse/schema/content validation through `consume`; classify its bounded typed validation errors as `INVALID_RESPONSE` or `CONTENT_REJECTED`. Create a separate observed request for leak repair. Replace raw fallback exception logging with bounded codes containing only phase, provider ID, configured model ID, and controlled error code.

- [ ] **Step 4: Add static authoring boundary inventory assertion**

In `scripts/admin-generation-observability-smoke.ts`, assert `lib/authoring/model.ts` remains the only direct `generateObject()` provider boundary excluded by scope, and every `streamText(` occurrence under `lib/ai-gateway` is inside `observed-model-call.server.ts` or passed as the `call` closure in `gateway-provider.ts`. This turns accidental unobserved generation calls into a release failure.

- [ ] **Step 5: Run instrumentation regressions**

```powershell
pnpm exec vitest run tests/ai-gateway/observed-model-call.test.ts tests/story-engine/contract-provider.test.ts tests/story-engine/choice-provider.test.ts tests/story-engine/contract-generation.test.ts tests/runtime/personalized-generation.test.ts
node scripts/run-smoke.cjs scripts/admin-generation-observability-smoke.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/ai-gateway/gateway-provider.ts lib/ai-gateway/generate.ts lib/ai-gateway/gateway.ts tests/story-engine/contract-provider.test.ts tests/story-engine/choice-provider.test.ts tests/runtime/personalized-generation.test.ts scripts/admin-generation-observability-smoke.ts
git commit -m "feat: record every generation provider call"
```

---

### Task 9: Add retention aggregates and bounded cleanup

**Files:**
- Modify: `supabase/migrations/20260718100000_generation_provider_observability.sql`
- Create: `supabase/tests/generation_provider_retention_test.sql`
- Create: `scripts/generation-observability-retention.ts`

- [ ] **Step 1: Write failing retention tests**

Prove:

- Detail newer than 90 days remains.
- Detail older than cutoff is selected in bounded batches using `FOR UPDATE SKIP LOCKED`.
- Selected rows roll up before deletion in same transaction.
- Repeated run does not double-count.
- Aggregate has no user/story/job/correlation columns.
- Aggregate older than 13 months is deleted in bounded batches.
- Newer cutoffs raise `INVALID_RETENTION_CUTOFF`.
- Failed transaction leaves detail intact.

- [ ] **Step 2: Run test and verify RED**

```powershell
pnpm exec supabase test db --local supabase/tests/generation_provider_retention_test.sql
```

Expected: FAIL because aggregate table/function are absent.

- [ ] **Step 3: Add identity-free daily aggregates**

Create `generation_provider_call_daily` keyed by:

```text
day, provider_id, model_id, use_case, workflow_phase,
outcome, generation_kind, cost_source, cost_currency
```

Store `call_count`, `success_count`, `fallback_call_count`, input/output/total token sums, `priced_call_count`, `unavailable_cost_count`, cost sum, elapsed sum, and elapsed max. Do not store identity fields. Enable RLS; revoke application access.

- [ ] **Step 4: Add cleanup RPC and maintenance loop**

Create:

```sql
rollup_and_purge_generation_provider_calls_v1(
  p_batch_size integer default 1000,
  p_detail_before timestamptz default pg_catalog.clock_timestamp() - interval '90 days',
  p_aggregate_before date default (pg_catalog.current_date - interval '13 months')::date
) returns jsonb
```

Bound `p_batch_size` to `1..5000`, reject unsafe cutoffs, select detail IDs with `FOR UPDATE SKIP LOCKED LIMIT p_batch_size`, upsert aggregate, delete exact selected IDs, delete a bounded aggregate batch, and return `rolledUp`, `deletedDetails`, `deletedAggregates`, and `hasMore`.

Create maintenance script that invokes RPC until `hasMore=false` or 100 batches, logs counts only, exits nonzero on RPC failure, and never prints service-role credentials.

- [ ] **Step 5: Run retention tests**

```powershell
pnpm exec supabase test db --local supabase/tests/generation_provider_retention_test.sql
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260718100000_generation_provider_observability.sql supabase/tests/generation_provider_retention_test.sql scripts/generation-observability-retention.ts
git commit -m "feat: retain provider call aggregates"
```

---

### Task 10: Add admin authorization, masking, and six read RPCs

**Files:**
- Create: `supabase/migrations/20260718110000_admin_generation_observability_rpcs.sql`
- Create: `supabase/tests/admin_generation_observability_rpc_test.sql`

- [ ] **Step 1: Write failing admin RPC security tests**

Test anonymous/authenticated non-admin denial, `owner` and `admin` success, fixed empty search path, no direct table grants, DB-masked email, bounded 90-day range, page size max 100, deterministic cursor ordering, filters, previous-period comparison, P50/P95, currency separation, job timeline order, omission of claim token/publication payload/raw errors, and one access-audit row for job detail.

- [ ] **Step 2: Run pgTAP and verify RED**

```powershell
pnpm exec supabase test db --local supabase/tests/admin_generation_observability_rpc_test.sql
```

Expected: FAIL because RPCs are absent.

- [ ] **Step 3: Add admin helper, email masker, and audit table**

Create `admin_generation_access_audit` with actor UUID, action enum `VIEW_CALL_DETAIL|VIEW_JOB_DETAIL|EXPORT_CALLS`, optional target IDs, bounded filter fingerprint, and timestamp. No email or raw filters.

Create private helpers:

```sql
private.require_generation_observability_reader_v1() returns uuid
private.mask_email_v1(p_email text) returns text
```

Reader helper requires `auth.uid()` and `admin_users.role in ('owner','admin')`; raise `ADMIN_REQUIRED`. Masking retains domain and at most first local-part character, for example `a***@example.com`.

- [ ] **Step 4: Add exact bounded RPCs**

Create:

```text
admin_generation_overview_v1
admin_generation_timeseries_v1
admin_model_performance_v1
admin_generation_provider_calls_v1
admin_generation_job_detail_v1
admin_generation_data_quality_v1
```

Every function uses `SECURITY DEFINER SET search_path = ''`, explicit scalar parameters, schema-qualified objects, stable errors, and typed table returns. Detail ledger orders `(started_at DESC, id DESC)` and applies cursor predicate `(started_at,id) < (p_cursor_started_at,p_cursor_id)`. Job calls order `(started_at ASC,id ASC)`; attempts order `(attempt_number ASC,started_at ASC,id ASC)`.

Overview returns current and preceding equal periods for calls, tokens, success/error/fallback rates, P50/P95, actual/estimated costs grouped by currency, unavailable-cost count, and active/failed/retrying/stale jobs. Stale means `RUNNING` with heartbeat/claim older than 75 seconds.

Data quality returns missing usage, unavailable pricing, unresolved actual model, calls lacking durable correlation, terminal job shape failures, and detail approaching retention cutoff.

- [ ] **Step 5: Run DB tests**

```powershell
pnpm exec supabase test db --local supabase/tests/generation_provider_calls_schema_test.sql supabase/tests/generation_provider_call_recording_test.sql supabase/tests/generation_provider_retention_test.sql supabase/tests/admin_generation_observability_rpc_test.sql
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260718110000_admin_generation_observability_rpcs.sql supabase/tests/admin_generation_observability_rpc_test.sql
git commit -m "feat: add admin generation observability queries"
```

---

### Task 11: Add strict admin filters, readers, and loaders

**Files:**
- Create: `lib/admin/generation-schemas.ts`
- Create: `lib/admin/generation-filters.ts`
- Create: `tests/admin/generation-schemas.test.ts`
- Create: `tests/admin/generation-filters.test.ts`
- Create: `tests/admin/generation.test.ts`
- Modify: `lib/admin/generation.ts`
- Modify: `lib/admin/dashboard.ts`

- [ ] **Step 1: Write failing reader/filter tests**

Test stable URL keys:

```text
from, to, provider, model, useCase, phase, outcome, errorCode,
costSource, userId, storyId, generationKind, jobId, correlationId,
chapter, cursorStartedAt, cursorId, pageSize
```

Assert 24-hour default, 90-day maximum, page size `1..100`, UUID validation, URL round-trip, unknown RPC fields rejected by strict Zod schemas, different currencies remain separate, partial data remains visible, and DB failures produce `AdminGenerationQueryError('QUERY_FAILED')` rather than zero metrics.

- [ ] **Step 2: Run tests and verify RED**

```powershell
pnpm exec vitest run tests/admin/generation-schemas.test.ts tests/admin/generation-filters.test.ts tests/admin/generation.test.ts
```

Expected: FAIL because modules/loaders are absent.

- [ ] **Step 3: Add strict schemas and filter parser**

Export:

```ts
export interface AdminGenerationFilters {
  from: string
  to: string
  providerId: string | null
  modelId: string | null
  useCase: string | null
  workflowPhase: string | null
  outcome: ProviderCallOutcome | null
  errorCode: string | null
  costSource: ProviderCallCostSource | null
  userId: string | null
  storyId: string | null
  generationKind: 'standard' | 'personalized' | null
  jobId: string | null
  correlationId: string | null
  chapterNumber: number | null
  cursorStartedAt: string | null
  cursorId: string | null
  pageSize: number
}
```

Add strict schemas for overview, timeseries, model performance, provider-call page, job detail, and data quality. Numeric DB values that can exceed JS safe integer stay decimal strings until display formatting.

- [ ] **Step 4: Replace broken loaders**

Use cookie-scoped client:

```ts
const supabase = await createClient()
const { data, error } = await supabase.rpc('admin_generation_overview_v1', args)
if (error) throw mapAdminGenerationError(error)
return AdminGenerationOverviewSchema.parse(data)
```

Export separate loaders plus `loadAdminGenerationDashboard()` using `Promise.all`. Remove `story_events.event_name` queries and broad catch-to-zero behavior. Change `lib/admin/dashboard.ts` to consume same overview RPC for generation summary; do not maintain separate formulas.

- [ ] **Step 5: Run tests**

```powershell
pnpm exec vitest run tests/admin/generation-schemas.test.ts tests/admin/generation-filters.test.ts tests/admin/generation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/admin/generation-schemas.ts lib/admin/generation-filters.ts tests/admin/generation-schemas.test.ts tests/admin/generation-filters.test.ts tests/admin/generation.test.ts lib/admin/generation.ts lib/admin/dashboard.ts
git commit -m "feat: load typed admin generation telemetry"
```

---

### Task 12: Build operations-first read-only dashboard

**Files:**
- Modify: `app/admin/generation/page.tsx`
- Create: `app/admin/generation/loading.tsx`
- Create: `components/admin/generation/generation-filter-bar.tsx`
- Create: `components/admin/generation/generation-summary-grid.tsx`
- Create: `components/admin/generation/generation-timeseries.tsx`
- Create: `components/admin/generation/model-performance-table.tsx`
- Create: `components/admin/generation/error-fallback-distribution.tsx`
- Create: `components/admin/generation/provider-call-ledger.tsx`
- Create: `components/admin/generation/generation-job-drawer.tsx`
- Create: `components/admin/generation/generation-data-quality.tsx`
- Create: `tests/admin/generation-view-model.test.ts`
- Modify: `components/admin/status-badge.tsx`
- Modify: `scripts/admin-generation-observability-smoke.ts`
- Modify: `scripts/admin-panel-smoke.ts`

- [ ] **Step 1: Write failing view-model and smoke tests**

Test loading, empty, query error, partial usage, unavailable cost, large page, cursor next link, filter preservation, masked identity, authorized user link, job drawer order, and absence of mutation labels:

```ts
expect(rendered).not.toMatch(/retry job|cancel job|recover job|edit route/i)
expect(rendered).toContain('Unavailable')
expect(nextHref).toContain('cursorStartedAt=')
expect(nextHref).toContain('provider=openrouter')
```

Smoke script must reject direct `story_events` access, `createAdminClient()` inside generation loader, raw email rendering, claim token/publication result fields, and mutation controls.

- [ ] **Step 2: Run tests and verify RED**

```powershell
pnpm exec vitest run tests/admin/generation-view-model.test.ts
node scripts/run-smoke.cjs scripts/admin-generation-observability-smoke.ts
```

Expected: FAIL because dashboard components are absent and old page remains.

- [ ] **Step 3: Implement server-rendered route composition**

Page order:

1. Header and selected range.
2. Data-quality warning.
3. Job-health strip.
4. Provider summary cards.
5. Cost/call/token trend.
6. Model-performance table.
7. Error/fallback distribution.
8. Provider-call ledger.
9. Job drawer when `jobId` exists.

Use existing `AdminStatCard`, `AdminSectionCard`, `AdminEmptyState`, `AdminErrorState`, and `StatusBadge`. Keep charts accessible with SVG/CSS plus a semantic table; do not add chart dependency. Separate cost series by currency. Render missing price/tokens as `Unavailable`, never zero.

- [ ] **Step 4: Implement URL filters and deterministic pagination**

Filter links/forms preserve every active key. Ledger user links target `/admin/users/{userId}`. Job links add `jobId` to current query. Next page carries both cursor values. Drawer shows job state, queue/claim/heartbeat/completion times, attempts, ordered provider calls, fallback sequence, controlled errors, totals, and authorized links; never shows claim token, content, or publication JSON.

- [ ] **Step 5: Run UI/static tests**

```powershell
pnpm exec vitest run tests/admin/generation-view-model.test.ts tests/admin/generation-schemas.test.ts tests/admin/generation-filters.test.ts tests/admin/generation.test.ts
node scripts/run-smoke.cjs scripts/admin-generation-observability-smoke.ts
node scripts/run-smoke.cjs scripts/admin-panel-smoke.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/admin/generation/page.tsx app/admin/generation/loading.tsx components/admin/generation components/admin/status-badge.tsx tests/admin/generation-view-model.test.ts scripts/admin-generation-observability-smoke.ts scripts/admin-panel-smoke.ts
git commit -m "feat: add generation operations dashboard"
```

---

### Task 13: Add gates and verify full rollout candidate

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add focused package scripts**

Add:

```json
{
  "test:generation-observability": "pnpm exec vitest run tests/observability tests/ai-gateway/observed-model-call.test.ts tests/runtime/generation-provider-context.test.ts tests/admin",
  "test:db:generation-observability": "node scripts/run-smoke.cjs scripts/runtime-baseline-sentinel.ts && pnpm exec supabase test db --local supabase/tests/runtime_lifecycle_baseline_test.sql supabase/tests/generation_jobs_schema_test.sql supabase/tests/generation_provider_calls_schema_test.sql supabase/tests/generation_provider_call_recording_test.sql supabase/tests/generation_provider_retention_test.sql supabase/tests/admin_generation_observability_rpc_test.sql",
  "smoke:admin-generation-observability": "node scripts/run-smoke.cjs scripts/admin-generation-observability-smoke.ts"
}
```

Append `smoke:admin-generation-observability` to aggregate `smoke` command after `smoke:admin-panel`.

- [ ] **Step 2: Run focused unit and static gates**

```powershell
pnpm run test:generation-observability
pnpm run smoke:admin-generation-observability
pnpm run smoke:admin-panel
pnpm run smoke:ai-model-routes
pnpm run smoke:generation-policy
```

Expected: all PASS.

- [ ] **Step 3: Run local DB gates**

These commands are destructive only to verified local Supabase:

```powershell
pnpm exec supabase start
pnpm exec supabase db reset
node scripts/run-smoke.cjs scripts/set-local-db-test-marker.ts
pnpm run test:db:generation-jobs
pnpm run test:db:generation-observability
pnpm run test:db:personalized
```

Expected: all PASS. Never set `lakoku.test_target = 'local-cli'` on linked/staging/production DB.

- [ ] **Step 4: Run code and build gates**

```powershell
pnpm run typecheck
pnpm run lint
pnpm run test:unit
$env:LAKOKU_DEPLOY = 'vps'
pnpm run build
Remove-Item Env:LAKOKU_DEPLOY
```

Expected: all PASS.

- [ ] **Step 5: Verify linked migration plan without applying**

```powershell
pnpm exec supabase db push --linked --include-all --dry-run
```

Expected: only unapplied observability migrations and any already-approved pending branch migrations appear; no drift or destructive SQL error. Do not run non-dry production push without explicit user confirmation.

- [ ] **Step 6: Commit gates**

```bash
git add package.json
git commit -m "chore: gate generation observability rollout"
```

---

## Rollout procedure

1. Merge schema, recorder, RPC, and UI code behind server deployment sequencing that applies DB migrations before app code.
2. Deploy migrations and verify table/function ACL plus `proconfig` contains empty `search_path` for every security-definer function.
3. Deploy provider recorder with `/admin/generation` still hidden from navigation if deployment supports feature gating.
4. Run one standard chapter and one personalized contract/chapter in a controlled account.
5. Verify one row per actual provider request, including failed fallback and repair requests; verify actual response model where provider reports it.
6. Force telemetry RPC failure and verify generation result remains authoritative.
7. Run `admin_generation_data_quality_v1` privately. Require zero forged job identity, zero invalid terminal shape, and understood missing usage/pricing/model-resolution counts.
8. Enable read-only dashboard. Verify owner and admin access; verify normal authenticated user denial.
9. Run retention script in count-only operational review, inspect cutoff, then schedule bounded service-role execution through owned VPS cron. Scheduler registration stays outside migration.
10. Observe 7–14 days before P1 planning.

Rollback:

- Hide dashboard and disable telemetry persistence at deployment configuration; generation continues.
- Keep schema and collected rows for diagnosis.
- Stop retention scheduler.
- Revert explicit OpenRouter fallback commit separately if provider behavior regresses.
- Never restore broken `story_events` metrics; show explicit telemetry-unavailable state instead.

## Final acceptance checklist

- Every external standard/personalized generation request gets one independent row.
- Durable claimed-job context maps to same recorder without worker-specific writes.
- Provider/model identity uses final response metadata when available.
- Token/cost/timing fields stay numeric, bounded, and nullable when unavailable.
- Provider actual cost overrides estimate; unknown price never becomes zero.
- Prompt, output, raw response, headers, credentials, raw exception, generic metadata, and payload columns do not exist.
- Telemetry persistence failure never changes generation result.
- Direct application/admin table access is denied; RPCs authorize `owner|admin` through `auth.uid()`.
- Email is masked in DB output.
- Cursor pagination has deterministic ordering without duplicate/omitted rows.
- Job drill-down omits claim token and publication JSON.
- Detail retention is 90 days; identity-free aggregate retention is 13 months.
- Page exposes no mutation controls.
- P1/P2 capabilities remain outside this implementation.
