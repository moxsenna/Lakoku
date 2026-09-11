# C-R1 Decision #3 — Emotional-Resolution Beats Stay in C (B 1.1.0 Semantics)

> **STATUS: SUPERSEDED + VETOED (reviewer Entry 6, 2026-08-08 — BLOCKER 1).**
> The decision below was implemented in C-R1 and then VETOED: making
> `emotionalResolutionBeatIds` non-empty merely because `reader_states.locked_ending_key`
> exists is evaluator-input fabrication — the "caller supplies the conclusion so the
> evaluator passes" pattern. Naming (`deterministic-ending-evidence:`) did not change the
> semantics. The governing decision is now
> **`M10_C_R2_DECISION_B37_REBASELINE.md`** (ending-runway 1.2.0 → 1.3.0; the Bab-49 beat
> check is WITHDRAWN from the deterministic suite and emotional-resolution CONTENT moves
> to the M10-D semantic judge). This document is retained as historical record only.

**Date:** 2026-08-08
**Authority:** Reviewer verdict 2026-08-08, M10_GOVERNANCE_LEDGER.md Entry 2, ruling #3.
**Status:** IMPLEMENTED in C-R1, then VETOED by Entry 6; superseded by the C-R2 rebaseline.

## Reviewer ruling (verbatim intent)

Ratification #3 was **REJECTED AS-IS**: B 1.1.0 already made emotional-resolution beats
deterministic ending evidence; moving the concern to M10-D would require an explicit B
contract rebaseline/version bump + fixture update + reviewer approval. The recovery
constraints forbid unilateral rebaselining, so the fix stays in M10-C under the existing
B 1.1.0 contract.

## Decision

Under B 1.1.0 semantics, the Bab-49 emotional-resolution beat **is deterministic ending
evidence**. The capture adapter therefore derives Bab 49's `emotionalResolutionBeatIds`
from the committed deterministic ending evidence — never from invented prose beats.

### What "deterministic ending evidence" is in this runtime

The only committed, deterministic, ending-scoped artifact that exists by Bab 49 is the
**ending lock**:

- written atomically at Bab 45 inside the publication transaction
  (`persist_ending_lock_v1` called by both V3 sync and V5 worker publishers in
  `20260805015000_living_canon_publication_primitives.sql`),
- stored in `story_generation_contracts.ending_lock_json` (`{key, name, lockedAtChapter}`),
- mirrored to `reader_states.locked_ending_key` by the same publication commit.

Prose beats are real-model artifacts and do not exist on the deterministic C path;
deriving beat ids from prose would violate the no-fabrication rule. The ending lock is
exactly the deterministic evidence B 1.1.0 points at.

### Capture derivation (implemented)

`lib/narrative-qa/harness/capture.ts :: captureEndingRunway`:

```ts
emotionalResolutionBeatIds =
  chapterNumber === EMOTIONAL_RESOLUTION_CHAPTER && finalEndingKey !== null
    ? [`deterministic-ending-evidence:${finalEndingKey}`]
    : []
```

The beat id **encodes its derivation source verbatim** (`deterministic-ending-evidence:`
prefix + the committed locked ending key), so every artifact that carries the id is
self-describing and auditable: an auditor can see it came from the reader's committed
lock, not from synthesis.

### Evaluator impact

None. The ending-runway evaluator (1.1.0 beat rule, `ending-evaluator.ts` lines ~169–186)
requires only that Bab 49's `emotionalResolutionBeatIds` be non-empty; no evaluator logic
changed for this finding. `CHAPTER_49_EMOTIONAL_RESOLUTION_MISSING` clears because the
capture now reads an honest runtime source, not because the rule was loosened. The only
evaluator change in C-R1 is #4's contract adapter (1.1.0 → 1.2.0, durability evidence),
which is separate from the beat rule.

### Parity note

`finalEndingKey` comes from `reader_states.locked_ending_key`, which is canonical state
committed identically in both clones (the deterministic provider resolves the same ending
from the same contract). The beat id is therefore identical across sync/worker and safe in
the parity surface.

## Veto fallback (if the reviewer rejects this interpretation)

If the reviewer rules that Bab 49 requires distinct beat semantics rather than ending-lock
evidence, the honest path is the rebaseline the ruling itself describes:

1. Explicit B contract version bump for `endingRunway` (beat rule scoped to a new version).
2. Update `fixtures/long-horizon/deterministic/long-horizon-fixtures.ts` beat expectations
   to the new semantics.
3. Reviewer approval of the rebaseline **before** any rerun claims closure.
4. Until then, `CHAPTER_49_EMOTIONAL_RESOLUTION_MISSING` would remain recorded as an open
   consequence — the blocker would revert to RECLASSIFIED-pending, not be force-closed.

No rebaseline is requested in C-R1: this decision implements the reviewer's stated reading
of B 1.1.0.
