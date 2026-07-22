# Lakoku VPS Deploy (production)

> **Baca ini dulu.** Production Lakoku **bukan** Cloudflare Worker / Vercel.
> App berjalan di VPS Atlantic multi-app. Database production = **Supabase linked**, bukan Postgres di VPS.

Kit multi-app umum (server, port policy, Caddy, SSH):

```text
D:\Coding\deploy-kit\
  AGENT-HANDOFF.md
  README.md
  MULTI-APP.md
  QUICKSTART-ID.md
  scripts\package-app.ps1
```

Dokumen ini khusus **Lakoku**. Jangan tanya ulang host/stack ke user kecuali akses gagal.

---

## 1. Inventory production (tetap)

| Item | Nilai |
|------|--------|
| VPS host | `43.228.213.148` |
| SSH user | `root` |
| Auth | publickey `id_ed25519` (local: `C:\Users\bimap\.ssh\id_ed25519`) |
| Hostname | `moxvps` |
| OS | Ubuntu 24.04 LTS |
| App path | `/opt/lakoku` |
| Compose file | `/opt/lakoku/docker-compose.yml` |
| Container | `lakoku-web` |
| Internal port | `5200` (host bind **only** `127.0.0.1:5200`) |
| Docker network | `wacrm_edge` (**external**, shared with Caddy) |
| Public URL | `https://lakoku.biz.id` |
| Reverse proxy | Caddy di stack `/opt/wacrm` |
| Runtime mode | `LAKOKU_DEPLOY=vps` → Next **standalone** (`next.config.mjs`) |
| DB | Supabase project linked dari local CLI (bukan container Postgres di VPS) |

Protected neighbors on the same VPS (do not destroy):

| Path | Notes |
|------|--------|
| `/opt/wacrm` | Finance WA bot + shared Caddy (`80/443`) |
| `/opt/publiora` | Other app on `5300` |
| `/opt/9router` | Local LLM/proxy on `5100` |

Port reserved by neighbors: `5000–5002` (wacrm), `5100` (9router). Lakoku uses **`5200`**.

---

## 2. Architecture split (critical)

```text
Browser
  → https://lakoku.biz.id
  → Caddy (/opt/wacrm)
  → lakoku-web:5200  (Next standalone on VPS)

Next server (VPS)
  → Supabase (hosted) for DB/auth/storage
```

- **Code/image deploy** = VPS `/opt/lakoku` + `docker compose up -d --build`
- **Schema/RPC deploy** = local machine:

```powershell
cd "D:\Coding\lakoku v2"
pnpm exec supabase migration list --linked
pnpm exec supabase db push --linked --include-all --dry-run
# only with explicit user approval:
pnpm exec supabase db push --linked --include-all --yes
```

Never assume VPS `docker compose` applies Supabase migrations.

---

## 3. Update app (standard path)

### 3.1 From Windows (package + upload)

```powershell
# 1) package without node_modules/.git/.next
powershell -File D:\Coding\deploy-kit\scripts\package-app.ps1 -AppPath "D:\Coding\lakoku v2"

# 2) upload
scp "D:\Coding\deploy-kit\dist\lakoku v2.tgz" root@43.228.213.148:/opt/lakoku.tgz
# if filename has spaces, rename first:
# copy to D:\Coding\deploy-kit\dist\lakoku.tgz then scp that
```

Recommended packaging note: the kit uses the folder leaf name. Prefer syncing from a path without spaces when possible, or rename the tarball to `lakoku.tgz` before upload.

### 3.2 On VPS

```bash
ssh root@43.228.213.148

# inventory first
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
ss -tlnp | sed -n '1,5p; /:5200\|:80\|:443\|:5100\|:5300/p'

# backup current tree (fast rollback)
ts=$(date +%Y%m%d%H%M%S)
rm -rf /opt/lakoku.old.$ts
cp -a /opt/lakoku /opt/lakoku.old.$ts

# extract new code over /opt/lakoku (keep .env)
cd /opt
tar -xzf lakoku.tgz -C /opt/lakoku --strip-components=1
# ensure .env still present
test -f /opt/lakoku/.env || { echo "MISSING /opt/lakoku/.env"; exit 1; }

cd /opt/lakoku
docker compose up -d --build
docker compose ps
docker compose logs --tail=80 web
```

### 3.3 If repo is already present on VPS as git clone

Only if `/opt/lakoku/.git` exists and remote is correct:

```bash
cd /opt/lakoku
git fetch origin
git checkout main
git pull --ff-only origin main
docker compose up -d --build
```

As of last audit, production tree is **tarball-based** (no `.git` required). Prefer package+scp unless user confirms git remote deploy.

---

## 4. Environment

- File: **`/opt/lakoku/.env` only on server**
- Never commit `.env`
- Never print secret values in chat/logs
- Compose also injects build-args for `NEXT_PUBLIC_*` from `.env`

Public build-args required by `Dockerfile`:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL   # default https://lakoku.biz.id
```

Runtime:

```text
LAKOKU_DEPLOY=vps
PORT=5200
HOSTNAME=0.0.0.0
NARRATIVE_PROVIDER=gateway   # or value from .env
+ service-role / provider keys already in server .env
```

If a key is missing: tell user to fill `/opt/lakoku/.env`. Do not invent credentials.

---

## 5. Caddy / domain

Snippet lives in repo `deploy/Caddyfile.snippet` and is applied in shared Caddy:

```caddy
lakoku.biz.id, app.lakoku.biz.id {
		encode gzip
		reverse_proxy lakoku-web:5200
	}
```

Reload after Caddyfile edits:

```bash
cd /opt/wacrm
docker compose -f docker-compose.prod.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
# fallback:
docker compose -f docker-compose.prod.yml restart caddy
```

DNS: Cloudflare A record → `43.228.213.148`. Cert via Caddy. SSL Full after cert works.

---

## 6. Health checks (must pass after deploy)

```bash
# container
docker ps --filter name=lakoku-web

# local on VPS
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5200/
curl -sSI http://127.0.0.1:5200/ | head

# public
curl -sS -o /dev/null -w "%{http_code}\n" https://lakoku.biz.id/
```

Expect HTTP `200` (or app-level redirect that still proves routing).

Logs:

```bash
cd /opt/lakoku
docker compose logs -f --tail=100
```

---

## 7. Rollback

```bash
cd /opt/lakoku
docker compose down
# restore previous tree (example)
rm -rf /opt/lakoku
cp -a /opt/lakoku.old.<timestamp> /opt/lakoku
cd /opt/lakoku
docker compose up -d --build
```

Do **not** `docker compose down -v` on wacrm. Lakoku compose has no local DB volume; rollback is code/image tree.

---

## 8. Database / migration order for production features

When a release needs both schema and app:

1. **Local dry-run** linked migrations
2. **Explicit approval** then `db push --linked`
3. Verify objects/RPCs with read-only SQL
4. **Then** rebuild/restart `lakoku-web` on VPS
5. Smoke web + admin + one generation

Example observability objects (after applied):

```text
generation_jobs
generation_job_attempts
generation_provider_calls
generation_model_pricing_versions
admin_generation_access_audit
record_generation_provider_call_v1
admin_generation_overview_v1
```

Lifecycle ACL expected after hardening:

```text
acquire_generation_lease / publish_chapter / release_generation_lease
  anon EXEC = false
  authenticated EXEC = false
  service_role EXEC = true
```

---

## 9. Forbidden

- Deploy Lakoku as Cloudflare/Vercel “default production” without user override
- Bind Lakoku to `0.0.0.0:80` / `:443`
- Use ports `5000–5002` or `5100`
- `docker compose down -v` on `/opt/wacrm`
- Delete volumes `pgdata` / `baileys` / `media`
- Overwrite `/opt/lakoku/.env` with empty/example values
- Commit secrets, private keys, or dump production `.env` into chat
- Apply production `db push` without explicit user approval
- Assume VPS restart alone applies Supabase migrations

---

## 10. Agent checklist (copy)

```text
[ ] Read docs/VPS_DEPLOY.md + D:\Coding\deploy-kit\AGENT-HANDOFF.md
[ ] ssh root@43.228.213.148 works
[ ] Inventory: docker ps, ss -tlnp, ls /opt
[ ] If DB needed: local supabase dry-run → approval → push linked
[ ] Package/sync code to /opt/lakoku without wiping .env
[ ] docker compose up -d --build
[ ] curl 127.0.0.1:5200 and https://lakoku.biz.id
[ ] Record update command + rollback path in reply
```

---

## 11. One-liner mental model

```text
Supabase = DB/auth (linked CLI from laptop)
VPS Docker = Next standalone web (LAKOKU_DEPLOY=vps)
Caddy@wacrm = public HTTPS for lakoku.biz.id → lakoku-web:5200
```
