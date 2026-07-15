# Personalized Story Engine — Staging Runbook

**Branch:** `feature/personalized-story-engine`  
**PR:** https://github.com/moxsenna/Lakoku/pull/18  
**Target:** staging/integration only (not production GO)

## 0) Safety

- Never run local-only scripts against production.
- Never use `lakoku.test_target=local-cli` on staging/production DBs.
- Prefer additive migration apply against existing staging baseline.
- Keep app rollback path ready before migration.

## 1) Apply migrations in order

Confirm baseline already has core tables (especially `public.stories`).

Then apply additive personalized migrations in timestamp order:

```text
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

If using Supabase CLI against staging project:

```bash
# only after confirming CLI is pointed at staging, not production
pnpm exec supabase db push
# or ordered migration up equivalent for the staging target
```

After migrations:

1. Restart/reload PostgREST schema cache if staging requires it.
2. Verify key objects exist:
   - tables: `story_generation_contracts`, `story_creation_requests`, personalized choice tables
   - RPCs: `publish_chapter_v2`, `apply_personalized_choice`, `clone_premium_story_instance`, `persist_ending_lock_v1`

## 2) Seed public demo + premium template

### Demo public (`demo:` prefix)

Explore filter requires:

```text
visibility = public
id like demo:% or premium:%
```

Seed at least:

- `demo:staging-public` (or reuse existing demo)
- chapter 1 with choices
- chapter 2 no-choice optional for final-like checks

### Premium template (`premium:` prefix)

Seed a cloneable template with:

- `story_mode = 'premium_template'`
- `visibility = 'public'`
- `total_chapters = 50`
- `story_generation_contracts.mode = 'premium_template'`
- exactly 50 chapter blueprints (1..50)
- optional curated chapter 1 + valid V2 outcomes

## 3) Deploy app build to staging

Deploy this PR’s app build to staging only.

Required env (staging values):

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Do not set `NARRATIVE_PROVIDER=gateway` unless staging intentionally tests live model routing.

## 4) Run gates against staging-equivalent target

If staging allows local-like CLI gates, run:

```bash
pnpm release:personalized
pnpm test:e2e:personalized-auth
```

If authenticated e2e is local-loopback-only by design, run the same flow manually/API-assisted on staging:

1. login User A
2. `POST /api/stories/personalized` with `Idempotency-Key`
3. open chapter 1
4. submit choice
5. poll `/api/stories/{id}/chapters/{n}/status`
6. open next chapter
7. open final chapter and confirm no choices + completion CTAs
8. clone premium template and replay same key
9. confirm User B cannot read User A private story/chapter

## 5) Isolation checklist

- User A private story readable by A
- User B denied A private detail/chapter
- anon denied A private detail/chapter
- Explore does not list private personalized stories
- premium template remains public after clone
- premium instance is private and owned by cloner

## 6) Rollback plan

### App rollback
- Redeploy previous staging app build that does not depend on new personalized endpoints.

### DB rollback posture
- These migrations are additive.
- Prefer feature-flag/app rollback first.
- Do not drop personalized tables/RPCs on staging unless explicitly approved.
- If must reverse:
  1. stop app traffic to personalized endpoints
  2. restore previous app
  3. leave additive schema in place unless destructive rollback is explicitly authorized

## 7) Production approval gate

Only after all below are true:

- [ ] Staging migrations applied cleanly
- [ ] Demo + premium seeds verified
- [ ] release/e2e/smoke green on staging
- [ ] isolation checks green
- [ ] rollback path documented and accepted
- [ ] NTM/M9 explicit production sign-off recorded

Until then: **no production merge/deploy approval**.
