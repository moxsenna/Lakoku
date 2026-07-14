# Atomic Personalized Choice Design

## Goal

Apply choices for owned `personalized_ai` and `premium_instance` stories through one ownership-first, service-role-only database transaction. Preserve existing standard/public choice behavior and return only reader-safe `ChoiceOutcome`.

## Scope

Task 19 changes only:

- `supabase/migrations/20260713030000_apply_personalized_choice.sql`
- `lib/api/personalized-choice.server.ts`
- `app/api/stories/[id]/choices/route.ts`
- `tests/api/personalized-choice.test.ts`
- `supabase/tests/personalized_story_rls_test.sql`

This spec file records approved design but is not part of Task 19 integration diff.

## Authorization and dispatch

Route validates request, normalizes story ID, and obtains cookie session. Authenticated requests call `applyPersonalizedChoice`. Service first calls reader-safe `queryStoryForUser`; no service-role client or outcome lookup occurs when parent is inaccessible. After that check, an explicit internal projection verifies exact owner, private visibility, and mode.

`personalized_ai` and `premium_instance` use atomic RPC. `standard`, public stories, and `premium_template` use existing choice path. Anonymous readers retain existing public behavior and cannot read or mutate private stories.

## Service data flow

Service validates `Idempotency-Key`, reads existing reader state, outcome, and stored chapter choice label through exact projections. Missing reader state fails closed. It parses route state and choice history, validates `effect_json` with `ChoiceEffectSchema`, merges with `mergeChoiceEffect`, builds strict summarized history, and creates reader-safe `jejak`.

Expected prior state is sent as `jsonb`. RPC locks row then compares PostgreSQL `jsonb` semantic equality. No JavaScript hash or serialized text comparison is used.

## Transaction and replay

Dedicated `personalized_choice_applications` ledger binds user, story, chapter, choice, and idempotency key. Ledger stores exact public outcome snapshot.

RPC order:

1. Validate scalar and JSON inputs.
2. Verify story owner, private visibility, and personalized instance mode.
3. Lock exact reader state; fail if absent.
4. Return same-key/same-request ledger replay.
5. Reject same-key/different-request collision.
6. Return same-chapter/same-choice semantic replay without duplicate state.
7. Reject same-chapter/different-choice conflict.
8. Compare locked prior state with expected `jsonb` state.
9. Validate history, `jejak`, and normalized route state against stored outcome and label.
10. Insert ledger row and update route state, summarized history, reader-safe `jejak`, progress, status, and ending fields in one transaction.
11. Return public outcome plus internal service metadata `replayed`; route emits only `{ outcome }`.

Any failure rolls back ledger and reader state together.

## Concurrency

Reader row uses `FOR UPDATE`. Same-key requests serialize with transaction advisory lock. Unique ledger constraints enforce one applied choice per user/story/chapter. A stale request fails with `STALE_READER_STATE`; same chapter with different choice fails with `CHOICE_CONFLICT`.

## Security

RPC uses `SECURITY DEFINER` and empty `search_path`; all relations and functions are schema-qualified. `PUBLIC`, `anon`, and `authenticated` lack ledger access and RPC execute permission. Only `service_role` receives required access.

Response recursively excludes internal fields including `effect_json`, `choice_kind`, `route_state`, `choice_history`, `locked_ending_key`, ownership/mode fields, expected state, and ledger data.

## Errors

- Invalid personalized idempotency key: HTTP 400.
- Inaccessible story or unknown authorized choice: HTTP 404.
- Missing reader state, key collision, chapter conflict, position conflict, or stale state: HTTP 409.
- Invalid stored state/effect or unexpected database error: sanitized HTTP 500.

Raw database messages and internal payloads never enter response.

## Verification

Required gates:

```bash
pnpm vitest run tests/api/personalized-choice.test.ts
pnpm exec supabase test db supabase/tests/personalized_story_rls_test.sql
pnpm typecheck
pnpm lint
git diff --check
```

Tests prove authorization order, non-disclosure, standard compatibility, valid atomic mutation, exact replay, no duplicate history, conflict handling, stale-state protection, rollback, privilege boundaries, and recursive response privacy.
