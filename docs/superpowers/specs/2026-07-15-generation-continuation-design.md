# Generation Continuation Design

## Goal

After a successful personalized choice, continue next-chapter generation durably with one shared job, a 25s bounded wait, and optional reader-safe readiness signal.

## Deployment proof

OpenNext Cloudflare production worker binds Next `after()` work to platform `ctx.waitUntil`:

- Cloudflare wrapper passes `waitUntil: ctx.waitUntil.bind(ctx)`.
- OpenNext request context exposes that function to Next after provider.
- Detached promises are registered on the same waitUntil path.

Path selected: proven `after()` continuation. No durable outbox migration in Task 20.

## Scope

Create:

- `lib/api/generation-continuation.server.ts`
- `tests/api/generation-continuation.test.ts`

Modify:

- `app/api/stories/[id]/choices/route.ts`

Do not create:

- `supabase/migrations/20260713040000_personalized_generation_outbox.sql`

## Flow

1. Existing route auth, validation, and Task 19 personalized choice application remain first.
2. On successful personalized non-ending choice with a next chapter, start or reuse one shared generation promise for `(storyId, nextChapterNumber)`.
3. Register the same promise with `after(() => promise)`.
4. Race the same promise against a 25s timer.
5. Return `{ outcome, nextChapterReady }`.
6. Standard/public/template path remains `{ outcome }` only.

## Shared job semantics

Process-local map keyed by `storyId:chapterNumber`.

- Duplicate requests reuse the in-flight promise.
- Timeout never cancels generation.
- No second generation launch after timeout.
- Generation uses Task 17 runtime:
  ```ts
  generateNextPersonalizedChapter({
    storyId,
    userId,
    chapterNumber: nextChapterNumber,
    triggerChoiceId: choiceId,
  })
  ```
- Story-level lease remains concurrency control. `LEASE_HELD` is treated as in progress.

## Readiness mapping

| Result | nextChapterReady |
|---|---|
| Published / chapter exists | true |
| Timeout | false |
| Lease held | false |
| Terminal generation failure | false |

Failure remains queryable through existing runtime/lease/event paths used by later Task 21 work. Response never includes lease IDs, route state, effect JSON, history, owner, or mode.

## Compatibility

- Old clients that only read `outcome` keep working.
- Personalized path may add optional `nextChapterReady`.
- Standard path omits the field.

## Verification

```bash
pnpm vitest run tests/api/generation-continuation.test.ts tests/api/personalized-choice.test.ts
pnpm typecheck
```

Deployment proof already captured by `pnpm build:cloudflare` and inspection of `.open-next/server-functions/default/index.mjs` waitUntil wiring.
