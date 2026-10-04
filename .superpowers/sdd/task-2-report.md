# Task 2 Report: Adaptasi migrasi + runner + replay fresh ke Neon

## Implementation Overview
Adapted all 91 source migrations from `supabase/migrations/*.sql` to `neon/migrations/*.sql`. Implemented deterministic one-way transformer `scripts/adapt-supabase-migrations.mjs` and idempotent runner `scripts/neon-migrate.mjs`. Verified clean replay and idempotency against target Neon database (`neondb`), validated strict grep gate (= 0), generated structural diff report (`neon/STRUCTURAL_DIFF.txt`), and documented adaptation notes (`neon/ADAPTATION_NOTES.md`).

## Transformer Design Decisions
1. **Multi-Character Dollar-Quote Parsing:**
   - Robust tag matching: State machine tracks `$([a-zA-Z0-9_]*)\$`, handling standard `$$` and arbitrary identifier tags (such as `$baseline_ddl$`, `$func$`, `$_$`, etc.).
   - Character scanner separates statements by `;` outside of single-line comments (`--`), nested multi-line comments (`/* ... */`), single-quoted strings (`'...'` with `''` escape), double-quoted identifiers (`"..."` with `""` escape), and dollar-quoted blocks.
2. **Statement Dropping without Multiline Regex Pitfalls:**
   - Regex patterns in `DROP_PATTERNS` omit `/m` flag and evaluate against statement text stripped of leading comments via `getCodeWithoutLeadingComments(stmt)`. This prevents internal keywords (such as `CREATE POLICY` inside PL/pgSQL DO blocks or function bodies) from falsely matching and dropping enclosing blocks.
3. **Preamble Initialization (`BASELINE_PREAMBLE`):**
   - Injected into baseline migration `20260707000000_core_runtime_baseline.sql`.
   - Creates `extensions` schema and installs `btree_gist` and `pgcrypto`.
   - Creates `auth` schema, stub function `auth.uid() returns uuid`, and `auth.users` compatibility table. This satisfies PostgreSQL `LANGUAGE sql` parse-time relation and function validation for downstream functions (`story_is_owned_by_auth`, `e5_is_owner_admin`).

## Files Requiring Non-Mechanical Attention
1. `20260707000000_core_runtime_baseline.sql`:
   - Supabase drift-check wrapper verified privileges using `has_function_privilege('anon', ...)` and `has_function_privilege('service_role', ...)`. These roles do not exist in Neon and throw runtime errors.
   - Transformer extracts the actual schema DDL encapsulated inside `$baseline_ddl$`, prepends `BASELINE_PREAMBLE`, and strips Supabase role grants and policies.
2. `20260718060000_harden_legacy_lifecycle_function_acl.sql`:
   - Contains only `REVOKE` and `GRANT` statements for `public`, `anon`, `authenticated`, and `service_role`. All statements were removed by `DROP_PATTERNS`, resulting in a clean empty no-op file on Neon.
3. `20260824101000_e5_stateless_validator_attestation.sql`:
   - Depends on cryptographic functions `extensions.gen_random_bytes`, `extensions.hmac`, and `extensions.digest`. Resolved by including `CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;` in the baseline preamble.

## Gate Outputs Verbatim

### 1. Grep Gate
Command:
```bash
grep -rliE "create policy|row level security|cron\.|storage\.buckets|references auth\.users" neon/migrations/ | wc -l
```
Output:
```
0
```

### 2. Replay Fresh to Neon
Command:
```bash
node scripts/neon-migrate.mjs
```
Output:
```
apply 20260707000000_core_runtime_baseline.sql ... OK
apply 20260708000000_paycore_credit_model.sql ... OK
apply 20260708100000_reading_policy.sql ... OK
apply 20260710000000_story_ownership.sql ... OK
apply 20260710010000_shared_story_links.sql ... OK
apply 20260711000000_reader_taste_profiles.sql ... OK
apply 20260711000001_analytics_events.sql ... OK
apply 20260711010000_ops_credit_config.sql ... OK
apply 20260711020000_admin_users_role.sql ... OK
apply 20260711030000_admin_editable_settings.sql ... OK
apply 20260713000000_personalized_story_engine.sql ... OK
apply 20260713005000_claim_authoring_story_shell.sql ... OK
apply 20260713006000_harden_authoring_story_claim.sql ... OK
apply 20260713007000_normalize_authoring_story_claim.sql ... OK
apply 20260713008000_replace_authoring_story_bible.sql ... OK
apply 20260713009000_validate_authoring_story_bible_payload.sql ... OK
apply 20260713009500_align_authoring_voice_bounds.sql ... OK
apply 20260713010000_publish_chapter_v2.sql ... OK
apply 20260713020000_bootstrap_personalized_story.sql ... OK
apply 20260713030000_apply_personalized_choice.sql ... OK
apply 20260713050000_clone_premium_story_instance.sql ... OK
apply 20260713060000_persist_ending_lock.sql ... OK
apply 20260713070000_harden_premium_story_clone.sql ... OK
apply 20260717010000_add_9router_provider.sql ... OK
apply 20260717020000_fallback_models_with_provider.sql ... OK
apply 20260718010000_generation_jobs_foundation.sql ... OK
apply 20260718020000_generation_job_enqueue.sql ... OK
apply 20260718030000_generation_job_worker_rpcs.sql ... OK
apply 20260718040000_generation_job_fencing.sql ... OK
apply 20260718050000_generation_choice_enqueue.sql ... OK
apply 20260718060000_harden_legacy_lifecycle_function_acl.sql ... OK
apply 20260718100000_generation_provider_observability.sql ... OK
apply 20260718110000_admin_generation_observability_rpcs.sql ... OK
apply 20260722090000_align_choices_and_runtime_policy.sql ... OK
apply 20260722090001_story_creative_directions.sql ... OK
apply 20260723010000_ai_model_route_reasoning_effort.sql ... OK
apply 20260724100000_reconcile_choice_routes_and_creative_direction.sql ... OK
apply 20260724110000_chapter_generation_checkpoints.sql ... OK
apply 20260724115000_claim_generation_job_by_id.sql ... OK
apply 20260724120000_checkpoint_versioning.sql ... OK
apply 20260724121000_generation_checkpoint_fencing.sql ... OK
apply 20260724122000_generation_job_ending_lock_publication.sql ... OK
apply 20260724123000_generation_publication_lock_order.sql ... OK
apply 20260724124000_generation_checkpoint_audit_signals.sql ... OK
apply 20260728010000_plot_debt_closure_ledger.sql ... OK
apply 20260728020000_checkpoint_audit_signals_v2.sql ... OK
apply 20260728030000_publish_generation_job_chapter_v4.sql ... OK
apply 20260728040000_enqueue_contract_provenance.sql ... OK
apply 20260728050000_publish_generation_job_chapter_v4_common_checkpoint.sql ... OK
apply 20260728060000_harden_checkpoint_audit_and_reconciliation.sql ... OK
apply 20260728070000_correct_audit_validation_and_published_reconciliation.sql ... OK
apply 20260728080000_align_publish_chapter_v2_actionability.sql ... OK
apply 20260731010000_generation_incident_capture.sql ... OK
apply 20260731020000_password_recovery_capabilities.sql ... OK
apply 20260731030000_generation_incident_metadata.sql ... OK
apply 20260802010000_durable_validation_diagnostics.sql ... OK
apply 20260804010000_account_commercial_entitlements.sql ... OK
apply 20260804020000_credit_reservations.sql ... OK
apply 20260805000000_chapter_state_delta_expand.sql ... OK
apply 20260805010000_commercial_generation_intents.sql ... OK
apply 20260805015000_living_canon_publication_primitives.sql ... OK
apply 20260805020000_living_canon_publication_primitives.sql ... OK
apply 20260805021000_story_creation_request_job_binding.sql ... OK
apply 20260805025000_commercial_quote_reactivation.sql ... OK
apply 20260805030000_publish_generation_job_chapter_v6.sql ... OK
apply 20260806010000_commercial_cutover_primitives.sql ... OK
apply 20260808020000_contract_v2_forward_only.sql ... OK
apply 20260818000000_terminal_commercial_finalizer.sql ... OK
apply 20260818000001_terminal_finalization_discovery.sql ... OK
apply 20260818000002_terminal_commercial_finalizer_forward_repair.sql ... OK
apply 20260823100000_e5_blueprint_review_queue.sql ... OK
apply 20260823100100_e5_blueprint_resolutions.sql ... OK
apply 20260823100200_e5_blueprint_audit.sql ... OK
apply 20260823100250_e5_blueprint_validator_proofs.sql ... OK
apply 20260823100300_e5_blueprint_rls.sql ... OK
apply 20260824100000_e5_blueprint_resolution_function.sql ... OK
apply 20260824101000_e5_stateless_validator_attestation.sql ... OK
apply 20260826130000_m10f_ai_model_routes_live.sql ... OK
apply 20260827010000_align_publish_chapter_v2_m10f_imperatives.sql ... OK
apply 20260827120000_seed_m10f_openrouter_pricing.sql ... OK
apply 20260827130000_atomic_runtime_review_enqueue.sql ... OK
apply 20260912220000_add_story_authoring_ai_model_route.sql ... OK
apply 20260915120000_update_chapter_prose_route_gemini31pro.sql ... OK
apply 20260915140000_align_publish_chapter_v2_actionability_lexicon.sql ... OK
apply 20260917000000_dompet_imbalan_referral.sql ... OK
apply 20260917120000_play_billing_channel_model.sql ... OK
apply 20260918000000_gamified_missions_ads.sql ... OK
apply 20260919000000_lakoin_tinta_economy.sql ... OK
apply 20260920000000_story_cover_generation.sql ... OK
apply 20260921000000_push_devices.sql ... OK
apply 20260922000000_story_cover_candidates.sql ... OK
selesai. total tercatat: 91
```

### 3. Idempotency Proof
Command:
```bash
node scripts/neon-migrate.mjs
```
Output:
```
skip 20260707000000_core_runtime_baseline.sql
skip 20260708000000_paycore_credit_model.sql
... (all 91 files skipped)
skip 20260921000000_push_devices.sql
skip 20260922000000_story_cover_candidates.sql
selesai. total tercatat: 91
```

### 4. Structural Diff Summary
From `neon/STRUCTURAL_DIFF.txt`:
- `CREATE TABLE`: 75 in Supabase vs 76 in Neon (+1 delta is `auth.users` compat table in preamble).
- `CREATE FUNCTION`: 166 in Supabase vs 167 in Neon (+1 delta is `auth.uid()` stub function in preamble).
- `CREATE TRIGGER`: 17 in Supabase vs 17 in Neon (exact match, delta 0).
Domain object parity is 100% (75/75 domain tables, 166/166 domain functions, 17/17 domain triggers).

## Self-Review Findings & Concerns
- All 91 migrations adapt and apply cleanly with zero parse or runtime errors.
- Tracking table `neon_schema_migrations` records all applied versions and guarantees idempotency.
- Zero credentials or `.env.local` changes committed.
- Body mentions of `auth.users` remain in functions/views (e.g. `story_readers`, `story_collaborators`) as intended per brief, fully inventoried in `neon/ADAPTATION_NOTES.md` for Task 3 audit.

## Fix round (Task 2 review)

Addressed reviewer findings:
1. Runner now prefers `process.env.DATABASE_URL` if set, falling back to `.env.local` if present, erroring with `'DATABASE_URL tidak ada (env atau .env.local)'` only when both are missing.
2. Runner now supports `neon/bootstrap/*.sql` executed before `neon/migrations/*.sql`.

### Verification

#### 1. Syntax Check
Command:
```bash
node --check scripts/neon-migrate.mjs
```
Output:
```
(clean, exit 0)
```

#### 2. Process Env Only Fallback (Temporary .env.local Removal)
Command:
```bash
mv .env.local .env.local.hold && DATABASE_URL=$(grep '^DATABASE_URL=' .env.local.hold | cut -d= -f2-) node scripts/neon-migrate.mjs && mv .env.local.hold .env.local
```
Output:
```
skip 20260707000000_core_runtime_baseline.sql
... (all 91 files skipped)
skip 20260922000000_story_cover_candidates.sql
selesai. total tercatat: 91
```

#### 3. Standard Local Execution
Command:
```bash
node scripts/neon-migrate.mjs
```
Output:
```
skip 20260707000000_core_runtime_baseline.sql
... (all 91 files skipped)
skip 20260922000000_story_cover_candidates.sql
selesai. total tercatat: 91
```

Commit: `f234f60 fix(neon): runner env fallback and bootstrap directory support`

