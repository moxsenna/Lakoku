# Atomic Personalized Choice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply owned personalized story choices atomically with replay-safe public outcomes, stale-state protection, and no internal-field disclosure.

**Architecture:** Route preserves standard/public behavior while authenticated owned personalized instances use a server-only service. Service performs parent-first authorization, validates internal state/effect, then calls a service-role-only RPC which locks reader state, compares expected `jsonb`, writes a dedicated replay ledger, and mutates route/history/jejak/progress in one transaction.

**Tech Stack:** Next.js 16, TypeScript 5.7, Zod 4, Supabase JS, PostgreSQL PL/pgSQL/RLS, pgTAP, Vitest 4, pnpm 11.

---

### Task 1: Failing service and route tests

**Files:**
- Create: `tests/api/personalized-choice.test.ts`
- Test: `app/api/stories/[id]/choices/route.ts`
- Test: `lib/api/personalized-choice.server.ts`

- [ ] Write tests proving inaccessible parent prevents admin lookup; standard stories retain old path; missing state fails closed; valid effect is normalized and summarized; RPC gets expected prior state; replay remains public-only; typed conflicts map to 409; recursive response has no internal fields.
- [ ] Run `pnpm vitest run tests/api/personalized-choice.test.ts`.
- [ ] Confirm RED because service module/dispatch do not exist.

### Task 2: Failing database tests

**Files:**
- Modify: `supabase/tests/personalized_story_rls_test.sql`

- [ ] Add deterministic owned personalized fixtures with canonical reader state, stored choice labels, and valid effect payloads.
- [ ] Add pgTAP assertions for exact RPC signature/security/ACL, ledger isolation, atomic route/history/jejak/progress mutation, stored public replay snapshot, exact replay, key collision, chapter conflict, stale-state rejection, and rollback.
- [ ] Run `pnpm exec supabase test db supabase/tests/personalized_story_rls_test.sql`.
- [ ] Confirm RED because ledger/RPC do not exist.

### Task 3: Atomic database RPC

**Files:**
- Create: `supabase/migrations/20260713030000_apply_personalized_choice.sql`
- Test: `supabase/tests/personalized_story_rls_test.sql`

- [ ] Create dedicated `personalized_choice_applications` table keyed by user/idempotency and unique by user/story/chapter; store public outcome snapshot.
- [ ] Create `public.apply_personalized_choice(uuid,text,integer,text,text,jsonb,jsonb,jsonb,jsonb)` as `VOLATILE SECURITY DEFINER SET search_path = ''`.
- [ ] Validate input; verify private exact owner and mode; lock reader state; fail closed if absent; handle key/chapter replay and collision; compare expected state using `jsonb IS DISTINCT FROM`; validate public summary payloads against stored outcome/label; insert ledger and update reader state atomically.
- [ ] Revoke table/function access from `PUBLIC`, `anon`, and `authenticated`; grant required table/function access only to `service_role`.
- [ ] Reset local database and run focused pgTAP until GREEN.

### Task 4: Ownership-first server service

**Files:**
- Create: `lib/api/personalized-choice.server.ts`
- Test: `tests/api/personalized-choice.test.ts`

- [ ] Export `PersonalizedChoiceError` and `applyPersonalizedChoice({userId,storyId,chapterNumber,choiceId,idempotencyKey})`.
- [ ] Call `queryStoryForUser` before creating admin client. Then verify exact owner/private/mode with explicit projection.
- [ ] Read and strictly parse internal reader state, published outcome, and stored choice label using explicit projections.
- [ ] Parse `effect_json` with `ChoiceEffectSchema`, merge via `mergeChoiceEffect`, build strict `ChoiceHistoryEntrySchema` summary and reader-safe `JejakItemSchema` entry.
- [ ] Call RPC with expected prior `jsonb`, parse strict public result, map stable SQL messages to typed service errors.
- [ ] Run focused Vitest until service tests GREEN.

### Task 5: Route dispatch

**Files:**
- Modify: `app/api/stories/[id]/choices/route.ts`
- Test: `tests/api/personalized-choice.test.ts`

- [ ] Normalize story ID and authenticate cookie session.
- [ ] For authenticated requests, try personalized service; only `NOT_PERSONALIZED_STORY` falls through to old standard path.
- [ ] Require `Idempotency-Key` only after owned personalized mode is established.
- [ ] Map typed validation/not-found/conflict errors to sanitized 400/404/409; unexpected errors stay sanitized 500.
- [ ] Return only `{ outcome }`; keep guest and standard flow behavior unchanged.
- [ ] Run focused Vitest and typecheck until GREEN.

### Task 6: Final gates and review

**Files:**
- Review exact five Task 19 production/test files.

- [ ] Run `pnpm vitest run tests/api/personalized-choice.test.ts tests/api/owned-queries.test.ts tests/story-engine/route-state.test.ts tests/story-engine/choice-branch.test.ts`.
- [ ] Run `pnpm exec supabase test db supabase/tests/personalized_story_rls_test.sql`.
- [ ] Run `pnpm typecheck` and `pnpm lint`.
- [ ] Run `git diff --check`.
- [ ] Verify no wildcard internal select, no internal response fields, no Task 14/23 file conflicts, and no unrequested commit/push.
- [ ] Dispatch spec compliance review, then code quality review; fix all confirmed issues and rerun gates.
