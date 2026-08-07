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
