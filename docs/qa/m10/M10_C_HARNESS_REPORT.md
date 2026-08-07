# M10-C Stage Report — Long-Horizon 1→50 Harness

**Status:** M10-C COMPLETE — result **BLOCKED** (honest: 6 capture blockers for
missing production wires; no blocker removed to force green)
**Stage report commit:** this docs commit (records evidence of `eea7de9`)
**M10-C code commit (exact head):** `eea7de90a0b68ebc7bf09db60ede8603970c8858`
**Stage C baseline SHA:** `401f0f8716efe99b02e4179f1969d951dc92c74a` (verifiable: `git cat-file -t`)
**M10-A closure anchor:** `0997e7dd848eed77b8b480e5fa1057804827d303` (immutable)

**Scope guard held:** no LLM/model calls (`NARRATIVE_PROVIDER` never set to
`gateway`; `assertDeterministicProvider` enforced), no production contact
(`assertIsolatedTarget` pins the local Supabase URL; un-bypassable), no
production DB mutation, no real reader data, no fabricated evaluator inputs
(missing wires are recorded as `CaptureBlockerV1`, never filled), no production
runtime file edited (the only `lib/api` change is the behavior-preserving
`applyPersonalizedChoiceAuthorized` extraction approved for C-pre).

---

## 1. What M10-C is

A deterministic QA harness that drives the REAL production personalized-v1
runtime — generation, schema-3 checkpoints, publication RPCs, and the accepted
-choice seam — through Bab 1→50 against an isolated LOCAL Supabase, and feeds
the captured DB state into the M10-B evaluator contracts. Zero model spend:
the deterministic provider supplies prose and structured proposals; everything
from contract to committed canon is production code.

Two clones run the identical run spec:

* `m10c-sync` — sync publication path (`publish_chapter_state_v3`)
* `m10c-worker` — worker publication path (`publish_generation_job_chapter_v5`)

plus two fork stories `m10c-fork-a` / `m10c-fork-b` for the branch-fork
primitive. One documented command:

```
pnpm m10:c:harness     # scripts/m10-c-harness-cli.ts -> runM10CHarness
```

It bootstraps local Supabase env from `supabase status -o json`, refuses to run
against any non-local target, writes 9 artifacts to
`.zcode/artifacts/m10-c/<runId>/`, and exits 1 unless result is PASS.

## 2. Exact-head evidence (post-commit runs on the committed tree)

Two consecutive runs of the committed code (`eea7de9`) produced:

```
runId:          m10-c-41852d4cbec3   (both runs)
findingsHash:   41852d4cbec3769cad10d2b9c7396f754212c067e207868392f1d16388f60b9b
summaryHash:    fe8f22fbc76e817f48c8646674f0b9828d98743ef631a7f52df4b6b3b3cb231d
result:         BLOCKED
chapters:       50 sync + 50 worker + fork branches to Bab 12
parity:         0 mismatches across all 50 chapters
```

Two further runs before the commit produced the SAME findingsHash — four
byte-identical runs total (plan C.6 reproducibility). The manifest records
`headSha`, `workingTreeDirty`, `baselineSha`, route profiles, runtime policy
versions (`personalizedV1 1.0.0`, choice policy `m10c-first-choice-v1`,
harness spec 1) and every evaluator version. `workingTreeDirty: true` is
honest and fully explained: the executed harness code is 100% committed at
`headSha`; the dirty flag comes only from untracked documentation (this
report, the SDD ledger, two unrelated plan documents). No executed source is
uncommitted.

`result: BLOCKED` is the correct, unforced outcome: six capture blockers mean
six evaluator inputs have no honest runtime source yet (\\S4). No blocker was
removed or weakened to reach green.

## 3. DoD checklist (plan §M10-C)

| DoD item | Evidence |
|---|---|
| Clean isolated DB runs Bab 1→50 without manual state patch | `ALL_50_CHAPTERS_PUBLISHED` PASS both modes; reseed only drops harness-owned rows |
| Sync and worker modes supported | `m10c-sync` (V3) + `m10c-worker` (V5) both complete |
| Per-chapter artifacts + B findings captured | `captures.json` (50+50), `findings.json` (592 findings into M10-B contracts) |
| Two identical runs → identical normalized hashes | runId + findingsHash identical across 4 runs |
| Mid + late checkpoint resume proven | `CHECKPOINT_RESUME_EXERCISED` PASS; plan {Bab 20 same-attempt, 33 new-attempt, 46 same-attempt}; canon revision stays exactly 50 |
| Act boundary hooks proven from production runtime | `ACT_BOUNDARY_HOOKS_PROVEN` PASS: rollup committed at Bab 5/12/50; next-act blueprint version 1 in effect for Bab 6 and 13; `act-boundaries.json` |
| Branch-fork primitive exists and is isolated | `fork.json`: pre-fork captureHash parity TRUE through Bab 10, different legal choices (`buka-jejak` vs `hadap-lawan`), both branches to Bab 12 with single canon spines, `crossLeakDetected: false` |
| NTM G1/G2-TIERS/G4 status-stale gaps proven closed or explicit C blockers | Explicit C blockers retained (see §4) — none claimed closed |
| One documented command for CI/QA | `pnpm m10:c:harness` (bootstraps env, fail-closed isolation assertions) |
| Report records exact-head evidence | This document + `manifest.json` (`headSha`, `baselineSha`) |
| STOP for review | This report is the review stop |

STOP conditions: none triggered — no direct table mutation to advance a
chapter, no skipped chapter, sync/worker divergence is zero (provenance-
normalized captureHash), resume never re-applied committed state
(`CANON_REVISION_ADVANCED_ONCE_PER_CHAPTER` PASS), act side-effects read from
the production runtime (not simulated), artifacts contain only harness-owned
fixture rows.

## 4. The six capture blockers (missing production wires)

All are inputs the M10-B evaluator contracts require that the production
runtime does not persist or expose. Values were NEVER fabricated; each field is
empty/null and the blocker recorded. They are production work items, not
harness defects:

1. `CONTEXT_MEMORY_PROMPT_LAYERS_UNOBSERVABLE` — `buildWriterPrompt` returns a
   concatenated user string; per-layer (1a/3) text exists only on the
   real-model gateway path.
2. `CONTEXT_BUDGET_NOT_PERSISTED_BY_RUNTIME` — `persistRetrievalLog` has zero
   call sites in `lib/runtime/personalized-generation.ts`; `retrieval_logs`
   stays empty.
3. `EMOTIONAL_RESOLUTION_BEATS_NOT_PERSISTED` — no table/checkpoint field
   records a resolution beat; prior harness fabrication of
   `beat:<chapter>` was removed.
4. `ENDING_LOCK_PUBLICATION_TX_UNOBSERVABLE` — the ending lock IS written
   inside the publication transaction, but no transaction id is persisted, so
   atomic-commit provenance cannot be read back.
5. `ACT_RECONCILIATION_TRIGGER_UNOBSERVABLE` — no persisted marker identifies
   what triggered act reconciliation.
6. `ENDING_REACHABILITY_PER_ACT_NOT_PERSISTED` — per-act ending reachability is
   not persisted.

Two consequent HIGH findings remain until wires 3–4 exist:
`CHAPTER_49_EMOTIONAL_RESOLUTION_MISSING` and `ENDING_LOCK_NOT_DURABLE` (2
each, one per clone). They are downstream of blockers, not new defects.

## 5. Review must-fix resolution (C-2 review package)

The independent review returned SPEC FAIL / QUALITY PASS with 8 must-fix items
and 5 minor items. All resolved: B1 (act-boundary hooks), B2 (tamper
fail-closed probes through the REAL checkpoint RPCs — `fencing.json`), B3
(new-attempt resume mode consumed; sync EXACT_REPLAY vs worker REJECTED), H1
(fork primitive — two isolated stories, ownership model forbids two readers on
one personalized story), H2 (baseline SHA replaced with verifiable
`401f0f8…` + runtime headSha/workingTreeDirty), H3 (horizon evaluators
run-once: finding mass 12582 → 592), H4 (every PostgREST read checks `error`;
null can no longer suppress findings), H5 (dead choice-policy drift check
removed), Q3 (fixture seeded a non-debt-backed thread production can never
produce — removed), M1–M5 (report notes, parity scope declaration,
previousDeltaHash removal, blocker dedupe by code, bundle type removal).
Details in `.superpowers/sdd/progress.md` → "C-2 FIXES".

### Provenance fencing evidence (`fencing.json`)

| Probe | sync | worker |
|---|---|---|
| state-delta-tamper @20/@46 | REJECTED | REJECTED |
| attempt-id-tamper @20/@46 | REJECTED | REJECTED |
| job-id-tamper @20/@46 | — | REJECTED |
| new-attempt-resume @33 | EXACT_REPLAY (legitimate idempotent replay from the commit ledger; no double-advance — canon revision proves it) | REJECTED |

## 6. Findings (592 total, both clones)

| Count | Severity | Code | Interpretation |
|---|---|---|---|
| 436 | MEDIUM | `EXACT_PARAGRAPH_REPETITION` | Deterministic-provider templated prose — measures the fixture, not the runtime; becomes meaningful under M10-F real model |
| 98 | MEDIUM | `CHOICE_HISTORY_DUPLICATE_PREVIOUS` | Harness-policy artifact: deterministic policy accepts the same choice id+label at consecutive chapters by design |
| 28 | HIGH | `STALE_THREAD_CALLBACK_DEADLINE_MISSED` | `main_mystery` dormant Bab 12→48 by fixture design; write path enforces no callback window — product decision pending |
| 18 | MEDIUM | `STALE_THREAD_DETECTED` | Same root cause as above |
| 6 | MEDIUM | `REPEATED_CHOICE_LABEL` | Deterministic provider artifact |
| 2 | HIGH | `CHAPTER_49_EMOTIONAL_RESOLUTION_MISSING` | Downstream of blocker 3 |
| 2 | HIGH | `ENDING_LOCK_NOT_DURABLE` | Downstream of blocker 4 |
| 2 | MEDIUM | `REPEATED_CLOSING_STRING` | Deterministic provider artifact |

Zero BLOCKER findings. The pre-fix `ENDING_LEAVES_UNRESOLVED_THREAD` BLOCKERs
were a fixture artifact (Q3) and are gone.

## 7. Escalations (observations, NOT fixed — no production mandate)

1. **Authoring-path terminal-thread gap** (out of M10-C scope): the
   personalized path derives threads exclusively from plot debts
   (`contract-persistence.server.ts`), so a personalized story cannot end with
   a dangling thread. But `lib/authoring/persist.ts:96-106` inserts arbitrary
   non-debt-backed threads for standard/public stories, and completion has no
   terminal-thread gate on that path. Needs a product decision.
2. **Thread staleness not enforced in the write path**: evaluator windows
   (`STALE_AFTER_CHAPTERS` / `STALE_CALLBACK_WINDOW`) are not mirrored by any
   publication gate; `story_threads.stale` stayed `false` all run. Needs a
   product decision: enforce in the write path, or fix the evaluator threshold.

## 8. What this stage does NOT prove

* Nothing about real-model prose quality — the deterministic provider is
  templated by design. Semantic dimensions belong to M10-D/F.
* Nothing about production behavior under load, concurrency beyond the
  capacity-slot pool, or real reader traffic.
* The six blocked evaluator inputs: their evaluators run on empty inputs and
  cannot PASS until the production wires exist.

## 9. Gate verdict

M10-C clears its gate **honestly as BLOCKED**: every success criterion that can
be proven deterministically IS proven (1→50 both modes, parity, resume both
modes, act hooks, fork isolation, tamper fail-closed, reproducibility ×4), and
every gap is an explicit, recorded blocker pointing at real production wires —
none simulated, none fabricated, none removed.
