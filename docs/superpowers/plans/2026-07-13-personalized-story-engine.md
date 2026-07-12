# Personalized Story Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add private 50-chapter personalized stories and cloneable premium story instances whose choices update bounded route state and deterministically select an ending without breaking standard stories, reader contracts, or existing generation/publish paths.

**Architecture:** Expand database and RLS first, then add pure story-engine modules, gateway extensions, mechanically derived v2 lifecycle RPCs, personalized creation/runtime, atomic choice processing, polling, and premium cloning. Reader-facing code uses explicit safe projections and ownership-aware queries; service-role code owns internal contract, route, effect, lease, and attempt data. Existing `generateNextChapterReal()`, `publishChapter()`, `ChapterDraftSchema`, Layer A/B validation, credit/unlock flow, and reader API seam remain intact.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.7, Zod 4, Vitest 4, Supabase/PostgreSQL/RLS/pgTAP, Vercel AI SDK 7, pnpm 11.

---

## Non-Negotiable Execution Rules

- Work from repository root `D:\Coding\lakoku v2`.
- Do not edit `docs/ARCHITECTURE_v1.1.md`, `docs/NARRATIVE_TRACEABILITY_MATRIX.md`, or `docs/PRD_Lakoku_Interactive_v0.3.md`; they already contain unrelated modifications.
- Before implementation, create isolated worktree per `superpowers:using-git-worktrees` guidance. Never implement on dirty source checkout.
- Do not commit schema dumps, function dumps, linked credentials, generated test logs, or release evidence containing secrets. Use `.local/personalized-story-introspection/`, already covered by new ignore rule in Task 1.
- Never infer legacy `publish_chapter` body, `generation_leases` columns, `story_events.payload` keys, or canon table columns. Task 1 introspection output controls Tasks 3, 12, 20, 21, and 23.
- Stop before Task 3 if linked dump or exact `publish_chapter` definition is unavailable. Stop before Task 12 if function body, grants, lease-release logic, event append logic, and idempotency logic cannot be identified exactly. This is mandatory, not optional.
- `after()` exists in current Next.js dependency and is used by `app/brainstorm/actions.ts`, but that proves request-lifetime continuation support only. Task 20 must verify deployed adapter behavior. If durable completion is not proven, use existing durable outbox/lease schema if introspection confirms it; otherwise add indexed outbox in Task 20. Never describe unverified fire-and-forget work as durable.
- Use explicit reader-safe projections. Internal service-role selects may include internal fields when required. Static smoke checks must classify files and projections instead of banning internal server reads globally.
- Keep data/schema changes additive: no table/column/function drop and no destructive column alteration. Security-policy reconciliation is exception: if Task 1 finds existing permissive Dashboard policy that leaks private rows, Task 3 must alter or replace that exact reviewed policy. Adding another permissive policy does not restrict old access because PostgreSQL combines permissive policies with OR.

## File Map

### Database and test infrastructure

- Modify: `.gitignore` — ignore local linked-schema/RPC dumps and local release evidence.
- Create: `supabase/tests/personalized_story_rls_test.sql` — pgTAP coverage for public/owner/anon/service-role access.
- Create: `supabase/tests/personalized_story_schema_test.sql` — additive column, constraint, index, policy, grant, and RPC assertions.
- Create: `supabase/migrations/20260713000000_personalized_story_engine.sql` — additive story/reader/outcome/contract/idempotency schema, indexes, and defensive RLS.
- Create: `supabase/migrations/20260713010000_publish_chapter_v2.sql` — introspection-derived atomic publisher; never edit already-applied schema migration to add RPC later.
- Create: `supabase/migrations/20260713020000_bootstrap_personalized_story.sql` — transactional contract/canon bootstrap derived from linked canon schema.
- Create: `supabase/migrations/20260713030000_apply_personalized_choice.sql` — atomic authorized choice application and replay/conflict semantics.
- Create: `supabase/migrations/20260713040000_personalized_generation_outbox.sql` only if Task 20 runtime proof requires durable queue storage.
- Create: `supabase/migrations/20260713050000_clone_premium_story_instance.sql` — transactional template clone derived from linked schema.

### Reader-safe data and contracts

- Modify: `lib/api/queries.ts` — explicit projections plus public/owned/detail/explore query functions.
- Modify: `lib/api/server.ts` — ownership-aware library, explore, detail, chapter access.
- Modify: `lib/api/user-state.ts` — explicit public state projection; internal state moves to personalized service.
- Modify: `app/api/stories/route.ts` — explore-safe listing.
- Modify: `app/api/stories/[id]/route.ts` — authorized detail.
- Modify: `packages/contracts/src/reader.ts` — optional readiness and chapter-status public schemas only.
- Modify: `lib/api/client.ts` — readiness polling while preserving existing `submitChoice()` return contract.
- Modify: `components/reader-view.tsx` — polling and final no-choice CTAs; no internal props.

### Pure story engine

- Create: `lib/story-engine/story-contract.ts` — strict 50-chapter contract schema/types.
- Create: `lib/story-engine/route-state.ts` — parse, normalize, merge, deduplicate, prompt summary.
- Create: `lib/story-engine/plot-debt.ts` — deterministic runway/debt audit.
- Create: `lib/story-engine/ending-resolver.ts` — deterministic ending score/lock resolution.
- Create: `lib/story-engine/chapter-brief.ts` — chapter target/runway/route brief.
- Create: `lib/story-engine/quality.ts` — deterministic prose and choice quality validators.
- Create: `lib/story-engine/index.ts` — pure barrel; no `server-only` or DB imports.
- Create: `fixtures/contracts/build-contract-fixture.ts` — shared complete 50-target fixture builder.
- Create: `fixtures/contracts/misteri-drama.ts`, `fixtures/contracts/romansa-drama.ts`, `fixtures/contracts/fantasi-petualangan.ts` — three complete contracts without repeated literal target arrays.
- Create: `tests/story-engine/story-contract.test.ts`, `route-state.test.ts`, `plot-debt.test.ts`, `ending-resolver.test.ts`, `chapter-brief.test.ts`, `quality.test.ts`.

### Gateway and runtime

- Modify: `lib/ai-gateway/schemas.ts` — `ChoiceEffectSchema`, raw branch schema, parser; do not change `ChapterDraftSchema`.
- Modify: `lib/ai-gateway/provider.ts` — optional `generateChoices` and `generateStoryContract` methods/input types.
- Modify: `lib/ai-gateway/gateway.ts` — chapter-aware choice validation and contract operation.
- Modify: `lib/ai-gateway/gateway-provider.ts` — optional real-provider implementations through existing model chain.
- Modify: `lib/ai-gateway/index.ts` — public pure exports.
- Create: `tests/story-engine/choice-branch.test.ts`.
- Modify: `lib/runtime/lifecycle.ts` — additive `publishChapterV2()` wrapper; old wrapper unchanged.
- Create: `lib/runtime/personalized-generation.ts` — existing chapter pipeline plus brief, separate choices, v2 publish, Chapter 50 completion.
- Modify: `lib/runtime/index.ts` — personalized runtime export.
- Create: `tests/runtime/personalized-generation.test.ts`.

### Contract creation, persistence, choice, status, clone

- Create: `lib/story-engine/contract-generation.server.ts` — 30-second generation, one repair, validated fallback, source tracking.
- Create: `lib/story-engine/contract-persistence.server.ts` — contract and exact canon/50-blueprint bootstrap.
- Create: `tests/story-engine/contract-generation.test.ts`.
- Create: `lib/api/personalized-stories.server.ts` — authenticated strong-idempotency creation service.
- Create: `app/api/stories/personalized/route.ts` — authenticated creation endpoint.
- Create: `tests/api/personalized-stories.test.ts`.
- Create: `lib/api/personalized-choice.server.ts` — ownership-first atomic choice service and bounded generation wait.
- Modify: `app/api/stories/[id]/choices/route.ts` — dispatch personalized/private flow while preserving standard flow.
- Create: `tests/api/personalized-choice.test.ts`.
- Create: `lib/api/chapter-status.server.ts` — exact chapter/lease/latest-attempt resolution.
- Create: `app/api/stories/[id]/chapters/[chapterNumber]/status/route.ts` — authorized status endpoint.
- Create: `tests/api/chapter-status.test.ts`.
- Create: `lib/api/generation-continuation.server.ts` — proven `after()` path or durable outbox worker/lease path.
- Create: `lib/api/premium-clone.server.ts` — authenticated clone orchestration.
- Create: `app/api/stories/premium/[templateId]/clone/route.ts` — authenticated clone endpoint.
- Create: `tests/api/premium-clone.test.ts`.

### Privacy, smoke, and release evidence

- Create: `tests/privacy/recursive-internal-field-scan.test.ts` — recursive response scan.
- Create: `tests/integration/story-ownership.test.ts` — DB-backed ownership/isolation integration.
- Create: `scripts/personalized-story-smoke.ts` — repository-convention static/runtime smoke.
- Modify: `package.json` — `smoke:personalized-story` command through `scripts/run-smoke.cjs`; append to aggregate `smoke`.
- Create: `docs/superpowers/reports/personalized-story-engine-release-evidence.md` during execution — changed files, migration, examples, isolation/privacy proof, and gate output.

## Phase 1 — Database, RLS, and Ownership-Safe Reads

### Task 1: Linked Schema and Legacy RPC Introspection Gate

**Files:**
- Modify: `.gitignore`
- Produce untracked: `.local/personalized-story-introspection/public-schema.sql`
- Produce untracked: `.local/personalized-story-introspection/publish-chapter.sql`
- Produce untracked: `.local/personalized-story-introspection/runtime-columns.sql`

- [ ] **Step 1: Add failing repository guard**

Append this exact ignore entry, then verify it is not yet effective before edit with `git check-ignore`:

```gitignore
# Local linked Supabase introspection and release evidence
.local/personalized-story-introspection/
.local/personalized-story-release/
```

Run: `git check-ignore -q .local/personalized-story-introspection/public-schema.sql`
Expected before edit: exit 1. Expected after edit: exit 0.

- [ ] **Step 2: Dump linked schema without tracking it**

```bash
mkdir -p .local/personalized-story-introspection
pnpm exec supabase db dump --linked --schema public --file .local/personalized-story-introspection/public-schema.sql
```

Expected: exit 0 and non-empty dump containing `CREATE FUNCTION public.publish_chapter` or `CREATE OR REPLACE FUNCTION public.publish_chapter`.

- [ ] **Step 3: Extract exact linked definitions and catalog facts**

Use dump text as immutable source. Copy full statements—not summaries—for `publish_chapter`, `acquire_generation_lease`, `release_generation_lease`, tables `generation_leases`, `story_events`, `idempotency_keys`, any `outbox` table, and all canon tables into `publish-chapter.sql`/`runtime-columns.sql`. Then run:

```bash
rg -n -i "(create( or replace)? function public.publish_chapter|generation_leases|story_events|idempotency_keys|outbox|characters|character_states|character_aliases|character_voice_sheets|facts_ledger|knowledge_scopes|secrets_reveals|story_threads|chapter_blueprints|act_rollups)" .local/personalized-story-introspection/public-schema.sql
```

Expected: exact definitions found. Mandatory stop if any lifecycle definition used by planned SQL is absent; obtain linked DB access before continuing. Never reconstruct missing SQL from TypeScript wrappers.

- [ ] **Step 4: Record introspection decisions locally**

Write `runtime-columns.sql` with copied DDL plus comments identifying exact lease primary key/status/expiry fields, exact event JSON keys and ordering, idempotency storage behavior, outbox availability, every FK/unique constraint, and clone-table columns. This file stays untracked.

- [ ] **Step 5: Verify repository cleanliness scope**

Run: `git status --short`
Expected: only `.gitignore` from this task plus pre-existing three modified docs in source checkout; no `.local` files listed.

- [ ] **Step 6: Commit implementation worktree change**

```bash
git add .gitignore
git commit -m "chore: ignore personalized story introspection artifacts"
```

### Task 2: Failing Database Schema and RLS Tests

**Files:**
- Create: `supabase/tests/personalized_story_schema_test.sql`
- Create: `supabase/tests/personalized_story_rls_test.sql`

- [ ] **Step 1: Write failing pgTAP schema assertions**

Use `plan(24)` and assertions for new story/reader/outcome columns, `story_generation_contracts`, three indexes, RLS enabled on five tables, named policies, and service-role-only execution. Key assertions:

```sql
select has_column('public', 'stories', 'story_mode');
select has_column('public', 'reader_states', 'route_state');
select has_column('public', 'choice_outcomes', 'effect_json');
select has_table('public', 'story_generation_contracts');
select ok((select relrowsecurity from pg_class where oid = 'public.stories'::regclass), 'stories RLS enabled');
select policies_are('public', 'stories', array['stories_owner_read','stories_public_read']);
```

- [ ] **Step 2: Write failing role-switch RLS tests**

Create deterministic users A/B, public template, and private personalized rows inside transaction. Use `set local role anon/authenticated/service_role` and `set_config('request.jwt.claim.sub', ..., true)`. Assert anon sees public only, A sees own private, B cannot see A, contract/chapters/outcomes follow parent ownership, and service role can write. Roll back test fixtures.

- [ ] **Step 3: Run tests and verify RED**

Run: `pnpm exec supabase test db supabase/tests/personalized_story_schema_test.sql supabase/tests/personalized_story_rls_test.sql`
Expected: FAIL on missing `story_mode`, `route_state`, `effect_json`, `story_generation_contracts`, indexes, and policies. If local Supabase is stopped, run `pnpm exec supabase start` first; expected local stack starts successfully.

- [ ] **Step 4: Commit failing tests**

```bash
git add supabase/tests/personalized_story_schema_test.sql supabase/tests/personalized_story_rls_test.sql
git commit -m "test: define personalized story database security contract"
```

### Task 3: Additive Schema, Defensive Policies, and Strong Request Idempotency

**Files:**
- Create: `supabase/migrations/20260713000000_personalized_story_engine.sql`
- Modify: `supabase/tests/personalized_story_schema_test.sql`
- Modify: `supabase/tests/personalized_story_rls_test.sql`

- [ ] **Step 1: Implement additive schema from approved spec**

Add approved columns/defaults/check constraints to `stories`, `reader_states`, and `choice_outcomes`; create `story_generation_contracts`; create approved indexes. Also add strong creation reservation storage:

```sql
create table if not exists public.story_creation_requests (
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  request_kind text not null check (request_kind in ('personalized','premium_clone')),
  idempotency_key text not null,
  request_hash text not null,
  story_id text not null,
  status text not null check (status in ('RESERVED','READY','FAILED')),
  error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_user_id, request_kind, idempotency_key),
  unique (story_id)
);
```

- [ ] **Step 2: Add defensive policies**

Enable RLS on `stories`, `chapters`, `choice_outcomes`, `reader_states`, `story_generation_contracts`, and `story_creation_requests`. Every policy creation uses both schema and table checks:

```sql
if not exists (
  select 1 from pg_policies
  where schemaname = 'public' and tablename = 'stories'
    and policyname = 'stories_public_read'
) then
  create policy stories_public_read on public.stories
    for select to anon, authenticated using (visibility = 'public');
end if;
```

No anon/authenticated write policy for stories, chapters, outcomes, contracts, or creation requests. Before creating policies, audit every existing policy from Task 1 for command, roles, permissive/restrictive mode, USING, and WITH CHECK. Preserve stronger owner policies. If an existing permissive policy allows broader reads/writes (for example `USING (true)`), explicitly replace that exact policy with reviewed equivalent safe semantics in this migration; otherwise new policies cannot close leak because permissive policies are OR-combined. Add pgTAP assertions against effective A/B/anon behavior, not policy names alone.

- [ ] **Step 3: Add constraint and grant assertions**

Assert allowed modes/statuses, total chapters exactly 50, contract source values, no authenticated write policy, and no table privilege exposing `story_creation_requests`.

- [ ] **Step 4: Reset local DB and run tests**

Run: `pnpm exec supabase db reset && pnpm exec supabase test db supabase/tests/personalized_story_schema_test.sql supabase/tests/personalized_story_rls_test.sql`
Expected: PASS for additive schema/RLS assertions; RPC-specific assertions remain deferred until Task 12 and must be marked with pgTAP `skip()` carrying reason `publish_chapter_v2 added after linked RPC derivation`, then replaced in Task 12.

- [ ] **Step 5: Verify no destructive SQL**

Run: `rg -n -i "\bdrop\s+(table|column|function)|alter\s+column.*type" supabase/migrations/20260713000000_personalized_story_engine.sql`
Expected: no matches. `DROP POLICY` is also not used because policy checks are defensive.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260713000000_personalized_story_engine.sql supabase/tests/personalized_story_schema_test.sql supabase/tests/personalized_story_rls_test.sql
git commit -m "feat: add personalized story schema and row security"
```

### Task 4: Reader-Safe Explicit Queries and Ownership-Aware Server Reads

**Files:**
- Modify: `lib/api/queries.ts`
- Modify: `lib/api/server.ts`
- Modify: `lib/api/user-state.ts`
- Modify: `app/api/stories/route.ts`
- Modify: `app/api/stories/[id]/route.ts`
- Create: `tests/api/owned-queries.test.ts`

- [ ] **Step 1: Write failing query tests**

Mock Supabase fluent queries and assert exact projection strings exclude internal columns. Cover public explore, A-owned private library, denied B detail, public detail, and explicit reader-state projection.

```ts
expect(STORY_READER_COLUMNS).toBe('id,title,cover,tagline,role,tropes,total_chapters,synopsis,status,current_chapter,jejak,ending_name')
expect(STORY_READER_COLUMNS).not.toMatch(/owner_user_id|story_mode|generation_status/)
```

Run: `pnpm vitest run tests/api/owned-queries.test.ts`
Expected: FAIL because constants/functions do not exist and current code uses `.select('*')`.

- [ ] **Step 2: Implement exact public signatures**

```ts
export const STORY_READER_COLUMNS = 'id,title,cover,tagline,role,tropes,total_chapters,synopsis,status,current_chapter,jejak,ending_name' as const
export async function queryStoriesByIdsForUser(storyIds: string[], userId: string): Promise<StorySummary[]>
export async function queryStoryForUser(id: string, userId: string | null): Promise<StoryDetail | null>
export async function queryExploreStories(): Promise<StorySummary[]>
```

`queryStoriesByIdsForUser` uses authenticated cookie client/RLS where available and additionally constrains `.in('id', storyIds)` plus `.or('visibility.eq.public,owner_user_id.eq.<userId>')`. `queryStoryForUser` uses same visibility/owner rule. `queryExploreStories` selects public rows and allows only `id LIKE 'demo:%'` or `story_mode = 'premium_template'`. Empty ID list returns `[]` without query.

- [ ] **Step 3: Replace reader-facing wildcard selects**

Use explicit `CHAPTER_READER_COLUMNS`, `OUTCOME_READER_COLUMNS`, and `READER_STATE_PUBLIC_COLUMNS`. Keep any service-role internal module free to select required internals. Route `/api/stories` calls `listExploreStories()`; detail route calls `getStory()`.

- [ ] **Step 4: Update server orchestration**

`listMyLibraryStories()` gets session user, reader-state IDs, then calls `queryStoriesByIdsForUser`. `listExploreStories()` calls `queryExploreStories`. `getStory()` normalizes ID and calls `queryStoryForUser(id, user?.id ?? null)` before overlay. Chapter reads first authorize parent story so private B chapter cannot be fetched by guessed ID.

- [ ] **Step 5: Run focused and type gates**

Run: `pnpm vitest run tests/api/owned-queries.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/api/queries.ts lib/api/server.ts lib/api/user-state.ts app/api/stories/route.ts app/api/stories/[id]/route.ts tests/api/owned-queries.test.ts
git commit -m "fix: enforce ownership-safe reader queries"
```

## Phase 2 — Pure Story Engine

### Task 5: Strict Story Contract and Three Complete Fixtures

**Files:**
- Create: `lib/story-engine/story-contract.ts`
- Create: `fixtures/contracts/build-contract-fixture.ts`
- Create: `fixtures/contracts/misteri-drama.ts`
- Create: `fixtures/contracts/romansa-drama.ts`
- Create: `fixtures/contracts/fantasi-petualangan.ts`
- Create: `tests/story-engine/story-contract.test.ts`

- [ ] **Step 1: Write failing strictness and fixture tests**

Test unknown-key rejection at root and nested targets; exactly 50 unique sequential targets; act coverage exactly 1–50 without gaps/overlaps; at least two unique ending keys; debts reference valid chapters; reveal runway gates valid; exact closure literals; all three fixtures differ in genre/conflict and parse completely.

Run: `pnpm vitest run tests/story-engine/story-contract.test.ts`
Expected: FAIL because module/fixtures do not exist.

- [ ] **Step 2: Implement strict schema**

Implement approved fields including `endingCandidates`, `plotDebts`, `revealRunway`, and `closureRunway`, using `.strict()` for every object. Add super-refinement:

```ts
export const StoryContractSchema = StoryContractBaseSchema.superRefine((contract, ctx) => {
  const numbers = contract.chapterTargets.map((target) => target.chapterNumber)
  if (numbers.some((number, index) => number !== index + 1)) {
    ctx.addIssue({ code: 'custom', path: ['chapterTargets'], message: 'chapterTargets must be sequential 1..50' })
  }
})
export type StoryContract = z.infer<typeof StoryContractSchema>
```

- [ ] **Step 3: Build fixtures without triplicated JSON**

`buildContractFixture(seed)` accepts title/genre/tone/character/conflict/endings/debts/reveals and deterministically maps `Array.from({length: 50}, (_, i) => ...)` into complete distinct targets. Each genre file calls builder with complete genre-specific seed. Builder returns `StoryContractSchema.parse(candidate)` so fixtures cannot load invalid data.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/story-engine/story-contract.test.ts`
Expected: PASS with three fixtures each containing 50 targets.

- [ ] **Step 5: Commit**

```bash
git add lib/story-engine/story-contract.ts fixtures/contracts/build-contract-fixture.ts fixtures/contracts/misteri-drama.ts fixtures/contracts/romansa-drama.ts fixtures/contracts/fantasi-petualangan.ts tests/story-engine/story-contract.test.ts
git commit -m "feat: define strict personalized story contracts"
```

### Task 6: Route State Parse, Merge, Clamp, Deduplicate, and Summary

**Files:**
- Create: `lib/story-engine/route-state.ts`
- Create: `tests/story-engine/route-state.test.ts`

- [ ] **Step 1: Write failing tests**

Cover score bounds, trust bounds, duplicate evidence, boolean-only flags, ending-bias deltas, malformed raw state normalization, immutable input, and stable sorted prompt summary.

Run: `pnpm vitest run tests/story-engine/route-state.test.ts`
Expected: FAIL because module does not exist.

- [ ] **Step 2: Implement exact types and functions**

```ts
export type RouteState = z.infer<typeof RouteStateSchema>
export interface RouteChoiceEffect {
  routeDeltas: Record<string, number>
  trustDeltas: Record<string, number>
  flagsSet: Record<string, boolean>
  evidenceAdded: string[]
  endingBiasDeltas: Record<string, number>
  threadTouches: string[]
}
export function normalizeRouteState(input: unknown): RouteState
export function mergeChoiceEffect(state: unknown, effect: RouteChoiceEffect): RouteState
export function summarizeRouteStateForPrompt(state: unknown): string
```

Only `truth`, `risk`, `secrecy`, and `empathy` are accepted route delta keys. Unknown keys are ignored after validated `RouteChoiceEffect`; clamp scores, clamp each trust value, trim/drop empty evidence, deduplicate preserving first appearance, and sort record keys in summary for deterministic prompts.

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run tests/story-engine/route-state.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/story-engine/route-state.ts tests/story-engine/route-state.test.ts
git commit -m "feat: add bounded personalized route state"
```

### Task 7: Plot Debt Auditor and Deterministic Ending Resolver

**Files:**
- Create: `lib/story-engine/plot-debt.ts`
- Create: `lib/story-engine/ending-resolver.ts`
- Create: `tests/story-engine/plot-debt.test.ts`
- Create: `tests/story-engine/ending-resolver.test.ts`

- [ ] **Step 1: Write failing audit tests**

Assert rejection for major mystery opened at 36, any thread opened at 41, missing lock at 45, unresolved main mystery at 48, open conflict/new conflict at 50; assert chapter 35/40 boundary acceptance.

- [ ] **Step 2: Write failing ending tests**

Assert chapter 44 cannot lock; chapter 45 selects highest score; tie resolves by contract candidate order then key; existing lock wins at 46–50; missing locked key rejects; resolver returns only `{key,name,requiredClosure}`.

Run: `pnpm vitest run tests/story-engine/plot-debt.test.ts tests/story-engine/ending-resolver.test.ts`
Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement auditor contract**

```ts
export interface PlotDebtAuditInput {
  chapterNumber: number
  debts: StoryContract['plotDebts']
  opensMajorMystery: boolean
  opensNewThread: boolean
  endingLocked: boolean
  opensNewConflict: boolean
}
export type PlotDebtFindingCode = 'MAJOR_MYSTERY_AFTER_35' | 'THREAD_AFTER_40' | 'ENDING_NOT_LOCKED' | 'MAIN_MYSTERY_OPEN' | 'OPEN_CONFLICT_AT_END' | 'NEW_CONFLICT_AT_END'
export function auditPlotDebts(input: PlotDebtAuditInput): { ok: boolean; findings: { code: PlotDebtFindingCode; debtId?: string }[] }
```

- [ ] **Step 4: Implement resolver**

```ts
export function resolveEnding(input: {
  routeState: RouteState
  storyContract: StoryContract
  chapterNumber: number
  lockedEndingKey?: string | null
}): { key: string; name: string; requiredClosure: string[] }
```

Score `routeState.endingBias[candidate.key] ?? 0`; stable candidate array order breaks equal scores. Reject lock requests before chapter 45. At chapter 45+ return existing valid lock; otherwise resolve deterministically.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm vitest run tests/story-engine/plot-debt.test.ts tests/story-engine/ending-resolver.test.ts`
Expected: PASS.

```bash
git add lib/story-engine/plot-debt.ts lib/story-engine/ending-resolver.ts tests/story-engine/plot-debt.test.ts tests/story-engine/ending-resolver.test.ts
git commit -m "feat: audit plot closure and resolve endings"
```

### Task 8: Chapter Brief, Quality Validators, and Pure Barrel

**Files:**
- Create: `lib/story-engine/chapter-brief.ts`
- Create: `lib/story-engine/quality.ts`
- Create: `lib/story-engine/index.ts`
- Create: `tests/story-engine/chapter-brief.test.ts`
- Create: `tests/story-engine/quality.test.ts`

- [ ] **Step 1: Write failing brief tests**

Test chapter target selection, route summary, due debts, previous choice inclusion, no-new-major-conflict after 35, no-new-thread after 40, lock at 45, payoff at 46–48, emotional resolution at 49, and no choices/conflicts at 50.

- [ ] **Step 2: Write failing quality tests**

Test 799/1001 words fail, duplicate long paragraphs fail, two consecutive abstract paragraphs fail, fewer than three drama/mystery dialog lines fail, weak hook fails, choice labels unrelated to last three paragraphs fail, internal labels/leak words fail, wall-of-text/info-dump/backstory/actionless labels fail, valid mobile fixture passes.

Run: `pnpm vitest run tests/story-engine/chapter-brief.test.ts tests/story-engine/quality.test.ts`
Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement brief schema/signature**

```ts
export interface ChoiceHistoryEntry {
  chapterNumber: number
  choiceId: string
  label: string
  consequence: string[]
  effectSummary: { truth?: number; risk?: number; secrecy?: number; empathy?: number; flagsSet: string[] }
  createdAt: string
}
export const ChapterBriefSchema = z.object({
  chapterNumber: z.number().int().min(1).max(50), phase: z.string(), goals: z.array(z.string()),
  mustInclude: z.array(z.string()), mustNotReveal: z.array(z.string()), routeSummary: z.string(),
  debtsToProgress: z.array(z.string()), debtsToClose: z.array(z.string()),
  allowMajorNewConflict: z.boolean(), allowNewThread: z.boolean(), lockEnding: z.boolean(),
  endingKey: z.string().nullable(), finalChapter: z.boolean(), previousChoiceSummary: z.string().nullable(),
}).strict()
export function buildChapterBrief(input: { storyContract: StoryContract; snapshot: CanonSnapshot; readerState: { routeState: RouteState; lockedEndingKey?: string | null }; chapterNumber: number; previousChoice?: ChoiceHistoryEntry | null }): ChapterBrief
```

Reuse cutoff constants/rules from `lib/narrative/template.ts` and `lib/narrative/threads.ts`; do not duplicate contradictory values.

- [ ] **Step 4: Implement deterministic validator result**

```ts
export interface QualityFinding { code: string; message: string }
export function validateChapterQuality(input: { genre: string; paragraphs: string[]; lastParagraphs?: string[] }): QualityFinding[]
export function validateChoiceQuality(input: { labels: string[]; lastParagraphs: string[] }): QualityFinding[]
```

- [ ] **Step 5: Export pure barrel and verify no server import**

Run: `pnpm vitest run tests/story-engine/chapter-brief.test.ts tests/story-engine/quality.test.ts && pnpm typecheck`
Expected: PASS. `rg -n "server-only|supabase" lib/story-engine/index.ts` returns no matches.

- [ ] **Step 6: Commit**

```bash
git add lib/story-engine/chapter-brief.ts lib/story-engine/quality.ts lib/story-engine/index.ts tests/story-engine/chapter-brief.test.ts tests/story-engine/quality.test.ts
git commit -m "feat: build chapter briefs and quality gates"
```

## Phase 3 — Dynamic Choices and Atomic Publish V2

### Task 9: Choice Schemas and Chapter-Aware Validation

**Files:**
- Modify: `lib/ai-gateway/schemas.ts`
- Modify: `lib/ai-gateway/gateway.ts`
- Modify: `lib/ai-gateway/index.ts`
- Create: `tests/story-engine/choice-branch.test.ts`

- [ ] **Step 1: Write failing tests**

Cover 2–3 choices, unique IDs, exact outcome matching, concrete labels, banned generic labels/internal route labels, valid effects, next chapter equality, ending only at 49, chapter 49 normal path to 50, and chapter 50 rejection with code `CHOICES_NOT_ALLOWED`. Assert `ChapterDraftSchema.keyof().options` unchanged and excludes `choices`/`outcomes`.

Run: `pnpm vitest run tests/story-engine/choice-branch.test.ts`
Expected: FAIL because schemas/validator do not exist.

- [ ] **Step 2: Add schemas without touching `ChapterDraftSchema`**

Implement approved strict `ChoiceEffectSchema` and `ChoiceBranchSchema`. Export:

```ts
export type ChoiceEffect = z.infer<typeof ChoiceEffectSchema>
export type ChoiceBranch = z.infer<typeof ChoiceBranchSchema>
export function validateChoiceBranch(input: unknown, chapterNumber: number): ChoiceBranch
```

Use schema for shape, then gateway checks matching sets, banned labels, leak scan, chapter transitions, and ending-window rules. Callers skip generation at chapter 50; direct validation at 50 throws `GatewayError('Bab terakhir tidak memiliki pilihan.', 'CHOICES_NOT_ALLOWED')`.

- [ ] **Step 3: Run tests and commit**

Run: `pnpm vitest run tests/story-engine/choice-branch.test.ts && pnpm typecheck`
Expected: PASS.

```bash
git add lib/ai-gateway/schemas.ts lib/ai-gateway/gateway.ts lib/ai-gateway/index.ts tests/story-engine/choice-branch.test.ts
git commit -m "feat: validate chapter-aware dynamic choices"
```

### Task 10: Optional Choice Provider and Gateway Pass

**Files:**
- Modify: `lib/ai-gateway/provider.ts`
- Modify: `lib/ai-gateway/gateway.ts`
- Modify: `lib/ai-gateway/gateway-provider.ts`
- Create: `tests/story-engine/choice-provider.test.ts`

- [ ] **Step 1: Write failing compatibility tests**

Compile/use provider containing only `generatePlan` and `writeChapter`; assert it remains valid. Test missing optional method gives `CHOICE_PROVIDER_UNAVAILABLE`. Test raw valid branch passes gateway and invalid raw branch never escapes.

Run: `pnpm vitest run tests/story-engine/choice-provider.test.ts`
Expected: FAIL because method/input/gateway operation do not exist.

- [ ] **Step 2: Add optional interface**

```ts
export interface ChoiceInput {
  snapshot: CanonSnapshot
  chapterBrief: ChapterBrief
  draft: ChapterDraftParsed
  lastParagraphs: string[]
  routeState: RouteState
  choiceHistory: ChoiceHistoryEntry[]
  lockedEndingKey: string | null
}
export interface GenerationProvider {
  readonly name: string
  generatePlan(input: PlanInput): Promise<unknown>
  writeChapter(input: WriteInput): Promise<unknown>
  generateChoices?(input: ChoiceInput): Promise<unknown>
}
```

- [ ] **Step 3: Add gateway operation and real adapter pass**

```ts
export async function generateChoiceBranch(deps: GatewayDeps, input: ChoiceInput): Promise<ChoiceBranch>
```

Operation calls optional provider method, validates using draft chapter number, scans prompt/labels/hints/consequences, and returns parsed branch. `createGatewayProvider()` implements optional method using same resolved model chain and request path as prose. Do not create direct SDK client outside `gateway-provider.ts`; preserve model route selection/logging/cost path.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm vitest run tests/story-engine/choice-provider.test.ts tests/story-engine/choice-branch.test.ts && pnpm typecheck`
Expected: PASS and legacy deterministic provider test compiles unchanged.

```bash
git add lib/ai-gateway/provider.ts lib/ai-gateway/gateway.ts lib/ai-gateway/gateway-provider.ts tests/story-engine/choice-provider.test.ts
git commit -m "feat: route dynamic choices through generation gateway"
```

### Task 11: Additive TypeScript `publishChapterV2` Wrapper

**Files:**
- Modify: `lib/runtime/lifecycle.ts`
- Create: `tests/runtime/publish-chapter-v2.test.ts`

- [ ] **Step 1: Write failing wrapper tests**

Mock admin RPC. Assert method name `publish_chapter_v2`, snake-case payload, effect mapping, normal branch, and chapter 50 null/empty branch. Assert existing `publishChapter()` still calls `publish_chapter` with unchanged payload.

Run: `pnpm vitest run tests/runtime/publish-chapter-v2.test.ts`
Expected: FAIL because wrapper/types do not exist.

- [ ] **Step 2: Implement additive types**

```ts
export interface PublishOutcomeV2 extends PublishOutcome {
  effect: ChoiceEffect
  choiceKind: 'normal' | 'special_bad_ending'
}
export interface PublishChapterV2Input extends Omit<PublishChapterInput, 'outcomes'> {
  outcomes: PublishOutcomeV2[]
}
export async function publishChapterV2(input: PublishChapterV2Input): Promise<PublishResult>
```

Map each outcome to linked RPC JSON key convention established by Task 1 plus `effect_json` and `choice_kind`. Keep old interfaces/function body unchanged except imports needed for types.

- [ ] **Step 3: Run tests and commit**

Run: `pnpm vitest run tests/runtime/publish-chapter-v2.test.ts && pnpm typecheck`
Expected: PASS.

```bash
git add lib/runtime/lifecycle.ts tests/runtime/publish-chapter-v2.test.ts
git commit -m "feat: add publish chapter v2 runtime wrapper"
```

### Task 12: Mechanically Derive `publish_chapter_v2` from Linked Legacy RPC

**Files:**
- Create: `supabase/migrations/20260713010000_publish_chapter_v2.sql`
- Modify: `supabase/tests/personalized_story_schema_test.sql`
- Modify: `supabase/tests/personalized_story_rls_test.sql`

- [ ] **Step 1: Replace deferred tests with failing RPC tests**

Assert exact argument types, `SECURITY DEFINER`, fixed `search_path`, service-role execute only, normal atomic insert, effect/choice-kind persistence, Chapter 50 `NULL` choices plus `[]` outcomes, Chapter 50 empty choices, replay result, chapter-exists result, event append, and exact lease release based on introspected columns.

Run: `pnpm exec supabase test db supabase/tests/personalized_story_schema_test.sql supabase/tests/personalized_story_rls_test.sql`
Expected: FAIL because `publish_chapter_v2` does not exist.

- [ ] **Step 2: Perform mandatory mechanical derivation**

Copy complete dumped `publish_chapter` body into new `publish_chapter_v2` in same migration. Make only these auditable changes:

1. Rename function.
2. Preserve exact parameter types/order, volatility, event sequencing, idempotency behavior, conflict behavior, lease verification/release, and return JSON.
3. Permit `p_choices IS NULL OR p_choices = '[]'::jsonb` and `p_outcomes IS NULL OR p_outcomes = '[]'::jsonb` only when `p_chapter_number = 50`; reject empty branches for chapters 1–49.
4. For provided outcomes, extend existing insert column/value list with `effect_json` validated as JSON object and `choice_kind` constrained to supported value.
5. Require outcome/choice cardinality and matching IDs before writes.
6. Keep chapter/outcomes/event/lease release in one PL/pgSQL transaction.
7. Set `SECURITY DEFINER` and `SET search_path = public, pg_temp`; schema-qualify all tables/functions.
8. Revoke from `PUBLIC`, `anon`, and `authenticated`; grant only `service_role`.

Mandatory stop: if copied old body cannot be matched line-for-line to linked dump apart from listed changes, do not apply migration. Re-dump linked DB and resolve discrepancy first.

- [ ] **Step 3: Show mechanical diff for review**

Extract old and v2 functions into untracked normalized files and run:

```bash
git diff --no-index -- .local/personalized-story-introspection/publish-chapter.sql .local/personalized-story-introspection/publish-chapter-v2.sql
```

Expected: differences limited to name, Chapter 50 branch allowance, effect/choice columns/validation, strengthened search path/grants where old definition lacked them.

- [ ] **Step 4: Reset and run DB tests**

Run: `pnpm exec supabase db reset && pnpm exec supabase test db supabase/tests/personalized_story_schema_test.sql supabase/tests/personalized_story_rls_test.sql`
Expected: PASS, including rollback assertion proving no partial chapter/outcome/event/lease mutation on invalid effect.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260713010000_publish_chapter_v2.sql supabase/tests/personalized_story_schema_test.sql supabase/tests/personalized_story_rls_test.sql
git commit -m "feat: add atomic personalized chapter publisher"
```

### Task 13: Phase 1–3 Integration Gate

**Files:**
- Create: `tests/integration/personalized-core-gate.test.ts`

- [ ] **Step 1: Write integration test**

Build valid fixture, merge effect, resolve chapter-45 ending, build chapter-50 brief, verify choice validator rejects chapter 50, and verify v2 wrapper sends null/empty choices without mutating reader contract.

- [ ] **Step 2: Run RED then implement test harness adapters**

Run: `pnpm vitest run tests/integration/personalized-core-gate.test.ts`
Expected first run: FAIL until imports/test adapters are wired; no production behavior is added here.

- [ ] **Step 3: Run complete phase gate**

Run: `pnpm vitest run tests/story-engine tests/runtime/publish-chapter-v2.test.ts tests/integration/personalized-core-gate.test.ts && pnpm typecheck && pnpm exec supabase test db`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/personalized-core-gate.test.ts
git commit -m "test: gate personalized core integration"
```

## Phase 4 — Contract Generation, Bootstrap, Runtime, and Creation

### Task 14: Optional Story Contract Provider Through Existing Gateway

**Files:**
- Modify: `lib/ai-gateway/provider.ts`
- Modify: `lib/ai-gateway/gateway.ts`
- Modify: `lib/ai-gateway/gateway-provider.ts`
- Create: `tests/story-engine/contract-provider.test.ts`

- [ ] **Step 1: Write failing compatibility/routing tests**

Assert old provider remains valid, absent method produces `CONTRACT_PROVIDER_UNAVAILABLE`, raw provider output is returned as `unknown` without strict parsing, and gateway-provider uses existing resolved model chain rather than direct client. Strict parsing belongs to Task 15 so invalid first output can drive exactly one repair attempt.

Run: `pnpm vitest run tests/story-engine/contract-provider.test.ts`
Expected: FAIL.

- [ ] **Step 2: Add optional contract operation**

```ts
export interface StoryContractInput { storyId: string; tasteJson: TasteProfile; repairErrors?: string[] }
export interface GenerationProvider { generateStoryContract?(input: StoryContractInput): Promise<unknown> }
export async function generateStoryContractRaw(deps: GatewayDeps, input: StoryContractInput): Promise<unknown>
```

Implement provider prompt/generation using same `resolveModelChain`, configured model route, request logging, and cost path already used by gateway provider. Return raw `unknown`; Task 15 performs `StoryContractSchema.safeParse()`, records issue strings, invokes one repair call, and validates fallback.

- [ ] **Step 3: Run tests and commit**

Run: `pnpm vitest run tests/story-engine/contract-provider.test.ts && pnpm typecheck`
Expected: PASS.

```bash
git add lib/ai-gateway/provider.ts lib/ai-gateway/gateway.ts lib/ai-gateway/gateway-provider.ts tests/story-engine/contract-provider.test.ts
git commit -m "feat: route story contracts through generation gateway"
```

### Task 15: Resilient 30-Second Contract Generation

**Files:**
- Create: `lib/story-engine/contract-generation.server.ts`
- Create: `tests/story-engine/contract-generation.test.ts`

- [ ] **Step 1: Write fake-timer tests**

Test valid first result returns `llm`; invalid first + valid repair returns `llm_repaired`; two invalid results return validated fixture fallback; 30,001ms timeout returns fallback; rejected provider returns fallback; fallback customizes story ID/name/setting/tropes without changing 50-target structure.

Run: `pnpm vitest run tests/story-engine/contract-generation.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement bounded orchestration**

```ts
export type ContractSource = 'llm' | 'llm_repaired' | 'template_fallback'
export async function createResilientStoryContract(input: {
  storyId: string
  tasteJson: TasteProfile
  provider: GenerationProvider
  timeoutMs?: number
}): Promise<{ contract: StoryContract; contractSource: ContractSource }>
```

Use one `AbortController`/`Promise.race` budget of `timeoutMs ?? 30_000` per LLM call, exactly one repair call carrying Zod issue strings, then `mapTasteToTemplate`. Parse fallback again with `StoryContractSchema`; throw only if bundled fixture is corrupt, never because provider failed.

- [ ] **Step 3: Run tests and commit**

Run: `pnpm vitest run tests/story-engine/contract-generation.test.ts`
Expected: PASS.

```bash
git add lib/story-engine/contract-generation.server.ts tests/story-engine/contract-generation.test.ts
git commit -m "feat: add resilient personalized contract generation"
```

### Task 16: Contract Persistence and Canon Bootstrap with Exactly 50 Blueprints

**Files:**
- Create: `lib/story-engine/contract-persistence.server.ts`
- Create: `tests/story-engine/contract-persistence.test.ts`

- [ ] **Step 1: Write failing persistence tests**

Mock admin client and assert validated contract maps to one contract row, characters/aliases/voice/facts/knowledge/secrets/threads, exactly 50 blueprint rows with numbers 1–50, source fields split into approved JSON columns, and zero chapter insert/generation calls. Assert transaction/RPC failure leaves no shell partials.

Run: `pnpm vitest run tests/story-engine/contract-persistence.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement deterministic bootstrap mapping**

```ts
export interface CanonBootstrap {
  characters: CharacterInsert[]; characterAliases: CharacterAliasInsert[]; voiceSheets: VoiceSheetInsert[]
  facts: FactInsert[]; knowledge: KnowledgeInsert[]; secrets: SecretInsert[]; threads: ThreadInsert[]
  blueprints: ChapterBlueprintInsert[]
}
export function contractToCanonBootstrap(contract: StoryContract): CanonBootstrap
export async function persistContractAndCanon(input: { contract: StoryContract; contractSource: ContractSource; onboardingJson: TasteProfile }): Promise<void>
```

Use introspected exact insert columns. Blueprints map every `chapterTarget` to existing canon shape and contain no prose. Persist contract plus canon through one new transaction-safe DB RPC in `supabase/migrations/20260713020000_bootstrap_personalized_story.sql`, service-role only, with rollback tests. Derive every insert column and FK mapping from Task 1 introspection. Do not edit already-applied migrations. Do not generate a chapter here.

- [ ] **Step 3: Run unit and DB tests**

Run: `pnpm vitest run tests/story-engine/contract-persistence.test.ts && pnpm exec supabase test db`
Expected: PASS; DB assertion counts 50 blueprints and 0 chapters after bootstrap.

- [ ] **Step 4: Commit**

```bash
git add lib/story-engine/contract-persistence.server.ts tests/story-engine/contract-persistence.test.ts supabase/migrations/20260713020000_bootstrap_personalized_story.sql supabase/tests/personalized_story_schema_test.sql
git commit -m "feat: persist contracts and bootstrap personalized canon"
```

### Task 17: Personalized Chapter Runtime and Chapter 50 Completion

**Files:**
- Create: `lib/runtime/personalized-generation.ts`
- Modify: `lib/runtime/index.ts`
- Create: `tests/runtime/personalized-generation.test.ts`

- [ ] **Step 1: Write failing runtime tests**

Inject loaders/provider/lifecycle dependencies. Assert call order: lease, canon, contract, reader state, brief, compile, existing `generateChapter`, consumer-safe guard, choices for chapters below 50, v2 publish, telemetry. Assert Chapter 50 skips choice provider, resolves locked ending, publishes null/empty choices, then marks reader `SELESAI`. Assert story A/B use separate IDs/snapshots and cannot overwrite chapters. Assert standard `generateNextChapterReal()` remains exported and uncalled.

Run: `pnpm vitest run tests/runtime/personalized-generation.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement dependency-testable runtime**

```ts
export interface PersonalizedGenerateInput { storyId: string; userId: string; chapterNumber: number; triggerChoiceId?: string }
export async function generateNextPersonalizedChapter(input: PersonalizedGenerateInput, deps?: PersonalizedGenerationDeps): Promise<RealGenerateResult>
```

Reuse `acquireGenerationLease`, `loadCanonSnapshot`, `compileContext`, `generateChapter`, Layer A/B/repair, `assertConsumerSafe`, and telemetry. Load/parse contract and internal reader state through explicit internal service-role selects. Run `auditPlotDebts` before publish. Persist ending lock at chapter 45 atomically with reader/contract state. For Chapter 50 complete reader only after successful `publishChapterV2`.

- [ ] **Step 3: Run tests and regression gate**

Run: `pnpm vitest run tests/runtime/personalized-generation.test.ts scripts/m4-generation.ts && pnpm typecheck`
Expected: personalized test PASS. If Vitest cannot execute smoke script directly, run `pnpm smoke:m4`; expected PASS. Existing `lib/runtime/story-generation.ts` logic remains unchanged.

- [ ] **Step 4: Commit**

```bash
git add lib/runtime/personalized-generation.ts lib/runtime/index.ts tests/runtime/personalized-generation.test.ts
git commit -m "feat: generate personalized chapters through validated runtime"
```

### Task 18: Authenticated Strong-Idempotency Personalized Creation Endpoint

**Files:**
- Create: `lib/api/personalized-stories.server.ts`
- Create: `app/api/stories/personalized/route.ts`
- Create: `tests/api/personalized-stories.test.ts`

- [ ] **Step 1: Write failing service/route tests**

Test missing auth 401, missing/invalid `Idempotency-Key` 400, same key+same request returns same story ID, same key+different request returns 409, owner always session user, private `personalized_ai` shell, taste profile load, contract/canon before chapter, exactly Chapter 1 generation, and reader-safe response.

Run: `pnpm vitest run tests/api/personalized-stories.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement strong reservation semantics**

```ts
export async function createPersonalizedStory(input: {
  userId: string
  idempotencyKey: string
}): Promise<{ storyId: string; redirectUrl: string; replayed: boolean }>
```

Canonical request hash is SHA-256 of `{kind:'personalized',userId,tasteProfileVersion}`. Reserve `story_creation_requests` with generated `ai:${crypto.randomUUID()}` using unique key. On unique conflict: same hash returns stored story; different hash throws typed `IDEMPOTENCY_CONFLICT`. Never accept `userId` from body. Persist shell, resilient contract, canon, reader state, then generate only Chapter 1. Update request/story status to `READY`; failures mark request/story failed without creating a second story on replay.

- [ ] **Step 3: Implement route**

Authenticate with cookie Supabase `auth.getUser()`, read header, call service, return `201` first call or `200` replay:

```json
{"storyId":"ai:<uuid>","redirectUrl":"/baca/ai%3A<uuid>?bab=1"}
```

No contract, route, effect, owner, or generation internals in response.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm vitest run tests/api/personalized-stories.test.ts && pnpm typecheck`
Expected: PASS.

```bash
git add lib/api/personalized-stories.server.ts app/api/stories/personalized/route.ts tests/api/personalized-stories.test.ts
git commit -m "feat: create personalized stories idempotently"
```

## Phase 5 — Atomic Choice, Durable Continuation, Status, and Reader Polling

### Task 19: Ownership-First Atomic Personalized Choice Service

**Files:**
- Create: `supabase/migrations/20260713030000_apply_personalized_choice.sql`
- Create: `lib/api/personalized-choice.server.ts`
- Modify: `app/api/stories/[id]/choices/route.ts`
- Create: `tests/api/personalized-choice.test.ts`
- Modify: `supabase/tests/personalized_story_rls_test.sql`

- [ ] **Step 1: Write failing authorization/idempotency tests**

Assert ownership checked with authenticated client before service-role outcome lookup; B/anon cannot infer outcome existence; valid effect updates route state, summarized `choice_history`, and reader-safe `jejak` atomically; exact replay returns prior public outcome without duplicate history; same chapter with different choice returns conflict 409; response recursively excludes internal fields.

Run: `pnpm vitest run tests/api/personalized-choice.test.ts`
Expected: FAIL.

- [ ] **Step 2: Add transaction-safe choice RPC**

Create service-role-only `apply_personalized_choice` using introspected reader-state keys and row lock. Parameters include authenticated `p_user_id`, story/chapter/choice, normalized next route state, summarized history entry, reader-safe jejak entry, and idempotency key. Inside transaction: verify story owner equals `p_user_id`, lock state, detect replay by chapter+choice, reject chapter conflict, update route/history/jejak/progress, return public outcome. Revoke `PUBLIC`, anon, authenticated. Do not return `effect_json` or state JSON.

- [ ] **Step 3: Implement ownership-first service**

```ts
export async function applyPersonalizedChoice(input: {
  userId: string; storyId: string; chapterNumber: number; choiceId: string; idempotencyKey: string
}): Promise<{ outcome: ChoiceOutcome; nextChapterNumber: number | null; replayed: boolean }>
```

First query parent through user-scoped `queryStoryForUser` and require owned mode. Only then use admin explicit select `story_id,chapter_number,choice_id,consequence,next_chapter_number,is_ending,effect_json,choice_kind`; validate effect, merge route, build `effectSummary` containing score deltas and flag names only, and call RPC.

- [ ] **Step 4: Route dispatch and tests**

Private personalized/premium instance requires auth and `Idempotency-Key`; standard/public path keeps old behavior. Map typed conflict to 409.

Run: `pnpm vitest run tests/api/personalized-choice.test.ts && pnpm exec supabase test db supabase/tests/personalized_story_rls_test.sql`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260713030000_apply_personalized_choice.sql lib/api/personalized-choice.server.ts app/api/stories/[id]/choices/route.ts tests/api/personalized-choice.test.ts supabase/tests/personalized_story_rls_test.sql
git commit -m "feat: apply personalized choices atomically"
```

### Task 20: Bounded Wait and Proven Durable Generation Continuation

**Files:**
- Create: `lib/api/generation-continuation.server.ts`
- Modify: `app/api/stories/[id]/choices/route.ts`
- Create: `tests/api/generation-continuation.test.ts`
- Conditionally create: `supabase/migrations/20260713040000_personalized_generation_outbox.sql`

- [ ] **Step 1: Write failing bounded-wait tests**

Assert ready within 25s returns `nextChapterReady: true`; timeout returns false without cancelling generation; duplicate trigger shares same story/chapter job; lease-held treated as in progress; generation failure remains queryable.

Run: `pnpm vitest run tests/api/generation-continuation.test.ts`
Expected: FAIL.

- [ ] **Step 2: Prove continuation capability before selecting path**

Current code imports `after` in `app/brainstorm/actions.ts`; verify target deployment adapter with production build and documented OpenNext behavior:

```bash
pnpm build
pnpm build:cloudflare
rg -n "waitUntil|after\(" .open-next open-next.config.ts node_modules/@opennextjs/cloudflare
```

Expected for `after()` path: generated Cloudflare handler binds Next wait-until work to platform `ctx.waitUntil`, and an integration probe logs completion after response. If proof fails, inspect Task 1 dump for durable outbox/lease mechanism. Do not proceed with detached promise.

- [ ] **Step 3A: Implement proven `after()` continuation when proof passes**

```ts
export async function continueGeneration(input: PersonalizedGenerateInput): Promise<void> {
  const { after } = await import('next/server')
  after(() => generateNextPersonalizedChapter(input).then(recordResult).catch(recordFailure))
}
```

Start same promise before bounded wait and register that same in-flight promise with `after`; do not launch duplicate generation after timeout.

- [ ] **Step 3B: Otherwise implement durable outbox**

If linked outbox exists, use its exact columns/lease claim RPC. If absent, create `20260713040000_personalized_generation_outbox.sql` with unique `(story_id, chapter_number)`, status `PENDING|RUNNING|DONE|FAILED`, attempts, available/locked timestamps, last error code, and service-role-only atomic claim RPC using `FOR UPDATE SKIP LOCKED`. Enqueue before response; worker claims, runs personalized generation, records terminal state. Request path may attempt bounded synchronous processing, but uncompleted job remains durable.

- [ ] **Step 4: Return optional readiness without breaking old caller**

Route response becomes `{ outcome, nextChapterReady?: boolean }`; standard stories may omit field. Personalized branch waits `Promise.race([generation, 25_000ms timer])` and uses continuation path for remaining work.

- [ ] **Step 5: Run tests and commit selected files**

Run: `pnpm vitest run tests/api/generation-continuation.test.ts tests/api/personalized-choice.test.ts && pnpm typecheck`
Expected: PASS.

```bash
git add lib/api/generation-continuation.server.ts app/api/stories/[id]/choices/route.ts tests/api/generation-continuation.test.ts
git add supabase/migrations/20260713040000_personalized_generation_outbox.sql 2>/dev/null || true
git commit -m "feat: continue personalized generation durably"
```

### Task 21: Exact Per-Chapter Status Service and Endpoint

**Files:**
- Create: `lib/api/chapter-status.server.ts`
- Create: `app/api/stories/[id]/chapters/[chapterNumber]/status/route.ts`
- Create: `tests/api/chapter-status.test.ts`
- Conditionally modify: `supabase/migrations/20260713040000_personalized_generation_outbox.sql`

- [ ] **Step 1: Write failing precedence/authorization tests**

Assert chapter exists wins `ready`; exact active lease gives `generating`; latest exact failed attempt gives `failed`; stale/other-chapter lease ignored; older failure followed by active lease gives generating; unknown triggered state gives generating; B/anon denied private status. Assert `stories.generation_status` is never queried.

Run: `pnpm vitest run tests/api/chapter-status.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement exact introspection-backed resolution**

```ts
export type PersonalizedChapterStatus = 'ready' | 'generating' | 'failed'
export async function getChapterStatusForUser(input: { userId: string; storyId: string; chapterNumber: number }): Promise<PersonalizedChapterStatus>
```

Authorize parent first. Query chapter existence. Query active lease using exact Task 1 columns, not assumed `lease_id`. Query latest exact failed attempt using confirmed `story_events` payload key spelling/index. If payload querying cannot be made exact and indexed, store attempt rows in Task 20 outbox keyed by `(story_id,chapter_number)` and query that dedicated index; do not scan ambiguous JSON.

- [ ] **Step 3: Implement route and contract**

Validate positive integer path; auth required for private instance; return only:

```json
{"status":"ready","chapterNumber":2}
```

- [ ] **Step 4: Run tests and commit**

Run: `pnpm vitest run tests/api/chapter-status.test.ts && pnpm typecheck && pnpm exec supabase test db`
Expected: PASS.

```bash
git add lib/api/chapter-status.server.ts app/api/stories/[id]/chapters/[chapterNumber]/status/route.ts tests/api/chapter-status.test.ts
git add supabase/migrations/20260713040000_personalized_generation_outbox.sql 2>/dev/null || true
git commit -m "feat: expose exact personalized chapter status"
```

### Task 22: Reader Polling and Final Chapter No-Choice UI

**Files:**
- Modify: `packages/contracts/src/reader.ts`
- Modify: `lib/api/client.ts`
- Modify: `components/reader-view.tsx`
- Create: `tests/api/reader-status-contract.test.ts`
- Create: `tests/reader-final-chapter.test.ts`

- [ ] **Step 1: Write failing contracts/UI tests**

Assert optional `nextChapterReady` parses; chapter status schema contains no internals; existing `submitChoice()` still returns `ChoiceOutcome`; hint renders; Chapter 50 renders no choice section and shows links `Kembali ke Library` and `Buat Cerita Baru`; polling stops on ready/failed/unmount.

Run: `pnpm vitest run tests/api/reader-status-contract.test.ts tests/reader-final-chapter.test.ts`
Expected: FAIL.

- [ ] **Step 2: Extend public schemas additively**

```ts
export const ChapterGenerationStatusSchema = z.enum(['ready','generating','failed'])
export const ChapterStatusResponseSchema = z.object({ status: ChapterGenerationStatusSchema, chapterNumber: z.number().int().positive() }).strict()
export const SubmitChoiceResponseSchema = z.object({ outcome: ChoiceOutcomeSchema, nextChapterReady: z.boolean().optional() }).strict()
```

Do not add internal fields to any reader schema.

- [ ] **Step 3: Preserve client seam and add helper**

Keep `submitChoice(...): Promise<ChoiceOutcome>`. Add internal/public helper returning envelope only where ReaderView needs it:

```ts
export async function submitChoiceWithReadiness(...): Promise<SubmitChoiceResponse>
export async function getChapterGenerationStatus(storyId: string, chapterNumber: number): Promise<ChapterStatusResponse>
```

- [ ] **Step 4: Implement bounded reader polling/final UI**

On false readiness, poll every 1500ms; ready navigates, failed shows reader-safe retry state, abort on unmount. Final state is based on `chapter.number === story.totalChapters` and empty choices; show two non-choice links. No route state, effect, history, contract, lease, attempt, or mode prop enters component.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm vitest run tests/api/reader-status-contract.test.ts tests/reader-final-chapter.test.ts && pnpm typecheck`
Expected: PASS.

```bash
git add packages/contracts/src/reader.ts lib/api/client.ts components/reader-view.tsx tests/api/reader-status-contract.test.ts tests/reader-final-chapter.test.ts
git commit -m "feat: poll personalized chapters and render final actions"
```

## Phase 6 — Premium Template Clone

### Task 23: Transactional `clone_premium_story_instance` RPC

**Files:**
- Create: `supabase/migrations/20260713050000_clone_premium_story_instance.sql`
- Create: `supabase/tests/premium_story_clone_test.sql`

- [ ] **Step 1: Write failing pgTAP clone tests**

Seed public premium template with contract and rows in every linked canon table. Assert invalid mode/private template returns `INVALID_TEMPLATE`; valid clone creates private `premium_instance`, correct `source_story_id`, owner, contract, all canon/aliases/voice/state/facts/knowledge/secrets/threads/50 blueprints/rollups/reader state, optional curated Chapter 1; injected FK failure rolls back every target row; execute denied to anon/authenticated and granted to service role.

Run: `pnpm exec supabase test db supabase/tests/premium_story_clone_test.sql`
Expected: FAIL because RPC does not exist.

- [ ] **Step 2: Implement linked-schema-derived clone SQL**

Use exact Task 1 column lists; never `INSERT ... SELECT *`. Validate source row `story_mode = 'premium_template' AND visibility = 'public'`. Insert target shell with `story_mode='premium_instance'`, `visibility='private'`, `owner_user_id=p_user_id`, `source_story_id=p_template_story_id`. Copy every approved table with IDs remapped where IDs are globally unique; preserve intra-story FKs via deterministic old-to-new ID mapping. Create reader state. Copy curated Chapter 1 and its public choices/outcomes only when present. Entire function is one transaction via PL/pgSQL exception semantics.

Use `SECURITY DEFINER SET search_path = public, pg_temp`, schema-qualified objects, revoke `PUBLIC`/anon/authenticated, grant service role only.

- [ ] **Step 3: Run clone and full DB tests**

Run: `pnpm exec supabase db reset && pnpm exec supabase test db supabase/tests/premium_story_clone_test.sql supabase/tests/personalized_story_schema_test.sql supabase/tests/personalized_story_rls_test.sql`
Expected: PASS, including rollback count zero after injected failure.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260713050000_clone_premium_story_instance.sql supabase/tests/premium_story_clone_test.sql
git commit -m "feat: clone premium templates transactionally"
```

### Task 24: Authenticated Strong-Idempotency Premium Clone Endpoint

**Files:**
- Create: `lib/api/premium-clone.server.ts`
- Create: `app/api/stories/premium/[templateId]/clone/route.ts`
- Create: `tests/api/premium-clone.test.ts`

- [ ] **Step 1: Write failing tests**

Test auth required, header required, same request replay, changed template under same key conflict, body `userId` ignored/rejected, session user passed as `p_user_id`, invalid template maps 404/422 without leakage, curated Chapter 1 skips generation, absent Chapter 1 generates only Chapter 1.

Run: `pnpm vitest run tests/api/premium-clone.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement service**

```ts
export async function clonePremiumStoryForUser(input: {
  userId: string; templateStoryId: string; idempotencyKey: string
}): Promise<{ storyId: string; redirectUrl: string; replayed: boolean }>
```

Reserve `story_creation_requests` with kind `premium_clone`, request hash including template ID, and ID `ai:premium:${templateSlug}:${crypto.randomUUID()}`. Call clone RPC with authenticated `userId`. Query explicit chapter existence for copied Chapter 1; generate personalized Chapter 1 only when absent. Mark reservation ready.

- [ ] **Step 3: Implement route and run tests**

Route derives `userId` only from cookie auth. Return reader-safe ID/redirect/replayed envelope.

Run: `pnpm vitest run tests/api/premium-clone.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/api/premium-clone.server.ts app/api/stories/premium/[templateId]/clone/route.ts tests/api/premium-clone.test.ts
git commit -m "feat: expose idempotent premium story cloning"
```

## Phase 7 — Privacy, Ownership, Smoke, and Release Gate

### Task 25: Recursive Privacy and Story Isolation Tests

**Files:**
- Create: `tests/privacy/recursive-internal-field-scan.test.ts`
- Modify: `tests/runtime/personalized-generation.test.ts`
- Modify: `tests/api/personalized-choice.test.ts`

- [ ] **Step 1: Write recursive scanner and failing payload tests**

```ts
const INTERNAL_KEYS = new Set(['effect_json','effectJson','route_state','routeState','choice_history','choiceHistory','story_contract_json','storyContractJson','plot_debts_json','ending_candidates_json','ending_lock_json'])
function collectInternalPaths(value: unknown, path = '$'): string[]
```

Walk arrays/objects recursively. Run against explore/detail/chapter/choice/status/create/clone response fixtures. Include nested injected leak proving scanner fails.

- [ ] **Step 2: Add story isolation assertions**

Generate same chapter number for story A/B with different contracts and route state. Assert publish calls carry respective IDs and different content; no cache keyed only by chapter number; no premium template ID receives personalized publish.

- [ ] **Step 3: Run tests and fix response mappers only**

Run: `pnpm vitest run tests/privacy/recursive-internal-field-scan.test.ts tests/runtime/personalized-generation.test.ts tests/api/personalized-choice.test.ts`
Expected before fixes: injected leak test demonstrates RED; final run PASS with all real payloads clean.

- [ ] **Step 4: Commit**

```bash
git add tests/privacy/recursive-internal-field-scan.test.ts tests/runtime/personalized-generation.test.ts tests/api/personalized-choice.test.ts
git commit -m "test: prove personalized story privacy and isolation"
```

### Task 26: RLS Ownership Integration Tests

**Files:**
- Create: `tests/integration/story-ownership.test.ts`
- Modify: `supabase/tests/personalized_story_rls_test.sql`

- [ ] **Step 1: Write DB-backed integration matrix**

Using local Supabase anon/user A/user B/service role clients, verify A reads private parent/chapters/outcomes/contract/state; B and anon read none; everyone reads public premium template reader rows; server reads internal effect; explore excludes private; library includes A-owned private only.

- [ ] **Step 2: Run RED against missing local fixture bootstrap**

Run: `pnpm vitest run tests/integration/story-ownership.test.ts`
Expected: FAIL until test bootstrap creates auth users and applies migrations.

- [ ] **Step 3: Add deterministic setup/cleanup inside test**

Create users with admin test client, seed rows with service role, authenticate client sessions, run matrix, and delete fixtures in `afterAll`. No production bypass helper.

- [ ] **Step 4: Run ownership gates**

Run: `pnpm vitest run tests/integration/story-ownership.test.ts && pnpm exec supabase test db supabase/tests/personalized_story_rls_test.sql`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/story-ownership.test.ts supabase/tests/personalized_story_rls_test.sql
git commit -m "test: verify personalized story ownership under RLS"
```

### Task 27: Personalized Story Smoke Script and Package Command

**Files:**
- Create: `scripts/personalized-story-smoke.ts`
- Modify: `package.json`

- [ ] **Step 1: Write smoke script with failing assertions**

Use repository `assert`/filesystem convention. Checks: migration files, dynamic choice generation, no personalized use of `buildChoices`, route state in runtime, premium template never target of instance publish, premium instance source ID enforcement, Chapter 50 skip, old functions preserved, and internal response contracts clean.

Reader-facing wildcard scan targets `lib/api/queries.ts`, `lib/api/server.ts`, and reader route response builders. It parses/classifies exported reader query chains. Internal modules (`*.server.ts`, runtime, admin) may select internal columns and are not flagged. Explicitly fail `.select('*')` only in reader-facing paths; separately require internal selects to enumerate needed internal columns.

- [ ] **Step 2: Run script directly and verify RED**

Run: `node scripts/run-smoke.cjs scripts/personalized-story-smoke.ts`
Expected: FAIL before package command/final markers are present.

- [ ] **Step 3: Add package command in repository style**

```json
"smoke:personalized-story": "node scripts/run-smoke.cjs scripts/personalized-story-smoke.ts"
```

Append `pnpm run smoke:personalized-story` to aggregate `smoke` chain.

- [ ] **Step 4: Run smoke and commit**

Run: `pnpm smoke:personalized-story`
Expected: PASS with concise check count.

```bash
git add scripts/personalized-story-smoke.ts package.json
git commit -m "test: add personalized story smoke gate"
```

### Task 28: Full Gates and Release Evidence

**Files:**
- Create during execution: `docs/superpowers/reports/personalized-story-engine-release-evidence.md`

- [ ] **Step 1: Run formatting/static scans before full gates**

```bash
rg -n "select\(['\"]\*['\"]\)" lib/api app/api/stories packages/contracts/src/reader.ts
rg -n "effect_json|route_state|choice_history|story_contract_json|plot_debts_json|ending_candidates_json|ending_lock_json" packages/contracts/src/reader.ts components/reader-view.tsx
```

Expected: first command has no production wildcard reader selects and no plan placeholders; allowed internal references are reviewed by path. Second command has no matches.

- [ ] **Step 2: Run complete automated gate**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm exec supabase db reset
pnpm exec supabase test db
pnpm smoke:personalized-story
pnpm smoke
pnpm build
pnpm build:cloudflare
```

Expected: every command exits 0. Existing smoke is required because reader, runtime, gateway, auth, credits, and premium paths changed.

- [ ] **Step 3: Run authenticated end-to-end evidence flow**

Against local Supabase/Next production server: create users A/B; create personalized A with idempotency replay; read Chapter 1; choose; observe ready or poll until ready; verify Chapter 2 differs from separate B story; verify B/anon receive 404/403 for A resources; clone public premium template twice with same key and receive same instance; verify Chapter 50 fixture/API has no choices and completion CTA.

- [ ] **Step 4: Write release evidence report**

Report exact changed files, migration names, flow summary, command outputs, one generated choice branch, route state after choice, recursive proof no `effect_json` in response, A/B chapter isolation proof, RLS matrix, clone rollback proof, continuation path selected with evidence, and explicit statement that production exposure still requires M5 NTM sign-off under `AGENT_RULES.md`.

- [ ] **Step 5: Verify unrelated docs untouched**

```bash
git diff --name-only -- docs/ARCHITECTURE_v1.1.md docs/NARRATIVE_TRACEABILITY_MATRIX.md docs/PRD_Lakoku_Interactive_v0.3.md
```

Expected in implementation worktree: no output. Source checkout pre-existing modifications are not copied or overwritten.

- [ ] **Step 6: Commit evidence**

```bash
git add docs/superpowers/reports/personalized-story-engine-release-evidence.md
git commit -m "docs: record personalized story release evidence"
```

## Plan Self-Review

- **Spec coverage:** 28 tasks cover schema/RLS/query ownership; strict contracts and three complete 50-target fixtures; route state; plot debt and ending resolution; chapter brief/quality; dynamic choices; additive provider methods; introspection-derived v2 publish; resilient contract creation; canon bootstrap; personalized runtime/creation; atomic choice/idempotency; verified durable continuation; exact status; reader polling/final UI; transactional premium clone; recursive privacy/RLS/isolation; smoke and full release evidence.
- **Resolved assumptions:** Repository uses `pnpm vitest run`, `pnpm typecheck`, `node scripts/run-smoke.cjs`, Next.js 16.2.6, and Supabase CLI available through `pnpm exec`. `after()` presence is not treated as durability proof; Task 20 selects it only after OpenNext/Cloudflare proof, otherwise uses durable outbox/lease storage.
- **SQL certainty:** Legacy RPC body, lease columns, event payload spelling, outbox shape, and clone columns remain mandatory linked-introspection inputs. Plan gives stop conditions and mechanical derivation constraints instead of invented production SQL.
- **Type consistency:** `StoryContract`, `RouteState`, `ChoiceEffect`, `ChoiceBranch`, `ChapterBrief`, `PublishOutcomeV2`, and public readiness/status envelopes have one defining task and matching downstream signatures. `ChapterDraftSchema`, `generateNextChapterReal()`, `publishChapter()`, reader contract internals, and standard story flow stay unchanged.
- **Privacy:** Reader-safe projections and recursive payload scans coexist with legitimate explicit service-role internal selects. No internal state/effect/contract fields enter reader schemas or component props.
- **Phase order:** Database and ownership precede pure engine; choices/v2 publish precede creation/runtime; creation precedes choice continuation/status; clone follows working personalized runtime; privacy and release gates close implementation.
- **Placeholder scan:** No unresolved implementation marker or fake SQL body. Conditional migration in Task 20 has objective selection test and complete required storage semantics; introspection-dependent SQL has mandatory stop and exact derivation procedure.
