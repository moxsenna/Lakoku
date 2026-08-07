# M10 Governance Ledger

Append-only record of reviewer verdicts controlling the M10 B→G stage graph.
Newest entry last. Do not edit historical entries.

---

## Entry 1 — 2026-08 (recorded in `M10_B_REPORT.md` closure addendum)

**Verdict: STOP / RESET stage state setelah M10-B.** M10-B R1 integrated onto current
main (PR #56 squash `7d0dd03`, closure docs `21cb682`, CI run `31197911530` success).
M10-C restarted from the new main; old-branch C/E evidence invalidated (E preliminary only).
Six observability blockers: *"harus ditutup atau direclassify dengan proof sampai C PASS."*
Production activation / production DB / real reader data in QA: FORBIDDEN.

## Entry 2 — 2026-08-08 (C recovery verdict; verbatim key block)

```text
M10-A                CLOSED
M10-B                CLOSED

M10-C recovery core  PASS
M10-C stage          BLOCKED / NOT PASS

Ratification:
  #1                 APPROVED → F
  #2                 REJECTED → C
  #3                 REJECTED pending B contract decision
  #4                 CLOSE IN C if atomic proof adapter fixed
  #5                 REJECTED → C/G1 blocker
  #6                 REJECTED → C/G1 blocker

Additional:
  G4-STALE           C BLOCKER
  V5 vs V6 seam      C VERIFICATION GATE
  migration duplicate HOLD pending history proof

M10-D                BLOCKED BY C
M10-E                BLOCKED BY C
M10-F                BLOCKED
M10-G                BLOCKED

production action    FORBIDDEN
```

Ratification detail (reviewer, verbatim intent):

- **#1 RATIFY** — prompt-layer writer is the real writer/model boundary; end-to-end
  prompt-layer verification moves to F.
- **#2 REJECT** — C itself requires per-chapter context-budget capture. Fix the capture
  seam/runtime observability in C; DB persistence not required if the production runtime
  can return the evidence deterministically.
- **#3 REJECT AS-IS** — B 1.1.0 already made emotional-resolution beats deterministic
  ending evidence; ownership may not move silently after B froze. Moving to D requires an
  explicit B contract rebaseline/version bump + fixture update + reviewer approval.
- **#4 reclassification REJECTED; substance CLOSABLE** — a transaction ID is not the
  requirement. If lock + chapter + canon mutation are proven one DB transaction and
  rollback/fencing tests prove atomicity, the gap is CLOSED in C. Fix the
  capture/evaluator adapter so durability derives from canonical publication proof.
- **#5 REJECT — C BLOCKER** — no publication-path call site is not an observability
  defect; it is an unwired production runtime side-effect, the category plan C.5 forbids
  deferring.
- **#6 REJECT — C BLOCKER** — C must prove ending reachability at checkpoint/act
  boundaries through the production runtime; final enforcement alone does not replace
  per-act execution proof.
- **G4-STALE = C-BLOCKER-7** (`G4-STALE_RUNTIME_SIDE_EFFECT_MISSING`) — 28 HIGH
  `STALE_THREAD_CALLBACK_DEADLINE_MISSED` + 18 MEDIUM `STALE_THREAD_DETECTED`; write path
  does not apply callback windows; `story_threads.stale` stays false. Legitimate options
  only: (A) implement runtime stale/touch/callback enforcement per NCS + regression +
  clean 1→50 rerun, or (B) explicit NCS/NTM change + rationale/product decision +
  evaluator policy/version update + reviewer approval + clean rerun. No finding downgrades.
- **V5 vs V6 gate** — read-only call-path proof required: is the terminal publication
  authority of the current production commercial worker V5 or V6? If V6, the C worker
  harness must use V6; preflight V6 + publication V5 is not full production-boundary proof.
  If V5 remains canonical and V6 is a commercial wrapper inapplicable to the fixture,
  document the exact call chain.
- **Migration duplicate** — HOLD. No delete, no no-op yet. Algorithm: (1) identify exact
  filenames + SHA256; (2) prove whether the newer duplicate was ever applied in
  shared/staging; (3) byte-identical AND never applied in shared environments → delete the
  redundant newer duplicate; (4) ever applied → forward-only repair with unique version.
  No-op with a still-duplicate version number solves nothing. No migration-history rewrite
  on repo evidence alone.
- **workingTreeDirty** not a blocker for the recovery run; the final closure run should
  come from a clean worktree.

Next step ordered by reviewer: a **narrow C-R1 corrective package** for #2, formal #3
decision, #4 closure adapter, runtime G1 #5/#6, G4-STALE, and V5-vs-V6 proof, then a
clean 1→50 sync+worker rerun. Green there ⇒ real M10-C PASS, opening D + E.

## Entry 3 — 2026-08-08 (C-R1 corrective package + closure rerun SUBMITTED; not a verdict)

Agent-side record (reviewer verdict still pending):

- **C-R1 committed** at `e02a3a7` on `feature/m10-c-recovery` (17 files): #2 capture
  seam (`persistRetrievalLog` + capture read-back, fail-closed), #3 formal beat
  decision (`M10_C_R1_DECISION_3_BEAT_CONTRACT.md`, B 1.1.0 semantics, veto fallback
  documented), #4 ending-evaluator 1.2.0 canonical publication proof adapter, #5/#6
  production post-publication lifecycle hook (`ACT_RECONCILIATION` /
  `ACT_ENDING_REACHABILITY` story_events from the shared schema-3 publish path),
  G4-STALE Option A (runtime `markThreadStaleness` side-effect + unchanged Layer A
  fail-closed enforcement + cadence + pure/DB regression tests), blocker dispositions
  rewritten (5 CLOSED, prompt layer RECLASSIFIED to F per ratification #1).
- **Closure rerun `m10-c-ceccff8be159` from clean committed worktree** (manifest
  `headSha` = `e02a3a7`, isolated-qa, deterministic provider): PASS, 50+50 chapters,
  0 parity mismatches, stateDeltaHash both modes, 7/7 completion checks ×2,
  0 BLOCKER/HIGH findings, 0 STALE_THREAD_*, 0 ENDING_LOCK_NOT_DURABLE,
  0 CHAPTER_49_EMOTIONAL_RESOLUTION_MISSING, retrieval_logs Bab 2–50 both stories,
  story_events per act boundary both stories, fork single-spine + no cross-leak,
  fencing tamper probes rejected. Full evidence: `M10_C_R1_REPORT.md`.
- **Carried to reviewer:** migration duplicate HOLD (staging-history source for
  algorithm step 2 unknown — no delete/no-op performed), #3 veto fallback, pre-existing
  full-suite flakiness (baseline 20 failing files vs 1 with C-R1 = the HOLD-owned
  migration test).
- NTM G4-STALE and G4-STATUS updated IN_PROGRESS → DONE with scope + evidence.
- Stage state unchanged until verdict: M10-D/E BLOCKED BY C; production action
  FORBIDDEN. **STOP for reviewer verdict.**
