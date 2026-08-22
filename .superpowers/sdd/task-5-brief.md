# Task 5 — Audit Reports (`docs/audits/`)

## Context
M10-A Story Bible dataflow audit (branch `audit/m10-a-story-bible-dataflow`, base `b7961311cf70b91cb7245149e400075c4e454d74`). Detectors (372283a), tests (601ffde), CLI scripts (82a5f0a) committed. Machine-readable results exist at `.zcode/artifacts/m10-a/audit.json` and `.zcode/artifacts/m10-a/context-pressure.json` — READ THEM as the primary data source for the reports. Detector report with full evidence catalog: `.superpowers/sdd/task-2-report.md` (read it — contains the source-of-truth matrix statuses and real production symbols with `file :: symbol` evidence).

## Constraints (binding)
- Create exactly two files: `docs/audits/M10A_STORY_BIBLE_DATAFLOW.md` and `docs/audits/M10A_RISK_REGISTER.md`. No other file changes. No commits? → DO commit nothing; controller commits. Do NOT modify lib/, tests/, scripts/, fixtures/.
- Reports must be SOURCE-BACKED: every claim about the runtime must cite `file :: symbol + observation` (path + symbol, not line numbers). Every status must come from the committed matrix/detector output — do not invent statuses.
- Verdict semantics (user-approved): M10-A EXECUTION: SUCCESS; M10-A VERDICT: HOLD if any BLOCKER/HIGH finding exists, else PASS. Derive from .zcode/artifacts/m10-a/audit.json (executionStatus/auditVerdict/summary). Do not soften BLOCKER/HIGH findings. Do not recommend fixes beyond the "recommended narrow fix" column — M10-A does NOT fix.
- No production secrets, no log payloads, no raw DB dumps. Allowed codes only (detector codes are allowlisted by construction).
- Language: Bahasa Indonesia for prose (repo convention), technical terms/EN codes kept as-is.
- The plan is the report spec: read docs/superpowers/plans/M10A_STORY_BIBLE_DATAFLOW_AUDIT_PLAN.md §16 (report structure), §17 (severity rules), §21 (definition of done), §22 (deliverables).

## Deliverable 1: `docs/audits/M10A_STORY_BIBLE_DATAFLOW.md`
Must contain these 16 sections (plan §16):
1. Executive Summary — one page max: objective, method (source discovery → evidence catalog → characterization → detector → test → report), verdict (EXECUTION/VERDICT), headline findings count, recommendation (M10-A PASS/HOLD + stop-before-M10-B statement if HOLD)
2. Production Baseline SHA — exact base b7961311cf70b91cb7245149e400075c4e454d74 + branch + head SHA of this audit (check git log -1)
3. Story Bible Architecture — diagram/flow (Story Contract → Persistent Story Bible → CanonSnapshot → Context selection/compression → ChapterBrief → ContinuationContext → PreProseBrief → Planner → Writer Prompt → Draft → Validators → Publish → State/Canon evolution → next chapter) with real module names
4. Source-of-Truth Matrix — the 17-domain matrix from lib/narrative-qa/story-bible-audit.ts MATRIX_ROWS / buildSourceOfTruthMatrix() output (run `node scripts/run-smoke.cjs scripts/m10-story-bible-audit.ts` or read audit.json matrix) — present as tables with status + key evidence
5. Creation Paths — who creates each domain (e.g. authoring compile seeds act rollup; contract-persistence writes canon rows)
6. Mutation Paths — every write path found: publish_generation_job_chapter_v4 (worker, with plot debt closures + ending lock), publishChapterV2 (sync, no ending lock), persist_ending_lock_v1, reader_plot_debt_closures ledger insert, direct INSERT/UPDATE/UPSERT wrappers; which tables each touches
7. Read/Compilation Paths — loader.ts :: loadCanonSnapshot tables; compiler.ts :: compileContext budget allocation; continuation-context.server.ts :: loadContinuationContextForChapter; chapter-brief.ts :: buildChapterBrief; pre-prose-brief.ts; gateway.ts; gateway-provider.ts :: buildPrompt
8. Writer Propagation — per StoryContract field (corePromise, mainConflict, finalQuestion, chapterTargets[n], emotionalTurn, expectedThreadMovement, plotDebts, endingCandidates, closureRunway): persisted? selected? compressed? propagated? prompt-visible? validator-enforced? write-back aware? Use propagation-audit findings + task-2-report evidence
9. Validation Coverage — validator matrix: which validators exist per domain (validateThreadLifecycle, auditPlotDebts, continuity checks, ending-resolver constraints, v4 RPC SQL validations DEBT_CLOSURE_DEADLINE_VIOLATION etc.) and what they actually receive (thread signals hardcoded empty — THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED)
10. Publish/State Evolution — worker v4 vs sync v2 differences; plot debt ledger insert on conflict do nothing; checkpoint transition; reader state updates
11. Worker vs Legacy Parity — per plan §11 domains: plot debt closure, ending lock, reader state, chapter, choice outcomes, checkpoint, canon delta, thread state, timeline state, fact state — each labeled PROVEN_READ_ONLY/PARITY_RISK/AMBIGUOUS with evidence (no live DB mutation was performed — M10-A constraint; real parity proof deferred to M10-C)
12. Chapter 45–50 Finalization — ending lock lifecycle (44 null → 45 lock → 46–50 cannot switch; retry divergence detector), chapter 50 reconciliation characterization (FINAL_STATE_RECONCILIATION_GAP etc.)
13. Context Pressure Results — from context-pressure.json: milestone table (1/10/20/30/35/40/45/48/49/50), stress cases 900/1500/3000/4500 with totalBudget 4000, choice-history pressure 10/20/30/40/50, key detectors (CONTEXT_DECLARED_BUDGET_OVERSHOOT, LOAD_BEARING_PRESSURE, RELEVANT_FACT_EVICTION, ROLLUP_EVICTION_PRESSURE, CHOICE_HISTORY_*)
14. Proven Gaps — the BLOCKER/HIGH findings with CODE, observed vs expected behavior, exact source evidence, chapter range affected, recommended narrow fix (from audit.json findings + task-2-report)
15. Unknown / Unproven Paths — statuses AMBIGUOUS/CONSUMER_UNPROVEN/WRITE_PATH_UNPROVEN/DEAD_PATH_CANDIDATE rows; what would prove them (M10-C isolated DB harness)
16. Follow-up PR Recommendations — ordered list of narrow follow-up PRs (NOT performed in M10-A), each with scope, affected files, and why it's outside audit mandate

## Deliverable 2: `docs/audits/M10A_RISK_REGISTER.md`
Table per plan §16: | Severity | Code | Domain | Evidence | Effect at Chapter 50 | Proposed Fix | — one row per finding from audit.json. Plus: verdict summary at top (EXECUTION/VERDICT), counts, and a short legend of severity definitions from plan §17. All findings from audit.json — do not add or remove.

## Validation
- `node scripts/run-smoke.cjs scripts/m10-story-bible-audit.ts` (regenerate audit.json if needed) and cross-check every finding code + severity in the reports matches the artifact.
- `node scripts/run-smoke.cjs scripts/m10-context-pressure-audit.ts` for context numbers.
- `git status` — only the two docs files added.

## Report
Write report to `.superpowers/sdd/task-5-report.md`: files created, verdict derived, findings counts, section-by-section completeness note, validation results, concerns. Do NOT commit.

## Return contract (final message)
status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT — plus one-line summary and concerns.