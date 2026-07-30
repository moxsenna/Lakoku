# Generation Worker + Recovery Ops

Durable generation-job worker path (plan v4). OFF by default. Enable only after
local proof + smoke.

## Feature flag

`LAKOKU_GENERATION_WORKER`
- unset / `off` / `false` / `0` / `no` → **legacy path** (after()-direct, no
  generation_job row, `attemptId: null`). Current production default.
- `on` / `true` / `1` / `yes` → **durable worker path**: kickoff enqueues a
  `generation_jobs` row (committed before `STARTED`), returns `attemptId = jobId`,
  and `after()` claims that exact job (claim-by-id) → acquires the job lease →
  heartbeats → runs the generator → fenced publish marks the job `SUCCEEDED`.

When ON, a stranded job (process killed before/after `after()`) is recovered by
the recovery endpoint below. Without the cron installed, stranded jobs never run,
so **the cron is part of the Definition of Done** for enabling the flag.

## Recovery endpoint

`POST /api/generation/recover`

- Auth: `Authorization: Bearer $LAKOKU_RECOVERY_SECRET`.
- **Fail closed**: if `LAKOKU_RECOVERY_SECRET` is unset the route returns `404`.
- Wrong/absent bearer → `401`.
- Worker flag OFF → `202` no-op (nothing durable to recover).
- On success: schedules bounded processing via `after()` and returns `202`
  immediately. It never returns job detail.
- Processing per tick: `recover_stale_generation_jobs_v1` (requeue leases from
  dead workers) then global-pop claim + run up to `LAKOKU_RECOVERY_MAX_JOBS`
  (default 5, max 20) jobs. Safe under overlapping ticks — claim uses
  `FOR UPDATE SKIP LOCKED`, so two concurrent ticks never run the same job.

### Env

```
LAKOKU_GENERATION_WORKER=on
LAKOKU_RECOVERY_SECRET=<long-random-secret>
# optional
LAKOKU_RECOVERY_MAX_JOBS=5
```

### VPS cron (every 2 minutes)

```cron
*/2 * * * * curl -fsS -X POST \
  -H "Authorization: Bearer $LAKOKU_RECOVERY_SECRET" \
  https://lakoku.biz.id/api/generation/recover >/dev/null 2>&1
```

Or a systemd timer (preferred on `moxvps`):

```ini
# /etc/systemd/system/lakoku-recover.service
[Service]
Type=oneshot
Environment=LAKOKU_RECOVERY_SECRET=<secret>
ExecStart=/usr/bin/curl -fsS -X POST \
  -H "Authorization: Bearer ${LAKOKU_RECOVERY_SECRET}" \
  https://lakoku.biz.id/api/generation/recover
```

```ini
# /etc/systemd/system/lakoku-recover.timer
[Timer]
OnCalendar=*:0/2
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
systemctl enable --now lakoku-recover.timer
```

## Rollout checklist

Follow this exact 12-step rollout sequence in production:

1. **Pre-rollout Inspection**: Verify the current production database schema version and ensure no migrations are currently in progress.
2. **Database Backup**: Perform a full database backup before running any schema migrations.
3. **Migration 1**: Apply `supabase/migrations/20260724115000_claim_generation_job_by_id.sql`.
4. **Migration 2**: Apply `supabase/migrations/20260724120000_checkpoint_versioning.sql`.
5. **Migration 3**: Apply `supabase/migrations/20260724121000_generation_checkpoint_fencing.sql`.
6. **Migration 4**: Apply `supabase/migrations/20260724122000_generation_job_ending_lock_publication.sql`.
7. **Migration 5**: Apply `supabase/migrations/20260724123000_generation_publication_lock_order.sql`.
8. **Migration 6**: Apply `supabase/migrations/20260724124000_generation_checkpoint_audit_signals.sql`.
9. **Environment Configuration**: Set `LAKOKU_RECOVERY_SECRET` env variable to a strong random token.
10. **Install Cron / Timer**: Configure and enable the VPS cron job or systemd timer to target `/api/generation/recover`.
11. **Smoke Test Recovery Endpoint**: Verify `/api/generation/recover` returns `401` with an invalid token, `404` with no secret set, and `202` when called with the correct token.
12. **Enable Feature Flag**: Flip `LAKOKU_GENERATION_WORKER=on` to transition the app to the durable worker path. Monitor logs for `START_CHAPTER_WORKER_DONE`, `GENERATION_WORKER_SUCCEEDED`, and `GENERATION_RECOVER_TICK`.

## Rollback

To disable the durable worker path and return to legacy execution:

1. **Disable Feature Flag**: Set `LAKOKU_GENERATION_WORKER=off`. New generation requests will bypass the queue and use the legacy in-memory path immediately.
2. **Queue Inventory & Reactivation**: Active or pending jobs remaining in the `generation_jobs` queue when the worker is disabled will be frozen. When/if the worker is reactivated (`LAKOKU_GENERATION_WORKER=on`), these jobs will resume processing from their last saved checkpoint.
3. **Recovery No-Op**: While the feature flag is off, the recovery endpoint `/api/generation/recover` acts as a strict no-op (returning HTTP `202 Accepted` but performing no DB claims or processing). You may safely leave the cron active or disable it.

### Warning

> [!WARNING]
> **Forward-Only Migrations**: The 6 migrations applied during rollout are forward-only due to dependencies and schema changes. Do not run down migrations or rollback schema state in production, as doing so may cause irreversible loss of checkpoint data and audit logs.
