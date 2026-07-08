# Web Release Staging QA

Gunakan checklist ini untuk release web nyata setelah gate otomatis hijau. Isi dengan bukti staging, bukan asumsi lokal.

## Build Under Test

- Date: 2026-07-07
- Commit SHA: `c87184e` + dirty workspace changes under current Codex thread
- Staging URL: `http://127.0.0.1:3010` (local production rehearsal; real staging URL not provided yet)
- Tester: Codex
- Device/browser: Playwright CLI, Chromium/Chrome for Testing 150, desktop viewport

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
- [ ] Bab preparing menampilkan bahasa reader-safe (not exercised in this local rehearsal).
- [x] Tidak ada istilah model, prompt, token, validator, atau brand internal di UI pembaca yang diuji.

## Observability

- [x] `/admin/consistency` bisa dibuka oleh akun yang berwenang/local env.
- [x] Metrics consistency memuat data staging/local env (`1 laporan / 4 bab`, `0/9` stale).
- [x] Alert endpoint tidak false-positive pada dataset sehat (`{"ok":true,"storyId":null,"alert":null}`).
- [~] Choice request bisa ditelusuri dari request log sampai event/story state (browser consequence + local DB report verified; full request log correlation not available in local rehearsal).

## Privacy Review

- [x] Tidak ada service-role key atau secret di client bundle (`STATIC_SECRET_CLEAN` on `.next/static`).
- [x] Cookie/session auth berfungsi di staging/local env (login redirected to `/beranda`).
- [x] Report canonical refs tidak dikembalikan ke reader (UI received success only; canonical refs not displayed).
- [x] Entitlement hanya berubah lewat webhook terverifikasi (covered by `m8-entitlement-smoke` in `pnpm smoke`).

## Release decision

- [ ] GO
- [x] NO-GO for real web release until a deployed staging URL/commit is tested and Bab PREPARING state is exercised.

Notes:
- Local production rehearsal passed the core release-risk checks on `http://127.0.0.1:3010`.
- Real staging QA remains required because this run did not exercise deployed hosting, CDN/runtime env, or a real PREPARING lease state.
