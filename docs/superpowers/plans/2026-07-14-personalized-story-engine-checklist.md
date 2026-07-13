# Personalized Story Engine — Execution Checklist

**Branch:** `feature/personalized-story-engine`  
**Worktree:** `D:\Coding\lakoku v2\.worktrees\personalized-story-engine`  
**Implementation plan:** [`2026-07-13-personalized-story-engine.md`](./2026-07-13-personalized-story-engine.md)  
**Design spec:** [`../specs/2026-07-12-personalized-story-engine-design.md`](../specs/2026-07-12-personalized-story-engine-design.md)

## Status Legend

- [x] Complete — implementation and required reviews passed
- [ ] Pending — not started or not yet accepted
- 🔄 In progress
- ⛔ Blocked

## Progress Summary

- **Complete:** 4 / 28 tasks
- **In progress:** Task 5 — strict story contract and complete fixtures
- **Pending:** Task 6–28
- **Current gate:** StoryContract schema and three validated 50-chapter fixtures

---

## Phase 1 — Database, RLS, and Ownership-Safe Reads

- [x] **Task 1: Linked schema and legacy RPC introspection gate**
  - Linked public schema dumped to ignored local artifacts.
  - Exact legacy `publish_chapter`, lease, event, policy, grant, and canon definitions inspected.
  - Existing `USING (true)` privacy leaks identified.
  - Introspection artifacts remain untracked.

- [x] **Task 2: Failing database schema and RLS tests**
  - pgTAP schema contract created.
  - Effective anon/User A/User B/service-role matrix created.
  - Explicit local DB marker required.
  - Expected RED established before migration.

- [x] **Task 3: Additive schema, defensive policies, and strong idempotency**
  - [x] Add personalized story columns.
  - [x] Create `story_generation_contracts`.
  - [x] Create `story_creation_requests`.
  - [x] Add indexes and constraints.
  - [x] Replace leaking permissive core-table policies.
  - [x] Add column-level reader-safe grants.
  - [x] Protect internal columns from direct PostgREST access.
  - [x] Add safe RLS helper predicates.
  - [x] Verify migration idempotency locally.
  - [x] Final integrated Task 3–4 review.

- [x] **Task 4: Reader-safe ownership queries**
  - [x] Replace reader-facing `.select('*')` calls.
  - [x] Add explicit story/chapter/outcome/reader-state projections.
  - [x] Add owned-library query.
  - [x] Add public Explore query.
  - [x] Add public-or-owner detail query.
  - [x] Authorize parent story before chapter access.
  - [x] Protect authoring/generation server actions with session and ownership checks.
  - [x] Add atomic authoring story-shell ownership claim.
  - [x] Add strict authoring input validation and fail-closed public errors.
  - [x] Make story shell + full canon replacement transactional.
  - [x] Deep-validate canon payload and story-local references.
  - [x] Add real concurrent ownership/canon race tests.
  - [x] Harden PostgreSQL race-session cleanup.
  - [x] Complete real PostgREST reader-state CRUD test.
  - [x] Complete anon/User B reader-state mutation-denial test.
  - [x] Complete hidden-column REST denial test.
  - [x] Run final integrated Task 3–4 review.

### Phase 1 Exit Gate

- [ ] Public Explore works after migration.
- [ ] Owner Library reads private stories.
- [ ] Other users and anon cannot read private stories or chapters.
- [ ] Internal columns cannot be requested through PostgREST.
- [ ] Service-role server flows retain required access.
- [ ] Rolling deployment sequence remains compatible.
- [ ] `pnpm release:personalized` passes.

---

## Phase 2 — Pure Story Engine

- [ ] **Task 5: Strict Story Contract and three complete fixtures**
  - [ ] Implement strict `StoryContractSchema`.
  - [ ] Validate exactly 50 sequential chapter targets.
  - [ ] Validate ending candidates, plot debts, reveal runway, and closure runway.
  - [ ] Create mystery/drama fixture.
  - [ ] Create romance/drama fixture.
  - [ ] Create fantasy/adventure fixture.

- [ ] **Task 6: Route-state engine**
  - [ ] Implement `RouteStateSchema`.
  - [ ] Normalize and clamp scores.
  - [ ] Merge choice effects immutably.
  - [ ] Deduplicate evidence.
  - [ ] Produce deterministic prompt summary.

- [ ] **Task 7: Plot-debt auditor and ending resolver**
  - [ ] Enforce chapter 36/41/45/48/50 boundaries.
  - [ ] Lock ending deterministically at Chapter 45.
  - [ ] Preserve locked ending through Chapter 50.
  - [ ] Add boundary and tie-breaking tests.

- [ ] **Task 8: Chapter brief and deterministic quality gates**
  - [ ] Build chapter brief from contract, canon, route state, and prior choice.
  - [ ] Enforce conflict/thread/ending runway rules.
  - [ ] Add prose quality checks.
  - [ ] Add choice-label quality checks.
  - [ ] Export pure story-engine barrel.

### Phase 2 Exit Gate

- [ ] All pure story-engine tests pass.
- [ ] No DB/provider/server-only imports in pure engine.
- [ ] All fixtures validate as complete 50-chapter contracts.
- [ ] `pnpm typecheck` passes.

---

## Phase 3 — Dynamic Choices and Atomic Publish V2

- [ ] **Task 9: Choice schemas and chapter-aware validation**
  - [ ] Add `ChoiceEffectSchema`.
  - [ ] Add `ChoiceBranchSchema`.
  - [ ] Match exact choice/outcome ID sets.
  - [ ] Reject generic/internal labels.
  - [ ] Enforce next-chapter and ending-window rules.
  - [ ] Reject choice generation for Chapter 50.

- [ ] **Task 10: Optional choice-provider gateway**
  - [ ] Add optional `generateChoices` provider method.
  - [ ] Preserve existing providers.
  - [ ] Route through existing model configuration/logging/cost path.
  - [ ] Validate raw output before runtime use.

- [ ] **Task 11: TypeScript `publishChapterV2` boundary**
  - [ ] Add V2 input/outcome types.
  - [ ] Map `effect_json` and `choice_kind` explicitly.
  - [ ] Support Chapter 50 null/empty choices and outcomes.
  - [ ] Preserve old `publishChapter()` unchanged.

- [ ] **Task 12: Atomic `publish_chapter_v2` RPC**
  - [ ] Mechanically derive from exact legacy RPC dump.
  - [ ] Preserve idempotency, event, lease, and conflict semantics.
  - [ ] Add effect persistence atomically.
  - [ ] Support Chapter 50 without choices.
  - [ ] Restrict execution to service role.
  - [ ] Prove rollback and idempotency with pgTAP.

- [ ] **Task 13: Phase 1–3 integration gate**
  - [ ] Run focused pure-engine/runtime tests.
  - [ ] Run all unit tests.
  - [ ] Run typecheck.
  - [ ] Run fresh local DB tests.
  - [ ] Verify no reader wildcard/internal-field leaks.
  - [ ] Verify old standard generation remains unchanged.

---

## Phase 4 — Contract Generation, Bootstrap, Runtime, and Creation

- [ ] **Task 14: Story-contract provider gateway**
  - [ ] Add optional raw contract-generation provider method.
  - [ ] Reuse existing model routing/logging/cost path.
  - [ ] Preserve legacy provider compatibility.

- [ ] **Task 15: Resilient contract generation**
  - [ ] Enforce maximum 30-second generation timeout.
  - [ ] Permit exactly one repair attempt.
  - [ ] Fall back to validated fixture.
  - [ ] Record `contract_source`.
  - [ ] Never fail story creation due only to provider failure.

- [ ] **Task 16: Contract persistence and canon bootstrap**
  - [ ] Persist contract fields in approved columns.
  - [ ] Create all required canon rows transactionally.
  - [ ] Create exactly 50 chapter blueprints.
  - [ ] Generate no chapter during bootstrap.

- [ ] **Task 17: Personalized chapter runtime**
  - [ ] Load contract and internal reader state.
  - [ ] Build chapter brief.
  - [ ] Reuse existing plan/write/Layer A/Layer B/repair flow.
  - [ ] Generate dynamic choices for Chapters 1–49.
  - [ ] Skip choices for Chapter 50.
  - [ ] Mark reader complete only after Chapter 50 publish succeeds.

- [ ] **Task 18: Authenticated idempotent personalized creation endpoint**
  - [ ] Require authenticated user.
  - [ ] Require strong `Idempotency-Key`.
  - [ ] Load taste profile.
  - [ ] Create private owned story shell.
  - [ ] Generate/fallback contract.
  - [ ] Bootstrap canon before generation.
  - [ ] Generate Chapter 1 only.
  - [ ] Return reader-safe story ID and redirect.

---

## Phase 5 — Choice Effects, Continuation, Status, and Reader Polling

- [ ] **Task 19: Atomic personalized choice service**
  - [ ] Authorize owner before internal outcome lookup.
  - [ ] Merge route effect safely.
  - [ ] Append summarized `choice_history`.
  - [ ] Preserve reader-safe `jejak`.
  - [ ] Make replay idempotent.
  - [ ] Reject conflicting second choice.

- [ ] **Task 20: Durable generation continuation**
  - [ ] Verify runtime durability support.
  - [ ] Use proven `after()` continuation or durable outbox.
  - [ ] Avoid duplicate generation promises.
  - [ ] Return optional `nextChapterReady`.

- [ ] **Task 21: Exact per-chapter status endpoint**
  - [ ] Check chapter existence first.
  - [ ] Check exact active lease.
  - [ ] Check latest exact failed attempt.
  - [ ] Do not use story-level status as chapter truth.
  - [ ] Authorize private story access.

- [ ] **Task 22: Reader polling and final chapter UI**
  - [ ] Poll pending personalized chapter status.
  - [ ] Navigate when ready.
  - [ ] Show reader-safe failure state.
  - [ ] Stop polling on unmount.
  - [ ] Show no choice buttons on Chapter 50.
  - [ ] Show Library/New Story CTAs.

---

## Phase 6 — Premium Template Clone

- [ ] **Task 23: Transactional premium clone RPC**
  - [ ] Require public `premium_template` source.
  - [ ] Reject private/non-template source.
  - [ ] Clone shell, contract, canon, blueprints, state, and optional Chapter 1.
  - [ ] Remap globally unique IDs and FKs safely.
  - [ ] Roll back all rows on any error.
  - [ ] Restrict execution to service role.

- [ ] **Task 24: Authenticated premium clone endpoint**
  - [ ] Derive user ID only from auth session.
  - [ ] Add strong idempotency.
  - [ ] Pass trusted user ID to clone RPC.
  - [ ] Reuse curated Chapter 1 or generate Chapter 1 only.
  - [ ] Return reader-safe response.

---

## Phase 7 — Privacy, Ownership, Smoke, and Release

- [ ] **Task 25: Recursive privacy and story-isolation tests**
  - [ ] Recursively scan all reader responses for internal fields.
  - [ ] Prove Story A/B chapter isolation.
  - [ ] Prove premium template never receives personalized writes.

- [ ] **Task 26: RLS ownership integration tests**
  - [ ] Verify anon/User B/private-owner matrix through real clients.
  - [ ] Verify parent/child/contract/state privacy.
  - [ ] Verify service role can read required internals.
  - [ ] Verify Explore and Library behavior.

- [ ] **Task 27: Personalized story smoke gate**
  - [ ] Add `scripts/personalized-story-smoke.ts`.
  - [ ] Scan reader-facing wildcard selects.
  - [ ] Scan internal response fields.
  - [ ] Verify Chapter 50 choice skip.
  - [ ] Verify old generation/publish paths preserved.
  - [ ] Add `smoke:personalized-story` package command.

- [ ] **Task 28: Full gates and release evidence**
  - [ ] `pnpm typecheck`
  - [ ] `pnpm lint`
  - [ ] `pnpm test:unit`
  - [ ] Local Supabase reset/migration tests
  - [ ] `pnpm smoke:personalized-story`
  - [ ] Existing smoke suite
  - [ ] Next.js build
  - [ ] Cloudflare/OpenNext build
  - [ ] Authenticated local end-to-end flow
  - [ ] Write release evidence report
  - [ ] Verify unrelated docs remain untouched

---

## Explicit Non-Goals and Safety Checks

- [ ] No full branching tree.
- [ ] No `chapter_variants` table.
- [ ] No choices added to `ChapterDraftSchema`.
- [ ] No removal of Layer A/B validation.
- [ ] No personalized chapters written to premium template IDs.
- [ ] No internal fields in reader responses.
- [ ] No direct client AI calls.
- [ ] No production migration/deployment without explicit approval.
- [ ] No push/merge without explicit approval.
