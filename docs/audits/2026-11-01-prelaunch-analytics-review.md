# Consolidated Review Report

Target: docs/designs/PRELAUNCH_ANALYTICS_PROMOTION_GATE.md
Mode: Consolidated (uninterrupted) · Tanggal: 2026-11-01
Stage reports: zoom_out_report.md (S5), comprehension_report.md (S6), critic_report.md (S7), intermediate_zoom_out_report.md (S8), implementation_readiness_report.md (S9)

## Status per stage

| Stage | Reviewer | Verdict |
|---|---|---|
| 5 Initial Zoom Out | egm-zoom-out | PASS WITH FINDINGS (4 Major, 4 Nit) |
| 6 Comprehension | egm-comprehension | FAIL (1 Blocker, 6 Major, 8 Nit) |
| 7 Critic | egm-design / egm-structural / egm-style | FAIL / PASS WITH FINDINGS / PASS WITH FINDINGS (2 Blocker, 12 Major, ~25 Nit) |
| 8 Intermediate Zoom Out | egm-zoom-out | PASS WITH FINDINGS (4 Major, 4 Nit) |
| 9 Implementation Readiness | egm-implementation-readiness / egm-codebase-details / egm-style | FAIL / FAIL / FAIL (3 Blocker, 15 Major, ~15 Nit) |

## Temuan konsolidasi per prioritas (setelah remediasi)

### 🔴 Blocker — semuanya PROPOSE FIX, diterapkan

| ID | Temuan | Resolusi |
|---|---|---|
| c6-1/style-r1-2 | Definisi drop-off terbalik + "menyelesaikan bab N" tak teroperasionalisasi | Rumus dibekukan ulang: drop-off = 1 − tingkat lanjut; operasionalisasi via first-view; sensoring 7 hari |
| design-r1-1 | `credit_orders_v2.amount_idr` hardcoded 0 → pendapatan Android Rp0 | Aturan derivasi dibekukan: perbaikan RPC `play_billing_grant_v1` (snapshot harga dari `credit_products`) menjadi pendamping WAJIB Fase 3 + amendemen NFR eksplisit + kaveat baris historis |
| design-r1-2/z5-1/c6-B2 | Premis matcher middleware salah (`/s/*`, `/baca/*` sudah tercakup) | Koreksi: perluasan hanya `/mulai` + `/auth/:path*`; catat `PROTECTED_PREFIXES` `/baca/*` (tamu di-redirect sebelum render; capture tetap jalan di middleware) |
| i9-B1 | Enum kanal tidak pernah didaftarkan | Taksonomi + tabel mapping utm_source→kanal dibekukan di dokumen |
| i9-B2 | Fase 1 pasti gagal typecheck: `db-types.ts` absen dari rencana | `lib/supabase/db-types.ts` (Modify) ditambahkan ke Fase 1 |
| style-r1-B1/c6-n6 | Rujukan "file 6" → seharusnya file 7 (pencatat atribusi) | Rujukan silang dikoreksi + renumbering |

### 🟡 Major — PROPOSE FIX diterapkan (ringkas)

1. Enum kanal & representasi Postgres: `source text not null check (source in (...))` (konvensi 91 migration, tanpa `CREATE TYPE`); mapping `utm_source` tidak dikenal → `other`.
2. Format nilai cookie dibekukan: JSON pendek `{c,us,uc,rh}` di-encode; cookie rusak/hilang → fail-open `direct`.
3. Setiap signup menulis TEPAT SATU baris (default `direct` bila cookie absen) — menutup celah G1 "signup tanpa baris".
4. Skema tabel lengkap: `id uuid pk default gen_random_uuid()`, `user_id uuid not null UNIQUE FK auth.users on delete cascade`, RLS enable tanpa policy.
5. `ACQUISITION_COOKIE_DAYS = 30` konstanta mandiri — BUKAN mirror `RewardPolicy.attributionCookieDays` (setting admin live milik referral).
6. Cookie ditempel pada SEMUA response middleware termasuk `NextResponse.redirect`.
7. `/r/:path*` ditambahkan ke matcher agar cabang `referral_code` tidak dead-code.
8. Mata uang: konstanta konversi USD→IDR dengan `decisionRef` (preseden `lib/commercial/daily-cost-report.ts`); `cost_source='unavailable'` → exclude + bar error.
9. Health-check anti false-alarm: top-of-funnel nol-24-jam = BREACH; late-funnel nol = WATCH; sanity atribusi (100% `direct` pada ≥10 signup = sinyal); kadens manual harian disarankan, bukan alarm otomatis.
10. Health atribusi + asert baris `user_acquisition` masuk verifikasi sekali jalan.
11. Kunci dedup drop-off: `coalesce(anonymous_id, user_id)` + model identitas dinyatakan (drop-off ≠ rekonsiliasi ekonomi per orang).
12. Zona waktu dibekukan: "hari" = Asia/Jakarta.
13. Fork UU PDP dibekukan: jalur NOTICE (perbarui `/privacy`, tanpa-PII); jalur consent ditolak karena membatalkan first-touch di in-app browser.
14. Gerbang (file 13) kondisional OQ6; state keempat `MENUNGGU RATIFIKASI`.
15. Alias `pnpm analytics:verify` ditambahkan ke file verifikasi; referensi env `DATABASE_URL` (bukan `SUPABASE_SERVICE_ROLE_KEY` stale).
16. Funnel launch-week: tahapan didaftarkan eksplisit.
17. Rujukan "K6"/"E0" diganti pointer in-doc / `lib/commercial/daily-cost-report.ts` (`E0_R1_DECISION_REF`).
18. OQ3–OQ6 diberi owner (pemilik/moxsenna); OQ4 dinarrow (drop-off tamu terpisah = diputuskan).
19. Klaim absolut "nol risiko regresi" → "risiko rendah dan terlokalisasi, diverifikasi via CUJ 3".
20. Klaim in-app browser melunak ("tidak selalu mempertahankan query param") — fallback share-slug berdiri sendiri.
21. Sizing dikoreksi dengan asumsi dinyatakan (~1 juta baris/bulan pada 10 ribu DAU).
22. Rate limit (jika ditambah): per `anonymous_id`, bukan per-IP (CGNAT).

### 🟢 Nit — diterapkan sepanjang relevan

Kolisi "slug" → "parameter UTM"; "laporan harian" → kadens manual eksplisit; garden path CUJ 3 ditulis ulang; brand guard didefinisikan (AGENT_RULES); PayCore + `credit_orders_v2` diberi link `docs/PAYCORE_INTEGRATION.md`; "staging" → local dev; WATCH/BREACH dijelaskan satu kalimat; G2 menamai `analytics:verify`; format heading entri diseragamkan; morfologi serapan dibenahi; polisemi "pembaca tabel" diklarifikasi; OQ1 tabel = primary record.

### ⚪ Diterima sebagai trade-off (tidak diubah)

- Kunjungan tamu tidak terkanal (konsekuensi OQ1=A, keputusan pemilik).
- Tidak ada event kunjungan pertama; anchor funnel terawal `story_setup_entry_viewed`.
- Laporan launch-week tidak membedakan abandon vs gagal bayar sampai status `failed` ditulis (OQ5/pemilik).
- `credit_orders_v2` belum punya runtime writer di jalur web (union tetap benar untuk masa depan).

## Kesimpulan

Lima stage, 3 Blocker + 15 Major + ~35 Nit teridentifikasi. Semua Blocker dan Major diratifikasi sebagai PROPOSE FIX dan diterapkan dalam satu penulisan ulang dokumen (bukan tambalan per ronde, sesuai anjuran Stage 8). Dokumen final: `docs/designs/PRELAUNCH_ANALYTICS_PROMOTION_GATE.md` v2. Fase 1 boleh dieksekusi atas perintah pemilik.
