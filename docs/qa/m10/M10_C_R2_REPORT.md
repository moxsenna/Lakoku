# M10-C — C-R2 corrective package report

**Scope:** the narrow C-R2 ordered by reviewer ledger Entry 6 (2026-08-08).
**Branch:** `feature/m10-c-recovery`. **Code head of counted runs:** `dab4967`.
**Predecessor report:** `docs/qa/m10/M10_C_R1_REPORT.md` (C-R1; §7 closing gates).

> **Headline, stated plainly: the C-R2 rerun result is `BLOCKED`, not PASS.**
> Blocker #6 (ending reachability) is UNRESOLVED by design of the current contract
> model, so the harness reports BLOCKED. That is the honest outcome and it is
> reported as such rather than engineered away. M10-C cannot self-declare closed.

---

## 1. What Entry 6 ordered, and what was done

| Entry 6 item | Disposition in C-R2 |
|---|---|
| BLOCKER 1 — #3 emotional-resolution beat = evaluator-input fabrication (VETO) | Bab-49 beat check **WITHDRAWN** from the deterministic evaluator; emotional-resolution CONTENT reclassified to the M10-D semantic judge. Decision doc: `M10_C_R2_DECISION_B37_REBASELINE.md`; the superseded doc is marked VETOED in place. |
| BLOCKER 2 — evaluator 1.2.0 accepts precomputed booleans | `endingRunway` rebaselined **1.2.0 → 1.3.0**. `canonicalPublicationProof` (conclusion booleans) deleted; inputs are RAW rows and the evaluator computes the durability conjunction itself. |
| BLOCKER 3 — #6 reachability false PASS | Fabricated `isMain: true / isSecret: false / blockedByFlags: []` PASS removed. New `deriveEndingReachabilityEvidence()` publishes only provable clauses and marks the model gaps UNPROVEN. `#6` stays **OPEN**, `ACT_ENDING_REACHABILITY` proof stays **NOT RATIFIED**, `G1-REACH` stays **IN_PROGRESS**. |
| G1 issue — missing-thread drift mask | The `existingThreadIds` filter is **removed**. A trajectory-required thread that never materialized now reaches `computeDriftScore()` and scores as drift. |
| Gate 2 — migration-history authority | **NOT resolved by implementation.** Escalated verbatim to the decision-maker as a two-option choice (§5). No migration was renamed, deleted, or rewritten in C-R2. |

Everything Entry 6 listed as "Approved from C-R1 (kept)" was left untouched:
context-budget wiring, G4 stale marking + fail-closed regression, post-publication
call site, V5 call-chain proof, fork/fencing/parity, absence of STALE HIGH findings.

---

## 2. B.3.7 rebaseline — `endingRunway 1.3.0`

**Rule applied:** the evaluator receives rows, not verdicts. The caller may not hand
the evaluator the conclusion the evaluator exists to reach.

Removed input (1.2.0):

```ts
canonicalPublicationProof: {
  lockAtCorrectChapter: boolean      // caller's conclusion
  chapterCommittedRevision: number | null
  chapterPublished: boolean          // caller's conclusion
}
```

Replacement input (1.3.0) — raw rows only:

```ts
endingLock: { lockedEndingKey: string; lockedAtChapter: number } | null
commit45:   { chapterNumber: number; committedCanonRevision: number } | null
publishedChapterNumbers: number[]
```

The evaluator now computes durability itself:

```text
durable  ==  endingLock != null
         AND endingLock.lockedAtChapter == 45
         AND commit45 != null AND commit45.chapterNumber == 45
         AND publishedChapterNumbers includes 45
otherwise → ENDING_LOCK_NOT_DURABLE
```

Fixture rebaseline (deterministic long-horizon set):

- `greenEnding()` carries raw rows at `evaluatorVersion: '1.3.0'`;
- `red-ending-lock-not-durable` now removes the raw commit row (`commit45 = null`)
  instead of flipping a boolean;
- **new** `red-ending-lock-wrong-chapter` sets `lockedAtChapter = 46` — a misplaced
  lock the evaluator must detect on its own (46 stays inside the FINAL_HORIZON
  window 45..50, so the temporal envelope gate still passes);
- `red-ending-chapter49-no-resolution` is **withdrawn**;
  `CHAPTER_49_EMOTIONAL_RESOLUTION_MISSING` no longer exists in the deterministic
  suite. The withdrawal is recorded as an in-file comment, not a silent deletion.

Manifest confirms the bump: `evaluatorVersions.endingRunway = "1.3.0"`.

---

## 3. G1 corrections

### 3.1 Missing-thread requirement is no longer filtered

C-R1 built reconciliation requirements as
`expectedThreadMovement.filter(id => existingThreadIds.has(id))`. `computeDriftScore()`
(lib/narrative/reconciliation.ts) counts a required thread as unmet when
`state.threadStatuses[threadId]` is not OPEN/DEVELOPING/PAYOFF_DUE — an id with no
entry at all is `undefined`, therefore unmet, therefore drift. The filter removed
exactly the evidence the function is designed to score. Filter deleted; a regression
test asserts a ghost id survives into `requiredThreadsActive` and yields
`computeDriftScore(...) === 1`.

Reviewer wording, kept as the code comment rationale: *"Jangan filter missing
requirement. Missing required thread adalah evidence drift, bukan sesuatu yang harus
di-ignore."*

### 3.2 Honest reachability evidence (no fabricated PASS)

Model fact, stated rather than worked around: `EndingCandidateSchema`
(lib/story-engine/story-contract.ts) carries only `key`, `name`, `condition`
(free text) and `requiredClosure`. It **cannot** express a secret ending or a
structured flag-blocking condition. `checkEndingReachability()` detects secrets only
via `isSecret === true` and blocking only via `blockedByFlags`. Therefore NCS §1.4
("≥2 main endings + a secret path reachable at every checkpoint") is **not provable**
on the current contract model.

What C-R2 does instead of faking it:

- candidates are still mapped to `EndingDef`s **solely as violation-detection input**
  to `checkEndingReachability` — passing `endings: []` would raise
  `ENDING_UNREACHABLE` CRITICAL at every boundary and force
  `FAILED_REVIEW_REQUIRED`, breaking the approved #5 reconciliation wiring. The
  mapping is documented in-code as detection input, never as a reachability claim;
- a new `deriveEndingReachabilityEvidence()` separates what is provable
  (candidate count vs `ENDING_RULES.minReachableEndings`, `requiredClosure`
  satisfiability, any violation codes actually detected) from what is not
  (`secretEndingModeled`, `secretPathProven`, `flagBlockingModeled`);
- `FLAG_BLOCKING_PROVABLE_ON_CURRENT_MODEL = false` is an exported, documented
  MODEL FACT — not a stub or a disabled check;
- `ncs14Proven` is the conjunction of all four clauses and is therefore **always
  false** on the current model;
- the persisted `ACT_ENDING_REACHABILITY` payload has **no `passed` field at all**,
  so no consumer can render it as a verdict;
- capture renders the string verbatim and can never print `PASS`.

Observed in the counted runs (`act-boundaries.json`, every boundary, both modes):

```text
UNPROVEN:candidates=2/min=2,closure=satisfiable,secretPath=UNPROVEN
```

Closing NCS §1.4 requires a contract-model change (structured `kind`/`isSecret` and
machine-checkable blocking conditions on ending candidates). That is a design change,
outside the "C-R2 harus sempit" boundary, and is not attempted here.

---

## 4. Counted rerun evidence (head `dab4967`)

Entry 6 stated the full double-run need not be repeated *"kecuali runtime/schema yang
memengaruhi normalized evidence berubah."* C-R2 changed exactly that (evaluator
inputs, persisted boundary payload, and — in `dab4967` — the disposition-basis
strings that feed hashed artifacts). The full double run was therefore redone.

Environment (unchanged recipe, isolated only): worktree
`D:\Coding\lakoku-m10c-gate3`, supabase `project_id = lakoku-m10c`, ports +1000
(API 56321, db 56322). Before each counted run: `supabase db reset` → ledger verified
**65/65**, `auth.users = 0`, `/auth/v1/health` = 200 → config edit reverted with
`git checkout` → `supabase/.branches/` removed → `git status --porcelain` empty.
No `NARRATIVE_PROVIDER` set anywhere: deterministic provider, **zero model calls**.
No production endpoint, credential, or row was touched.

**Run A** (fresh reset → harness) and **Run B** (second fresh reset, same command,
same head):

```text
runId             m10-c-ceccff8be159
headSha           dab4967aa7ba129ddc38d7c5d1f599b6a5b7c1b6
workingTreeDirty  false
result            BLOCKED
chapters          50 (sync + worker)
parityMismatches  0
totalFindings     542   (BLOCKER 0 / HIGH 0 / MEDIUM 542 / LOW 0 / INFO 0)
failedCompletionChecks  []
findingsHash      ceccff8be159a81ffee25129d66d12c44673ac845d34c890639ed3166c6b9b49
summaryHash       2f8d5f10fcfc890aabc1efcb54a4fe1ae188878e985a9f2742d4afc8ba37ca14
evaluatorVersions.endingRunway  1.3.0
```

**Byte-identical A vs B — all eight evidence artifacts:** `act-boundaries.json`,
`blockers.json`, `captures.json`, `fencing.json`, `findings.json`, `fork.json`,
`parity.json`, `summary.json`. `manifest.json` differs in `startedAt`/`finishedAt`
only; every other manifest field, including `artifactHashes`, is equal. (The C-R1
worker-mode `threadStatuses` ordering wobble did not recur — `act-boundaries.json`
was byte-equal this time.)

Hash movement vs the C-R1 closure runs is expected and explained:

- `findingsHash` **unchanged** (`ceccff8b…`) — findings are evaluator outputs, and
  the withdrawn Bab-49 beat finding was already zero on the green path;
- `summaryHash` **changed** (`61549907…` C-R1 → `97387dff…` at `ebd85d0` →
  `2f8d5f10…` at `dab4967`) — the summary/boundary payload shape and the
  disposition-basis text changed. Both movements are accounted for by a commit.

The 542 MEDIUM findings are the known pre-existing deterministic-provider prose
artifacts, unchanged in composition: 436 `EXACT_PARAGRAPH_REPETITION`,
98 `CHOICE_HISTORY_DUPLICATE_PREVIOUS`, 6 `REPEATED_CHOICE_LABEL`,
2 `REPEATED_CLOSING_STRING`.

### 4.1 Blocker dispositions as recorded by the run

```text
CONTEXT_BUDGET_NOT_PERSISTED_BY_RUNTIME        CLOSED       (production wiring + capture read-back)
ENDING_LOCK_PUBLICATION_TX_UNOBSERVABLE        CLOSED       (raw-row durability on endingRunway 1.3.0)
ACT_RECONCILIATION_TRIGGER_UNOBSERVABLE        CLOSED       (post-publication hook, persisted event)
CONTEXT_MEMORY_PROMPT_LAYERS_UNOBSERVABLE      RECLASSIFIED (M10-F, ratification #1)
EMOTIONAL_RESOLUTION_BEATS_NOT_PERSISTED       RECLASSIFIED (M10-D semantic judge, Entry 6 BLOCKER 1)
ENDING_REACHABILITY_PER_ACT_NOT_PERSISTED      UNRESOLVED   → run result BLOCKED
```

`unresolvedCaptureBlockers = ['ENDING_REACHABILITY_PER_ACT_NOT_PERSISTED']`. The
harness fails closed on it; no capture blocker was removed to force a green result.
The stale C-R1 basis strings ("five CLOSED … one RECLASSIFIED") were corrected in
`dab4967` so the artifacts describe the C-R2 state truthfully.

### 4.2 Code gates

`pnpm typecheck` clean. `pnpm lint` → 0 errors, 11 pre-existing warnings in files
C-R2 did not touch. `pnpm test:unit` → 158 files passed / 7 skipped, 1993 tests
passed / 22 skipped.

---

## 5. Gate 2 — migration-history authority (still HOLD, decision-maker input required)

C-R2 made **no** migration change. The exit remains exactly the two options Entry 6
named, and neither is an implementation-side call:

1. the decision-maker authorizes a **separate READ-ONLY** query against production
   `supabase_migrations.schema_migrations` (a `SELECT` only — no migration, no write
   of any kind), so the real applied history can settle whether `bb3287a` is a repair
   or a rewrite; **or**
2. the decision-maker explicitly approves the migration-history rewrite/waiver on the
   record that the project has no authoritative deployed migration history for that
   range.

Until one of those is chosen, `bb3287a` stays NOT RATIFIED and is not proposed for
merge. Nothing was renamed or deleted on assumption.

---

## 6. Stage state and STOP

```text
B.3.7 raw durability input     CLOSED   (endingRunway 1.3.0, raw rows)
B.3.7 beat evidence            WITHDRAWN → M10-D semantic judge
G1 missing-thread drift mask   CLOSED   (filter removed + regression test)
G1 ending reachability         OPEN     (NCS §1.4 unprovable on current contract model)
ACT_ENDING_REACHABILITY proof  NOT RATIFIED
G1-REACH (NTM)                 IN_PROGRESS
migration-history authority    HOLD     (decision-maker)
M10-C rerun result             BLOCKED
M10-C                          NOT CLOSED
M10-D / M10-E / M10-F / M10-G  BLOCKED
production activation          FORBIDDEN
```

No production action was taken or planned. No model call was made. M10-D/E/F/G were
not started.

**STOP — awaiting the reviewer verdict on C-R2 and the decision-maker's Gate-2 choice.**
