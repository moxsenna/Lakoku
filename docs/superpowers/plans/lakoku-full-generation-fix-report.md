# Lakoku Full Generation Fix — Agent Report

**Branch:** `fix/generation-reliability`  
**Worktree:** `.worktrees/fix-generation-reliability`  
**Baseline:** `c3133ef`  
**Head:** (see git log on branch)  
**Date:** 2026-07-24  

## Commits

| SHA | Message |
|-----|---------|
| `b151d0d` | fix(safety): stop creative-direction contract wipe and harden observability |
| `b1ab3e7` | feat(choices): choice protocol V2 creative draft + deterministic finalizer |
| `90c6d1f` | feat(generation): mode dispatch, choice reliability, checkpoint foundation |
| `1b8691d` | docs: generation reliability fix report |
| *(latest)* | feat(generation): wire PROSE_READY choice-only resume path |

## Root causes

| ID | Root cause | Bukti | Dampak | Fixed by |
|----|------------|-------|--------|----------|
| RC1 | Creative direction fallback upsert empty `story_generation_contracts` | `persist-creative-direction.ts` wrote `{}` on dedicated-table fail | Valid contracts wiped | B1 remove fallback; typed errors |
| RC2 | Duplicate migration version `20260722090000` | Two SQL files same prefix | Supabase version collision | Rename + uniqueness checker + repair migration |
| RC3 | Choice prompt pseudo-JSON + full mechanical schema | `buildChoiceSystemPrompt` | High invalid JSON / schema fail | Protocol V2 draft + finalizer |
| RC4 | Repair dumps finding codes into `mustNotInclude` | `choice-generation.ts` repair path | Provider error codes as narrative constraints | `buildChoiceRepairNotes` |
| RC5 | No choice concurrency gate | Overall gate 6 only | Choice provider stampede after prose | `choice-concurrency.ts` |
| RC6 | `startOwnedChapterGeneration` always standard | Always `generateNextChapterReal` | Personalized retry wrong path | `runChapterGenerationAttempt` |
| RC7 | Double terminal failure on choice leak | Outer catch after recorded throw | Duplicate UNKNOWN events | `GenerationStageError` / `isFailureRecorded` |
| RC8 | No PROSE_READY durability | Choices fail discards valid prose | Full regen on choice fail | Checkpoint table + helpers (foundation) |
| RC9 | Post-publish telemetry could surface as failure | Missing best-effort wrap on success path | Success → exception | `bestEffort` on publish path |

## Perubahan file (ringkas)

| Area | File | Alasan |
|------|------|--------|
| Safety | `lib/authoring/persist-creative-direction.ts` | No contract wipe |
| Safety | `lib/api/authoring-lock.server.ts` | Fail lock when direction required |
| Safety | `scripts/check-migration-version-uniqueness.ts` | Guard duplicates |
| Safety | `supabase/migrations/20260722090001_*` + `20260724100000_*` | Unique versions + reconcile |
| Choices V2 | `lib/ai-gateway/choice-draft-v2.ts` | Schema + finalizer + prompt |
| Choices V2 | `lib/ai-gateway/gateway.ts` | Accept V2 draft shape |
| Choices V2 | `lib/ai-gateway/gateway-provider.ts` | Valid JSON prompt; generateText; 90s |
| Reliability | `lib/runtime/choice-concurrency.ts` | Per-provider gate |
| Reliability | `lib/runtime/choice-error-taxonomy.ts` | Retry matrix + repair notes |
| Reliability | `lib/runtime/choice-generation.ts` | Gate + real repair |
| Dispatch | `lib/runtime/generation-mode.ts` | Mode resolve + dispatch |
| Dispatch | `lib/api/start-chapter.server.ts` | Dispatcher + attemptId |
| Dispatch | `app/api/stories/[id]/generate/route.ts` | Dispatcher |
| Durability | `lib/runtime/chapter-generation-checkpoint.ts` | Fingerprints + status map |
| Durability | `supabase/migrations/20260724110000_chapter_generation_checkpoints.sql` | Table |
| Ops | `docs/runbooks/generation-diagnosis.md` | Diagnosis |
| Ops | `scripts/sql/audit-empty-generation-contracts.sql` | Read-only audit |

## Choice protocol

```text
old AI output (full ChoiceBranch + effects)
→ new AI creative draft (question + 2 actions + intent)
→ finalizeAiChoiceDraft (IDs, nextChapter, effects)
→ existing ChoiceBranch publish contract
→ validateChoiceBranch / publishChapterV2 unchanged for reader
```

## Retry matrix

| Error | Retry | Repair | Fallback | Terminal |
|-------|-------|--------|----------|----------|
| TIMEOUT / RATE_LIMITED / 5XX / NETWORK | transient_retry (1) | — | next provider | after budget |
| INVALID_JSON / SCHEMA_INVALID | — | structural_repair | structured provider | after budget |
| CONTENT_REJECTED | — | content_rewrite | next provider | after budget |
| QUALITY_* | — | quality_repair | — | REPAIR_EXHAUSTED |
| UNKNOWN | — | — | next_provider | chain exhausted |

## Checkpoint proof

Helpers + sync path:

- stable `proseFingerprint`
- choice job key reuses same prose fingerprint
- expired / wrong status not usable for choice-only retry
- reader copy nontechnical (`preparing_choices`)
- **`generateNextChapterRealInner`**: load usable checkpoint → skip `generateChapter` → `fromCheckpoint: true`
- choice fail → `CHOICES_RETRY_WAIT` (prose retained)
- publish success → `PUBLISHED`

Policy matrix unit test: `prose: 1, choice: 3, publish: 1`.

**Still not run:** live fake-provider soak / multi-process worker claim.

## Mode dispatch proof (unit)

| Case | Result |
|------|--------|
| no contract | standard |
| personalized_ai | personalized |
| invalid personalized-like mode | GENERATION_CONTRACT_INVALID |
| start-chapter after() | `runChapterGenerationAttempt` |
| generate route | dispatcher |

## Test output (targeted)

Commands run on worktree:

```bash
pnpm typecheck                          # exit 0
pnpm run check:migration-versions       # exit 0
pnpm exec vitest run \
  tests/ai-gateway/choice-prompt-contract.test.ts \
  tests/ai-gateway/choice-structured-output.test.ts \
  tests/runtime/choice-generation-repair.test.ts \
  tests/runtime/choice-checkpoint.test.ts \
  tests/runtime/choice-concurrency.test.ts \
  tests/runtime/generation-mode-dispatch.test.ts \
  tests/runtime/story-generation-observability.test.ts \
  tests/authoring/persist-creative-direction.test.ts \
  tests/db/migration-version-uniqueness.test.ts \
  tests/api/authoring-lock-start.test.ts \
  tests/authoring/generation-route-authorization.test.ts \
  tests/authoring/actions-authorization.test.ts
```

Expected: all listed files green (41+ tests across reliability suite).

## Database

| Item | Status |
|------|--------|
| New migrations | `20260724100000_reconcile_...`, `20260724110000_chapter_generation_checkpoints` |
| Duplicate version | `story_creative_directions` → `20260722090001_*` |
| Local reset / db tests | **Not run** (no local supabase push this session) |
| Linked dry-run | **OK** (2026-07-24) — would push 4 local-only versions |
| Production migration | **Applied** (user terminal, 2026-07-24) — 4 versions pushed |
| Data audit | Script ready; production counts unknown |

### Linked dry-run evidence (user terminal)

```text
Would push these migrations:
 • 20260722090001_story_creative_directions.sql
 • 20260723010000_ai_model_route_reasoning_effort.sql
 • 20260724100000_reconcile_choice_routes_and_creative_direction.sql
 • 20260724110000_chapter_generation_checkpoints.sql
```

`migration list --linked` (tail):

| Local | Remote | Meaning |
|-------|--------|---------|
| `20260722090000` | `20260722090000` | Already remote — was **align_choices** (policy + choices route), not creative_directions |
| `20260722090001` | *(empty)* | Local creative_directions rename — **not** on remote yet |
| `20260723010000` | *(empty)* | reasoning_effort column |
| `20260724100000` | *(empty)* | idempotent reconcile |
| `20260724110000` | *(empty)* | checkpoints |

SQL probes (user dashboard):

- `to_regclass('public.story_creative_directions')` → **NULL** (table missing)
- `to_regclass('public.chapter_generation_checkpoints')` → **NULL** (table missing)

**Interpretation:** Remote only applied the old dual-prefix winner (`align_choices`). Creative directions never landed. Rename to `…90001` is **safe** (not a re-apply of applied creative_directions). Repair + checkpoint migrations create missing objects with `if not exists`.

**Config note:** CLI warned local `major_version` differs; linked project is PG 17. `supabase/config.toml` still has `major_version = 15` — fix before local DB work; not a blocker for linked push of these SQL files.

**Push result (applied):**

```text
Applying migration 20260722090001_story_creative_directions.sql...
NOTICE: relation "story_creative_directions" already exists, skipping
Applying migration 20260723010000_ai_model_route_reasoning_effort.sql...
NOTICE: column "reasoning_effort" ... already exists, skipping
Applying migration 20260724100000_reconcile_choice_routes_and_creative_direction.sql...
Applying migration 20260724110000_chapter_generation_checkpoints.sql...
Finished supabase db push.
```

All four versions recorded; idempotent notices expected for objects already present.

## Soak result

| N | Overall | Choice | Initial | Eventual | Invalid JSON | Timeout | Prose regen | Publish |
|---|---------|--------|---------|----------|--------------|---------|-------------|---------|
| — | — | — | **not run** | **not run** | — | — | — | — |

Release gate 30/30 eventual publish **not claimed**.

## Remaining risks / follow-up

1. **Async choice job worker** still optional: sync path already resumes from PROSE_READY without prose regen; true background CHOICES job enqueue/claim not fully productized.
2. **Attempt durable table:** `attemptId` currently = `correlationId`; not full `generation_jobs` QUEUED-before-STARTED unless job enqueue path used.
3. **Status API attempt-aware:** reader status helpers added; chapter status route may still prefer latest story_event failure — needs route integration.
4. **Native structured `Output.object`:** V2 schema ready; provider still JSON-prompt + parse (generateText). Native schema capability flag not DB-wired.
5. **Production empty-contract audit** not executed.
6. **Linked migration push** applied 2026-07-24 (4 versions).
7. Provider external dependency remains primary reliability risk.

## Deployment

- Commit SHA deployed: `feda39a` (`fix/generation-reliability`)
- VPS: `/opt/lakoku`, container `lakoku-web`
- Backup: `/opt/lakoku.old.20260724155013`
- Image rebuild: `docker compose up -d --build` OK
- Health: `http://127.0.0.1:5200/` → **200**, `https://lakoku.biz.id/` → **200**, status **healthy**
- `.env` preserved
- Neighbors (caddy/9router/publiora) still up
- Migration: **pushed linked** (20260722090001, 20260723010000, 20260724100000, 20260724110000)
- DB probe: `chapter_generation_checkpoints` present

## Definition of Done (plan §32)

Integrated flow **not fully proven**:

```text
durable attempt → mode dispatch → prose → PROSE_READY → choices fail → retry
→ publish → status ready → reader
```

Unit/foundation coverage for each stage exists; end-to-end soak + worker split remaining.

## How to continue

```bash
cd "D:/Coding/lakoku v2/.worktrees/fix-generation-reliability"
pnpm test:unit   # full unit
# After approval:
pnpm exec supabase db push --linked --dry-run
# Wire choice-only job in story-generation after prose validation
# Soak: scripts/m5-soak or e2e-real-generation with fake provider matrix
```
