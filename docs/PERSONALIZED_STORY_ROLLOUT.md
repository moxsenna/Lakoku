# Personalized Story Reader Rollout

Task 4 reader build supports ownership schema from `20260710000000_story_ownership.sql` and final personalized grants from `20260713000000_personalized_story_engine.sql`.

## Required sequence

1. Confirm ownership migration already applied. Required stable fields: `stories.owner_user_id` and `stories.visibility`.
2. Deploy Task 4 app build. Explore uses `visibility = 'public'` plus stable `demo:` / `premium:` ID prefixes. Reader projections do not reference `story_mode`, `generation_status`, or `story_contract_version`.
3. Wait until previous app instances drain. Both previous and Task 4 builds work against ownership-era schema during this window.
4. Apply `20260713000000_personalized_story_engine.sql`. Migration adds personalized fields and then installs final RLS policies plus exact reader column grants. Do not weaken these grants or policies.
5. Run local preflight and DB gate before production promotion:

   ```bash
   # Local Supabase CLI database only. Never run against linked/staging/production.
   docker exec -u root <local-supabase-db-container> \
     psql -U supabase_admin -d postgres \
     -c "alter database postgres set lakoku.test_target = 'local-cli';"

   pnpm test:db:personalized
   # Full release gate:
   pnpm release:personalized
   ```

6. Deploy personalized-engine app changes only after DB gate passes. Keep Task 4 instances healthy while new app instances replace them.

## Gate safety

`test:db:personalized`:

- obtains URL and keys from `supabase status -o json` without printing them;
- rejects every non-loopback API URL;
- requires explicit database marker `lakoku.test_target = 'local-cli'` through local pgTAP preflight;
- uses `supabase test db --local`, never `--linked`;
- calls local Auth and PostgREST for reader contracts;
- runs existing personalized schema/RLS pgTAP tests;
- stays outside ordinary `test:unit`, so unit CI does not require Docker.

If local database lacks linked baseline tables, restore local baseline first, apply migrations, restart local PostgREST schema cache, then run gate. Never use ignored introspection artifacts or linked credentials as deploy input.
