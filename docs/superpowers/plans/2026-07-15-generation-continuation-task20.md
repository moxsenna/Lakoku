# Generation Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue personalized next-chapter generation after choice with one shared durable job, 25s bounded wait, and optional `nextChapterReady`.

**Architecture:** Choice route keeps Task 19 apply-first path. Personalized non-ending outcomes start or reuse a process-local generation promise, register the same promise with Next `after()` backed by Cloudflare `ctx.waitUntil`, race it for 25s, and return readiness without cancelling work.

**Tech Stack:** Next.js 16, TypeScript 5.7, Vitest 4, OpenNext Cloudflare, Task 17 personalized runtime, Task 19 choice service.

---

### Task 1: Failing continuation tests

**Files:**
- Create: `tests/api/generation-continuation.test.ts`

- [ ] Write tests for ready-within-25s, timeout-without-cancel, shared duplicate job, lease-held in progress, terminal failure remains non-ready, standard path omits readiness, personalized privacy preserved.
- [ ] Run `pnpm vitest run tests/api/generation-continuation.test.ts`.
- [ ] Confirm RED.

### Task 2: Continuation service

**Files:**
- Create: `lib/api/generation-continuation.server.ts`
- Test: `tests/api/generation-continuation.test.ts`

- [ ] Export shared job helpers:
  ```ts
  export const CONTINUATION_WAIT_MS = 25_000
  export function continuationJobKey(storyId: string, chapterNumber: number): string
  export async function continuePersonalizedGeneration(input: {
    storyId: string
    userId: string
    chapterNumber: number
    triggerChoiceId?: string
  }): Promise<{ nextChapterReady: boolean }>
  ```
- [ ] Start or reuse process-local promise for key.
- [ ] Register same promise with `after(() => promise)`.
- [ ] Race same promise vs 25s timer.
- [ ] Map success/`CHAPTER_EXISTS` to ready true; timeout/`LEASE_HELD`/failure to false.
- [ ] Never cancel generation on timeout.
- [ ] Run focused tests until service GREEN.

### Task 3: Choice route integration

**Files:**
- Modify: `app/api/stories/[id]/choices/route.ts`
- Test: `tests/api/generation-continuation.test.ts`
- Regression: `tests/api/personalized-choice.test.ts`

- [ ] After successful personalized choice, if non-ending next chapter exists, call continuation service.
- [ ] Return `{ outcome, nextChapterReady }`.
- [ ] Keep standard path `{ outcome }` only.
- [ ] Preserve all Task 19 error mappings and privacy.
- [ ] Run:
  ```bash
  pnpm vitest run tests/api/generation-continuation.test.ts tests/api/personalized-choice.test.ts
  pnpm typecheck
  ```

### Task 4: Final review and commit

**Files:**
- Review exact Task 20 files.

- [ ] Confirm no outbox migration was added.
- [ ] Confirm deployment proof remains valid from OpenNext waitUntil wiring.
- [ ] Run focused lint and `git diff --check`.
- [ ] Spec and quality review.
- [ ] Commit:
  ```bash
  git add lib/api/generation-continuation.server.ts app/api/stories/[id]/choices/route.ts tests/api/generation-continuation.test.ts
  git commit -m "feat: continue personalized generation durably"
  ```
