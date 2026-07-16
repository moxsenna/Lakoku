# Lakoku VPS deploy

| Item | Value |
|------|--------|
| Path | `/opt/lakoku` |
| Container | `lakoku-web` |
| Port | `5200` (host bind `127.0.0.1:5200`) |
| Network | `wacrm_edge` |
| Domain | `https://lakoku.appvibe.biz.id` |

## Update

```bash
cd /opt/lakoku
# sync code, then:
docker compose up -d --build
```

## Logs

```bash
docker compose -f /opt/lakoku/docker-compose.yml logs -f --tail=100
```

## Rollback

```bash
cd /opt/lakoku
docker compose down
# restore previous tree, then:
docker compose up -d --build
```

## Health

```bash
curl -sI http://127.0.0.1:5200/
curl -sI https://lakoku.appvibe.biz.id/
```
