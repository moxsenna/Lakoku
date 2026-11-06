/** Halaman consent OAuth minimal (sisi admin). Murni agar bisa diuji. */
export function renderConsentPage(args: {
  clientId: string
  redirectUri: string
  state: string
  scope: string
  codeChallenge: string
  email: string | undefined
}): string {
  const esc = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  return `<!doctype html>
<html lang="id">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Izinkan akses Seed — Lakoku</title>
<style>body{font-family:system-ui,sans-serif;background:#0d0d14;color:#eee;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{background:#171722;padding:32px;border-radius:16px;max-width:420px}
code{background:#0d0d14;padding:2px 6px;border-radius:6px;word-break:break-all}
button{background:#6d5dfc;color:#fff;border:0;border-radius:10px;padding:12px 20px;font-size:15px;width:100%;margin-top:16px;cursor:pointer}
.muted{color:#999;font-size:13px}</style></head>
<body><div class="card">
<h2>Izinkan akses Seed Lakoku</h2>
<p class="muted">Login sebagai <strong>${esc(args.email ?? '(tanpa email)')}</strong></p>
<p>Gemini (client <code>${esc(args.clientId)}</code>) meminta izin untuk:</p>
<ul>
<li>Membuat draft novel katalog</li>
<li>Menerima spesifikasi bab dan mengirim prosa</li>
<li>Menyelesaikan novel ke status <strong>review</strong> (tanpa publish)</li>
</ul>
<p class="muted">Redirect ke: <code>${esc(args.redirectUri)}</code></p>
<form method="post" action="/api/mcp/seed/oauth/authorize">
<input type="hidden" name="client_id" value="${esc(args.clientId)}">
<input type="hidden" name="redirect_uri" value="${esc(args.redirectUri)}">
<input type="hidden" name="state" value="${esc(args.state)}">
<input type="hidden" name="scope" value="${esc(args.scope)}">
<input type="hidden" name="code_challenge" value="${esc(args.codeChallenge)}">
<button type="submit">Izinkan</button>
</form>
</div></body></html>`
}
