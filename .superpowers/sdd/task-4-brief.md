# Task 4 — CLI Audit Scripts (`scripts/m10-*.ts`)

## Context
M10-A Story Bible dataflow audit (branch `audit/m10-a-story-bible-dataflow`, base `b7961311cf70b91cb7245149e400075c4e454d74`). Detectors committed at lib/narrative-qa/ (372283a), tests at tests/narrative-qa/ (601ffde). Your scripts turn those pure detectors into CLI executables per the repo's official runner pattern.

## Constraints (binding)
- Scripts only: `scripts/m10-story-bible-audit.ts` and `scripts/m10-context-pressure-audit.ts`. No other file changes. No commits. No new deps.
- Audit CLI contract (user-approved): script output must separate `executionStatus` (SUCCESS/ERROR) from `auditVerdict` (PASS/HOLD). Exit code: 0 on SUCCESS regardless of findings (BLOCKER findings are VALID audit output); non-zero ONLY for auditor failure (crash, invalid schema/evidence catalog, artifact generation failure, scope violation).
- Machine-readable artifacts: write JSON to `.zcode/artifacts/m10-a/audit.json` (m10-story-bible-audit.ts) and `.zcode/artifacts/m10-a/context-pressure.json` (m10-context-pressure-audit.ts). `.zcode/` is git-ignored — verify by checking .gitignore; artifacts are local-only, never committed.
- Pure/deterministic only: reuse lib/narrative-qa entrypoints (runStoryBibleAudit, buildContextPressureReport, etc.) and fixtures (fixtures/long-horizon/story-bible-pressure.ts). NO server-only imports, NO DB, NO env, NO network, NO real model calls.
- Match repo script conventions: look at scripts/run-smoke.cjs to see how scripts are executed (`node scripts/run-smoke.cjs <script.ts>`), and look at 1-2 existing scripts in scripts/ (e.g. scripts/*-smoke.ts) for import style, console output conventions, process exit patterns. CJS-style scripts are exempt from no-require-imports — but these are TS scripts run through the smoke runner, so follow the TS script conventions in scripts/.
- Evidence in findings must keep `file :: symbol + observation` format; do not strip or mutate findings from detectors.

## Deliverables
1. `scripts/m10-story-bible-audit.ts`:
   - Assemble synthetic inputs from fixtures (49 choices via generateSyntheticChoices, canon snapshots at milestones 10/20/30/40/45/50 via buildSyntheticCanonSnapshot, story contract via buildSyntheticStoryContract) + hypothesis flags (e.g. retrievalLogInvoked: false, validatorReceivesDraftSignals: false) into the input groups expected by runStoryBibleAudit (check its signature in lib/narrative-qa/story-bible-audit.ts).
   - Run audit, print to stdout: executionStatus, auditVerdict, summary counts (blocker/high/medium/low/info/total), and the full finding list (code, severity, domain, status) — keep output compact and readable.
   - Write `.zcode/artifacts/m10-a/audit.json` containing the full AuditReportArtifact.
   - Exit 0 on SUCCESS; exit 1 with error message on auditor failure (wrap in try/catch).
2. `scripts/m10-context-pressure-audit.ts`:
   - Build context samples for milestones 1/10/20/30/35/40/45/48/49/50 (buildSyntheticCanonSnapshot grows facts/threads/timeline/rollups with chapter — adapt into the sample interface expected by analyzeContextSample/buildContextPressureReport; check lib/narrative-qa/context-pressure-audit.ts signatures).
   - Stress cases: totalBudget=4000 with loadBearingCost 900/1500/3000/4500 (construct samples that vary load-bearing fact count/cost to trigger the four stress levels — use the same approach the tests use; check tests/narrative-qa/context-pressure.test.ts and sample-builder.ts for how samples are constructed).
   - Choice history pressure at 10/20/30/40/50 with 49 total choices.
   - Print per-milestone summary table (chapter, declaredBudget, actualUsed, factsIncluded/Excluded, loadBearingIncluded, rollupsIncluded/Excluded, threadsRetained, timelineRetained, writerLayer3CharLength, detectorsTriggered) + choice-history pressure rows + verdict.
   - Write `.zcode/artifacts/m10-a/context-pressure.json` (ContextPressureReportArtifact shape).
   - Exit 0 on SUCCESS; exit 1 on auditor failure.

## Validation (must pass before reporting)
- `node scripts/run-smoke.cjs scripts/m10-story-bible-audit.ts` → prints summary, writes audit.json, exit 0
- `node scripts/run-smoke.cjs scripts/m10-context-pressure-audit.ts` → prints milestone table, writes context-pressure.json, exit 0
- `pnpm typecheck` clean
- `pnpm exec eslint scripts/m10-story-bible-audit.ts scripts/m10-context-pressure-audit.ts` clean
- Verify the two JSON artifacts exist under .zcode/artifacts/m10-a/ and contain valid JSON with the expected fields

## Report
Write report to `.superpowers/sdd/task-4-report.md`: files created, output snippets (verdict, counts, milestone table excerpt), artifact paths + sizes, exact validation commands + results, concerns.

## Return contract (final message)
status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT — plus one-line summary and concerns.