# Align Choices Gateway + Admin Runtime Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Copy `chapter_prose` AI model route onto `choices`, fix admin structured fallbacks (+ copy button), and make lease TTL + concurrency caps editable via `generation_policy` in Admin Settings.

**Architecture:** One migration updates `choices` route data and adds policy columns. Runtime reads extended `getGenerationPolicy()` for lease TTL and concurrency caps (env still overrides concurrency in emergencies). Admin settings schemas/UI accept structured `{provider, modelId}` fallbacks and new policy fields. No new tables.

**Tech Stack:** Next.js App Router, Supabase SQL migrations, Zod, Vitest, existing admin settings patterns (`lib/admin/settings.ts`, `components/admin/settings/*`).

**Spec:** `docs/superpowers/specs/2026-07-22-align-choices-gateway-admin-runtime-design.md`

---

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/20260722090000_align_choices_and_runtime_policy.sql` | Align choices route + policy columns |
| `lib/ops/generation-policy.ts` | Read extended policy from DB |
| `lib/ops/ai-model-routes.ts` | Already has `normalizeFallbackModels` — reuse from admin |
| `lib/runtime/generation-concurrency.ts` | Caps from env or refreshed policy |
| `lib/runtime/story-generation.ts` | Lease TTL from policy |
| `lib/runtime/personalized-generation.ts` | Lease TTL from policy |
| `lib/ai-gateway/gateway-provider.ts` | Optional: dead free OpenRouter default fix |
| `lib/admin/settings-schemas.ts` | Zod for structured fallbacks + policy fields |
| `lib/admin/settings.ts` | list/update routes & policy |
| `app/api/admin/settings/model-routes/route.ts` | unchanged shape if schema handles body |
| `app/api/admin/settings/generation-policy/route.ts` | body via schema |
| `components/admin/settings/edit-ai-model-route-dialog.tsx` | Structured fallbacks + copy |
| `components/admin/settings/edit-generation-policy-dialog.tsx` | Lease + concurrency fields |
| `app/admin/settings/page.tsx` | Display new fields / pass prose route to dialog |
| `tests/ops/generation-policy.test.ts` | New unit tests |
| `tests/admin/settings-schemas.test.ts` | New or extend schema tests |
| `tests/runtime/generation-concurrency-config.test.ts` | Cap refresh + env override |

---

### Task 1: Migration — align choices + policy columns

**Files:**
- Create: `supabase/migrations/20260722090000_align_choices_and_runtime_policy.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- Align choices route to chapter_prose primary/fallbacks; extend generation_policy.

-- 1) Policy columns (safe defaults match current code/env)
alter table public.generation_policy
  add column if not exists lease_ttl_seconds integer not null default 300,
  add column if not exists max_concurrent_generations integer not null default 10,
  add column if not exists max_concurrent_generations_per_user integer not null default 1,
  add column if not exists generation_max_queue integer not null default 40;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'generation_policy_lease_ttl_check'
  ) then
    alter table public.generation_policy
      add constraint generation_policy_lease_ttl_check
      check (lease_ttl_seconds between 60 and 1800);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'generation_policy_max_concurrent_check'
  ) then
    alter table public.generation_policy
      add constraint generation_policy_max_concurrent_check
      check (max_concurrent_generations between 1 and 64);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'generation_policy_max_per_user_check'
  ) then
    alter table public.generation_policy
      add constraint generation_policy_max_per_user_check
      check (max_concurrent_generations_per_user between 1 and 8);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'generation_policy_max_queue_check'
  ) then
    alter table public.generation_policy
      add constraint generation_policy_max_queue_check
      check (generation_max_queue between 0 and 500);
  end if;
end $$;

-- 2) Align choices → chapter_prose (primary + fallbacks only; keep temp/max if set)
update public.ai_model_routes as choices
set
  provider = prose.provider,
  model_id = prose.model_id,
  fallback_models = prose.fallback_models,
  route_version = '2026-07-22-align-choices-to-prose',
  notes = coalesce(choices.notes, '') || ' | aligned primary/fallbacks to chapter_prose',
  is_active = true,
  updated_at = now()
from public.ai_model_routes as prose
where choices.use_case = 'choices'
  and prose.use_case = 'chapter_prose'
  and prose.is_active = true;
```

- [ ] **Step 2: Apply migration locally / linked when ready**

Run (linked prod only with user intent):

```bash
pnpm exec supabase db push --linked
```

Or local:

```bash
pnpm exec supabase db reset --local
# or migration up per project convention
```

Expected: columns exist; `choices.model_id` equals `chapter_prose.model_id`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260722090000_align_choices_and_runtime_policy.sql
git commit -m "db: align choices route to prose and add runtime policy columns"
```

---

### Task 2: Extend `getGenerationPolicy` (TDD)

**Files:**
- Modify: `lib/ops/generation-policy.ts`
- Create: `tests/ops/generation-policy.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/ops/generation-policy.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  from: vi.fn(),
  adminFactory: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@lakoku/db', () => ({ createAdminClient: mocks.adminFactory }))

beforeEach(() => {
  vi.resetModules()
  mocks.maybeSingle.mockReset()
  mocks.from.mockReset()
  mocks.adminFactory.mockReset()
  mocks.from.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: mocks.maybeSingle,
      }),
    }),
  })
  mocks.adminFactory.mockReturnValue({ from: mocks.from })
})

describe('getGenerationPolicy', () => {
  it('maps extended runtime columns from DB', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        target_words_min: 800,
        target_words_max: 1000,
        target_scenes: 3,
        lease_ttl_seconds: 600,
        max_concurrent_generations: 8,
        max_concurrent_generations_per_user: 2,
        generation_max_queue: 20,
      },
      error: null,
    })
    const { getGenerationPolicy } = await import('@/lib/ops/generation-policy')
    await expect(getGenerationPolicy()).resolves.toEqual({
      targetWordsMin: 800,
      targetWordsMax: 1000,
      targetScenes: 3,
      leaseTtlSeconds: 600,
      maxConcurrentGenerations: 8,
      maxConcurrentGenerationsPerUser: 2,
      generationMaxQueue: 20,
    })
  })

  it('falls back to defaults when DB empty', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
    const { getGenerationPolicy, DEFAULT_GENERATION_POLICY } = await import(
      '@/lib/ops/generation-policy'
    )
    await expect(getGenerationPolicy()).resolves.toEqual(DEFAULT_GENERATION_POLICY)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
node node_modules/vitest/vitest.mjs run tests/ops/generation-policy.test.ts
```

Expected: fail (missing fields / wrong select).

- [ ] **Step 3: Implement `lib/ops/generation-policy.ts`**

Replace interface + defaults + select + map:

```ts
export interface GenerationPolicy {
  targetWordsMin: number
  targetWordsMax: number
  targetScenes: number
  leaseTtlSeconds: number
  maxConcurrentGenerations: number
  maxConcurrentGenerationsPerUser: number
  generationMaxQueue: number
}

export const DEFAULT_GENERATION_POLICY: GenerationPolicy = {
  targetWordsMin: 800,
  targetWordsMax: 1000,
  targetScenes: 3,
  leaseTtlSeconds: 300,
  maxConcurrentGenerations: 10,
  maxConcurrentGenerationsPerUser: 1,
  generationMaxQueue: 40,
}

// in getGenerationPolicy select:
.select(`
  target_words_min,target_words_max,target_scenes,
  lease_ttl_seconds,max_concurrent_generations,
  max_concurrent_generations_per_user,generation_max_queue
`)

// map with Number(...) and fallbacks:
leaseTtlSeconds: Number(data.lease_ttl_seconds ?? DEFAULT_GENERATION_POLICY.leaseTtlSeconds),
maxConcurrentGenerations: Number(
  data.max_concurrent_generations ?? DEFAULT_GENERATION_POLICY.maxConcurrentGenerations,
),
maxConcurrentGenerationsPerUser: Number(
  data.max_concurrent_generations_per_user
    ?? DEFAULT_GENERATION_POLICY.maxConcurrentGenerationsPerUser,
),
generationMaxQueue: Number(
  data.generation_max_queue ?? DEFAULT_GENERATION_POLICY.generationMaxQueue,
),
```

Note: `cache()` from React means tests must `vi.resetModules()` between cases (already in beforeEach).

- [ ] **Step 4: Run tests — expect PASS**

```bash
node node_modules/vitest/vitest.mjs run tests/ops/generation-policy.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/ops/generation-policy.ts tests/ops/generation-policy.test.ts
git commit -m "feat(ops): extend generation policy with lease and concurrency caps"
```

---

### Task 3: Concurrency caps from policy (env override)

**Files:**
- Modify: `lib/runtime/generation-concurrency.ts`
- Create: `tests/runtime/generation-concurrency-config.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/runtime/generation-concurrency-config.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const policyMock = vi.hoisted(() => ({
  getGenerationPolicy: vi.fn(),
}))

vi.mock('@/lib/ops/generation-policy', () => ({
  getGenerationPolicy: policyMock.getGenerationPolicy,
  DEFAULT_GENERATION_POLICY: {
    targetWordsMin: 800,
    targetWordsMax: 1000,
    targetScenes: 3,
    leaseTtlSeconds: 300,
    maxConcurrentGenerations: 10,
    maxConcurrentGenerationsPerUser: 1,
    generationMaxQueue: 40,
  },
}))

async function loadMod() {
  vi.resetModules()
  // clear env overrides under test
  delete process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS
  delete process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS_PER_USER
  delete process.env.LAKOKU_GENERATION_MAX_QUEUE
  return import('@/lib/runtime/generation-concurrency')
}

describe('generation concurrency policy refresh', () => {
  beforeEach(() => {
    policyMock.getGenerationPolicy.mockReset()
  })
  afterEach(() => {
    vi.resetModules()
  })

  it('applies DB policy caps when env unset', async () => {
    policyMock.getGenerationPolicy.mockResolvedValue({
      targetWordsMin: 800,
      targetWordsMax: 1000,
      targetScenes: 3,
      leaseTtlSeconds: 300,
      maxConcurrentGenerations: 4,
      maxConcurrentGenerationsPerUser: 2,
      generationMaxQueue: 12,
    })
    const mod = await loadMod()
    await mod.refreshGenerationConcurrencyFromPolicy()
    expect(mod.getGenerationConcurrencyConfig()).toMatchObject({
      maxConcurrent: 4,
      maxPerUser: 2,
      maxQueue: 12,
    })
  })

  it('keeps env override over DB', async () => {
    process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS = '3'
    policyMock.getGenerationPolicy.mockResolvedValue({
      targetWordsMin: 800,
      targetWordsMax: 1000,
      targetScenes: 3,
      leaseTtlSeconds: 300,
      maxConcurrentGenerations: 10,
      maxConcurrentGenerationsPerUser: 1,
      generationMaxQueue: 40,
    })
    const mod = await loadMod()
    await mod.refreshGenerationConcurrencyFromPolicy()
    expect(mod.getGenerationConcurrencyConfig().maxConcurrent).toBe(3)
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (missing `refreshGenerationConcurrencyFromPolicy`)

```bash
node node_modules/vitest/vitest.mjs run tests/runtime/generation-concurrency-config.test.ts
```

- [ ] **Step 3: Implement refresh API in `generation-concurrency.ts`**

Design constraints:
- Keep existing FIFO queue logic.
- Replace module-level `const MAX_*` with `let` caps initialized from env (same `envInt` helpers).
- Track which knobs were **env-pinned** at boot:

```ts
const ENV_PIN_CONCURRENT = process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS?.trim()
  ? true
  : false
// same for PER_USER and MAX_QUEUE

let maxConcurrent = envInt('LAKOKU_MAX_CONCURRENT_GENERATIONS', 10, 1, 64)
let maxPerUser = envInt('LAKOKU_MAX_CONCURRENT_GENERATIONS_PER_USER', 1, 1, 8)
let maxQueue = envInt('LAKOKU_GENERATION_MAX_QUEUE', 40, 0, 500)
// QUEUE_WAIT_MS stays env-only this PR

export function getGenerationConcurrencyConfig() {
  return {
    maxConcurrent,
    maxPerUser,
    maxQueue,
    queueWaitMs: QUEUE_WAIT_MS,
    avgChapterSeconds: AVG_CHAPTER_SECONDS,
    envPinned: {
      maxConcurrent: ENV_PIN_CONCURRENT,
      maxPerUser: ENV_PIN_PER_USER,
      maxQueue: ENV_PIN_QUEUE,
    },
  }
}

export async function refreshGenerationConcurrencyFromPolicy(): Promise<void> {
  const { getGenerationPolicy } = await import('@/lib/ops/generation-policy')
  const policy = await getGenerationPolicy()
  if (!ENV_PIN_CONCURRENT) {
    maxConcurrent = clamp(policy.maxConcurrentGenerations, 1, 64)
  }
  if (!ENV_PIN_PER_USER) {
    maxPerUser = clamp(policy.maxConcurrentGenerationsPerUser, 1, 8)
  }
  if (!ENV_PIN_QUEUE) {
    maxQueue = clamp(policy.generationMaxQueue, 0, 500)
  }
}

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.trunc(n)))
}
```

Update all internal references from `MAX_CONCURRENT` → `maxConcurrent` (and per-user / queue).

Call refresh at the start of `withGenerationSlot` (best-effort, ignore errors):

```ts
export async function withGenerationSlot<T>(...) {
  try {
    await refreshGenerationConcurrencyFromPolicy()
  } catch {
    // keep current caps
  }
  // existing acquire / fn / release
}
```

Export `refreshGenerationConcurrencyFromPolicy` from `lib/runtime/index.ts` if barrel re-exports concurrency (it already re-exports the module).

- [ ] **Step 4: Run tests — PASS**

```bash
node node_modules/vitest/vitest.mjs run tests/runtime/generation-concurrency-config.test.ts
```

Also re-run any existing concurrency tests if present:

```bash
node node_modules/vitest/vitest.mjs run tests/runtime/generation-concurrency
```

- [ ] **Step 5: Commit**

```bash
git add lib/runtime/generation-concurrency.ts lib/runtime/index.ts tests/runtime/generation-concurrency-config.test.ts
git commit -m "feat(runtime): refresh generation concurrency caps from policy"
```

---

### Task 4: Lease TTL from policy in generation paths

**Files:**
- Modify: `lib/runtime/story-generation.ts` (search `ttlSeconds: 300`)
- Modify: `lib/runtime/personalized-generation.ts` (search `ttlSeconds: 300`)
- Create/extend: `tests/runtime/lease-ttl-from-policy.test.ts` **or** assert via existing personalized/story tests with mock

- [ ] **Step 1: Write a focused unit test with mocks**

If full story-generation is heavy, test a thin helper instead. Prefer extracting:

```ts
// lib/runtime/generation-lease-ttl.ts
import { getGenerationPolicy } from '@/lib/ops/generation-policy'

export async function resolveGenerationLeaseTtlSeconds(): Promise<number> {
  const policy = await getGenerationPolicy()
  const n = Number(policy.leaseTtlSeconds)
  if (!Number.isFinite(n)) return 300
  return Math.min(1800, Math.max(60, Math.trunc(n)))
}
```

Test:

```ts
// tests/runtime/generation-lease-ttl.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getGenerationPolicy: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/ops/generation-policy', () => ({
  getGenerationPolicy: mocks.getGenerationPolicy,
}))

beforeEach(() => {
  vi.resetModules()
  mocks.getGenerationPolicy.mockReset()
})

describe('resolveGenerationLeaseTtlSeconds', () => {
  it('clamps policy value into 60..1800', async () => {
    mocks.getGenerationPolicy.mockResolvedValue({ leaseTtlSeconds: 900 /* ...other fields */ })
    const { resolveGenerationLeaseTtlSeconds } = await import(
      '@/lib/runtime/generation-lease-ttl'
    )
    await expect(resolveGenerationLeaseTtlSeconds()).resolves.toBe(900)
  })
})
```

- [ ] **Step 2: Implement helper + wire callers**

In `story-generation.ts` before `acquireGenerationLease`:

```ts
const ttlSeconds = await resolveGenerationLeaseTtlSeconds()
const lease = await acquireGenerationLease({
  // ...
  ttlSeconds,
})
```

Same in `personalized-generation.ts`.

- [ ] **Step 3: Run unit test PASS**

```bash
node node_modules/vitest/vitest.mjs run tests/runtime/generation-lease-ttl.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add lib/runtime/generation-lease-ttl.ts lib/runtime/story-generation.ts lib/runtime/personalized-generation.ts tests/runtime/generation-lease-ttl.test.ts
git commit -m "feat(runtime): use generation_policy lease TTL for chapter generation"
```

---

### Task 5: Admin schemas — structured fallbacks + policy fields

**Files:**
- Modify: `lib/admin/settings-schemas.ts`
- Create: `tests/admin/settings-schemas.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  updateAiModelRouteSchema,
  updateGenerationPolicySchema,
} from '@/lib/admin/settings-schemas'

describe('updateAiModelRouteSchema', () => {
  it('accepts structured fallbacks', () => {
    const parsed = updateAiModelRouteSchema.safeParse({
      useCase: 'choices',
      provider: '9router',
      modelId: 'gcli/grok-4.5',
      fallbackModels: [{ provider: '9router', modelId: 'cx/gpt-5.6-terra' }],
      temperature: 0.7,
      maxOutputTokens: 2048,
      isActive: true,
      routeVersion: 'v1',
      notes: null,
      reason: 'align choices to prose',
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects string fallbacks', () => {
    const parsed = updateAiModelRouteSchema.safeParse({
      useCase: 'choices',
      provider: '9router',
      modelId: 'gcli/grok-4.5',
      fallbackModels: ['cx/gpt-5.6-terra'],
      temperature: null,
      maxOutputTokens: null,
      isActive: true,
      routeVersion: 'v1',
      notes: null,
      reason: 'bad shape',
    })
    expect(parsed.success).toBe(false)
  })
})

describe('updateGenerationPolicySchema', () => {
  it('requires lease and concurrency fields', () => {
    const parsed = updateGenerationPolicySchema.safeParse({
      targetWordsMin: 800,
      targetWordsMax: 1000,
      targetScenes: 3,
      leaseTtlSeconds: 600,
      maxConcurrentGenerations: 10,
      maxConcurrentGenerationsPerUser: 1,
      generationMaxQueue: 40,
      reason: 'raise lease for gateway',
    })
    expect(parsed.success).toBe(true)
  })
})
```

- [ ] **Step 2: Update schemas**

```ts
const aiProviderSchema = z.enum([
  'custom',
  'openrouter',
  '9router',
  'gateway',
  'deterministic',
])

const fallbackModelSchema = z.object({
  provider: aiProviderSchema,
  modelId: z.string().trim().min(3).max(200),
})

export const updateAiModelRouteSchema = z
  .object({
    useCase: z.string().min(1),
    provider: aiProviderSchema,
    modelId: z.string().trim().min(3).max(200),
    fallbackModels: z.array(fallbackModelSchema).max(8),
    temperature: z.number().min(0).max(2).nullable(),
    maxOutputTokens: z.number().int().min(256).max(64000).nullable(),
    isActive: z.boolean(),
    routeVersion: z.string().min(3).max(80),
    notes: z.string().max(500).nullable(),
    reason: z.string().min(5).max(500),
  })
  .superRefine((data, ctx) => {
    const keys = new Set<string>()
    for (const [i, fb] of data.fallbackModels.entries()) {
      const key = `${fb.provider}\0${fb.modelId}`
      if (keys.has(key)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Fallback tidak boleh duplikat',
          path: ['fallbackModels', i],
        })
      }
      keys.add(key)
      if (fb.provider === data.provider && fb.modelId === data.modelId) {
        ctx.addIssue({
          code: 'custom',
          message: 'Fallback tidak boleh sama dengan primary model',
          path: ['fallbackModels', i],
        })
      }
    }
  })

export const updateGenerationPolicySchema = z
  .object({
    targetWordsMin: z.number().int().min(300).max(3000),
    targetWordsMax: z.number().int().min(300).max(5000),
    targetScenes: z.number().int().min(1).max(10),
    leaseTtlSeconds: z.number().int().min(60).max(1800),
    maxConcurrentGenerations: z.number().int().min(1).max(64),
    maxConcurrentGenerationsPerUser: z.number().int().min(1).max(8),
    generationMaxQueue: z.number().int().min(0).max(500),
    reason: z.string().min(5).max(500),
  })
  .refine((d) => d.targetWordsMax >= d.targetWordsMin, {
    message: 'Max words harus >= min words',
    path: ['targetWordsMax'],
  })
```

- [ ] **Step 3: Run tests PASS**

```bash
node node_modules/vitest/vitest.mjs run tests/admin/settings-schemas.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add lib/admin/settings-schemas.ts tests/admin/settings-schemas.test.ts
git commit -m "feat(admin): structured AI route fallbacks and runtime policy schema"
```

---

### Task 6: Admin server list/update for structured fallbacks + policy

**Files:**
- Modify: `lib/admin/settings.ts`

- [ ] **Step 1: Update `AdminAiModelRoute` type**

```ts
export interface AdminFallbackModel {
  provider: string
  modelId: string
}

export interface AdminAiModelRoute {
  useCase: string
  provider: string
  modelId: string
  fallbackModels: AdminFallbackModel[]
  // ...rest unchanged
}
```

- [ ] **Step 2: Map list with `normalizeFallbackModels`**

```ts
import { normalizeFallbackModels } from '@/lib/ops/ai-model-routes'

// in listAdminAiModelRoutes map:
fallbackModels: normalizeFallbackModels(
  r.fallback_models,
  (r.provider as import('@/lib/ops/ai-model-routes').AiProvider) ?? 'gateway',
),
```

- [ ] **Step 3: `updateAiModelRoute` write jsonb objects**

```ts
fallback_models: input.fallbackModels.map((f) => ({
  provider: f.provider,
  modelId: f.modelId,
})),
```

Return the same structured array.

- [ ] **Step 4: Extend `AdminGenerationPolicy` + get/update**

Select/update the four new columns. Include in audit `oldValue`/`newValue`.

- [ ] **Step 5: Fix any smoke that assumes string[] fallbacks**

Search:

```bash
rg -n "fallbackModels" scripts tests components/admin lib/admin -g "*.{ts,tsx}"
```

Update assertions to structured shape.

- [ ] **Step 6: Commit**

```bash
git add lib/admin/settings.ts
git commit -m "feat(admin): persist structured model fallbacks and runtime policy fields"
```

---

### Task 7: Admin UI — model route dialog + policy dialog + settings page

**Files:**
- Modify: `components/admin/settings/edit-ai-model-route-dialog.tsx`
- Modify: `components/admin/settings/edit-generation-policy-dialog.tsx`
- Modify: `app/admin/settings/page.tsx`

- [ ] **Step 1: Update `EditAiModelRouteDialog` props**

```ts
interface FallbackRow { provider: string; modelId: string }

interface RouteRow {
  useCase: string
  provider: string
  modelId: string
  fallbackModels: FallbackRow[]
  temperature: number | null
  maxOutputTokens: number | null
  isActive: boolean
  routeVersion: string
  notes: string | null
}

interface Props {
  route: RouteRow
  proseRoute?: RouteRow | null  // for copy button
  onClose: () => void
  onSaved: () => void
}
```

UI changes:
- Provider primary: `<select>` with options `9router|openrouter|custom|gateway|deterministic`
- Fallback rows: provider select + modelId input
- If `route.useCase === 'choices' && proseRoute`: button **Salin dari chapter_prose** that sets form state from `proseRoute` (provider, modelId, fallbacks copy). Does not save.
- PATCH body sends structured `fallbackModels`

- [ ] **Step 2: Update `EditGenerationPolicyDialog`**

Add inputs: lease TTL, max concurrent, max per user, max queue. Client-side range checks matching Zod. PATCH includes new fields.

Helper text under concurrency:

> Concurrency process-local (per Node process/container). Multi-instance not shared.

- [ ] **Step 3: Update settings page**

- Types for `aiModelRoutes` / `generationPolicy` match server.
- Table fallbacks column: preview first fallback as `provider:modelId` + count.
- Policy card shows lease + concurrency stats.
- Pass `proseRoute={data.aiModelRoutes.find(r => r.useCase === 'chapter_prose') ?? null}` into dialog.

- [ ] **Step 4: Manual smoke (owner session)**

1. Open `/admin/settings`
2. Confirm `choices` primary matches prose after migration
3. Edit choices → Salin dari chapter_prose → save with reason
4. Edit generation policy → set lease 600 → save
5. Confirm audit log rows appear

- [ ] **Step 5: Commit**

```bash
git add components/admin/settings/edit-ai-model-route-dialog.tsx \
  components/admin/settings/edit-generation-policy-dialog.tsx \
  app/admin/settings/page.tsx
git commit -m "feat(admin-ui): structured model routes and runtime policy controls"
```

---

### Task 8: Optional hardening — dead OpenRouter free default

**Files:**
- Modify: `lib/ai-gateway/gateway-provider.ts` (~line with `OPENROUTER_FREE_DEFAULT`)

- [ ] **Step 1: Change default**

From:

```ts
const OPENROUTER_FREE_DEFAULT = 'nousresearch/hermes-3-llama-3.1-405b:free'
```

To paid default only when building env candidates without free:

```ts
// Free slug retired (404 on OpenRouter). Prefer paid default as sole code default.
const OPENROUTER_PAID_DEFAULT = 'deepseek/deepseek-v3.2'
// openRouterCandidates: if OPENROUTER_MODELS unset, use [OPENROUTER_PAID_DEFAULT] only
```

Update any test that asserts the free slug.

- [ ] **Step 2: Run choice-provider / gateway tests**

```bash
node node_modules/vitest/vitest.mjs run tests/story-engine/choice-provider.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add lib/ai-gateway/gateway-provider.ts
git commit -m "fix(ai-gateway): drop dead OpenRouter free default from env chain"
```

---

### Task 9: Verification bundle

- [ ] **Step 1: Unit suite for touched areas**

```bash
node node_modules/vitest/vitest.mjs run \
  tests/ops/generation-policy.test.ts \
  tests/runtime/generation-concurrency-config.test.ts \
  tests/runtime/generation-lease-ttl.test.ts \
  tests/admin/settings-schemas.test.ts \
  tests/story-engine/choice-provider.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Typecheck**

```bash
pnpm run typecheck
```

Expected: no errors in touched files.

- [ ] **Step 3: Optional sequential gateway smoke (manual, not CI)**

```bash
# after migration applied + NARRATIVE_PROVIDER=gateway
# use existing e2e or a 1-job soak
NARRATIVE_PROVIDER=gateway node scripts/run-smoke.cjs scripts/e2e-real-generation.ts
```

Expected: choices no longer fail solely on free hermes 404; lease ≥ policy value.

- [ ] **Step 4: Final commit if docs needed**

```bash
git add docs/superpowers/plans/2026-07-22-align-choices-gateway-admin-runtime.md
git commit -m "docs: plan for choices gateway align and admin runtime settings"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| Copy prose → choices DB | Task 1 |
| Policy columns lease/concurrency/queue | Task 1 |
| `getGenerationPolicy` extended | Task 2 |
| Concurrency from policy + env pin | Task 3 |
| Lease TTL in standard + personalized gen | Task 4 |
| Structured fallback Zod | Task 5 |
| Admin list/update structured | Task 6 |
| UI copy button + policy form | Task 7 |
| Optional free hermes fix | Task 8 |
| Tests / verify | Task 9 |

## Placeholder scan

No TBD/TODO left in steps. All paths, schemas, and commands are concrete.

## Type consistency

- Fallback shape always `{ provider, modelId }` (camelCase) in API/UI/DB jsonb.
- Policy fields: `leaseTtlSeconds`, `maxConcurrentGenerations`, `maxConcurrentGenerationsPerUser`, `generationMaxQueue`.
- DB columns snake_case counterparts only at SQL/admin map boundaries.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-22-align-choices-gateway-admin-runtime.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session with executing-plans, batch + checkpoints  

Which approach?
