# M10-C — C-R3 partial progress report (Entry 8)

**Date:** 2026-08-08  
**Branch:** `feature/m10-c-recovery`  
**Remote head:** `37a5d2d` (pushed)  
**Predecessor:** Entry 7, C-R2 report, double-run BLOCKED

Per reviewer ledger Entry 8 ("GO C-R3, scope narrow"), C-R3 implements two items:

1. **Structured ending model for NCS §1.4 provability** — schema has `kind`, `isSecret`, `blockingConditions`.
2. **Production reconciliation enforcement** — durable `needs_review` gate blocks next-chapter admission on FAILED_REVIEW_REQUIRED.

Item #3 from Entry 8 — "dedicated deterministic drift fixture producing RECONCILED via real post-publication path" — is **PENDING**. This document reports what is DONE, not completed.

---

## Item 1: structured ending model (DONE)

**File:** `lib/story-engine/story-contract.ts`  
**Changes:**

```ts
export const EndingCandidateSchema = z.object({
  key: boundedString(80),
  name: boundedString(160),
  kind: z.enum(['main', 'secret']).default('main'),
  isSecret: z.boolean().default(false),
  condition: boundedString(500), // prose legacy field retained
  requiredClosure: boundedStringArray(8, 400, 1),
  blockingConditions: z.array(z.string()).min(0).max(20).default([]),
}).strict()
```

- `styleProfile` bumped `'lakoku_mobile_drama_v1' → 'lakoku_mobile_drama_v2'`.
- Migration validation in `supabase/migrations/20260728010000_plot_debt_closure_ledger.sql` updated to accept new keys.
- Fixtures (`fixtures/contracts/*.ts`, `long-horizon/story-bible-pressure.ts`) updated with explicit fields; test contracts extended similarly.
- Producer/consumer map unchanged except honest mapping update.

**Typecheck/lint:** clean. Unit tests passing (one pre-existing timeout unrelated).

---

## Item 2: honest runtime mapping (DONE)

**File:** `lib/runtime/post-publication-lifecycle.server.ts`  
**Change:** `deriveActBoundaryReconciliationInput` now maps candidates honestly:

```ts
const endings: EndingDef[] = contract.endingCandidates.map((candidate) => ({
  id: candidate.key,
  isMain: candidate.kind === 'main' || !candidate.isSecret,
  isSecret: candidate.kind === 'secret' || candidate.isSecret,
  blockedByFlags: candidate.blockingConditions ?? [],
}))
```

Now `EndingDef` can express secrets and blocking flags; `checkEndingReachability` will fire `SECRET_ENDING_UNREACHABLE` / `ENDING_UNREACHABLE` when conditions are present.

---

## Item 3: durable FAILED_REVIEW_REQUIRED gate (DONE)

### Writer (post-publication lifecycle hook)

**File:** `lib/runtime/post-publication-lifecycle.server.ts`  
**Change:** On `FAILED_REVIEW_REQUIRED`, persist `generation_status='needs_review'`:

```ts
if (result.status === 'FAILED_REVIEW_REQUIRED') {
  const { error } = await admin
    .from('stories').update({ generation_status: 'needs_review' })
    .eq('story_id', storyId)
  if (error) throw new Error(...)
  await insertStoryEvent(admin, storyId, 'ACT_RECONCILIATION_FAILED_REVIEW_REQUIRED', {...})
}
```

Column `generation_status` already exists with CHECK constraint allowing `'needs_review'`. No new migration needed.

### Reader (next-chapter admission)

**File:** `lib/runtime/personalized-generation.ts`  
**Change:** Fail closed at earliest point before lease acquire:

```ts
const { data: storyRow, error } = await admin
  .from('stories').select('generation_status').eq('story_id', storyId).single()
if (storyRow?.generation_status === 'needs_review') {
  await releaseOwnLease()
  return { ok: false, reason: 'FAILED_REVIEW_REQUIRED', detail: ... }
}
```

The check runs in `generateNextPersonalizedChapterInner` after canon/blueprint load but before any generation work. If status is set, generation of the *next* chapter is refused until review resolves it. The committed chapter remains published; future chapters wait.

---

## Item 4: RECONCILED proof fixture (PENDING)

Entry 8 requires a dedicated deterministic drift fixture that exercises the real post‑publication path and verifies `version++` + `reconciled_from_version` persisted via blueprint inserts when `runReconciliation()` returns `RECONCILED`.

Current state:

- Production side-effect code already persists new versions (existing line 427–440 in post-publication-lifecycle.server.ts).
- No explicit drift fixture exists yet in the C-R3 branch.
- This item must be implemented separately: add a fixture script using the new ending model + a negative spine-violation case to produce `FAILED_REVIEW_REQUIRED` and verify the gate fires.

**Status:** Not started. Requires additional design/implementation cycles beyond Entry 8’s current narrow window.

---

## Verification

```bash
pnpm typecheck     # ✓ clean
pnpm lint          # 0 errors, 11 warnings (pre-existing)
pnpm test:unit     # 1992 passed / 22 skipped (1 unrelated timeout)
```

---

## Next steps per Entry 8

- Implement the drift fixture proving RECONCILED via real production path.
- Add negative spine-failure test verifying the gate rejects next chapter.
- Rerun full unit test suite; then counted double run if runtime/schema affects normalized evidence.
- Write C-R3 final report; append ledger Entry 9; push; STOP for verdict.

---

**Note:** This report reflects the partial state only (items 1–3 DONE, item 4 PENDING). Gate-2 migration history remains answered per Entry 8a (production ledger read executed, bb3287a approved as forward-only).
