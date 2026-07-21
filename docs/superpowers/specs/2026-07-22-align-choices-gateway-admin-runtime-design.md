# Design: Align Choices Gateway + Admin Runtime Settings

**Date:** 2026-07-22  
**Status:** Draft for user review  
**Scope:** Copy `chapter_prose` model route onto `choices`, harden admin AI Model Routes UI for structured fallbacks, and expose lease TTL + concurrency caps in Admin Settings via `generation_policy`.

---

## 1. Problem

Gateway soak of 10 concurrent real generations showed:

1. **Capacity gate works** (peak `active=10`, ~7× wall-clock concurrency).
2. **Publish often fails** because:
   - Choices route primary (`ag/gemini-pro-agent`) differs from prose (`gcli/grok-4.5`).
   - Env fallback chain still reaches OpenRouter free model  
     `nousresearch/hermes-3-llama-3.1-405b:free` → **404 unavailable**.
   - Lease TTL is **hardcoded 300s** while live multi-call LLM jobs run **5–9 minutes** → `INVALID_OR_EXPIRED_LEASE`.
3. Admin Settings already lists AI Model Routes, but:
   - Fallback UI treats `fallback_models` as `string[]` while DB stores  
     `jsonb` of `{ provider, modelId }`.
   - Lease TTL and concurrency caps are **not** admin-editable (code/env only).

User decisions:

- Align choices by **copying prose route → choices** (not a single shared row).
- Admin must expose: **AI Model Routes**, **lease TTL**, **concurrency caps**.

---

## 2. Goals / Non-goals

### Goals

1. `choices` use_case uses the **same primary + fallback chain** as `chapter_prose` (provider + model IDs).
2. Admin can view/edit those routes with **structured fallbacks** and a **“Salin dari chapter_prose”** action for `choices`.
3. Admin can edit **lease TTL** and **concurrency caps** without deploy.
4. Runtime reads those settings from DB (with safe defaults + optional env emergency override).
5. Changes are audited like existing settings.

### Non-goals

- Multi-instance / Redis distributed concurrency (still process-local).
- Merging prose+choices into one DB row forever.
- Full 10-way live LLM soak as a PR gate (too expensive/slow).
- Redesigning generation_policy product semantics beyond adding fields.

---

## 3. Current architecture (relevant)

| Piece | Location | Behavior today |
|---|---|---|
| Route select | `lib/ai-gateway/select-provider.ts` | Loads `chapter_prose` + `choices` routes; gateway mode only if `NARRATIVE_PROVIDER=gateway` |
| Model chain | `lib/ai-gateway/gateway-provider.ts` `resolveModelChain` | DB route candidates **first**, then env/code candidates (includes OpenRouter free default) |
| Choices chain | same file | `choicesRoute ?? aiRoute` then `resolveModelChain` |
| Routes CRUD | `lib/admin/settings.ts` + `/api/admin/settings/model-routes` + `EditAiModelRouteDialog` | Exists; fallback typed as `string[]` |
| Policy | `generation_policy` id=1 | words min/max + scenes only |
| Lease TTL | `story-generation.ts` / `personalized-generation.ts` | hardcoded `ttlSeconds: 300` |
| Concurrency | `generation-concurrency.ts` | env ints at **module load** |

DB snapshot (production-linked) at design time:

- `chapter_prose`: `9router` / `gcli/grok-4.5` → fallbacks `cx/gpt-5.6-terra` (9router), `deepseek/deepseek-v3.2` (openrouter)
- `choices`: `9router` / `ag/gemini-pro-agent` → different primary/fallbacks

---

## 4. Design

### 4.1 One-shot data alignment (choices ← prose)

**Action:** Update row `ai_model_routes` where `use_case = 'choices'`:

| Field | Source |
|---|---|
| `provider` | from `chapter_prose.provider` |
| `model_id` | from `chapter_prose.model_id` |
| `fallback_models` | deep copy of `chapter_prose.fallback_models` (jsonb objects) |
| `temperature` | keep choices-specific if already set; else copy prose (prefer keep 0.7 if present) |
| `max_output_tokens` | keep choices-specific if set; else copy prose |
| `route_version` | new stamp e.g. `2026-07-22-align-choices-to-prose` |
| `notes` | short note: aligned primary/fallbacks to chapter_prose |
| `is_active` | true |
| `updated_at` | now |

**Delivery:**

1. **Migration SQL** (idempotent UPDATE joining prose row) for linked/prod DB.
2. **Optional local seed/script** not required if migration is source of truth.

**Runtime code change for align:** none required for selection path (already uses DB).  
Optional hardening (same PR if cheap): change `OPENROUTER_FREE_DEFAULT` away from dead `:free` slug so env-tail candidates do not waste time on 404. Prefer paid default only or empty when DB route present — **do not remove env chain**, only fix dead default model id.

### 4.2 Admin AI Model Routes — structured fallbacks + copy action

#### Data model (API / UI)

```ts
type FallbackModel = { provider: AiProvider; modelId: string }

interface AdminAiModelRoute {
  useCase: string
  provider: string
  modelId: string
  fallbackModels: FallbackModel[]  // was string[] — BREAKING for client form only
  temperature: number | null
  maxOutputTokens: number | null
  isActive: boolean
  routeVersion: string
  notes: string | null
}
```

`AiProvider` remains: `custom | openrouter | 9router | gateway | deterministic`.

#### Read path (`listAdminAiModelRoutes`)

- Use existing `normalizeFallbackModels` from `lib/ops/ai-model-routes.ts` (or share it) so legacy `text[]` and new jsonb both work.
- Return structured objects to the settings page.

#### Write path (`updateAiModelRoute` + Zod schema)

- Accept `fallbackModels: { provider, modelId }[]` (max 8).
- Validate:
  - modelId non-empty (min length 3)
  - provider in known set
  - no duplicate `(provider, modelId)` pairs
  - no fallback equal to primary `(provider, modelId)`
- Persist jsonb array of objects with keys `provider` + `modelId` (camelCase to match current DB rows).
- Keep audit log shape with full new/old values.

#### UI (`EditAiModelRouteDialog` + settings table)

- Each fallback row: **provider** select + **modelId** input + remove.
- Add fallback button (cap 8).
- When `useCase === 'choices'`: button **“Salin dari chapter_prose”** that:
  - Prefills provider, modelId, fallbacks from the prose route already loaded in page data (client-side copy into form state).
  - Does **not** auto-save; user still must provide reason and click Simpan.
- Table column Fallbacks: show count + short preview (`provider:modelId` truncated), not only “N models”.
- Owner-only edit remains.

#### API

- `PATCH /api/admin/settings/model-routes` body schema updated to structured fallbacks.
- No new endpoint for “copy”; pure client prefill is enough.

### 4.3 Lease TTL + concurrency on `generation_policy`

#### Schema migration

Add columns to `public.generation_policy` (row id=1):

| Column | Type | Default | Check |
|---|---|---|---|
| `lease_ttl_seconds` | integer | 300 | 60–1800 |
| `max_concurrent_generations` | integer | 10 | 1–64 |
| `max_concurrent_generations_per_user` | integer | 1 | 1–8 |
| `generation_max_queue` | integer | 40 | 0–500 |

Also extend `queue_wait_ms`? **No** — YAGNI this PR (env remains).

Update existing id=1 row defaults if null.

#### Ops reader (`lib/ops/generation-policy.ts`)

Extend `GenerationPolicy` type:

```ts
{
  targetWordsMin, targetWordsMax, targetScenes,
  leaseTtlSeconds,
  maxConcurrentGenerations,
  maxConcurrentGenerationsPerUser,
  generationMaxQueue,
}
```

Keep `cache()` per-request. Code fallbacks match column defaults if DB missing.

#### Admin

- Extend `AdminGenerationPolicy`, `getAdminGenerationPolicy`, `updateGenerationPolicy`, Zod schema, and `EditGenerationPolicyDialog` with the four fields.
- Settings page Generation Policy card shows the new numbers.
- Audit area remains `generation_policy`.

#### Runtime consumers

1. **Lease TTL**  
   - `generateNextChapterRealInner` / personalized path:  
     `ttlSeconds: policy.leaseTtlSeconds` instead of `300`.  
   - Lifecycle default (`lifecycle.ts` 120) left as low-level default for non-chapter callers; chapter paths always pass explicit TTL from policy.

2. **Concurrency**  
   - Today constants are fixed at module load from env.  
   - Change to **resolvable config**:
     - Prefer env if set (emergency override, documented).
     - Else use last-known DB policy values.
   - Implementation approach (simple, process-local):
     - Keep module-level mutable config initialized from env/defaults.
     - On each `acquireGenerationSlot` / `withGenerationSlot` entry (or via a small `refreshConcurrencyConfigFromPolicy()` called at start of `generateNextChapterReal`), update caps from `getGenerationPolicy()` when env overrides are absent.
     - Avoid changing fairness algorithm; only numeric caps.
   - UI note on settings card:  
     “Concurrency process-local (per Node process / container). Multi-instance not shared.”

### 4.4 Security / auth

- No change: owner-only mutation via existing `requireOwner()` / admin guards.
- Service role never exposed to client; admin APIs remain server-authenticated.

### 4.5 Observability

- Existing settings audit log covers route + policy edits.
- Optional log once per process when concurrency caps refresh from DB (rate-limited / only on change) to avoid spam.

---

## 5. Data flow (after)

```
Admin Settings
  ├─ AI Model Routes ──PATCH──► ai_model_routes (choices / chapter_prose)
  └─ Generation Policy ─PATCH──► generation_policy (words + lease + concurrency)

selectProvider (gateway)
  ├─ getAiModelRoute('chapter_prose') ──► prose chain
  └─ getAiModelRoute('choices') ───────► choice chain (aligned copy)

generateNextChapterReal
  ├─ getGenerationPolicy().leaseTtlSeconds ──► acquireGenerationLease
  ├─ concurrency caps from policy/env ───────► withGenerationSlot
  ├─ generateChapter (prose chain)
  └─ buildChoices → generateChoiceBranch (choices chain)
```

---

## 6. Testing plan

| Layer | What |
|---|---|
| Unit | `normalizeFallbackModels` / admin map structured; Zod rejects bad fallbacks; policy bounds |
| Unit | concurrency refresh respects env override over DB |
| Unit | story-generation / personalized uses policy lease TTL (mock getGenerationPolicy) |
| Smoke | admin settings smoke already exists — extend for new fields if present |
| Manual / optional | 1 sequential `NARRATIVE_PROVIDER=gateway` gen after choices align |
| Not required | full 10 concurrent live soak as CI gate |

---

## 7. Rollout

1. Ship migration (policy columns + choices route UPDATE).
2. Deploy code (admin + runtime readers).
3. Owner verifies Admin → Settings shows aligned routes and new policy fields.
4. Optional: run one live chapter gen smoke.
5. If lease still expires under heavy models, raise `lease_ttl_seconds` via admin (no redeploy).

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Aligning choices to prose increases cost/latency of choices | Same as prose already; fallbacks still short-circuit on first success |
| Admin writes legacy string[] clients break | Single app client updated in same PR; schema strict |
| Concurrency refresh races | Caps only increase/decrease numbers; no job identity change |
| Env override forgotten | Document in AGENT_RULES / settings UI helper text |
| Process-local concurrency misunderstood | Explicit UI note |

---

## 9. Implementation sequence (for later plan)

1. Migration: policy columns + choices align UPDATE.  
2. Ops: extend `getGenerationPolicy`.  
3. Runtime: lease TTL from policy; concurrency caps from policy/env.  
4. Admin schemas + settings server + dialogs + page.  
5. Optional: fix dead OpenRouter free default.  
6. Tests + smoke.  

---

## 10. Spec self-review

- No TBD/TODO left in required behavior.
- Choices remain a **separate row** (copy, not shared PK) — matches user choice.
- Admin surface matches multi-select: routes + lease + concurrency.
- Out of scope explicit: Redis multi-instance, full live soak CI.
- Fallback key names standardized to `provider` + `modelId` (matches current prod jsonb).
