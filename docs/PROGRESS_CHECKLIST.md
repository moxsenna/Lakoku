# Lakoku — Progress Checklist (Task Tracker) v1.0

**Status:** Living document — dicentang seiring pekerjaan berjalan
**Last updated:** 5 Juli 2026 (Auth Supabase + reader-state per-user hidup: tabel `reader_states` RLS pemilik-saja, login/daftar/callback, seam server overlay state per-user, jejak/progres tercatat per-akun — terverifikasi E2E)
**Turunan dari:** `docs/IMPLEMENTATION_PLAN.md` (runbook v1.0) — jika runbook berubah, sinkronkan checklist ini di PR yang sama (anti-drift, runbook §5)
**Cara pakai:** Setiap task = satu checkbox. Centang HANYA bila Definition of Done (DoD) task terpenuhi. Milestone dianggap selesai hanya bila blok Sign-off-nya lengkap (lihat runbook §4).

## Legenda status

- `[ ]` — belum dikerjakan
- `[~]` — sebagian (deviasi/parsial dicatat di baris "Catatan")
- `[x]` — selesai, DoD terverifikasi (bukan diasumsikan)

## Ringkasan status milestone

| Milestone | Status | Catatan singkat |
|---|---|---|
| M0 — Repo, tooling, CI skeleton | `[ ]` | Belum monorepo ARCH §5; repo saat ini single Next.js app |
| M1 — Contracts + DB + RLS | `[~]` | Supabase terhubung; skema reader-path + RLS read publik + seed; **auth + `reader_states` per-user RLS pemilik-saja hidup**. `packages/contracts`/`db` & domain naratif ARCH §13.1 belum |
| M2 — Runtime lifecycle + fake gen E2E | `[ ]` | Belum ada `packages/runtime` |
| M3 — Memory hierarchy + Layer A + alias | `[ ]` | Belum ada `packages/narrative-core` |
| M4 — Template + provider gateway | `[ ]` | Belum ada `packages/ai-gateway` |
| M5 — Reconciliation + thread + Layer B | `[ ]` | Gate 50 bab; belum dimulai |
| **M6-WEB — Web reader mobile-first** | `[~]` | **Jalur UX (fixtures) TUNTAS** — Exit Criteria jalur UX ✔ (lint+tsc hijau); jalur cerita nyata menunggu M5 |
| M6 — Android reader beta | `[ ]` | Client kedua; belum dimulai |
| M7 — Story Foundation + opening + reports | `[ ]` | Belum dimulai |
| M8 — Observability + alert + entitlement | `[ ]` | Belum dimulai |
| M9 — Hardening + release gate + beta cut | `[ ]` | Belum dimulai |

---

## M0 — Repo, Tooling, CI Skeleton

- [ ] **T0.1 Monorepo scaffold** — struktur `apps/`, `packages/`, `infra/`, `fixtures/`, `docs/` (ARCH §5); pnpm workspaces; tiap paket punya `package.json` + `tsconfig` extend base.
- [~] **T0.2 Tooling dasar** — TS strict, ESLint, Prettier, Vitest; `pnpm lint && pnpm typecheck && pnpm test` hijau di repo kosong.
  - [x] `AGENT_RULES.md` (ringkasan ARCH §23) — sudah dibuat di root repo.
  - [x] ESLint 9 flat config (`eslint.config.mjs`) — `eslint-config-next/core-web-vitals` + `/typescript`, prefix `_` dihormati. `pnpm lint` (eslint .) & `tsc --noEmit` hijau.
  - [x] TS strict aktif (`tsconfig.json`).
  - [ ] Prettier & Vitest belum disiapkan; `pnpm typecheck`/`pnpm test` script belum ada (menunggu monorepo T0.1).
- [ ] **T0.3 CI skeleton** — `.github/workflows/ci.yml` (lint + typecheck + test + migration check placeholder); CI hijau di PR pertama.
- [ ] **Exit Criteria M0** — pipeline CI hijau; batas kepemilikan paket terdokumentasi.
- **Catatan:** Repo sekarang adalah satu app Next.js di root (`app/`, `components/`, `lib/`), belum monorepo ARCH §5. `docs/` sudah ada. `AGENT_RULES.md` + ESLint flat config + TS strict sudah ada; Prettier/Vitest/CI belum. Saat T0.1 (monorepo) dibuat, `eslint.config.mjs` root ini dipindah/di-extend ke konfig workspace.

## M1 — Contracts + DB Baseline + RLS

- [ ] **T1.1 `packages/contracts`** — Zod + JSON Schema + tipe ter-generate untuk endpoint ARCH §11.1; larangan duplikasi tipe ditegakkan.
- [~] **T1.2 Skema kanonik baseline** (`packages/db` + `infra/supabase`) — migrasi domain ARCH §13.1 termasuk `character_aliases`, `character_voice_sheets`, `act_rollups`, `facts_ledger.salience/.load_bearing`, `story_threads.status/.payoff_window`, `chapter_blueprints.version/.reconciled_from_version/.reconciliation_reason`, event `BLUEPRINT_RECONCILED`; migration test naik-turun lulus.
  - [x] **Reader-path baseline (subset)**: Supabase terhubung; migrasi `reader_path_baseline` + `align_schema_to_contract` membuat `stories`, `chapters`, `choice_outcomes` (selaras 1:1 dengan `lib/api/types.ts`); seed dari fixtures via `scripts/seed-supabase.ts` (idempotent upsert). Fixtures kini HANYA seed/fallback — sumber kebenaran konten adalah Supabase.
  - [x] **Reader-state per-user**: migrasi `reader_states_per_user` (PK `(user_id, story_id)`; status/current_chapter/jejak/ending_name) menggantikan kolom DEMO global di `stories` untuk pengguna login. Kolom demo di `stories` kini hanya fallback tamu.
  - [ ] Domain naratif ARCH §13.1 (facts_ledger, story_threads, blueprints, aliases, voice sheets, dst.) belum — menunggu M3–M5.
- [~] **T1.3 RLS + ownership harness** — RLS tiap tabel reader-private + test cross-user (story A tak terbaca user B).
  - [x] RLS aktif di 3 tabel konten published: read publik (anon), tulis hanya service role. Sesuai model "published content is public".
  - [x] `reader_states` RLS pemilik-saja (`auth.uid() = user_id` untuk select/insert/update/delete) — reader-private ditegakkan di DB. Terverifikasi: baris tercatat terikat `user_id` saat user uji memilih.
  - [ ] Ownership test cross-user formal (user B tak bisa baca baris user A) sebagai test otomatis di CI — menunggu M0 harness test.
- [ ] **Exit Criteria M1** — migrasi + RLS + ownership test lulus di CI; `packages/contracts` jadi acuan tunggal.
- **Catatan:** `lib/api/types.ts` saat ini adalah kontrak client sementara yang HARUS dijaga konsisten dengan `packages/contracts` begitu M1 dibuat (lihat T6W.2).

## M2 — Runtime Lifecycle + Fake Generation E2E

- [ ] **T2.1 `packages/runtime` story commands** — Story Contract lock, canonical bootstrap, `story_events`, idempotency keys, outbox, generation lease; unit test idempotensi (repeat tap, duplicate queue, resume tidak double-advance).
- [ ] **T2.2 Fake generation workflow** — workflow E2E publish chapter fixture deterministik via publish transaksional atomik; retry tak menduplikasi; gagal tak tinggalkan state parsial.
- [ ] **T2.3 API contract + ownership tests** — contract test semua endpoint reader; ETag reader endpoint berfungsi.
- [ ] **Exit Criteria M2** — end-to-end fake publish jalan; invariant idempotensi & atomicity terbukti.

## M3 — Memory Hierarchy + Layer A Validator + Alias ⭐ fondasi konsistensi

- [ ] **T3.1 Context compiler + T0–T3** (`packages/narrative-core`) — NTM G2-TIERS, G2-BUDGET — Chapter Context Packet (ARCH §12.2) + budget policy NCS §2.2; T1 rollup otomatis (WF step 9).
- [ ] **T3.2 Load-bearing protection + retrieval log** — NTM G2-LOADBEAR — fakta `LOAD_BEARING` tak dipangkas sebelum dibayar; exclusion list ke `retrieval_logs`.
- [ ] **T3.3 Layer A deterministic validator** — NTM G3-LAYERA — cek tanpa LLM (karakter terdaftar, no reveal pre-gate, knowledge scope, state delta, timeline monotonic, struktur bab, resolusi alias, larangan karakter baru > Bab 30).
- [ ] **T3.4 Alias registry** — NTM G5-ALIAS — WF step 5 resolve mention → `character_id`; unresolved = MAJOR.
- [ ] **Exit Criteria M3** — simulasi deterministik ke Bab 50 (fixture) lolos Layer A; NTM G2-*, G3-LAYERA, G5-ALIAS = `DONE`. Gate wajib sebelum Phase B lanjut.

## M4 — Template + Provider Gateway

- [ ] **T4.1 Planner/writer output schema + repair protocol** — NTM G3-REPAIR — skema plan & draft; repair maks 2/lapis → `FAILED_REVIEW_REQUIRED`; repair tak hapus canon.
- [ ] **T4.2 Template `lakoku_drama_bangkit_v1`** — blueprint 50 bab (8 act, gate 5/12/20/32/40/45/48), reveal gates, ending rules, fixture regresi di `fixtures/narrative/`.
- [ ] **T4.3 `packages/ai-gateway`** — adapter provider di balik kontrak internal (`generatePlan()`, `writeChapter()`); plan & prosa schema-valid; tak ada string yang bocorkan model/prompt/token.
- [ ] **Exit Criteria M4** — generasi AI satu bab lolos Layer A + repair; string consumer-safe.

## M5 — Reconciliation + Thread Lifecycle + Layer B ⭐ gate 50 bab

- [ ] **T5.1 Reconciliation checkpoint (WF step R)** — NTM G1-VERSION, G1-DRIFT, G1-REACH, G1-SPINE — langkah R di akhir act + on-demand saat drift ≥ 2; blueprint versioned; reachability semua ending; tak boleh langgar spine/reveal gate/ending.
- [ ] **T5.2 Layer B model validator** — NTM G3-LAYERB — kontradiksi lunak, voice, emosi vs relationship, pakai `character_voice_sheets`.
- [ ] **T5.3 Thread lifecycle** — NTM G4-STATUS, G4-BUDGET, G4-STALE, G4-BLOCK48 — status OPEN→…→RESOLVED|ABANDONED_APPROVED; maks 7 thread; no new thread ≥ Bab 41; stale 6 bab → callback ≤ 3 bab; Bab 48 diblokir bila mystery utama non-RESOLVED.
- [ ] **T5.4 Soak test 50 bab** — 3 jalur (high-trust, low-trust, mixed); 0 kontradiksi CRITICAL; semua ending reachable tiap checkpoint; biaya/bab dalam guardrail.
- [ ] **Exit Criteria M5** — NCS §8 hijau di soak; NTM G1/G3-LAYERB/G4 = `DONE`. Gate wajib sebelum cerita AI nyata disajikan ke pembaca.

## M6-WEB — Web Reader Mobile-First ⭐ client produksi pertama

> Dua-jalur: **Jalur UX (fixtures)** tak dikunci gate M5; **Jalur cerita nyata (AI ke pembaca)** menunggu M5 hijau.

- [~] **T6W.1 Design system + app shell** — mobile-first (`max-w-md`, bottom nav), token Midnight Drama + Paper Cream, aksesibilitas (aria, `prefers-reduced-motion`); brand guard (tanpa "Narraza"/"AI generator").
  - Catatan: sudah ada di root (`app/`, `components/app-shell.tsx`), belum dipindah ke `apps/web` sesuai ARCH §5. Deviasi struktur monorepo (lihat M0/M1).
- [x] **T6W.2 Client-data seam `lib/api/`** — `types.ts`, `client.ts` (`listStories`/`getStory`/`getChapter`/`submitChoice`), fixtures internal terpisah dari UI; tak ada komponen yang impor sumber data langsung; ganti `client.ts` → Reader API tak sentuh komponen.
  - **TERBUKTI**: `client.ts` kini menunjuk Reader API interim (`/api/*` route handlers → Supabase) — komponen UI tidak berubah sama sekali saat penggantian. Halaman RSC pakai `lib/api/server.ts` (baca Supabase langsung, tanpa lompatan HTTP); komponen client tetap fetch via `/api/*`.
  - Reader API interim (AMENDMENTS v0.4 jalur "Next.js dulu, Workers nanti"): `GET /api/stories`, `GET /api/stories/[id]`, `GET /api/stories/[id]/chapters/[number]`, `POST /api/stories/[id]/choices`. Query Supabase pakai client anon TANPA cookies (aman untuk `generateStaticParams`; konten published memang publik by RLS).
  - Catatan: konsistensi tipe dengan `packages/contracts` (ARCH §11.1) belum bisa diverifikasi karena `packages/contracts` belum ada (M1). Verifikasi ulang saat M1 selesai.
- [x] **T6W.3 Reader + progress** — reader menampilkan bab sesuai cerita (bukan sample statis); loading state pakai bahasa naratif; progress monotonic yang persist lintas sesi.
  - Progress lokal: `lib/api/progress.ts` (cache client, monotonic, aman SSR) + `components/resume-chapter.tsx` (`useSyncExternalStore`, surface di beranda hero & CTA detail). Reader mencatat bab saat dibuka & saat maju.
  - Verifikasi browser (iPhone 14): pilih di `pesan-terakhir` bab 12 → `localStorage lakoku:progress:v1 = {"pesan-terakhir":13,...}`; beranda hero berubah "BAB 12 → BAB 13 DARI 50". Monotonic (hanya maju).
  - Baca berkelanjutan bab-ke-bab: tombol "Lanjut" memuat bab berikutnya di dalam reader via `/baca/[id]?bab=N` (bukan balik ke detail); reader di-`key` per bab agar remount bersih. Bab yang belum ada di fixtures dialihkan anggun ke `/cerita/[id]` (bukan 404).
  - Konten demo: "Di Balik Kaca" kini punya Bab 1→2→3 penuh (bounded branching konvergen) untuk pengalaman baca dari awal. Verifikasi browser: 1→2→3 mengalir, progress `di-balik-kaca:3`; minta `pesan-terakhir?bab=13` (belum ada) → redirect ke detail.
  - Catatan: cache lokal ini BUKAN sumber kebenaran; saat Reader API nyata siap, progres server direkonsiliasi (ambil terjauh) — ARCH §7.1.
- [~] **T6W.4 Choice submission + recovery + generation status** — via `submitChoice`; konsekuensi & bab berikutnya dari outcome seam.
  - [x] Anti double-advance (client): guard `submittingRef` di `reader-view.tsx` — tap ganda tidak mengirim `submitChoice` lebih dari sekali. Happy-path pilihan → konsekuensi → lanjut terverifikasi di browser.
  - [ ] Pending-choice recovery yang otoritatif (resume setelah app mati saat generasi berjalan) — bergantung server nyata + generation lease (M2/T2.1); belum bisa diuji tanpa backend.
- [x] **T6W.5 Verifikasi browser mobile** — alur beranda → baca → pilih → konsekuensi → lanjut lolos; type-check hijau (agent-browser, viewport mobile).
- [x] **Exit Criteria M6-WEB (jalur UX)** — reader web E2E lolos dengan fixtures ✔; seam terpasang tanpa kebocoran ✔; brand guard lolos ✔; progress monotonic persist ✔; `tsc --noEmit` hijau ✔; **lint gate hijau** (`eslint .`, 0 error/0 warning) ✔.
- [~] **Exit Criteria M6-WEB (jalur cerita nyata)** — `client.ts` menunjuk Reader API nyata DAN M5 hijau.
  - [x] `client.ts` menunjuk Reader API nyata (route handlers → Supabase). Verifikasi browser: beranda + reader + pilihan→konsekuensi semuanya dari database.
  - [ ] M5 hijau (validator konsistensi + soak 50 bab) — konten AI belum boleh disajikan; konten sekarang tetap kuratif/fixture-seeded.

## M6 — Android Reader Beta (client kedua)

- [ ] **T6.1 Design system + app shell** — `apps/android` (Compose, offline-first, ARCH §6); navigation graph + DI + tema Brand Guidelines v1.1.
- [ ] **T6.2 Auth + library cache + reader + progress** — reader render dari local data; progress monotonic.
- [ ] **T6.3 Choice submission + recovery + generation status** — repeat tap tak double-advance; status reader-safe tanpa metadata model.
- [ ] **Exit Criteria M6** — alur baca + pilih + recovery lolos di device Android nyata.

## M7 — Story Foundation, Proposal, Opening Package, Reports

- [ ] **T7.1 Story Foundation flow + proposal selection** — user buat cerita → pilih proposal → lock story contract.
- [ ] **T7.2 Opening package + voice sheets** — NTM G5-VOICE — opening package membuat `character_voice_sheets`; voice masuk T0; opening → Bab 1 utuh.
- [ ] **T7.3 Reports + safe error states** — bahasa aman ("Cerita ini sedang dirapikan penulisnya"); bab rusak tak dipaksa publish.
- [ ] **Exit Criteria M7** — onboarding sampai Bab 1 mulus; laporan pembaca menautkan referensi kanonik.

## M8 — Observability, Alert, Entitlement/Checkout

- [ ] **T8.1 Dashboard konsistensi** — NTM G3-METRICS — `continuity_critical_rate` per bab, `repair_success_rate`, `review_required_rate`, thread staleness, `reader_inconsistency_report_rate`; tampil di dashboard.
- [ ] **T8.2 Alert** — alert saat `continuity_critical_rate` naik monoton terhadap nomor bab; ter-trigger di fixture regresi kompaksi.
- [ ] **T8.3 Entitlement + checkout webhook** — hanya webhook server terverifikasi memberi akses; tak ada entitlement otoritatif dari klien.
- [ ] **Exit Criteria M8** — observability + alert + pembayaran aman-server berjalan.

## M9 — Hardening + Release Gate + Beta Cut

- [ ] **T9.1 Isi seluruh baris NTM ke `DONE`** — verifikasi kelima bukti per baris (NTM §4).
- [ ] **T9.2 Release gate** — build ditolak bila ada baris in-scope belum `DONE`, jargon Narraza/AI bocor di client mana pun, soak 50 bab gagal NCS §8, atau web build / Android build / API contract gagal.
- [ ] **T9.3 Staging QA end-to-end** di device nyata + privacy review data.
- [ ] **Exit Criteria M9 (beta-ready)** — ARCH §18.3 + NTM §2 hijau; soak 50 bab 3 jalur bersih; semua ending reachable; biaya/bab dalam guardrail.

---

## Sign-off per Milestone (wajib sebelum menandai milestone selesai)

Salin blok ini per milestone saat menutupnya (runbook §4):

- [ ] Semua task DoD terpenuhi (kode + unit test + migration/fixture/metrik sesuai lingkup).
- [ ] Semua ID baris NTM dalam lingkup milestone = `DONE` dengan bukti lengkap.
- [ ] CI hijau termasuk fixture terkait.
- [ ] Tidak ada pelanggaran ARCH §23 (23 rules).
- [ ] Exit Criteria milestone tertulis terpenuhi dan terverifikasi (bukan diasumsikan).
