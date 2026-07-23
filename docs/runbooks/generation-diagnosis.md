# Runbook: Chapter / Choice Generation Diagnosis

## Log filter (VPS)

```bash
docker compose logs --since 3h web 2>&1 \
  | grep -E \
  'GENERATION_|CHOICE_|PROVIDER_|CHECKPOINT_|PUBLISH_|CONTRACT_|LEASE_|ATTEMPT_|START_CHAPTER_'
```

## SQL timeline

```sql
select seq, type, payload, created_at
from story_events
where story_id = '<STORY_ID>'
order by seq desc
limit 100;
```

## Jobs / checkpoints

```sql
select *
from generation_jobs
where story_id = '<STORY_ID>'
  and chapter_number = <CHAPTER>
order by created_at desc;

select
  story_id,
  chapter_number,
  attempt_id,
  status,
  prose_fingerprint,
  prose_attempt_count,
  choice_attempt_count,
  created_at,
  updated_at,
  expires_at
from chapter_generation_checkpoints
where story_id = '<STORY_ID>'
  and chapter_number = <CHAPTER>;
```

## Provider calls

```sql
select
  use_case,
  workflow_phase,
  provider_id,
  configured_model_id,
  outcome,
  error_code,
  latency_ms,
  created_at
from generation_provider_calls
where story_id = '<STORY_ID>'
  and chapter_number = <CHAPTER>
order by created_at;
```

## Empty generation contracts (read-only audit)

See `scripts/sql/audit-empty-generation-contracts.sql`.

## Migration uniqueness

```bash
pnpm run check:migration-versions
```

## Feature flags (planned / partial)

| Flag | Purpose |
|------|---------|
| `NEXT_PUBLIC_STORY_CREATIVE_DIRECTION_V1` | creative direction persist/load |
| `LAKOKU_CHOICES_FALLBACK_TO_PROSE=1` | allow choices to reuse prose route |
| `LAKOKU_CHOICE_MAX_ACTIVE` | choice concurrency per process |
| `LAKOKU_CHOICE_MAX_QUEUE` | choice wait queue size |

## Deploy notes

- Production = VPS (`docs/VPS_DEPLOY.md`), not Cloudflare/Vercel.
- DB migrations: `pnpm exec supabase db push --linked` only after dry-run + explicit approval.
- Do not `docker compose down -v`.
- Do not overwrite `.env`.
