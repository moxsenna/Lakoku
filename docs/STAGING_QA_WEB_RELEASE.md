# Web Release Staging QA

> **HISTORIS (2026-07-08).** Bukti QA di bawah dijalankan saat staging masih berjalan
> sebagai Cloudflare Worker `lakoku-v2` (`wrangler tail`, `cf-ray`). Deployment itu
> **sudah ditinggalkan** — production & staging Lakoku sekarang Next.js standalone di
> VPS (Docker). Lihat [VPS_DEPLOY.md](./VPS_DEPLOY.md) untuk prosedur rilis terkini.
> Catatan CF Worker di halaman ini dipertahankan sebagai arsip, bukan panduan aktif.

Gunakan checklist ini untuk release web nyata setelah gate otomatis hijau. Isi dengan bukti staging, bukan asumsi lokal.

## Build Under Test

- Date: 2026-07-08
- Commit SHA: `1b9c1df` (main; PR #13 merged)
- Staging URL: `https://lakoku.appvibe.biz.id` (deployed Cloudflare Worker `lakoku-v2`, version efa2c6af)
- Tester: Claude Code
- Device/browser: authenticated HTTP (curl) against deployed SSR + `wrangler tail` observability

## Automated Gate

- [x] `pnpm install --frozen-lockfile`
- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm build`
- [x] `pnpm smoke`
- [x] `pnpm release:m9`

## Reader Flow

- [x] Pengguna login bisa membuka `/beranda`.
- [x] Pengguna membuka cerita published dari database staging/local env.
- [x] Reader menampilkan bab, progress, settings, dan report dialog tanpa copy teknis.
- [x] Tap ganda pada choice hanya menghasilkan satu pengiriman (covered by release smoke + `submittingRef`; not re-clicked manually in browser).
- [x] Konsekuensi dan bab berikutnya berasal dari Reader API, bukan fallback client.

## No Synthetic Choice

- [x] Matikan outcome choice di staging atau pakai choice id invalid (covered by `scripts/web-release-smoke.ts` invalid choice).
- [x] Reader tidak maju ke bab berikutnya secara sintetis.
- [x] Tidak muncul copy `Pilihanmu telah dicatat, dan cerita bergerak ke arah yang baru.`
- [x] UI menampilkan recovery aman dan tetap menyimpan pilihan yang sama.

## Pending-choice recovery

- [x] Simulasikan koneksi putus setelah pembaca memilih (localStorage pending injection + automated retry-failure smoke).
- [x] Refresh halaman pada bab yang sama.
- [x] Reader membuka state pending, bukan daftar pilihan baru.
- [x] Tombol retry mengirim choice yang sama.
- [x] Setelah server menerima, pending hilang dan konsekuensi tampil.
- [x] Jika retry gagal lagi, pending tetap tersimpan dan bisa dicoba ulang (covered by `scripts/web-release-smoke.ts`).

## Reports And Safe States

- [x] Laporan masalah cerita terkirim dan tersimpan di staging/local env (`REPORT_OK 0a22e312-fe65-4340-b8e0-be74e8beaaf6`).
- [x] Bab unavailable menampilkan bahasa reader-safe (`Bab 13 belum bisa ditampilkan sekarang...`).
- [x] Bab preparing menampilkan bahasa reader-safe (exercised on deployed build: lease `generation_leases` ACTIVE utk (jejak-bayang-warisan, bab 2) → `/baca/jejak-bayang-warisan?bab=2` merender "Bab ini sedang ditulis." + "Bab 2 sedang disusun dengan cermat…"; control tanpa lease → tidak PREPARING).
- [x] Tidak ada istilah model, prompt, token, validator, atau brand internal di UI pembaca yang diuji.

## Observability

- [x] `/admin/consistency` bisa dibuka oleh akun yang berwenang/local env.
- [x] Metrics consistency memuat data staging/local env (`1 laporan / 4 bab`, `0/9` stale).
- [x] Alert endpoint tidak false-positive pada dataset sehat (`{"ok":true,"storyId":null,"alert":null}`).
- [x] Choice request bisa ditelusuri dari request log sampai event/story state (observability aktif di worker `lakoku-v2`; `wrangler tail` menangkap tiap request dengan `cf-ray` + response status + `logs[]` handler, menautkan request ke story/event state).

## Privacy Review

- [x] Tidak ada service-role key atau secret di client bundle (`STATIC_SECRET_CLEAN` on `.next/static`).
- [x] Cookie/session auth berfungsi di staging/local env (login redirected to `/beranda`).
- [x] Report canonical refs tidak dikembalikan ke reader (UI received success only; canonical refs not displayed).
- [x] Entitlement hanya berubah lewat webhook terverifikasi (covered by `m8-entitlement-smoke` in `pnpm smoke`).

## Release decision

- [x] GO — deployed build `1b9c1df` at https://lakoku.appvibe.biz.id tested; Bab PREPARING exercised on a real lease; request-log correlation available via Workers observability.
- [ ] NO-GO

Notes:
- Exercised directly on the deployed Cloudflare Worker (not local): auth wall + authenticated reader SSR, Bab PREPARING (active lease → reader-safe copy; control tanpa lease), fail-closed guards (webhook 400, generate 401), and per-request observability (`wrangler tail`, `cf-ray` correlation).
- Automated gate green on this commit: `pnpm smoke` (238 PASS), `pnpm release:m9` (17/17), `next build`, `wrangler deploy --dry-run`.
- QA data (throwaway login + lease) was inserted transiently and fully cleaned up after the run.
- PayCore payments verified end-to-end separately (staging sandbox pay → credit grant; production cutover) — see `docs/PAYCORE_INTEGRATION.md`.
