# Deploy Lakoku → Shared VPS Produksi (ubuntu@43.157.235.28)

**Target aktif:** shared VPS `ubuntu@43.157.235.28` — native systemd **user** service
(`mox-lakoku`, port lokal `5200`) + Cloudflare Tunnel (`lakoku.biz.id`,
`app.lakoku.biz.id`). Aplikasi hidup di `/home/ubuntu/mox-apps/lakoku`.

> ⚠️ Dokumen ini BUKAN penerus `docs/VPS_DEPLOY.md` (legacy Docker+Caddy di
> `root@43.228.213.148`). Jangan mencampur dua target. Kit sumber:
> `D:\Coding\deploy-kit` (repo lokal, di luar repo ini).

Runbook ini telah dieksekusi penuh dan terverifikasi pada release
`57b276d` (2026-09-12): origin 200, public 200, 14/14 asset 200, guardrail
teman utuh.

---

## 0. Aturan wajib (dari `deploy-kit/README.md` — berlaku mutlak)

- Password VPS ada di Windows **User env** `MOX_SHARED_VPS_PASSWORD`.
  **Dilarang** mencetak, menyalin ke chat/log, memasukkan sebagai argumen
  command, atau memberikannya ke `sshpass`. Helper membacanya sendiri.
- Mutasi hanya di `/home/ubuntu/mox-apps/**` dan unit systemd **user** Mox.
- Jangan sentuh `/home/ubuntu/.hermes` (aset teman), Docker, Caddy, firewall,
  package OS, cron, systemd system. **Dilarang reboot.**
- Restart hanya `mox-lakoku`.

## 1. Alat akses non-interaktif (helper Python)

OpenSSH interaktif tidak bisa dipakai agen (password butuh TTY; key
`id_ed25519` hanya milik VPS legacy). Gunakan helper Paramiko:

```bash
# health check (read-only)
python D:/Coding/deploy-kit/scripts/shared-vps-ssh-check.py

# eksekusi command (channel timeout 300s — untuk kerja panjang pakai nohup+poll)
python D:/Coding/deploy-kit/scripts/shared-vps-exec.py "<command>"

# upload / download via SFTP
python D:/Coding/deploy-kit/scripts/shared-vps-exec.py --upload "<local>" "<remote>"
python D:/Coding/deploy-kit/scripts/shared-vps-exec.py --download "<remote>" "<local>"
```

**Pitfall path Windows:** panggil helper dengan path gaya Windows dari
**PowerShell**. Dari Git Bash, `--upload "D:/..."` dapat gagal
`FileNotFoundError` karena konversi path MSYS. Pola aman:

```powershell
python 'D:\Coding\deploy-kit\scripts\shared-vps-exec.py' --upload `
  'D:\Coding\deploy-kit\dist\lakoku-<sha>.tgz' '/home/ubuntu/mox-apps/lakoku-incoming-<sha>.tgz'
```

## 2. Packaging release (dari repo ini)

**Pakai `git archive`** — deterministik, hanya tracked tree, otomatis tanpa
`node_modules`/`.git`/`.env*`, baris LF siap Linux:

```bash
cd "D:/Coding/lakoku v2"
git archive --format=tar.gz -o "D:/Coding/deploy-kit/dist/lakoku-<sha>.tgz" <sha>
# verifikasi isi
tar --force-local -tzf "D:/Coding/deploy-kit/dist/lakoku-<sha>.tgz" | wc -l
tar --force-local -tzf "D:/Coding/deploy-kit/dist/lakoku-<sha>.tgz" | grep -cE "node_modules|^\.git/|\.env"   # harus 0
```

Pitfall yang terdokumentasi (jangan pakai robocopy lagi): robocopy menyalin
sebagian `node_modules`/`.git` meski `/XD` diberikan, `/XF` tidak menahan
dotfile, GNU tar lokal butuh `--force-local` untuk path `D:` (jebakan
"Cannot connect to D:"), dan `nul` tidak boleh jadi argumen robocopy
(exit 16).

## 3. Baseline + backup (di VPS)

```bash
python .../shared-vps-exec.py "cd /home/ubuntu/mox-apps && \
  systemctl --user is-active mox-lakoku && \
  curl -fsS -o /dev/null -w 'baseline %{http_code}\n' http://127.0.0.1:5200/ && \
  free -h | head -2 && df -h /home/ubuntu | tail -1 && \
  stat -c '%n|%i|%s|%Y' /home/ubuntu/.hermes/config.yaml /home/ubuntu/.hermes/state.db"

# wajib: catat stat .hermes — harus identik sebelum/sesudah deploy
python .../shared-vps-exec.py "cd /home/ubuntu/mox-apps && \
  ts=\$(date +%Y%m%d-%H%M%S) && echo \"ts=\$ts\" && \
  rsync -a --exclude node_modules --exclude .next lakoku/ \"lakoku.bak-\$ts/\" && \
  cp lakoku/.env \"lakoku.env.bak-\$ts\" && chmod 600 \"lakoku.env.bak-\$ts\" && \
  ls -d lakoku.bak-* | tail -1"
```

## 4. Upload → extract → install → build → assembly

```bash
# upload (PowerShell, lihat §1)
# lalu di VPS — extract TIDAK menimpa .env (tarball tidak memuatnya);
# verifikasi md5 .env sama sebelum & sesudah:
python .../shared-vps-exec.py "cd /home/ubuntu/mox-apps/lakoku && \
  md5sum .env | cut -c1-12 && tar -xzf ../lakoku-incoming-<sha>.tgz && \
  md5sum .env | cut -c1-12 && echo EXTRACT-OK"

# install (WAJIB bersih bila pernah rusak — lihat §6 pitfall)
python .../shared-vps-exec.py "cd /home/ubuntu/mox-apps/lakoku && \
  rm -rf node_modules packages/contracts/node_modules && \
  nohup sh -c 'corepack pnpm install --frozen-lockfile > /tmp/lakoku-install.log 2>&1; \
  echo INSTALL_EXIT=\$? >> /tmp/lakoku-install.log' > /dev/null 2>&1 & echo INSTALL-STARTED"
# poll: grep INSTALL_EXIT /tmp/lakoku-install.log

# build (nohup + poll — channel helper timeout 300s)
python .../shared-vps-exec.py "cd /home/ubuntu/mox-apps/lakoku && \
  nohup sh -c 'corepack pnpm run build > /tmp/lakoku-build.log 2>&1; \
  echo BUILD_EXIT=\$? >> /tmp/lakoku-build.log' > /dev/null 2>&1 & echo BUILD-STARTED"
# poll: grep BUILD_EXIT /tmp/lakoku-build.log   (harus 0)

# assembly standalone (tanpa ini CSS/JS/aset 404 walau HTML 200)
python .../shared-vps-exec.py "cd /home/ubuntu/mox-apps/lakoku && \
  rm -rf .next/standalone/.next/static .next/standalone/public && \
  mkdir -p .next/standalone/.next && \
  cp -a .next/static .next/standalone/.next/static && \
  cp -a public .next/standalone/public && \
  test -f .next/standalone/server.js && echo ASSEMBLY-OK"
```

## 5. Restart + health check + guardrail

```bash
python .../shared-vps-exec.py "systemctl --user restart mox-lakoku && sleep 4 && \
  systemctl --user is-active mox-lakoku"

python .../shared-vps-exec.py "curl -fsS -o /tmp/lakoku-home.html -w 'origin %{http_code}\n' \
  http://127.0.0.1:5200/ && \
  curl -fsS -o /dev/null -w 'public %{http_code}\n' https://lakoku.biz.id/ && \
  curl -fsS -o /dev/null -w 'app %{http_code}\n' https://app.lakoku.biz.id/ && \
  python3 - <<'PY'
import re, subprocess, sys
html = open('/tmp/lakoku-home.html', encoding='utf-8').read()
assets = sorted(set(re.findall(r'(?:src|href)=\"(/_next/static/[^\"]+)\"', html)))
failed = [p for p in assets if subprocess.run(['curl','-fsS','-o','/dev/null','-w','%{http_code}',f'http://127.0.0.1:5200{p}'],capture_output=True,text=True).stdout.strip()!='200']
print(f'origin assets {len(assets)-len(failed)}/{len(assets)} HTTP 200')
sys.exit(1 if failed else 0)
PY"

# guardrail penutup: .hermes stat harus IDENTIK dengan baseline §3,
# dan hanya mox-lakoku yang berpindah status:
python .../shared-vps-exec.py "stat -c '%n|%i|%s|%Y' /home/ubuntu/.hermes/config.yaml /home/ubuntu/.hermes/state.db && \
  journalctl --user -u mox-lakoku -n 8 --no-pager | tail -3"
```

Verifikasi release benar: periksa penanda konten/kode yang hanya ada di SHA
target (mis. `grep -c 'maxRetries: 0, //' lib/ai-gateway/gateway-provider.ts`
= 2 pada release `4b61edd+`, atau headline landing `"Kalau ini ceritamu"`).

Bersihkan paket masuk: `rm /home/ubuntu/mox-apps/lakoku-incoming-<sha>.tgz`.

## 6. Pitfall yang sudah pernah terjadi (jangan diulang)

| Gejala | Sebab | Solusi |
|---|---|---|
| `pnpm run build` → `MODULE_NOT_FOUND ... node_modules/next/dist/bin/next`, tapi `pnpm install` bilang "Already up to date" | `node_modules` dikosongkan sebagian oleh cleaner/antivirus (fenomena sama pernah terjadi di Windows lokal) | `rm -rf node_modules packages/contracts/node_modules` lalu install ulang dari nol |
| Build "gagal" instan tanpa log | `nohup` tanpa redirect menelan output | selalu `> /tmp/...log 2>&1` di dalam `sh -c`, tulis `EXIT=$?` ke log |
| Helper `--upload` `FileNotFoundError` dari Git Bash | konversi path MSYS | panggil dari PowerShell dengan path `D:\...` |
| HTML 200 tapi CSS/JS/aset 404 | assembly standalone tidak dijalankan | langkah `cp -a` static+public di §4 |
| `tar: Cannot connect to D:` | GNU tar menganggap `D:` host remote | `--force-local` atau jalankan dari cwd relatif |
| robocopy "exit 16" | `nul` sebagai argumen / reserved device | jangan pakai robocopy; pakai `git archive` |

## 7. Rollback

```bash
python .../shared-vps-exec.py "cd /home/ubuntu/mox-apps && \
  ts=\$(ls -d lakoku.bak-* | tail -1) && \
  rsync -a --delete --exclude node_modules --exclude .next \"\$ts/\" lakoku/ && \
  cp \"lakoku.env.bak-*\" lakoku/.env 2>/dev/null; true"
# lalu ulangi §4 (install → build → assembly) dan §5 (restart + health)
```

## 8. Batas operasional pasca-deploy

```
production inference : ikut kebijakan kredit komersial + guard E0 R1 terukur
                       (lihat docs/qa/m10/M10_G_UNIT_ECONOMICS.md addendum)
completion inference di luar aplikasi : STOP (butuh otorisasi PM)
DB write manual produksi             : butuh otorisasi eksplisit
hardInferenceLimit (G-1)             : null
```
