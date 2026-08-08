# C-R2 Decision — B.3.7 Rebaseline (ending-runway 1.2.0 → 1.3.0)

**Date:** 2026-08-08
**Authority:** Reviewer verdict Entry 6 (`M10_GOVERNANCE_LEDGER.md`, "M10-C masih HOLD —
belum CLOSED"), BLOCKER 1 + BLOCKER 2.
**Status:** IMPLEMENTED in C-R2; submitted for reviewer ratification. Supersedes
`M10_C_R1_DECISION_3_BEAT_CONTRACT.md` (marked SUPERSEDED + VETOED).

## Reviewer ruling (Entry 6, substance)

1. **BLOCKER 1 — VETO of C-R1 #3.** Making `emotionalResolutionBeatIds` non-empty merely
   because `reader_states.locked_ending_key` exists fabricates evaluator input: the lock is
   made at Bab 45, not a Bab-49 beat; naming the id `deterministic-ending-evidence:<key>`
   does not change the semantics. This is the forbidden pattern "caller supplies the
   conclusion so the evaluator passes." Ordered corrective path: **version bump B.3.7 dan
   rebaseline**; emotional-resolution **content** moves to the M10-D semantic judge; the
   deterministic B/C layer may only check structured runtime obligations/evidence that
   actually exist.
2. **BLOCKER 2 — precomputed booleans.** Ending evaluator 1.2.0's
   `canonicalPublicationProof { lockAtCorrectChapter, chapterCommittedRevision,
   chapterPublished }` still trusted caller-computed conclusions. Ordered corrective path:
   inputs must be RAW rows and the EVALUATOR itself computes the durability conjunction.
   Bump together with the BLOCKER 1 correction.

## Decision

One versioned rebaseline of the ending-runway evaluator, **1.2.0 → 1.3.0**, fixing both
B.3.7 blockers in a single adapter-contract change.

### 1. Bab-49 beat check WITHDRAWN from the deterministic suite

- `CHAPTER_49_EMOTIONAL_RESOLUTION_MISSING` no longer exists in ending-runway 1.3.0.
- `EndingRunwayInputV1.publications` no longer carries `emotionalResolutionBeatIds`;
  `captureEndingRunway` no longer derives any beat id. There is no deterministic runtime
  source for Bab-49 emotional-resolution content — prose beats are real-model artifacts,
  and the deterministic path has none. Inventing one (by any name) is fabrication.
- Emotional-resolution CONTENT is deferred to the **M10-D semantic judge** over real
  prose. Capture blocker `ENDING_RESOLUTION_BEAT_BLOCKER` is REOPENED + RECLASSIFIED to
  M10-D scope; the harness therefore does not claim it closed and does not force BLOCKED
  on it either (reviewer-ordered reclassification, `ratifiedByReviewer: true`).
- Fixture `red-ending-chapter49-no-resolution` is WITHDRAWN; `EMOTIONAL_RESOLUTION_CHAPTER`
  remains exported as a spec constant for the future M10-D judge.

### 2. Durability is computed by the evaluator from RAW persisted rows

`EndingRunwayInputV1` (1.3.0) inputs:

| Field | Source (capture reads RAW rows) |
|---|---|
| `endingLock: { lockedEndingKey, lockedAtChapter } \| null` | `story_generation_contracts.ending_lock_json` (raw; `lockedAtChapter` passed through or null — never defaulted) |
| `commit45: { chapterNumber, committedCanonRevision } \| null` | the Bab-45 row of the committed canon ledger (`canon_commits`, raw row or null) |
| `publishedChapterNumbers: number[]` | full raw list from published chapters |
| `publications`, `finalState`, `closureRunwayFromChapter` | unchanged (no beat field) |

The evaluator computes, itself:

```
lockDurable = endingLock present
            ∧ endingLock.lockedAtChapter === 45
            ∧ commit45 row exists ∧ commit45.chapterNumber === 45
            ∧ publishedChapterNumbers includes 45
```

Any failed conjunct ⇒ `ENDING_LOCK_NOT_DURABLE` with the raw breakdown
(`lockPresent, lockedAtChapter, commit45, bab45Published, publishedChapterCount`) as
evidence detail. No boolean arrives precomputed; the capture adapter performs no
conclusion, only row read-back. All other 1.2.0 checks are unchanged
(`NEW_MAJOR_CONFLICT_IN_CLOSURE_RUNWAY`, `CHAPTER_50_CHOICES_NOT_NULL`,
`LOCKED_ENDING_KEY_MISMATCH`, `ENDING_LEAVES_UNRESOLVED_DEBT/THREAD`).

### 3. Fixture + suite rebaseline

- `greenEnding()` rebuilt on 1.3.0 raw inputs (horizon 45..50 preserved; every OBSERVED
  chapter ref stays inside the FINAL_HORIZON window).
- `red-ending-lock-not-durable` now drops the RAW `commit45` row (evaluator computes the
  failure).
- NEW `red-ending-lock-wrong-chapter`: raw lock row records `lockedAtChapter = 46` (stays
  inside the horizon window; the evaluator — not the caller — detects the misplaced lock).
- `red-ending-chapter49-no-resolution` WITHDRAWN (section 1).
- `EVALUATOR_VERSIONS.endingRunway` bumped to `1.3.0` (`scripts/m10-b-qa.ts`).

### 4. Scope discipline

This rebaseline touches ONLY the ending-runway adapter contract, its capture source, its
fixtures, and the blocker dispositions that cite them. It does not touch the other
evaluators, the reconciliation runtime beyond the separate G1 correction (documented in
the C-R2 report), or any publication authority. Per Entry 6: "C-R2 harus sempit."

## Consequences

- Capture blocker #4 (`ENDING_LOCK_TX_BLOCKER`) is CLOSED on the 1.3.0 semantics (raw-row
  durability), pending reviewer ratification of this rebaseline.
- Capture blocker #3 (`ENDING_RESOLUTION_BEAT_BLOCKER`) is REOPENED + RECLASSIFIED to
  M10-D (semantic judge over real prose). Not force-closed, not deleted.
- Because runtime capture changed, normalized harness evidence changes ⇒ a full double
  deterministic rerun is performed (Gate 3) and hashes are expected to differ from the
  C-R1-era runs (`ceccff8be159…` / `61549907…`).
