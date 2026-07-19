# Lakoku VPS deploy

**Canonical full runbook:** [`docs/VPS_DEPLOY.md`](../docs/VPS_DEPLOY.md)  
**Multi-app VPS kit:** `D:\Coding\deploy-kit\AGENT-HANDOFF.md`

Production is **VPS**, not Cloudflare/Vercel.

| Item | Value |
|------|--------|
| Path | `/opt/lakoku` |
| Container | `lakoku-web` |
| Port | `127.0.0.1:5200` |
| Network | `wacrm_edge` (shared Caddy) |
| Domain | `https://lakoku.appvibe.biz.id` |
| Mode | `LAKOKU_DEPLOY=vps` (Next standalone) |
| DB | Supabase linked (migrate from local CLI) |

## Update app

```bash
# on VPS after code sync, keep /opt/lakoku/.env
cd /opt/lakoku
docker compose up -d --build
docker compose logs --tail=100
```

From Windows package helper:

```powershell
powershell -File D:\Coding\deploy-kit\scripts\package-app.ps1 -AppPath "D:\Coding\lakoku v2"
scp <tarball> root@43.228.213.148:/opt/lakoku.tgz
```

## Logs

```bash
docker compose -f /opt/lakoku/docker-compose.yml logs -f --tail=100
```

## Health

```bash
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5200/
curl -sS -o /dev/null -w "%{http_code}\n" https://lakoku.appvibe.biz.id/
```

## Rollback

```bash
cd /opt/lakoku
docker compose down
# restore previous /opt/lakoku.old.* tree
docker compose up -d --build
```

## Migrations

Schema changes are **not** applied by Docker rebuild. From laptop:

```powershell
pnpm exec supabase db push --linked --include-all --dry-run
# only with explicit approval
pnpm exec supabase db push --linked --include-all --yes
```

Then rebuild/restart `lakoku-web`.
