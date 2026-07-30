# Lakoku Full Generation Fix — Completion Audit

**Canonical specification:** `docs/superpowers/plans/lakoku-full-generation-fix-plan.md`

**Branch:** `review/full-generation-fix-completion`

**HEAD:** `154ee04c940d41ef785cc6db8dea60f683e2ab90`

**Audit date:** 30 July 2026 (Asia/Jakarta)
**Production deployment / linked DB push:** NOT RUN

## Current repository state

- Branch tracks `origin/review/full-generation-fix-completion` and is **ahead 0, behind 0** (synced).
- Phase A + B + C committed and pushed.
- Working tree: clean except untracked `.commandcode/` and `.omo/run-continuation/` (foreign paths, excluded from all operations).
- Remote CI unknown; this document makes no remote-CI claim.
- All evidence is local-only. Retained logs in `.local/final-gates/` (ignored); soak artifacts in `.local/worker-soak/` (ignored).

## All branch commits

| SHA | Subject |
|---|---|
| `92ad83b` | `test(db): classify generation aggregate failures` |
| `97b6fa8` | `fix(db): enforce audit pairing and terminal reconciliation` |
| `43c77c3` | `test(db): pin generation lifecycle contracts` |
| `26bd369` | `fix(db): correct Phase A durable reconciliation` |
| `ad3d756` | `test(db): correct V4 ending race fixture` |
| `822070a` | `refactor(generation): add explicit provider execution seam` |
| `154ee04` | `test(generation): prove durable worker completion` |

Phase A (DB): SHAs 92ad83b–ad3d756.
Phase B (seam + soak): SHA 822070a.
Phase C (final-head evidence + commit): SHA 154ee04.

## Soak evidence history

### Pre-cleanup runs (superseded — predate concurrency-policy fix)

| Jobs | Run ID | Result artifact SHA-256 | Embedded evidence SHA-256 | Recorded result |
|---:|---|---|---|---|
| 10 | `8cc6500b-7cf0-4600-8b51-3c75e0d6be65` | `7be6a3f1bb8bcd1b87d01a055e17bde3bf648100d8e711f8e9dcbc6f43992ae2` | `7ff8b01d940c946764998e3cc45f5651acfb05fbc7b9e14f4f418d7385cc2dfd` | exit 0; published 10; recovered 2; forced `SIGKILL` |
| 30 | `2749e79c-25cc-4fc0-b847-64aafb249a4f` | `d09a1892075af3b147268128d61f6e32cda9cef3cabaa52eb94b442ce869956c` | `deace42d7c02458b865cdb78b2e63a050498ba2a82d1aae51ba53e77db437fea` | exit 0; published 30; recovered 1; forced `SIGKILL` |

### Initial production-seam runs (superseded — predate cleanup)

| Jobs | Run ID | Result artifact SHA-256 | Embedded evidence SHA-256 | Recorded result |
|---:|---|---|---|---|
| 10 | `c028b1d0-5838-4cef-85db-176f520a8e12` | `40d510e6983f6104d4aff7abaef052eca3b750b14fbd32f91f61ed1485ee7bc5` | `180bfde187cc56a8c6873e784f794a616266773d6526401fc552571b6aff7934` | exit 0; published 10; recovered 1; forced `SIGKILL` |
| 30 | `e2b1e353-4674-484e-8dba-48a06a3b47f9` | `2cee3bd39d2e6cb0b9a533e400e09d02be613ccb2a3fadd6e94700a5790296a4` | `08e4d0c3a0b66f5937140091687572e6e26e4e9dc8775ff5da444ca5e8548125` | exit 0; published 30; recovered 7; forced `SIGKILL` |

### Final-head runs on `154ee04` (after all fixes)

| Jobs | Run ID | Result artifact SHA-256 | Profile | Recorded result |
|---:|---|---|---|---|
| 10 | `4f9f2ad3-999f-4c6c-80b2-9677ad40942e` | `4238a401bdb6c5847de8e2dbe2b689a7672fb585142cba620a420e72c6d2c59f` | gen-con=1, choice=1 | exit 0; published 10; recovered 1; forced `SIGKILL` |
| 30 | `1f53ef39-b7e7-43f8-92dd-14dac605597b` | `24ebb56b73e0a31078d0813a624d3706dc01bc841e70538a1302ac0a882336de` | gen-con=6, choice=2 | exit 0; published 30; recovered 1; forced `SIGKILL` |

Final-head soak:10 details:
- 10/10 published, 1 SIGKILL recovery.
- Provider fallback exercised (`9router` as B after `custom` A failure).
- `proseFingerprintIdentical: true`, `proseAttemptCountIdentical: true`, `proseCandidateCalls: 0` — **zero prose regeneration due to choice failure**.
- All 9 programmed choice-outcome categories (TIMEOUT, RATE_LIMITED, HTTP_5XX, NETWORK_ERROR, INVALID_JSON, SCHEMA_INVALID, UNGROUNDED, NON_DISTINCT, HANG) exercised; 9 downstream-rejected candidates.
- Choice gate maxActive per provider = 1 as configured.
- Stale V4 fencing: pre-kill tuple captured, RETRY_WAIT/RUNNING_CHOICES/EXPIRED state asserted, stale V4 rejected with `GENERATION_JOB_NOT_RUNNING`.

Final-head soak:30 details:
- 30/30 published, 1 SIGKILL recovery.
- `proseFingerprintIdentical: true`, `proseAttemptCountIdentical: true`, `proseCandidateCalls: 0` — **zero prose regeneration due to choice failure**.
- All 10 programmed outcome categories exercised; 29 downstream-rejected candidates.
- Choice gate custom maxActive=2, maxQueued=2 (queue built up as expected under concurrency=2).
- Evidence: 104 records, SHA-256 `911934a820baf4cddf0f28b6d1eee0c9c23c926d1a909b2db2a533e87450a391`.

## Final local gates on HEAD `154ee04`

### Full unit suite

```text
pnpm exec vitest run
exit: 0
test files: 107 passed, 1 skipped (108)
tests: 1288 passed, 1 skipped (1289)
```

Full unit gate is green. Fresh run on final head retained as `.local/final-gates/unit-full-final-20260730.log`.

### Choice-concurrency regression

OpenRouter now inherits `LAKOKU_CHOICE_MAX_ACTIVE` unless explicit `LAKOKU_CHOICE_MAX_ACTIVE_OPENROUTER` set; 9router override preserved. TDD regression: 13/13 tests passed (global OpenRouter inheritance, explicit override, other-provider global, 9router override preservation). Earlier focused regression repeated 5 times at 29/29 each.

### Static and build gates

| Gate | Exit | Fresh result |
|---|---|---:|
| `pnpm run lint` | 0 | PASS, 20 warnings, 0 errors |
| `pnpm run typecheck` | 0 | PASS |
| `pnpm run build` | 0 | PASS (Next.js routes enumerated, all dynamic/static) |
| `pnpm run check:migration-versions` | 0 | PASS on final head `154ee04` |

Fresh evidence retained: `.local/final-gates/build-154ee04.log`, `.local/final-gates/production-soak-hashes-154ee04.log`.

### Full local pgTAP (retained from earlier run — no SQL change after fix)

Local Supabase at `127.0.0.1:55321`; linked DB not used.

```text
pnpm exec supabase test db --local
exit: 0
files: 26
tests: 1362
result: PASS
```

Retained `.local/final-gates/pgtap-full-20260730.log` SHA-256: `3feed8f4cb14f32f190f27df8631ff5bf77ebdb3b887b3b3c3ec5e4beac77da5`.

### Required DB races (retained — no SQL change after fix)

| Race | Exit | Fresh result |
|---|---|---:|
| `generation-publication-lock-order-race.ts` | 0 | V2/V3 enqueue, V3 lifecycle PASS |
| `generation-job-enqueue-race.ts` | 0 | 3/3 PASS |
| `generation-job-claim-race.ts` | 0 | 3/3 PASS |
| `generation-job-recovery-race.ts` | 0 | 3/3 iterations, 2 scenarios each PASS |
| `generation-job-fencing-race.ts` | 0 | 3/3 iterations, 2 scenarios each PASS |
| `generation-checkpoint-fencing-race.ts` | 0 | 2/2 PASS |

### Runtime baseline sentinel

Exit 0, PASS.

## Evidence location and scope

Final-head logs on `154ee04`:

- `.local/final-gates/head-154ee04.log` — SHA marker
- `.local/final-gates/build-154ee04.log` — build PASS
- `.local/final-gates/production-soak-hashes-154ee04.log` — soak:10 and soak:30 result SHA-256 (4238a401, 24ebb56b)
- `.local/worker-soak/4f9f2ad3-.../result.json` — soak:10 PASS
- `.local/worker-soak/1f53ef39-.../result.json` — soak:30 PASS

Retained pre-final logs (no SQL change since recorded):

- `.local/final-gates/pgtap-full-20260730.log`
- `.local/final-gates/unit-full-final-20260730.log`
- `.local/final-gates/lint-final-20260730.log`
- `.local/final-gates/typecheck-final-20260730.log`
- `.local/final-gates/race-*-20260730.log`
- `.local/final-gates/runtime-baseline-sentinel-20260730.log`

All logs and soak artifacts are local-only, ignored, mutable workspace evidence. Not committed, not remote CI, not linked-DB, not deployment.

## Completion classification

- All Phase A/B/C commits: committed and pushed, remote synced (0 ahead, 0 behind).
- Full pgTAP: PASS (26 files / 1362 tests).
- Runtime baseline sentinel: PASS.
- All six required generation DB race scripts: PASS.
- Typecheck: PASS.
- Lint: PASS (20 warnings, 0 errors).
- Build: PASS on final head `154ee04`.
- Migration version uniqueness: PASS on final head `154ee04`.
- Full unit suite: PASS (107 files / 1288 tests on final head `154ee04`).
- Choice-concurrency regression: PASS (13/13).
- **Final-head soak:10**: PASS — 10/10 published, 1 SIGKILL recovery, zero prose regeneration due to choice failure.
- **Final-head soak:30**: PASS — 30/30 published, 1 SIGKILL recovery, zero prose regeneration due to choice failure, per-provider choice concurrency bounded at 2, queue observed >0.
- Stale V4 fencing: proven — pre-kill tuples rejected.
- Provider A→B fallback: exercised in both profiles.
- Production: **HOLD**.
- Production generation worker: **OFF** pending explicit rollout approval.
- Deploy and linked DB push: **NOT RUN**.

## Verdict

**PRODUCTION HOLD — ROLLOUT APPROVAL REQUIRED.**

Known implementation defect: NONE OPEN.
Implementation: COMPLETE.
All requested final-head gates on SHA `154ee04`:
- Build: PASS
- Migration versions: PASS
- Soak:10: PASS
- Soak:30: PASS
- Unit (1288): PASS
Full branch committed and pushed (0 ahead, 0 behind).

Keep production generation worker OFF. No deploy, no linked-DB push, no rollout until explicit approval.
