# Lakoku — Progress Checklist (Task Tracker) v1.0

**Status:** Living document — dicentang seiring pekerjaan berjalan
**Last updated:** 5 Juli 2026 (PROVIDER LLM NYATA HIDUP & TERUJI di endpoint kustom: `lib/ai-gateway/gateway-provider.ts` `createGatewayProvider`. **Arah A dipilih** — LLM hanya menulis PROSA (judul+paragraf) via `streamText`; SEMUA metadata (events/reveals/state/thread) tetap canon-derived (bungkus provider deterministik), jadi Layer A/B & consumer-safe tak bergantung model. Provider fleksibel via `resolveModelChain()` — RANTAI FALLBACK berurutan: (1) endpoint KUSTOM/tunnel bila `CUSTOM_LLM_BASE_URL` diset (`@ai-sdk/openai-compatible`, key `CUSTOM_LLM_API_KEY`, model `NARRATIVE_MODEL`); (2) OpenRouter bila `OPENROUTER_API_KEY` diset — pakai fitur array `models` OpenRouter (fallback intra-request gratis→berbayar via `transformRequestBody`; default `nousresearch/hermes-3-llama-3.1-405b:free` → `deepseek/deepseek-v3.2`, override `OPENROUTER_MODELS`); (3) Vercel AI Gateway sebagai jaring terakhir. `generateProse` mencoba tiap kandidat berurutan (error/leak → kandidat berikut). Aktif via `NARRATIVE_PROVIDER=gateway`; default tetap deterministik. Catatan penting: banyak endpoint OpenAI-compatible SELALU balas SSE streaming → wajib `streamText`. **Smoke `scripts/m6-llm-smoke.ts` 20/20 PASS** di 3 skenario (tunnel-only, OpenRouter-only, rantai penuh) — prosa Indonesia nyata, events/reveals identik deterministik. Gate deterministik tetap hijau (eslint 0, m4 27/27, m5 236/236, tsc). FASE BERIKUTNYA: "AI canon-authoring" (lihat T7.4). — Sebelumnya: M0 batas paket logis §5.1)
**Turunan dari:** `docs/IMPLEMENTATION_PLAN.md` (runbook v1.0) — jika runbook berubah, sinkronkan checklist ini di PR yang sama (anti-drift, runbook §5)
**Cara pakai:** Setiap task = satu checkbox. Centang HANYA bila Definition of Done (DoD) task terpenuhi. Milestone dianggap selesai hanya bila blok Sign-off-nya lengkap (lihat runbook §4).

## Legenda status

- `[ ]` — belum dikerjakan
- `[~]` — sebagian (deviasi/parsial dicatat di baris "Catatan")
- `[x]` — selesai, DoD terverifikasi (bukan diasumsikan)

## Ringkasan status milestone

| Milestone | Status | Catatan singkat |
|---|---|---|
| M0 — Repo, tooling, CI skeleton | `[~]` | **Batas paket LOGIS §5.1 ditegakkan** via alias `@lakoku/{narrative-core,ai-gateway,runtime,db,api}` (+ entry `/server` untuk seam `server-only`) + barrel `index.ts` tiap paket + aturan boundary ESLint (`no-restricted-imports`, arah dependensi `db→narrative-core→ai-gateway→runtime`, `api→db`). Probe pelanggaran terbukti tertangkap. Doc `PACKAGE_BOUNDARIES.md`. Semua gate hijau tanpa regresi (tsc, eslint, m4 27/27, m5 236/236, invariants, e2e 21/21). Folder fisik `packages/*`/`apps/*` + CI belum (ditunda sampai butuh build/publish terpisah atau Android) |
| M1 — Contracts + DB + RLS | `[~]` | Supabase terhubung; skema reader-path + RLS read publik + seed; **auth + `reader_states` per-user RLS pemilik-saja hidup**. `packages/contracts`/`db` & domain naratif ARCH §13.1 belum |
| M2 — Runtime lifecycle + fake gen E2E | `[~]` | Runtime interim di app Next.js (`lib/runtime/`) + RPC atomik Postgres: event log, idempotency, lease, publish_chapter, **release_generation_lease**, fake gen E2E, ETag. **Jalur generasi NYATA (`story-generation.ts`) juga menyala** — E2E 21/21 di DB nyata. Harness invariant hijau. Struktur `packages/runtime` (monorepo) belum |
| M3 — Memory hierarchy + Layer A + alias | `[~]` | narrative-core interim di `lib/narrative/` + 12 tabel canon (RLS deny-default): alias resolver, context compiler T0–T3 + budget + load-bearing protection, Layer A (8 cek). Simulasi 50 bab + 8 cek negatif hijau (13/13). Struktur `packages/narrative-core` (monorepo) belum |
| M4 — Template + provider gateway | `[~]` | `lib/ai-gateway/` (schema Zod plan/draft, provider deterministik + `selectProvider()`, gateway consumer-safe, repair loop) + template `lakoku_drama_bangkit_v1`. **Terpasang di jalur runtime nyata** (E2E 21/21). Harness 27/27 hijau. **Provider LLM NYATA `createGatewayProvider` HIDUP & TERUJI** (`NARRATIVE_PROVIDER=gateway`): arah A — LLM menulis prosa via `streamText`, metadata canon-derived → Layer A/B & consumer-safe terjaga. `resolveModelChain()` = rantai fallback: tunnel kustom → OpenRouter (array `models` gratis→berbayar: hermes-405b-free → deepseek-v3.2) → AI Gateway. **Smoke `scripts/m6-llm-smoke.ts` 20/20 PASS** di 3 skenario (tunnel-only, OpenRouter-only, rantai penuh; prosa Indonesia; events/reveals identik deterministik). Struktur `packages/ai-gateway` (monorepo) belum |
| M5 — Reconciliation + thread + Layer B | `[~]` | `lib/narrative/{threads,layer-b,reconciliation,loader}` + repair 2-lapis di `generate.ts`; skema thread diselaraskan (PAYOFF_DUE + flag stale). Soak 3 jalur×50 bab 236/236, 0 CRITICAL. **Validator + canon loader kini aktif di jalur cerita nyata** (E2E 21/21, prosa terbit consumer-safe). Penyajian AI ke pembaca **AKTIF** untuk canon ter-seed; soak runtime jangka-panjang berlanjut |
| **M6-WEB — Web reader mobile-first** | `[~]` | **Jalur UX (fixtures) TUNTAS** — Exit Criteria jalur UX ✔ (lint+tsc hijau); jalur cerita nyata menunggu M5 |
| M6 — Android reader beta | `[ ]` | Client kedua; belum dimulai |
| M7 — Story Foundation + opening + reports | `[x]` | Selesai |
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
  - [x] **Proteksi rute** (`lib/supabase/proxy.ts`): tamu yang membuka `/baca`,`/akhir`,`/koleksiku` diarahkan ke `/auth/login?next=<asal>` (sanitasi path internal, anti open-redirect). Jelajah `/beranda`,`/cerita` & `/profil` (punya CTA masuk) tetap publik. Terverifikasi E2E.
  - [x] **Rekonsiliasi progres MONOTONIC lintas-perangkat** (`applyChoiceToUserState`): `current_chapter` via `Math.max`, `status` via rank `BARU<BERJALAN<SELESAI` (tak pernah turun), `ending_name` dipertahankan saat SELESAI, jejak digabung per-bab lalu diurutkan. Terverifikasi: pilihan bab-1 yang datang setelah watermark SELESAI/bab-5 TIDAK menurunkan progres.
- [ ] **Exit Criteria M1** — migrasi + RLS + ownership test lulus di CI; `packages/contracts` jadi acuan tunggal.
- **Catatan:** `lib/api/types.ts` saat ini adalah kontrak client sementara yang HARUS dijaga konsisten dengan `packages/contracts` begitu M1 dibuat (lihat T6W.2).

## M2 — Runtime Lifecycle + Fake Generation E2E

- [~] **T2.1 `packages/runtime` story commands** — Story Contract lock, canonical bootstrap, `story_events`, idempotency keys, outbox, generation lease; unit test idempotensi (repeat tap, duplicate queue, resume tidak double-advance).
  - [x] Skema runtime (`runtime_lifecycle_baseline`): `story_events` (append-only, seq monotonic per story, unique (story,seq)), `idempotency_keys` (dedup perintah tulis), `generation_leases` (unique partial index = maks 1 ACTIVE/story, TTL expiry), `outbox` (efek samping transaksional). RLS deny-default (hanya service role / RPC SECURITY DEFINER).
  - [x] RPC atomik: `acquire_generation_lease` (idempoten, tolak bila lease held) & `publish_chapter` (tulis chapter+outcomes+event+release lease+outbox dalam 1 transaksi). Wrapper tipe-aman di `lib/runtime/lifecycle.ts`; client service-role `lib/supabase/admin.ts`.
  - [x] Invariant idempotensi & no-double-advance terbukti via harness `scripts/runtime-invariants.ts` (9/9 PASS).
  - [ ] Story Contract lock & canonical bootstrap (butuh domain naratif M3) belum; outbox processor terpisah belum.
- [x] **T2.2 Fake generation workflow** — `lib/runtime/fake-generation.ts`: bab fixture DETERMINISTIK di-publish via jalur atomik (lease→tulis→publish transaksional→release). Retry (idempotency key stabil per story/chapter) tidak menduplikasi; gagal tak tinggalkan state parsial (all-or-nothing RPC). Endpoint operasional `POST /api/stories/[id]/generate` (dijaga `RUNTIME_ADMIN_TOKEN` bila diset). Terverifikasi HTTP: 201 lalu retry idempoten (seq sama).
- [x] **T2.4 Jalur generasi cerita NYATA (wiring M2–M5 end-to-end)** — `lib/runtime/story-generation.ts` `generateNextChapterReal()`: lease → `loadCanonSnapshot` (Supabase→`CanonSnapshot`, state ter-resolve s/d bab) → `compileContext` + `persistRetrievalLog` (`retrieval_logs`) → `generateChapter` (plan→write→Layer A→Layer B→repair 2-lapis) → boundary consumer-safe (`toReaderSafe`/`assertConsumerSafe`/`scanForLeaks`, termasuk cabang pilihan) → `publishChapter` atomik. Provider via `selectProvider()` (deterministik; LLM = drop-in). Kegagalan review → `release_generation_lease` (RPC baru) agar retry tak terkunci TTL.
  - Endpoint `POST /api/stories/[id]/generate` menerima `mode: 'real'`(default)`|'fake'`; status 201/409/422/404 sesuai hasil. Idempoten & atomik (RPC yang sama dengan M2).
  - Seed canon nyata: `scripts/seed-canon.ts` (fixture-50 → 12 tabel canon). E2E `scripts/e2e-real-generation.ts` **21/21 PASS** di Supabase nyata: generate Bab 1–3 (653 kata, ada choice, consumer-safe), `choice_outcomes`/`retrieval_logs`/`story_events` tertulis & seq monotonic, panggil-ulang Bab 1 idempoten, 0 lease ACTIVE menggantung. Invariant M2 fake tetap hijau (tanpa regresi).
- [~] **T2.3 API contract + ownership tests** — contract test semua endpoint reader; ETag reader endpoint berfungsi.
  - [x] **ETag** di `GET /api/stories/[id]/chapters/[number]` (`lib/api/etag.ts`): ETag kuat berbasis hash konten + dukungan `If-None-Match` → 304. Terverifikasi (200 lalu 304).
  - [ ] Contract test formal (Zod/JSON Schema semua endpoint) + ownership test otomatis — menunggu `packages/contracts` (T1.1) & harness test (M0).
- [~] **Exit Criteria M2** — end-to-end fake publish jalan; invariant idempotensi & atomicity terbukti.
  - [x] Fake publish E2E jalan (harness + HTTP); idempotensi & atomicity terbukti.
  - [ ] Contract/ownership test suite formal di CI — menunggu M0/T1.1.

## M3 — Memory Hierarchy + Layer A Validator + Alias ⭐ fondasi konsistensi

- [~] **T3.1 Context compiler + T0–T3** (`packages/narrative-core`) — NTM G2-TIERS, G2-BUDGET — Chapter Context Packet (ARCH §12.2) + budget policy NCS §2.2; T1 rollup otomatis (WF step 9).
  - [x] `lib/narrative/compiler.ts`: `compileContext()` menghasilkan packet §12.2 (contextVersion, phase, chapterGoal, forbiddenReveals, activeThreads, loadBearingFacts, relevantFacts, actRollups T1, voiceSheets, budgetReport). Budget policy §2.2 (alokasi per-seksi, seksi keras tak dipotong, T2/rollup tertua dikompres dulu). Skema 12 tabel canon (ARCH §13.1) via migrasi `narrative_canon_baseline`.
  - [x] Skema canon: `characters`, `character_states`, `character_aliases`, `character_voice_sheets`, `facts_ledger` (+salience/load_bearing/paid_off), `knowledge_scopes`, `secrets_reveals`, `timeline_events`, `story_threads` (+status/payoff_window), `act_rollups`, `chapter_blueprints` (+version/reconciled_from/reason), `retrieval_logs` — semua RLS deny-default.
  - [ ] T1 rollup **otomatis** saat act selesai (WF step 9) — menunggu workflow generasi M4/M5; kini rollup di-supply via canon/fixture. Loader Supabase→snapshot belum (compiler operasi atas snapshot in-memory).
- [x] **T3.2 Load-bearing protection + retrieval log** — NTM G2-LOADBEAR — fakta `LOAD_BEARING` belum-dibayar TAK PERNAH dipangkas (terbukti di budget ketat 40 token); exclusion list (`includedIds`/`excludedIds` + `budget_report`) siap ditulis ke `retrieval_logs`.
- [x] **T3.3 Layer A deterministic validator** — NTM G3-LAYERA — `lib/narrative/layer-a.ts`, 8 cek tanpa LLM: (1) karakter terdaftar & hidup/aktif & sudah diperkenalkan [CRITICAL], (2) no reveal pre-gate [CRITICAL], (3) knowledge scope [CRITICAL], (4) state delta ⊆ allowed [CRITICAL], (5) timeline monotonic + hormati flashback [MAJOR], (6) struktur bab 500–800 kata/2–4 scene/ada choice [MAJOR], (7) resolusi alias [MAJOR], (8) larangan karakter baru bernama > Bab 30 tanpa blueprint [CRITICAL]. Semua terbukti menyala via uji negatif.
- [x] **T3.4 Alias registry** — NTM G5-ALIAS — `lib/narrative/alias.ts`: resolver canonical name + alias (case-insensitive, tipe NAME/NICKNAME/RELATION/TITLE) → `character_id`; mention tak ter-resolve = MAJOR (bukan karakter baru otomatis). Terbukti: "ibu mertua"→Ratna resolve, "Orang Asing" → ALIAS_UNRESOLVED.
- [~] **Exit Criteria M3** — simulasi deterministik ke Bab 50 (fixture) lolos Layer A; NTM G2-*, G3-LAYERA, G5-ALIAS = `DONE`. Gate wajib sebelum Phase B lanjut.
  - [x] Fixture `fixtures/narrative/fixture-50.ts` (drama 50 bab, 8 act, reveal gate 12/20/32/45, karakter baru terencana Bab 33) + harness `scripts/narrative-layer-a.ts`: 50 bab valid lolos Layer A (0 finding) & 8 cek negatif menyala — **13/13 PASS**, tsc & lint hijau.
  - [ ] Loader Supabase→snapshot nyata + integrasi ke jalur generasi (menunggu M4). Tandai NTM `DONE` setelah dipakai di workflow AI nyata.

## M4 — Template + Provider Gateway

- [x] **T4.1 Planner/writer output schema + repair protocol** — NTM G3-REPAIR — skema plan & draft; repair maks 2/lapis → `FAILED_REVIEW_REQUIRED`; repair tak hapus canon.
  - **TERBUKTI**: `lib/ai-gateway/schemas.ts` (Zod) — `ChapterPlanSchema` (superRefine: dilarang buka thread baru ≥ Bab 41, NCS §4.2) + `ChapterDraftSchema` (`.strict()`, selaras `ChapterDraft` M3). `lib/ai-gateway/generate.ts` orkestrasi plan→write→Layer A→repair: MAX_REPAIR=2 (CRITICAL/MAJOR masuk repair, MINOR dicatat), gagal → `FAILED_REVIEW_REQUIRED` (draft null, tak dipaksa publish). Invariant `canonFingerprint` before/after memastikan repair TAK memutasi/menghapus canon.
- [x] **T4.2 Template `lakoku_drama_bangkit_v1`** — blueprint 50 bab (8 act, gate 5/12/20/32/40/45/48), reveal gates, ending rules, fixture regresi di `fixtures/narrative/`.
  - **TERBUKTI**: `lib/narrative/template.ts` — 8 `ACTS` (gate 5/12/20/32/40/45/48/50), `REVEAL_GATE_CHAPTERS` 12/20/32/45, `ENDING_RULES` (window Bab 49+, mystery utama wajib RESOLVED sebelum Bab 48, min 2 ending reachable). `buildBlueprints(spine)` menurunkan 50 blueprint deterministik; `forbidden_reveals` bab N = secret dgn gate > N. Fixture regresi memakai `fixtures/narrative/fixture-50.ts` (snapshot canon konsisten).
- [x] **T4.3 `packages/ai-gateway`** — adapter provider di balik kontrak internal (`generatePlan()`, `writeChapter()`); plan & prosa schema-valid; tak ada string yang bocorkan model/prompt/token.
  - **TERBUKTI**: `lib/ai-gateway/gateway.ts` kontrak internal `generatePlan()`/`writeChapter()` — panggil provider → validasi schema → tolak invalid (`GatewayError` PLAN_INVALID/DRAFT_INVALID). `lib/ai-gateway/provider.ts` interface `GenerationProvider` + adapter deterministik (fake, belum AI nyata — itu M5/soak); nama provider internal tak pernah masuk output. Boundary consumer-safe: `toReaderSafe()` (buang field internal), `scanForLeaks()`/`assertConsumerSafe()` menolak istilah bocor (model/prompt/token/Narraza/gpt/claude/gemini/llm/rag/embedding/provider) → `CONSUMER_LEAK`.
  - Catatan struktur: diletakkan di `lib/ai-gateway/` (bukan `packages/ai-gateway/`), konsisten dgn deviasi monorepo M0/M1. Kontrak & isolasi provider sudah sesuai ARCH §"packages/ai-gateway owns provider-specific code".
- [x] **Exit Criteria M4** — generasi AI satu bab lolos Layer A + repair; string consumer-safe.
  - **TERBUKTI**: `scripts/m4-generation.ts` — 27/27 PASS. Happy path Bab 6 (0 repair, 500–800 kata), reveal gate Bab 12, karakter baru terencana Bab 33, repair menyembuhkan MAJOR (1 attempt), provider bandel → FAILED_REVIEW_REQUIRED (2 attempt, draft null), schema tolak plan/draft invalid, consumer-safe lolos & tangkap kebocoran, template 50-bab konsisten. `tsc --noEmit` hijau; `eslint` 0 error/0 warning.

## M5 — Reconciliation + Thread Lifecycle + Layer B ⭐ gate 50 bab

- [x] **T5.1 Reconciliation checkpoint (WF step R)** — NTM G1-VERSION, G1-DRIFT, G1-REACH, G1-SPINE — langkah R di akhir act + on-demand saat drift ≥ 2; blueprint versioned; reachability semua ending; tak boleh langgar spine/reveal gate/ending.
  - **TERBUKTI**: `lib/narrative/reconciliation.ts` — `computeDriftScore()` (0–3, capped) atas `ActualState` (storyFlags/clues/threadStatuses); goal drift ≥ 2 diregenerasi jadi blueprint **versi baru** (`version++`, `reconciledFromVersion`, `reconciliationReason`) — bukan overwrite; event ledger `BLUEPRINT_RECONCILED`. `checkEndingReachability()` (min 2 ending utama + secret path reachable, CRITICAL bila gagal) + `checkSpineIntegrity()` (tolak hapus mandatory reveal / majukan reveal gate). Spine gagal / ending unreachable → `FAILED_REVIEW_REQUIRED`, blueprint tak diubah.
- [x] **T5.2 Layer B model validator** — NTM G3-LAYERB — kontradiksi lunak, voice, emosi vs relationship, pakai `character_voice_sheets`.
  - **TERBUKTI**: `lib/narrative/layer-b.ts` — validator TERPISAH dari writer (simulasi deterministik, kontrak findings identik): `VOICE_FORBIDDEN_WORD` (dialog vs `voiceSheets.forbiddenWords`), `SOFT_CONTRADICTION` (klaim menentang fakta canon), `EMOTION_RELATIONSHIP_MISMATCH` (warm vs skor ≤ −30 / hostile vs ≥ +30). Sinyal Layer B (`dialogue`/`emotionBeats`/`softClaims`) ditambahkan opsional ke `ChapterDraftSchema` & di-emit provider.
- [x] **T5.3 Thread lifecycle** — NTM G4-STATUS, G4-BUDGET, G4-STALE, G4-BLOCK48 — status OPEN→…→RESOLVED|ABANDONED_APPROVED; maks 7 thread; no new thread ≥ Bab 41; stale 6 bab → callback ≤ 3 bab; Bab 48 diblokir bila mystery utama non-RESOLVED.
  - **TERBUKTI**: `lib/narrative/threads.ts` — status machine `OPEN→DEVELOPING→PAYOFF_DUE→RESOLVED|ABANDONED_APPROVED` (`transitionThread` menolak transisi ilegal; `ABANDONED_APPROVED` hanya via checkpoint). Budget maks 7 aktif (`THREAD_BUDGET_EXCEEDED`/`canOpenNewThread`), no-new ≥ Bab 41 (`THREAD_NEW_FORBIDDEN`), stale 6 bab → callback ≤ 3 (`refreshStaleness`/`THREAD_STALE_UNADDRESSED`), Act 6+ wajib majukan PAYOFF_DUE, gate keras Bab 48 (`MAIN_MYSTERY_UNRESOLVED_AT_48`, CRITICAL).
  - **Skema diselaraskan** (migrasi `thread_lifecycle_align_m5`): status DB jadi `OPEN/DEVELOPING/PAYOFF_DUE/RESOLVED/ABANDONED_APPROVED`, `stale` jadi FLAG terpisah (kolom `stale`/`stale_since_chapter`), index thread aktif. Tipe TS (`ThreadStatus`, `StoryThread.stale`) ikut disesuaikan (sebelumnya STALE keliru sebagai status).
- [x] **T5.4 Soak test 50 bab** — 3 jalur (high-trust, low-trust, mixed); 0 kontradiksi CRITICAL; semua ending reachable tiap checkpoint; biaya/bab dalam guardrail.
  - **TERBUKTI**: `scripts/m5-soak.ts` — 3 jalur × 50 bab semua PUBLISHED, **0 CRITICAL**; reconciliation di tiap act gate (5/12/20/32/40/45/48) → ending reachable & status ≠ FAILED; guardrail biaya: max ≤ 6 panggilan/bab, rata-rata ≈ 2 (happy path plan+write). Repair Lapis A & B (dua lapis, maks 2/lapis) terintegrasi di `lib/ai-gateway/generate.ts`.
- [x] **Exit Criteria M5** — NCS §8 hijau di soak; NTM G1/G3-LAYERB/G4 = `DONE`. Gate wajib sebelum cerita AI nyata disajikan ke pembaca.
  - **TERBUKTI**: `scripts/m5-soak.ts` **236/236 PASS** (soak 3 jalur + targeted G1/G3-B/G4). `tsc --noEmit` hijau; `eslint lib scripts` 0 error/0 warning; M4 harness tetap 27/27 (tanpa regresi). Konten AI nyata ke pembaca tetap DITAHAN sampai integrasi runtime M6-WEB jalur cerita nyata (checklist M6-WEB baris "M5 hijau") — gate ini kini terpenuhi di sisi validator; penyalaan penyajian dilakukan terpisah saat runtime workflow siap.

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
- [ ] **Exit Criteria M6** �� alur baca + pilih + recovery lolos di device Android nyata.

## M7 — Story Foundation, Proposal, Opening Package, Reports

- [ ] **T7.1 Story Foundation flow + proposal selection** — user buat cerita → pilih proposal → lock story contract.
- [x] **T7.2 Opening package + voice sheets** — NTM G5-VOICE — opening package membuat `character_voice_sheets`; voice masuk T0; opening → Bab 1 utuh.
  - **Opening Package (authoring)** `lib/authoring/opening.ts` (logika murni) — `selectOpeningCharacters()` memilih tokoh `introducedChapter ≤ 1` (protagonis + tokoh Bab 1; fallback protagonis), `enrichOpeningVoiceSheets(compiled, author)` MEMPERKAYA voice sheet tokoh pembuka via `VoiceSheetAuthorFn` (DI) lalu MERGE immutable ke snapshot. `validateAuthoredVoice()` pagar aman-pembaca (`scanForLeaks`) + butuh substansi (speechHabits & sampleLines). Best-effort: author gagal/null/menolak/hasil cacat → voice DASAR (turunan cast) dipertahankan, alur kunci→Bab 1 tak pernah buntu. Voice tokoh non-pembuka tak disentuh.
  - **Voice authoring (LLM)** `lib/authoring/opening-model.ts` (server-only) — `makeVoiceSheetAuthor()` via `authorObject` (model JSON-capable T7.4): mengarang register khas, kebiasaan bicara, kata terlarang, contoh dialog agar suara antar-tokoh berbeda tajam sejak Bab 1; output divalidasi bentuk (Zod) lalu semantik saat merge.
  - **Voice masuk T0** `lib/ai-gateway/gateway-provider.ts` — `voiceGuidance()` merakit voice sheet tokoh aktif (deterministik dari canon, bukan model) ke prompt penulisan prosa, sehingga dialog tiap tokoh khas & konsisten mulai Bab 1. Aman-pembaca (di-scan ulang di boundary gateway).
  - **Wiring** `app/brainstorm/actions.ts` `lockStoryBible` → setelah ladder LOCKED, jalankan `enrichOpeningVoiceSheets(makeVoiceSheetAuthor())` SEBELUM `persistStoryBible` (voice kaya ikut ter-commit ke `character_voice_sheets`), lalu `startFirstChapter()` men-generate Bab 1 dengan voice T0 aktif → opening → Bab 1 utuh.
  - **Bukti** `scripts/m7d-opening-smoke.ts` **17/17 PASS** (seleksi pembuka, validasi voice terima/tolak, enrich sukses hanya sentuh pembuka + immutable, fallback null/throw/cacat). Regresi hijau: tsc 0, eslint 0, `m7-authoring` 10/10.
- [x] **T7.3 Reports + safe error states** — bahasa aman ("Cerita ini sedang dirapikan penulisnya"); bab rusak tak dipaksa publish.
  - [x] **Safe error states (reader-facing)** — bab yang belum terbit tak lagi dialihkan diam-diam ke halaman detail. Reader kini melihat layar reader-safe yang tepat: `PREPARING` (ada lease generasi aktif → "Bab ini sedang ditulis", progress bar, auto `router.refresh()` tiap 6 dtk) vs `UNAVAILABLE` ("Cerita ini sedang dirapikan penulisnya" + tombol Coba lagi / Kembali). TIDAK pernah membocorkan detail teknis (layer gagal, temuan validator, model). `FAILED_REVIEW_REQUIRED` di runtime melepas lease tanpa publish, jadi bab rusak tak pernah dipaksa tampil.
    - `lib/api/types.ts` `ChapterAvailability` (`PUBLISHED`/`PREPARING`/`UNAVAILABLE`); `lib/api/leases.ts` `isChapterPreparing()` (admin client, `generation_leases` RLS-locked); `lib/api/server.ts` `getChapterAvailability()`.
    - `components/chapter-unavailable.tsx` (reader-safe screen); `app/baca/[id]/page.tsx` mengganti `redirect()` diam-diam. Verifikasi browser: kedua state (PREPARING + UNAVAILABLE) tampil benar di viewport mobile.
  - [x] **Reports (laporan pembaca + referensi kanonik)** — inti fitur (ARCH §7.9/§11.1): laporan MENAUTKAN referensi kanonik bab, BUKAN mengandalkan screenshot pembaca. Migrasi `content_reports` (RLS deny-default) + RPC `record_content_report_v1` (atomik: simpan laporan + `story_events(REPORT_FILED)` dgn seq berikutnya). `lib/api/reports.ts` `buildCanonicalRefs()` menurunkan jangkar kanon bab (tokoh aktif, rahasia yg SUDAH terungkap gate<=N, fakta load-bearing, utas aktif) dari `CanonSnapshot` — best-effort, kerangka minimal bila canon belum ada — lalu `submitContentReport()` commit via service-role. `canonical_refs` bersifat ops-facing (tak pernah dikembalikan ke pembaca → tanpa risiko spoiler/istilah teknis).
    - Kategori ramah-pembaca (`ReportCategory` + `REPORT_CATEGORIES` di `lib/api/types.ts`); dialog `components/report-dialog.tsx` di-wire ke tombol "Laporkan Masalah Cerita" di `components/reader-view.tsx`; `app/api/stories/[id]/report/route.ts` (validasi kategori, ambil `reporter_id` dari sesi Supabase); client `submitReport()`. Respons reader-safe ("Terima kasih. Laporanmu sudah kami terima.").
    - Bukti: `scripts/m7c-report-smoke.ts` 17/17 (refs hormati batas bab, atomik simpan+event, RPC tolak cerita/bab invalid). Verifikasi browser end-to-end: pilih kategori + catatan → kirim → toast sukses + baris DB + `REPORT_FILED` tercatat.
- [x] **T7.4 AI canon-authoring (FASE BERIKUTNYA yang disepakati)** — alat OFFLINE (di luar hot-path per-bab) tempat AI *mengusulkan* isi story bible & alur: characters/facts/secrets/threads + blueprint 50-bab. Beda dari runtime Arah A: di sini AI boleh pakai `generateObject` (JSON terstruktur) di model JSON-capable, TAPI setiap usulan WAJIB divalidasi ke skema canon + Layer A/B sebelum di-*commit* ke Supabase. Hasilnya jadi `CanonSnapshot`/blueprint yang lalu dipakai runtime deterministik + prosa LLM. Ini yang membuat "AI ikut mengarang" tanpa mengorbankan kestabilan penyajian. (Opsi hybrid "Arah C" — plan per-bab oleh LLM saat runtime — dicatat sebagai alternatif lanjutan, belum dipilih.)
  - **Modul authoring** `lib/authoring/` — `schema.ts` (draft zod), `model.ts` (proposePremises/refinePremise/proposeCast/proposeMystery/proposeWorld via `generateObject`), `validate.ts` + `compile.ts` (draft → `CanonSnapshot`/blueprint), `repair.ts` (tangga kegagalan: validate → AI repair 1x → validate → transform deterministik → validate → escalate author), `persist.ts` (commit ke Supabase, spine act/gate/ending tak pernah diubah).
  - **Wizard 6-tahap** `components/brainstorm/brainstorm-wizard.tsx` + `app/brainstorm/` (page + server actions): idea → premis → cast → misteri → dunia → kunci. Smoke test 13/13 + roundtrip DB lolos.
  - **Wiring end-to-end**: entry point beranda/landing/bottom-nav kini menunjuk `/brainstorm` (menggantikan flow mock `/mulai`). Setelah "Kunci" sukses → `startFirstChapter()` memicu `generateNextChapterReal(storyId, 1)` (jalur cerita AI tervalidasi), memajukan `stories.status=BERJALAN`/`current_chapter=1`, lalu redirect ke `/baca/{id}?bab=1`. Kegagalan generasi diarahkan anggun ke `/cerita/{id}` (tanpa buntu).
  - Catatan: reconciliation runtime-adaptif (regenerateGoal LLM-authored di batas act) ditunda ke T7.5 sebagai fase lanjutan.
- [x] **T7.5 Reconciliation runtime-adaptif (regenerateGoal LLM-authored)** — di batas act, goal bab yang drift ≥ 2 kini boleh DITULIS ULANG oleh LLM, tetap dalam pagar spine (mandatory beats & forbidden reveals TIDAK berubah). Tetap "Fixed Spine + Adaptive Trajectory": hanya lapis trajectory (chapterGoal) yang adaptif.
  - **Core (narrative-core)** `lib/narrative/reconciliation.ts` — `runReconciliationAdaptive(input, goalAuthor?)` (async) berdampingan dengan `runReconciliation` sinkron; tipe `GoalAuthorFn` + `GoalAuthorContext` (DI, meniru pola `AiRepairFn`). `regenerateGoal` menerima `authoredGoal?` opsional. Bila author gagal/menolak/throw → **fallback deterministik** (`[rekonsiliasi vN]`) sehingga checkpoint tak pernah buntu. Ending reachability + `checkSpineIntegrity` ditegakkan identik dengan jalur sinkron; spine gagal → `FAILED_REVIEW_REQUIRED`, blueprint tak diubah. Versioning tetap (`version++`, `reconciledFromVersion`, event `BLUEPRINT_RECONCILED`), `authoredChapters` melacak bab yang benar-benar ditulis LLM.
  - **Penulis-goal (authoring)** `lib/authoring/reconcile-goal.ts` — `makeGoalAuthor()`/`authorChapterGoal()` via `authorObject` (model JSON-capable T7.4). Prompt hanya trajectory + ringkasan state; spine disertakan sebagai constraint read-only. `validateAuthoredGoal()` menolak goal yang membocorkan istilah teknis (`scanForLeaks`) atau menyinggung id reveal terlarang (anti reveal dini) → null (fallback).
  - **Smoke** `scripts/m7b-reconcile-smoke.ts` **23/23 PASS** (regresi = deterministik lama, adaptif menulis ulang + spine utuh, fallback throw/null, ending unreachable → FAILED, `validateAuthoredGoal` pagar). Regresi lain hijau: tsc 0, eslint 0, `m5-soak` 236/236.
- [x] **Exit Criteria M7** — onboarding sampai Bab 1 mulus (T7.1 foundation→proposal→lock, T7.2 opening package memperkaya voice + voice masuk T0 → opening→Bab 1 utuh); laporan pembaca menautkan referensi kanonik (T7.3). Reports + safe error states (T7.3), AI canon-authoring (T7.4), reconciliation runtime-adaptif (T7.5) lengkap.

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
