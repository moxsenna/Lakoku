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

- **Complete:** 27 / 28 tasks
- **In progress:** Task 28 — Full gates and release evidence
- **Pending:** authenticated browser E2E only
- **Next:** Browser cookie-session E2E matrix; keep production exposure blocked until NTM/M9 authorization

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

- [x] **Task 5: Strict Story Contract and three complete fixtures**
  - [ ] Implement strict `StoryContractSchema`.
  - [ ] Validate exactly 50 sequential chapter targets.
  - [ ] Validate ending candidates, plot debts, reveal runway, and closure runway.
  - [ ] Create mystery/drama fixture.
  - [ ] Create romance/drama fixture.
  - [ ] Create fantasy/adventure fixture.

- [x] **Task 6: Route-state engine**
  - [ ] Implement `RouteStateSchema`.
  - [ ] Normalize and clamp scores.
  - [ ] Merge choice effects immutably.
  - [ ] Deduplicate evidence.
  - [ ] Produce deterministic prompt summary.

- [x] **Task 7: Plot-debt auditor and ending resolver**
  - [ ] Enforce chapter 36/41/45/48/50 boundaries.
  - [ ] Lock ending deterministically at Chapter 45.
  - [ ] Preserve locked ending through Chapter 50.
  - [ ] Add boundary and tie-breaking tests.

- [x] **Task 8: Chapter brief and deterministic quality gates**
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

- [x] **Task 9: Choice schemas and chapter-aware validation**
  - [ ] Add `ChoiceEffectSchema`.
  - [ ] Add `ChoiceBranchSchema`.
  - [ ] Match exact choice/outcome ID sets.
  - [ ] Reject generic/internal labels.
  - [ ] Enforce next-chapter and ending-window rules.
  - [ ] Reject choice generation for Chapter 50.

- [x] **Task 10: Optional choice-provider gateway**
  - [ ] Add optional `generateChoices` provider method.
  - [ ] Preserve existing providers.
  - [ ] Route through existing model configuration/logging/cost path.
  - [ ] Validate raw output before runtime use.

- [x] **Task 11: TypeScript `publishChapterV2` boundary**
  - [ ] Add V2 input/outcome types.
  - [ ] Map `effect_json` and `choice_kind` explicitly.
  - [ ] Support Chapter 50 null/empty choices and outcomes.
  - [ ] Preserve old `publishChapter()` unchanged.

- [x] **Task 12: Atomic `publish_chapter_v2` RPC**
  - [ ] Mechanically derive from exact legacy RPC dump.
  - [ ] Preserve idempotency, event, lease, and conflict semantics.
  - [ ] Add effect persistence atomically.
  - [ ] Support Chapter 50 without choices.
  - [ ] Restrict execution to service role.
  - [ ] Prove rollback and idempotency with pgTAP.

- [x] **Task 13: Phase 1–3 integration gate**
  - [x] Run focused pure-engine/runtime tests.
  - [x] Run all unit tests.
  - [x] Run typecheck.
  - [x] Run fresh local DB tests.
  - [x] Verify no reader wildcard/internal-field leaks.
  - [x] Verify old standard generation remains unchanged.

---

## Phase 4 — Contract Generation, Bootstrap, Runtime, and Creation

- [x] **Task 14: Story-contract provider gateway**
  - [x] Add optional raw contract-generation provider method.
  - [x] Reuse existing model routing/logging/cost path.
  - [x] Preserve legacy provider compatibility.

- [x] **Task 15: Resilient contract generation**
  - [x] Enforce maximum 30-second generation timeout.
  - [x] Permit exactly one repair attempt.
  - [x] Fall back to validated fixture.
  - [x] Record `contract_source`.
  - [x] Never fail story creation due only to provider failure.

- [x] **Task 16: Contract persistence and canon bootstrap**
  - [x] Persist contract fields in approved columns.
  - [x] Create all required canon rows transactionally.
  - [x] Create exactly 50 chapter blueprints.
  - [x] Generate no chapter during bootstrap.

- [x] **Task 17: Personalized chapter runtime**
  - [x] Load contract and internal reader state.
  - [x] Build chapter brief.
  - [x] Reuse existing plan/write/Layer A/Layer B/repair flow.
  - [x] Generate dynamic choices for Chapters 1–49.
  - [x] Skip choices for Chapter 50.
  - [x] Mark reader complete only after Chapter 50 publish succeeds.

- [x] **Task 18: Authenticated idempotent personalized creation endpoint**
  - [x] Require authenticated user.
  - [x] Require strong `Idempotency-Key`.
  - [x] Load taste profile.
  - [x] Create private owned story shell.
  - [x] Generate/fallback contract.
  - [x] Bootstrap canon before generation.
  - [x] Generate Chapter 1 only.
  - [x] Return reader-safe story ID and redirect.

---

## Phase 5 — Choice Effects, Continuation, Status, and Reader Polling

- [x] **Task 19: Atomic personalized choice service**
  - [x] Authorize owner before internal outcome lookup.
  - [x] Merge route effect safely.
  - [x] Append summarized `choice_history`.
  - [x] Preserve reader-safe `jejak`.
  - [x] Make replay idempotent.
  - [x] Reject conflicting second choice.

- [x] **Task 20: Durable generation continuation**
  - [x] Verify runtime durability support.
  - [x] Use proven `after()` continuation or durable outbox.
  - [x] Avoid duplicate generation promises.
  - [x] Return optional `nextChapterReady`.

- [x] **Task 21: Exact per-chapter status endpoint**
  - [x] Check chapter existence first.
  - [x] Check exact active lease.
  - [x] Check latest exact failed attempt.
  - [x] Do not use story-level status as chapter truth.
  - [x] Authorize private story access.

- [x] **Task 22: Reader polling and final chapter UI**
  - [x] Poll pending personalized chapter status.
  - [x] Navigate when ready.
  - [x] Show reader-safe failure state.
  - [x] Stop polling on unmount.
  - [x] Show no choice buttons on Chapter 50.
  - [x] Show Library/New Story CTAs.

---

## Phase 6 — Premium Template Clone

- [x] **Task 23: Transactional premium clone RPC**
  - [x] Require public `premium_template` source.
  - [x] Reject private/non-template source.
  - [x] Clone shell, contract, canon, blueprints, state, and optional Chapter 1.
  - [x] Remap globally unique IDs and FKs safely.
  - [x] Roll back all rows on any error.
  - [x] Restrict execution to service role.

- [x] **Task 24: Authenticated premium clone endpoint**
  - [x] Derive user ID only from auth session.
  - [x] Add strong idempotency.
  - [x] Pass trusted user ID to clone RPC.
  - [x] Reuse curated Chapter 1 or generate Chapter 1 only.
  - [x] Return reader-safe response.

---

## Phase 7 — Privacy, Ownership, Smoke, and Release

- [x] **Task 25: Recursive privacy and story-isolation tests**
  - [x] Recursively scan all reader responses for internal fields.
  - [x] Prove Story A/B chapter isolation.
  - [x] Prove premium template never receives personalized writes.

- [x] **Task 26: RLS ownership integration tests**
  - [x] Verify anon/User B/private-owner matrix through real clients.
  - [x] Verify parent/child/contract/state privacy.
  - [x] Verify service role can read required internals.
  - [x] Verify Explore and Library behavior.

- [x] **Task 27: Personalized story smoke gate**
  - [x] Add `scripts/personalized-story-smoke.ts`.
  - [x] Scan reader-facing wildcard selects.
  - [x] Scan internal response fields.
  - [x] Verify Chapter 50 choice skip.
  - [x] Verify old generation/publish paths preserved.
  - [x] Add `smoke:personalized-story` package command.

- [ ] **Task 28: Full gates and release evidence**
  - [x] `pnpm typecheck`
  - [x] `pnpm lint`
  - [x] `pnpm test:unit`
  - [x] Local Supabase reset/migration tests
  - [x] `pnpm smoke:personalized-story`
  - [x] Existing smoke suite
  - [x] Next.js build
  - [x] Cloudflare/OpenNext build
  - [ ] Authenticated local end-to-end flow
  - [x] Write release evidence report
  - [x] Verify unrelated docs remain untouched

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
