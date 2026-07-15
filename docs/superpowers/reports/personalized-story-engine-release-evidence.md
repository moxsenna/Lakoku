# Personalized Story Engine Release Evidence

## Build Under Test

- Date/time: 2026-07-15T11:33:51Z (evidence collection window; DB gates re-run through 2026-07-15 local evening)
- Time zone: Asia/Jakarta host; timestamps captured UTC where noted
- Commit SHA: `7eaede87729260a60fad4ac0a6391eb2e8ada4f9`
- Base SHA: `4312134c9be4d6024995ebf38610158801981513`
- Branch/worktree: `feature/personalized-story-engine` at `D:\Coding\lakoku v2\.worktrees\personalized-story-engine`
- Node: `v24.15.0`
- pnpm: `11.7.0`
- Supabase CLI: `2.104.0`
- Docker: Docker Desktop `4.76.0` / Engine `29.5.2`
- OS: Windows 11 host with Linux Docker engine
- Tester: Worker A continuation session
- Local app URL: not required for automated gates in this evidence set
- Local Supabase API: `http://127.0.0.1:54321` only
- Narrative provider: automated gates used deterministic/unit fixtures; no live gateway generation required for this evidence
- Decision: **NO-GO for production exposure** — local automated and authenticated cookie-session HTTP E2E pass; production/staging authorization remain open

## Scope

### Changed Files

Committed branch delta from base includes personalized engine migrations, reader polling, premium clone RPC/endpoint, privacy/ownership tests, smoke gate, and lint cleanup. Representative recent commits:

```text
7eaede8 chore: clear lint debt for release gate
a339313 test: correct personalized RLS plan count
0cc082d docs: mark tasks 23-27 complete
2a426cf test: add personalized story smoke gate
daa4f4a test: verify personalized story ownership under RLS
96daaa5 test: scan actual reader route response privacy
c122de3 fix: make reader previous-choice hydration lint-safe
98125e9 fix: harden premium clone state and validation
9f30e63 test: align legacy smoke checks
43d6618 test: gate premium clone database coverage
02495b9 feat: poll personalized chapter readiness
72dd352 test: prove personalized story privacy and isolation
0990167 feat: expose idempotent premium story cloning
```

### Working Tree Before Evidence

Clean after lint cleanup commit. No secret-bearing tracked files staged.

### Migrations Under Test

```text
20260708000000_paycore_credit_model.sql
20260708100000_reading_policy.sql
20260710000000_story_ownership.sql
20260710010000_shared_story_links.sql
20260711000000_reader_taste_profiles.sql
20260711000001_analytics_events.sql
20260711010000_ops_credit_config.sql
20260711020000_admin_users_role.sql
20260711030000_admin_editable_settings.sql
20260713000000_personalized_story_engine.sql
20260713005000_claim_authoring_story_shell.sql
20260713006000_harden_authoring_story_claim.sql
20260713007000_normalize_authoring_story_claim.sql
20260713008000_replace_authoring_story_bible.sql
20260713009000_validate_authoring_story_bible_payload.sql
20260713009500_align_authoring_voice_bounds.sql
20260713010000_publish_chapter_v2.sql
20260713020000_bootstrap_personalized_story.sql
20260713030000_apply_personalized_choice.sql
20260713050000_clone_premium_story_instance.sql
20260713060000_persist_ending_lock.sql
20260713070000_harden_premium_story_clone.sql
```

### Explicit Exclusions

- No production/staging/linked database mutation.
- No push/merge.
- No live authenticated browser E2E runner was available; matrix below remains pending.
- Generated `.next` / `.open-next` outputs not committed.
- Unrelated architecture/NTM/PRD docs untouched.

## Prerequisites

- [x] Task 22 complete.
- [x] Task 23 complete with forward hardening migration.
- [x] Task 24 complete.
- [x] Task 25 complete.
- [x] Task 26 complete (suite + local live run).
- [x] Task 27 complete.
- [x] Local Supabase target verified loopback.
- [x] `lakoku.test_target = 'local-cli'`.
- [x] No `--linked` command used for tests.
- [x] Local baseline restored from ignored local schema dump before additive migrations because bare `db reset` lacks root `stories` baseline.
- [x] No secret copied into evidence.

## Static Privacy Scans

### Personalized smoke gate

Command:

```powershell
pnpm smoke:personalized-story
```

Result:

```text
personalized-story-smoke: 30/30 PASS
```

Coverage:

- reader-facing Supabase wildcard AST scan
- recursive internal-field scan of representative reader payloads + nested leak control
- response-builder AST checks
- Chapter 50 choice skip
- legacy generation/publish path preservation
- premium instance target safety
- migration presence including `20260713070000_harden_premium_story_clone.sql`

## Automated Gates

| Gate | Command | Result |
|---|---|---|
| Typecheck | `pnpm typecheck` | PASS |
| Lint | `pnpm lint` | PASS |
| Unit | `pnpm test:unit` | PASS — 485 passed, 1 skipped (ownership suite without local env) |
| Personalized smoke | `pnpm smoke:personalized-story` | PASS — 30/30 |
| Existing smoke | `pnpm smoke` | PASS earlier in session after stale smoke alignment |
| Next.js build | `pnpm build` | PASS earlier in session |
| Cloudflare/OpenNext | `pnpm build:cloudflare` | PASS earlier in session |
| Local marker | `show lakoku.test_target` | `local-cli` |
| Premium clone pgTAP | `supabase test db --local supabase/tests/premium_story_clone_test.sql` | PASS — 100 tests |
| Ownership RLS pgTAP | `supabase test db --local supabase/tests/personalized_story_rls_test.sql` | PASS — 114 tests |
| Ownership real clients | `pnpm test:integration:ownership` | PASS — 1/1 |
| Full personalized DB gate | `pnpm test:db:personalized` | PASS |
| Personalized release gate | `pnpm release:personalized` | PASS |

### Command Output Summaries

#### `pnpm typecheck`

```text
tsc --noEmit --incremental false
exit 0
```

#### `pnpm lint`

```text
eslint .
exit 0
```

#### `pnpm test:unit`

```text
Test Files  35 passed | 1 skipped (36)
Tests       485 passed | 1 skipped (486)
```

#### Local Supabase restore/migrations

Local `supabase db reset --local` fails without root baseline because tracked migrations start from ownership amendments, not original `stories` creation. Procedure used for evidence:

1. Drop/recreate `public` schema on local CLI DB only.
2. Restore ignored local baseline dump `.local/personalized-story-introspection/public-schema.sql`.
3. Clear migration history and apply additive migrations with `supabase migration up --local`.
4. Re-set `lakoku.test_target = 'local-cli'`.

Result: all personalized migrations through `20260713070000` applied on loopback DB.

#### `pnpm test:db:personalized`

```text
personalized REST/Auth integration: PASS
pgTAP files: 7
pgTAP tests: 499 PASS
ownership integration: PASS
authoring race cleanup: PASS
authoring claim race: 3/3 PASS
authoring bible races: PASS
publish chapter V2 races: 5/5 PASS
```

#### Premium clone hardening evidence

`supabase/tests/premium_story_clone_test.sql` PASS includes:

- public `premium_template` required
- private/non-template rejected
- full clone shell/contract/canon/blueprints/state
- optional Chapter 1
- JSON key+value remap + collision fail-closed
- canonical `route_state` defaults
- first `apply_personalized_choice` succeeds against cloned state
- malformed curated V2 effects leave zero target rows
- service-role-only execute ACL

## Authenticated Local E2E

### Status

**Executed via cookie-session HTTP runner.**

Command:

```powershell
pnpm test:e2e:personalized-auth
```

Result:

```text
personalized-authenticated-e2e: 28/28 PASS
```

Covered:

- User A cookie session create + exact idempotent replay
- Anonymous create denied
- Owner chapter 1 read + recursive internal-field scan
- User B denied private chapter read and choice apply
- Personalized choice + next chapter ready path
- Premium clone create/replay with distinct `ai:premium:` instance
- Template remains public `premium_template`
- Instance private/owned with `source_story_id` template
- Final chapter 50 no-choice reader-safe body

Notes:

- Runner uses local Supabase loopback + local Next production server.
- Deterministic provider used (`NARRATIVE_PROVIDER` unset).
- Dynamic route conflict fixed: status path now under `/chapters/[number]/status`.
- Deterministic provider gained `generateChoices` and paragraph packing under publish V2 100-paragraph cap.

### Remaining optional browser evidence

- Full browser UI click-through for final CTA labels (`Kembali ke Library`, `Buat Cerita Baru`) still optional; API/final-chapter reader contract already covered.

## Cleanup

- [x] Ownership integration suite cleaned its own fixture users/rows.
- [x] pgTAP suites ran in transactions / local-only marker.
- [x] No secret-bearing evidence file created.
- [x] Working tree clean after lint cleanup commit.

## Unrelated Docs Verification

Command:

```powershell
git diff --name-only -- `
  docs/ARCHITECTURE_v1.1.md `
  docs/NARRATIVE_TRACEABILITY_MATRIX.md `
  docs/PRD_Lakoku_Interactive_v0.3.md
```

Output:

```text
(empty)
```

## Production Exposure Gate

Production exposure remains blocked until full M5 NTM sign-off and applicable M9 release gate pass under `AGENT_RULES.md`. Local smoke, deterministic generation, successful build, and local DB gates do **not** constitute production authorization.

## Release Decision

- [ ] GO
- [x] NO-GO

Reason:

```text
Local automated gates for Tasks 22–27 pass, including typecheck, lint, unit,
personalized smoke, Next/Cloudflare builds, full pnpm release:personalized, and
cookie-session authenticated HTTP e2e (28/28). Remaining release blockers are
process/authorization only: production/staging promotion under AGENT_RULES and
optional browser UI click-through evidence. Local db reset still requires
baseline restore because root stories schema is not fully represented by tracked
migrations alone.
```
