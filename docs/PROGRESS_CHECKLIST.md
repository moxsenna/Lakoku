# Lakoku — Progress Checklist (Task Tracker) v1.0

**Status:** Living document — dicentang seiring pekerjaan berjalan
**Last updated:** 12 Juli 2026 — **AMENDMENTS v0.7 admin ops surface + onboarding premise-AI + bilik ketujuh** captures commit `5ac66b4` back through `da0cf49` (11 Juli 2026): admin panel MVP + editable settings + audit log + admin role system + ops-ready credit/generation/AI-model config + interactive onboarding flow (AI premise generation, session management) + chapter list dialog & re-read with locked choices + remove consequence phase (direct redirect to next chapter) + premium `bilik-ketujuh-kbm-v2` seed (50-bab handcraft + beat table) in explore UI + grant-credit-form email autocomplete + taste profile + analytics events. Prior baselines retained: AMENDMENTS v0.5 ownership/share MVP, AMENDMENTS v0.6 prose rhythm contract (800–1000 kata / 35–50 paragraf; prompt-engine; demo handcraft 1–3 + generator 4–50). Audit NTM: M5 core/smoke hijau; G1/G4 belum `DONE` penuh; M8/G3-METRICS `DONE`.
**Turunan dari:** `docs/IMPLEMENTATION_PLAN.md` (runbook v1.0) — jika runbook berubah, sinkronkan checklist ini di PR yang sama (anti-drift, runbook §5)
**Cara pakai:** Setiap task = satu checkbox. Centang HANYA bila Definition of Done (DoD) task terpenuhi. Milestone dianggap selesai hanya bila blok Sign-off-nya lengkap (lihat runbook §4).

## Legenda status

- `[ ]` — belum dikerjakan
- `[~]` — sebagian (deviasi/parsial dicatat di baris "Catatan")
- `[x]` — selesai, DoD terverifikasi (bukan diasumsikan)

## Ringkasan status milestone

| Milestone | Status | Catatan singkat |
|---|---|---|
| M0 — Repo, tooling, CI skeleton | `[~]` | **Batas paket LOGIS §5.1 ditegakkan** via alias `@lakoku/{narrative-core,ai-gateway,runtime,db,api,contracts}` (+ entry `/server` untuk seam `server-only`) + barrel `index.ts` tiap paket + aturan boundary ESLint (`no-restricted-imports`, arah dependensi `db→narrative-core→ai-gateway→runtime`, `api→db`). CI minimal `.github/workflows/ci.yml` menjalankan install, lint, typecheck, build, smoke. Gate lokal hijau. Repo masih belum monorepo penuh `apps/*`/`infra/*`; Prettier/Vitest belum. |
| M1 — Contracts + DB + RLS | `[~]` | Supabase terhubung; skema reader-path + RLS read publik + seed; **auth + `reader_states` per-user RLS pemilik-saja hidup**. `packages/contracts` sekarang sumber tunggal reader API (Zod + JSON Schema/OpenAPI + tipe `z.infer`), `lib/api/types.ts` hanya compatibility barrel. `packages/db` & sebagian domain naratif ARCH §13.1 belum |
| M2 — Runtime lifecycle + fake gen E2E | `[~]` | Runtime interim di app Next.js (`lib/runtime/`) + RPC atomik Postgres: event log, idempotency, lease, publish_chapter, **release_generation_lease**, fake gen E2E, ETag. **Jalur generasi NYATA (`story-generation.ts`) juga menyala** — E2E 21/21 di DB nyata. Harness invariant hijau. Struktur `packages/runtime` (monorepo) belum |
| M3 — Memory hierarchy + Layer A + alias | `[~]` | narrative-core interim di `lib/narrative/` + 12 tabel canon (RLS deny-default): alias resolver, context compiler T0–T3 + budget + load-bearing protection, Layer A (8 cek). Simulasi 50 bab + 8 cek negatif hijau (13/13). Struktur `packages/narrative-core` (monorepo) belum |
| M4 — Template + provider gateway | `[~]` | `lib/ai-gateway/` (schema Zod plan/draft, provider deterministik + `selectProvider()`, gateway consumer-safe, repair loop) + template `lakoku_drama_bangkit_v1`. **Terpasang di jalur runtime nyata** (E2E 21/21). Harness 27/27 hijau. **Provider LLM NYATA `createGatewayProvider` HIDUP & TERUJI** (`NARRATIVE_PROVIDER=gateway`): arah A — LLM menulis prosa via `streamText`, metadata canon-derived → Layer A/B & consumer-safe terjaga. `resolveModelChain()` = rantai fallback: tunnel kustom → OpenRouter (array `models` gratis→berbayar: hermes-405b-free → deepseek-v3.2) → AI Gateway. **Smoke `scripts/m6-llm-smoke.ts` 20/20 PASS** di 3 skenario (tunnel-only, OpenRouter-only, rantai penuh; prosa Indonesia; events/reveals identik deterministik). Struktur `packages/ai-gateway` (monorepo) belum |
| M5 — Reconciliation + thread + Layer B | `[~]` | Core reconciliation, Layer B, thread lifecycle, loader canon, dan soak 3 jalur×50 bab hijau (236/236, 0 CRITICAL). Jalur runtime nyata sudah memakai loader→compiler→Layer A/B→repair→publish, tetapi step R act-end (`runReconciliation*`) dan side-effect status thread penuh belum di-wire ke workflow runtime. Karena itu NTM G1/G4 masih `IN_PROGRESS`, bukan `DONE`. |
| **M6-WEB — Web reader mobile-first** | `[~]` | **Jalur UX TUNTAS** dan `client.ts` sudah menunjuk Reader API interim (route handlers→Supabase). Jalur cerita nyata terkendali untuk canon ter-seed sudah hidup, tetapi publikasi AI luas tetap menunggu M5 NTM sign-off + release gate M9. **Ekstensi M6-WEB++ (AMENDMENTS v0.7):** consequence phase dihapus, chapter list dialog + re-read, onboarding interaktif AI premise, premium seed `bilik-ketujuh-kbm-v2` di explore UI. |
| M6 — Android reader beta | `[ ]` | Client kedua; belum dimulai |
| M7 — Story Foundation + opening + reports | `[x]` | Selesai |
| M8 — Observability + alert + entitlement | `[x]` | **Selesai** — T8.1 dashboard konsistensi (`/admin/consistency`, 5 metrik G3-METRICS, `m8-metrics` 29/29), T8.2 alert naik-monoton + notifikasi eksternal (`m8-alert` 24/24), T8.3 entitlement webhook HMAC server-authoritative fail-closed (`m8-entitlement` 22/22). T8.3 live tinggal colok Stripe (`CHECKOUT_WEBHOOK_SECRET` + skema commercial). **Permukaan admin tambahan (AMENDMENTS v0.7):** `/admin` overview + `/admin/users|credits|payments|generation|settings` + RBAC + audit log — lihat blok "Admin Ops Surface" di bawah. |
| M9 — Hardening + release gate + beta cut | `[~]` | Release gate otomatis web (`scripts/m9-release-gate.ts`) + staging QA checklist sudah ada dan masuk CI. Beta-ready global belum: NTM G1/G4 dan QA staging manual masih perlu sign-off. Smoke `admin-panel` masuk `pnpm smoke`. |

---

## M0 — Repo, Tooling, CI Skeleton

- [ ] **T0.1 Monorepo scaffold** — struktur `apps/`, `packages/`, `infra/`, `fixtures/`, `docs/` (ARCH §5); pnpm workspaces; tiap paket punya `package.json` + `tsconfig` extend base.
- [~] **T0.2 Tooling dasar** — TS strict, ESLint, Prettier, Vitest; `pnpm lint && pnpm typecheck && pnpm test` hijau di repo kosong.
  - [x] `AGENT_RULES.md` (ringkasan ARCH §23) — sudah dibuat di root repo.
  - [x] ESLint 9 flat config (`eslint.config.mjs`) — `eslint-config-next/core-web-vitals` + `/typescript`, prefix `_` dihormati. `pnpm lint` (eslint .) & `tsc --noEmit` hijau.
  - [x] TS strict aktif (`tsconfig.json`).
  - [x] Script gate lokal tersedia: `pnpm typecheck`, `pnpm test`, `pnpm smoke`, dan smoke per milestone (`smoke:m4`, `smoke:m5`, `smoke:m7-*`, `smoke:m8-*`).
  - [ ] Prettier & Vitest belum disiapkan.
- [~] **T0.3 CI skeleton** — `.github/workflows/ci.yml` menjalankan `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, dan `pnpm smoke`.
  - [x] Gate lokal ekuivalen CI hijau pada 7 Juli 2026.
  - [ ] Migration/ownership check formal belum masuk workflow; actual PR run belum bisa diverifikasi lokal.
- [ ] **Exit Criteria M0** — pipeline CI hijau; batas kepemilikan paket terdokumentasi.
- **Catatan:** Repo sekarang adalah satu app Next.js di root (`app/`, `components/`, `lib/`) + package kontrak `packages/contracts`, belum monorepo ARCH §5 penuh. `docs/` sudah ada. `AGENT_RULES.md` + ESLint flat config + TS strict + CI minimal sudah ada; Prettier/Vitest belum. Saat T0.1 (monorepo) dibuat, `eslint.config.mjs` root ini dipindah/di-extend ke konfig workspace.

## M1 — Contracts + DB Baseline + RLS

- [~] **T1.1 `packages/contracts`** — Zod + JSON Schema + tipe ter-generate untuk endpoint ARCH §11.1; larangan duplikasi tipe ditegakkan.
  - [x] `packages/contracts` ada sebagai workspace package; schema reader API ditulis di Zod, tipe berasal dari `z.infer`, JSON Schema diturunkan via `z.toJSONSchema()`, dan `openApiDocument` memuat endpoint reader aktif (`stories`, `story`, `chapter`, `choices`, `report`).
  - [x] `lib/api/types.ts` menjadi compatibility barrel ke `@lakoku/contracts`; route POST `choices`/`report` memakai schema request kontrak; `scripts/contracts-smoke.ts` 16/16 PASS dan masuk `pnpm smoke`.
  - [ ] Coverage endpoint ARCH §11.1 yang belum aktif (`bootstrap`, `status`, `progress`, `catalog`, `assets`) + contract HTTP test/ownership test formal belum selesai.
- [~] **T1.2 Skema kanonik baseline** (`packages/db` + `infra/supabase`) — migrasi domain ARCH §13.1 termasuk `character_aliases`, `character_voice_sheets`, `act_rollups`, `facts_ledger.salience/.load_bearing`, `story_threads.status/.payoff_window`, `chapter_blueprints.version/.reconciled_from_version/.reconciliation_reason`, event `BLUEPRINT_RECONCILED`; migration test naik-turun lulus.
  - [x] **Reader-path baseline (subset)**: Supabase terhubung; migrasi `reader_path_baseline` + `align_schema_to_contract` membuat `stories`, `chapters`, `choice_outcomes` (selaras 1:1 dengan `@lakoku/contracts` via compatibility barrel `lib/api/types.ts`); seed dari fixtures via `scripts/seed-supabase.ts` (idempotent upsert). Fixtures kini HANYA seed/fallback — sumber kebenaran konten adalah Supabase.
  - [x] **Reader-state per-user**: migrasi `reader_states_per_user` (PK `(user_id, story_id)`; status/current_chapter/jejak/ending_name) menggantikan kolom DEMO global di `stories` untuk pengguna login. Kolom demo di `stories` kini hanya fallback tamu.
  - [ ] Domain naratif ARCH §13.1 (facts_ledger, story_threads, blueprints, aliases, voice sheets, dst.) belum — menunggu M3–M5.
- [~] **T1.3 RLS + ownership harness** — RLS tiap tabel reader-private + test cross-user (story A tak terbaca user B).
  - [~] RLS konten published: historis “read publik (anon)” untuk shell/chapters **dibatasi ulang** oleh AMENDMENTS v0.5 — playthrough user **bukan** katalog publik. Publik hanya demo resmi + teaser `shared_story_links`. Migrasi ownership + RLS filter owner = backlog T-OWN-1.
  - [x] `reader_states` RLS pemilik-saja (`auth.uid() = user_id` untuk select/insert/update/delete) — reader-private ditegakkan di DB. Terverifikasi: baris tercatat terikat `user_id` saat user uji memilih.
  - [ ] Ownership test cross-user formal (user B tak bisa baca baris user A) sebagai test otomatis di CI — menunggu M0 harness test + T-OWN-1.
  - [x] **Proteksi rute** (`lib/supabase/proxy.ts`): tamu yang membuka `/baca`,`/akhir`,`/koleksiku` diarahkan ke `/auth/login?next=<asal>` (sanitasi path internal, anti open-redirect). Jelajah `/beranda`,`/cerita` & `/profil` (punya CTA masuk) tetap publik. Terverifikasi E2E.
  - [x] **Rekonsiliasi progres MONOTONIC lintas-perangkat** (`applyChoiceToUserState`): `current_chapter` via `Math.max`, `status` via rank `BARU<BERJALAN<SELESAI` (tak pernah turun), `ending_name` dipertahankan saat SELESAI, jejak digabung per-bab lalu diurutkan. Terverifikasi: pilihan bab-1 yang datang setelah watermark SELESAI/bab-5 TIDAK menurunkan progres.
- [ ] **Exit Criteria M1** — migrasi + RLS + ownership test lulus di CI; `packages/contracts` jadi acuan tunggal.
- **Catatan:** Kontrak reader API kini hidup di `packages/contracts`; `lib/api/types.ts` hanya menjaga kompatibilitas impor lama.

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
  - [~] Contract test formal: smoke Zod/OpenAPI reader API (`scripts/contracts-smoke.ts`) sudah masuk `pnpm smoke`; ownership test otomatis masih menunggu harness DB/CI.
- [~] **Exit Criteria M2** — end-to-end fake publish jalan; invariant idempotensi & atomicity terbukti.
  - [x] Fake publish E2E jalan (harness + HTTP); idempotensi & atomicity terbukti.
  - [~] Contract/ownership test suite formal di CI — smoke kontrak masuk CI minimal; ownership DB cross-user belum.

## M3 — Memory Hierarchy + Layer A Validator + Alias ⭐ fondasi konsistensi

- [~] **T3.1 Context compiler + T0–T3** (`packages/narrative-core`) — NTM G2-TIERS, G2-BUDGET — Chapter Context Packet (ARCH §12.2) + budget policy NCS §2.2; T1 rollup otomatis (WF step 9).
  - [x] `lib/narrative/compiler.ts`: `compileContext()` menghasilkan packet §12.2 (contextVersion, phase, chapterGoal, forbiddenReveals, activeThreads, loadBearingFacts, relevantFacts, actRollups T1, voiceSheets, budgetReport). Budget policy §2.2 (alokasi per-seksi, seksi keras tak dipotong, T2/rollup tertua dikompres dulu). Skema 12 tabel canon (ARCH §13.1) via migrasi `narrative_canon_baseline`.
  - [x] Skema canon: `characters`, `character_states`, `character_aliases`, `character_voice_sheets`, `facts_ledger` (+salience/load_bearing/paid_off), `knowledge_scopes`, `secrets_reveals`, `timeline_events`, `story_threads` (+status/payoff_window), `act_rollups`, `chapter_blueprints` (+version/reconciled_from/reason), `retrieval_logs` — semua RLS deny-default.
  - [x] Loader Supabase→snapshot nyata + integrasi runtime ada: `loadCanonSnapshot()` dipanggil oleh `generateNextChapterReal()` sebelum `compileContext()`.
  - [ ] T1 rollup **otomatis** saat act selesai (WF step 9) — belum menjadi side-effect runtime; kini rollup di-supply via canon/fixture.
- [x] **T3.2 Load-bearing protection + retrieval log** — NTM G2-LOADBEAR — fakta `LOAD_BEARING` belum-dibayar TAK PERNAH dipangkas (terbukti di budget ketat 40 token); exclusion list (`includedIds`/`excludedIds` + `budget_report`) siap ditulis ke `retrieval_logs`.
- [x] **T3.3 Layer A deterministic validator** — NTM G3-LAYERA — `lib/narrative/layer-a.ts`, 8 cek tanpa LLM: (1) karakter terdaftar & hidup/aktif & sudah diperkenalkan [CRITICAL], (2) no reveal pre-gate [CRITICAL], (3) knowledge scope [CRITICAL], (4) state delta ⊆ allowed [CRITICAL], (5) timeline monotonic + hormati flashback [MAJOR], (6) struktur bab 500–800 kata/2–4 scene/ada choice [MAJOR], (7) resolusi alias [MAJOR], (8) larangan karakter baru bernama > Bab 30 tanpa blueprint [CRITICAL]. Semua terbukti menyala via uji negatif.
- [x] **T3.4 Alias registry** — NTM G5-ALIAS — `lib/narrative/alias.ts`: resolver canonical name + alias (case-insensitive, tipe NAME/NICKNAME/RELATION/TITLE) → `character_id`; mention tak ter-resolve = MAJOR (bukan karakter baru otomatis). Terbukti: "ibu mertua"→Ratna resolve, "Orang Asing" → ALIAS_UNRESOLVED.
- [~] **Exit Criteria M3** — simulasi deterministik ke Bab 50 (fixture) lolos Layer A; NTM G3-LAYERA dan G5-ALIAS sudah `DONE`, sedangkan G2-* tetap `IN_PROGRESS` sampai T1 auto-rollup/release gate lengkap.
  - [x] Fixture `fixtures/narrative/fixture-50.ts` (drama 50 bab, 8 act, reveal gate 12/20/32/45, karakter baru terencana Bab 33) + harness `scripts/narrative-layer-a.ts`: 50 bab valid lolos Layer A (0 finding) & 8 cek negatif menyala — **13/13 PASS**, tsc & lint hijau.
  - [x] Loader Supabase→snapshot nyata + integrasi ke jalur generasi sudah ada (`loadCanonSnapshot()` → `generateNextChapterReal()`).
  - [ ] T1 auto-rollup WF step 9 dan release gate biaya/konteks belum lengkap; lihat NTM G2-*.

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
- [~] **Exit Criteria M5** — NCS §8 hijau di soak deterministik, tetapi NTM M5 belum seluruhnya `DONE`.
  - **TERBUKTI**: `scripts/m5-soak.ts` **236/236 PASS** (soak 3 jalur + targeted G1/G3-B/G4). `tsc --noEmit` hijau; `eslint lib scripts` 0 error/0 warning; M4 harness tetap 27/27 (tanpa regresi).
  - **Runtime nyata**: `generateNextChapterReal()` sudah memuat canon dari Supabase, compile konteks + retrieval log, menjalankan `generateChapter()` (Layer A + G4 checks + Layer B + repair 2-lapis), consumer-safe guard, publish atomik, dan telemetri M8. Bukti sebelumnya: `scripts/e2e-real-generation.ts` 21/21 PASS di Supabase nyata.
  - **Belum NTM `DONE` penuh**: workflow runtime belum menjalankan step R act-end (`runReconciliation*`) untuk mem-persist blueprint versioned/event `BLUEPRINT_RECONCILED`; side-effect status/stale thread penuh juga masih disimulasikan di soak, belum menjadi langkah runtime produksi. Produksi AI luas tetap menunggu release gate M9.

## M6-WEB — Web Reader Mobile-First ⭐ client produksi pertama

> Dua-jalur: **Jalur UX (fixtures)** tak dikunci gate M5; **Jalur cerita nyata (AI ke pembaca)** menunggu M5 NTM sign-off penuh.

- [~] **T6W.1 Design system + app shell** — mobile-first (`max-w-md`, bottom nav), token Midnight Drama + Paper Cream, aksesibilitas (aria, `prefers-reduced-motion`); brand guard (tanpa "Narraza"/"AI generator").
  - Catatan: sudah ada di root (`app/`, `components/app-shell.tsx`), belum dipindah ke `apps/web` sesuai ARCH §5. Deviasi struktur monorepo (lihat M0/M1).
- [x] **T6W.2 Client-data seam `lib/api/`** — `types.ts`, `client.ts` (`listStories`/`getStory`/`getChapter`/`submitChoice`), fixtures internal terpisah dari UI; tak ada komponen yang impor sumber data langsung; ganti `client.ts` → Reader API tak sentuh komponen.
  - **TERBUKTI**: `client.ts` kini menunjuk Reader API interim (`/api/*` route handlers → Supabase) — komponen UI tidak berubah sama sekali saat penggantian. Halaman RSC pakai `lib/api/server.ts` (baca Supabase langsung, tanpa lompatan HTTP); komponen client tetap fetch via `/api/*`.
  - Reader API interim (AMENDMENTS v0.4 jalur "Next.js dulu, Workers nanti"): `GET /api/stories`, `GET /api/stories/[id]`, `GET /api/stories/[id]/chapters/[number]`, `POST /api/stories/[id]/choices`, `POST /api/stories/[id]/report`. Query Supabase pakai client anon TANPA cookies (aman untuk `generateStaticParams`; konten published memang publik by RLS).
  - Konsistensi tipe dengan `packages/contracts` (ARCH §11.1) kini diverifikasi oleh `scripts/contracts-smoke.ts`; `lib/api/types.ts` hanya re-export kompatibilitas.
- [x] **T6W.3 Reader + progress** — reader menampilkan bab sesuai cerita (bukan sample statis); loading state pakai bahasa naratif; progress monotonic yang persist lintas sesi.
  - Progress lokal: `lib/api/progress.ts` (cache client, monotonic, aman SSR) + `components/resume-chapter.tsx` (`useSyncExternalStore`, surface di beranda hero & CTA detail). Reader mencatat bab saat dibuka & saat maju.
  - Verifikasi browser (iPhone 14): pilih di `pesan-terakhir` bab 12 → `localStorage lakoku:progress:v1 = {"pesan-terakhir":13,...}`; beranda hero berubah "BAB 12 → BAB 13 DARI 50". Monotonic (hanya maju).
  - Baca berkelanjutan bab-ke-bab: tombol "Lanjut" memuat bab berikutnya di dalam reader via `/baca/[id]?bab=N` (bukan balik ke detail); reader di-`key` per bab agar remount bersih. Bab yang belum ada di fixtures dialihkan anggun ke `/cerita/[id]` (bukan 404).
  - Konten demo: "Di Balik Kaca" kini punya Bab 1→2→3 penuh (bounded branching konvergen) untuk pengalaman baca dari awal. Verifikasi browser: 1→2→3 mengalir, progress `di-balik-kaca:3`; minta `pesan-terakhir?bab=13` (belum ada) → redirect ke detail.
  - Catatan: cache lokal ini BUKAN sumber kebenaran; saat Reader API nyata siap, progres server direkonsiliasi (ambil terjauh) — ARCH §7.1.
- [~] **T6W.4 Choice submission + recovery + generation status** — via `submitChoice`; konsekuensi & bab berikutnya dari outcome seam.
  - [x] Anti double-advance (client): guard `submittingRef` di `reader-view.tsx` — tap ganda tidak mengirim `submitChoice` lebih dari sekali. Happy-path pilihan → konsekuensi → lanjut terverifikasi di browser.
  - [x] Synthetic choice fallback dihapus: `submitChoice()` menolak response gagal dan tidak lagi membuat konsekuensi/bab berikutnya di client.
  - [x] Pending-choice recovery web: `lib/api/pending-choice.ts` menyimpan choice gagal dengan idempotency key stabil, reader masuk phase pending setelah reload, retry memakai choice yang sama, pending hanya hilang setelah server menerima. Bukti: `scripts/web-release-smoke.ts` 9/9 PASS.
  - [~] Generation status server-authoritative tetap menunggu endpoint status/generation queue final; recovery web sudah tidak silent-advance.
- [x] **T6W.5 Verifikasi browser mobile** — alur beranda → baca → pilih → konsekuensi → lanjut lolos; type-check hijau (agent-browser, viewport mobile).
- [x] **T6W.6 UX Polish — Batch A (Quick Polish)** — 12 deliverable client-heavy, low-risk. Commit `a30e358`.
  - [x] A1 — Landing reciprocity badge ("3 bab gratis — tanpa kartu") di `app/page.tsx`.
  - [x] A2 — Onboarding smart defaults (`Pilihkan untukku`), momentum framing, ETA copy ("Biasanya 30–60 detik.") di `components/mulai/onboarding-flow.tsx`.
  - [x] A4 — Reader choice tap feedback (selected-state highlight segera) + adaptive delay (bounded, bukan fixed) di `components/reader-view.tsx`.
  - [x] A5 — Reader font minimum dinaikkan dari 15px ke 16px di `components/reader-view.tsx`.
  - [x] A6 — Fallback banner untuk unavailable chapter: banner eksplisit saat fallback terjadi (`components/chapter-unavailable-banner.tsx` baru).
  - [x] A7 — Library empty-state CTA ke `/mulai` di `app/koleksiku/page.tsx`.
  - [x] A8 — Numeric story progress (persentase) di `components/story-card.tsx`.
  - [x] A9 — Profile greeting (time-of-day) + free-chapter framing di `app/profil/page.tsx`.
  - [x] A10 — Credit pricing contrast + `Paling Hemat` badge + per-chapter microcopy di `app/kredit/page.tsx`.
  - [x] A11 — Payment return ETA + bounded balance polling (5× setiap 3 detik, max 15 detik) + manual refresh fallback (`components/credit-poller.tsx` baru + `/api/credits/balance`).
  - [x] A12 — Ending page placeholder cleanup: `Temukan Akhir Lain` disabled (coming-soon), `Bagikan` real via `navigator.share` + clipboard fallback, ending list discovered/undiscovered (`components/share-button.tsx` baru).
  - [x] A14 — Public credit pricing view: guest bisa lihat harga tanpa login; checkout tetap gated.
- [x] **T6W.7 UX Polish — Batch B (Flow Fixes)** — 2 deliverable. Commit `b81a9a6`.
  - [x] B1 — Guest-to-login preservation: stash onboarding draft lokal (expiry, no token/session/PII) sebelum `lockStoryBible`; redirect login dengan resume signal; restore draft setelah login; cleanup setelah sukses. Copy: "Masuk untuk menyimpan ceritamu" / "Cerita ini siap dikunci ke akunmu".
  - [x] B2 — Theme + text-size settings wiring: `FontSizeProvider` + shared state di reader & profile; theme via next-themes; baris lain (`Akses Cerita`, `Batas Konten`, `Akun dan Privasi`) disabled/coming-soon eksplisit.
- [x] **T6W.8 UX Polish — Batch C (Data Fixtures + Verification)** — 2 deliverable. Commit `55a0e74`.
  - [x] C1 — Stable completed-story seed script (`scripts/seed-selasa-demo.ts`): ID konstan `demo:selasa-akhir`, 50 bab + ending, delete-then-insert idempotent, reuse `buildFixtureSnapshot()` + `buildValidDraft()`.
  - [x] C2 — Targeted TestSprite replay untuk kasus yang tadinya blocked/mismatched.
- [x] **T6W.9 Poetry Lottie onboarding animation** — building screen kini menampilkan animasi Lottie quill/parchment (`components/mulai/poetry-lottie.tsx`, asset `public/lottie/poetry.json`) menggantikan brand text statis. Komponen `PoetryLottie` di-load via `next/dynamic` (ssr: false). Dependency baru: `lottie-react ^2.4.1`. Commit `814445c`.
- [x] **T6W.10 Performance optimization** — lazy load onboarding flow (`next/dynamic` di route `/mulai`), share shell layout across app routes, reduce redundant auth/reader fetches. Commits `8a90530`, `5536105`, `10dbda8`, `8ad5793`, `301d54f`.
- [x] **T6W.11 Cloudflare Workers hardening** — platform-safe OpenNext patch, harden Supabase env resolution untuk CF Workers Builds, force dynamic `/mulai` page untuk mencegah static generation di CF. Commits `ccf4f1c`, `5964366`, `7275abf`.

## M6-WEB++ — Reader UX extensions (AMENDMENTS v0.7)

> Tambahan jalur reader UX pasca-M6-WEB sebelum sign-off beta penuh. Terdokumentasi penuh di `docs/AMENDMENTS_v0.7.md`. Status: terpasang & terverifikasi; tidak terkunci gate M5 NTM.

- [x] **T6W.12 Hapus consequence phase + redirect langsung ke bab berikutnya** — `components/reader-view.tsx` tidak lagi menampilkan phase "konsekuensi" di halaman yang sama; `showOutcome()` sekarang `router.push()` ke bab N+1 begitu pilihan dikirim. Kartu "Pilihanmu sebelumnya" muncul DI ATAS judul bab baru (sumber: server `jejak` bila login, fallback `localStorage` bila tamu). Browser Back kembali ke bab sebelumnya (mode re-read). Commit `ac32a9f`.
  - Helper baru `lib/api/last-choice-summary.ts` (client-safe upsert localStorage untuk guest choice summary).
  - Copy loading bahasa naratif ("Pilihanmu sedang mengubah jalan cerita..."). Flow: Bab N → choose → loading → push Bab N+1 → kartu choice tampil.
- [x] **T6W.13 Chapter list dialog & re-read with locked choices** — dialog scrollable daftar bab dengan checkmark (bab sudah dibaca) + loading state, ditaut dari tombol "Daftar Bab" di reader settings panel. Mode re-read dideteksi via jejak match di `app/baca/[id]/page.tsx`; pilihan yang sudah dipilih sebelumnya ditampilkan sebagai **locked** dengan label "Pilihanmu waktu itu". CTA "Kembali ke Bab Terbaru" muncul di mode re-read. Commit `12a7260`.
  - Kontrak baru: `@lakoku/contracts` `ChapterMetadata` + `ListChaptersResponse` + endpoint `GET /api/stories/[id]/chapters` (spoiler gate: tidak bocor konten bab yang belum dibaca).
  - Server seam `lib/api/queries.ts#queryChapterMetadatas` (lightweight metadata query, bukan full chapter body); client `listChapters`. Smoke `contracts-smoke` mencakup tipe baru.
- [x] **T6W.14 Interactive onboarding flow + AI-driven premise generation** — onboarding pembaca (route `/mulai`) kini flow interaktif lengkap: `entry → quick (4 pertanyaan dari `lib/onboarding/question-presets.ts`) | customIdea (free-text) → 3 premis AI via `actProposeStorySetupPremises` → pilih 1 → pipeline otomatis: cast → misteri → dunia → kunci → Bab 1`. Komponen `components/mulai/onboarding-flow.tsx` menampilkan progress bar bertahap, building screen menampilkan animasi `PoetryLottie`. Session: guest draft tersimpan via `lib/onboarding-draft.ts` (`lakoku:onboarding-draft:v1`, TTL 30 menit, no PII) — restore setelah login resume. Commits `d3ad8b9`, `814445c`.
  - Server action `app/mulai/actions.ts#actProposeStorySetupPremises` — explain `StorySetupInputSchema.discriminatedUnion('mode', [quick | custom])`; prioritas prompt: (1) content boundaries / `avoidedTropes`, (2) custom idea / quick answers, (3) taste profile, (4) default engine. Composer pure `lib/onboarding/story-setup.ts` (`buildStorySetupIdea`) — no AI/DB calls.
  - Reuse engine `proposePremises` dari `lib/authoring/server` (sama dengan wizard `/brainstorm` T7.4); pembaca tunjuk ke `/brainstorm` bila ingin edit detail per-tahap.
  - Binding ke `TasteProfile` (dari `/onboarding/selera`) sebagai soft bias; guest `readGuestTasteProfile` dari storage lokal.
- [x] **T6W.15 Premium `bilik-ketujuh-kbm-v2` seed (50-bab handcraft + explore UI)** — fixture premium kedua (`fixtures/narrative/premium-bilik-ketujuh-kbm-v2.ts`, storyId `premium:bilik-ketujuh-kbm-v2`) dengan 50 bab naratif + 12 tabel canon + validation file. Cover art `public/covers/bilik-ketujuh.webp`. Ekspos di explore UI via `scripts/seed-premium-ui.ts` (delete-then-insert idempotent di `stories`, `chapters`, `choice_outcomes`) + `OFFICIAL_DEMO_STORY_IDS` di `lib/api/server.ts` menambahkan ID ini. Commits `660a67d`, `5ac66b4`, `33d2681`.
  - Validator `scripts/validate-premium.ts` run roundtrip via `buildAllPremiumBilikKetujuhKbmV2Drafts` + `buildPremiumBilikKetujuhKbmV2Snapshot`.
  - Bukan pengganti `demo:selasa-akhir`; dua demo resmi berjalan berdampingan (lihat AMENDMENTS v0.7 LD-DEMO-CATALOG).

- [x] **Exit Criteria M6-WEB (jalur UX)** — reader web E2E lolos dengan fixtures ✔; seam terpasang tanpa kebocoran ✔; brand guard lolos ✔; progress monotonic persist ✔; UX Polish Batch A/B/C tuntas ✔; guest-to-login preservation berfungsi ✔; theme + text-size settings nyata ✔; `tsc --noEmit` hijau ✔; **lint gate hijau** (`eslint .`, 0 error/0 warning) ✔.
- [~] **Exit Criteria M6-WEB (jalur cerita nyata)** — `client.ts` menunjuk Reader API nyata DAN M5 NTM sign-off penuh.
  - [x] `client.ts` menunjuk Reader API nyata (route handlers → Supabase). Verifikasi browser: beranda + reader + pilihan→konsekuensi semuanya dari database.
  - [~] M5 core hijau (validator + soak 50 bab), tetapi NTM sign-off penuh belum: G1/G4 masih `IN_PROGRESS`. Gate M9 otomatis sudah ada untuk web release, tetapi publikasi AI luas tetap menunggu sign-off NTM/staging.

## M6 — Android Reader Beta (client kedua)

- [ ] **T6.1 Design system + app shell** — `apps/android` (Compose, offline-first, ARCH §6); navigation graph + DI + tema Brand Guidelines v1.1.
- [ ] **T6.2 Auth + library cache + reader + progress** — reader render dari local data; progress monotonic.
- [ ] **T6.3 Choice submission + recovery + generation status** — repeat tap tak double-advance; status reader-safe tanpa metadata model.
- [ ] **Exit Criteria M6** �� alur baca + pilih + recovery lolos di device Android nyata.

---



## Admin Ops Surface (AMENDMENTS v0.7)

> Permukaan operasional admin baru — di luar `/admin/consistency` milik M8 T8.1. Tidak menggeser M8 sign-off; permukaan ini hidup seiring kebutuhan ops pra-beta. Diturunkan dari `docs/AMENDMENTS_v0.7.md` (LD-ADMIN-RBAC, LD-OPS-CONFIG, LD-SETTINGS-AUDIT, LD-ADMIN-GRANT, LD-ADMIN-PANEL).

- [x] **T-ADMIN-1 Admin role system (RBAC)** — peran admin dipindah dari hardcode email ke **DB sumber kebenaran** (tabel `admin_users`); sesi = cookie Supabase Auth; role = `owner | admin`. Migrasi `20260711020000_admin_users_role.sql`. Guard layout `app/admin/layout.tsx` memanggil `requireAdminUser()` (`lib/admin/auth.ts`): throw `Unauthenticated` / `Forbidden` bila tidak memenuhi. Middleware `middleware.ts` menambahkan matcher `/admin/:path*`. Commit `da0cf49`, `5b29c4f`.
  - `isAdminUser()` / `getAdminRole()` / `requireAdminUser()` (`lib/admin/auth.ts`, server-only, pakai `createAdminClient`).
  - RPC `admin_search_users_v1(p_email)` (`SECURITY DEFINER`, service-role only, max 10 hasil) untuk admin user search email (lihat T-ADMIN-GRANT).
- [x] **T-ADMIN-2 Ops credit & generation config** — sumber kebenaran bisnis dipindah ke DB; kode hanya validasi + fallback aman. Migrasi `20260711010000_ops_credit_config.sql`. Commits `da0cf49`, `cdc9b32`.
  - **`credit_products`** kolom baru: `normal_bonus_credits`, `first_topup_bonus_credits`, `marketing_badge`, `bonus_active`. Seed 6 SKU existing (`credits_starter` … `credits_ultra`).
  - **`credit_orders`** (baru): snapshot harga & kredit beku saat checkout (`price_idr`, `base_credits`, `bonus_credits`, `total_credits`, `bonus_kind ∈ {none, normal, first_topup}`, `status ∈ {created, paid, duplicate, failed}`); RLS owner-only.
  - **`has_paid_topup_v1(p_user_id)`** RPC (SECURITY DEFINER, service-role) — cek pernah topup berbayar (untuk first-topup bonus).
  - **`admin_credit_grants`** (audit trail grant manual admin) + RPC atomik `admin_grant_credits_v1(...)`: insert grant + kredit ledger in 1 tx, idempoten via `ledger_ref` unique.
  - **`generation_policy`**: tabel singleton (PK `id=1`) — `target_words_min/max` (default 800/1000, selaras AMENDMENTS v0.6), `target_scenes` (default 3); RLS read-public.
  - **`ai_model_routes`**: satu route aktif per `use_case` (partial unique index `where is_active = true`); kolom `provider/model_id/fallback_models text[]/temperature/max_output_tokens/route_version/notes`. Seed default.
  - **`feature_credit_costs`**: seed `chapter_unlock=5` versi `2026-07-default`; runtime `unlock cost` kini baca dari sini (bukan `reading_policy`).
  - Smoke: `topup-bonus`, `admin-credit-grant`, `credits-policy`, `generation-policy`, `ai-model-routes` — semua masuk `pnpm smoke`.
- [x] **T-ADMIN-3 Editable admin settings + audit log** — owner dapat mengedit 4 area settings via dialog UI; admin (non-owner) read-only. Migrasi `20260711030000_admin_editable_settings.sql`. Commits `7395377`, `6d1c2f0`.
  - Tabel baru `admin_settings_audit_logs` (`admin_user_id`, `admin_email`, `setting_area`, `setting_key`, `old_value jsonb`, `new_value jsonb`, `reason text`, `created_at`); RLS deny-default; index `created_at desc` + `(setting_area, setting_key)`.
  - Zod schemas `lib/admin/settings-schemas.ts`: `updateCreditProductSchema`, `updateFeatureCreditCostSchema`, `updateGenerationPolicySchema`, `updateAiModelRouteSchema` — masing-masing bawa `reason` wajib (5–500 chars).
  - Server helpers `lib/admin/settings.ts` (`lib/admin/credits.ts`, `lib/ops/ai-model-routes.ts`, `lib/ops/generation-policy.ts` sebagai pembaca) — owner guard + insert audit log.
  - 4 PATCH API routes (`/api/admin/settings/credit-products`, `feature-costs`, `generation-policy`, `model-routes`) — owner-only; Forbidden 403 bila admin mencoba write.
  - GET `/api/admin/settings/read` mengembalikan flag `isOwner` untuk toggle UI read-only badge.
  - UI: `app/admin/settings/page.tsx` jadi client component dengan 4 dialog Edit: `EditCreditProductDialog`, `EditFeatureCreditCostDialog`, `EditGenerationPolicyDialog`, `EditAiModelRouteDialog` (fallback list add/remove dinamis). Tabel audit "Recent settings changes" tampil. Peringatan eksplisit bila `chapter_unlock = 0`.
- [x] **T-ADMIN-4 Admin panel MVP — full ops dashboard** — `/admin` overview + 5 sub-rute terhubung ke DB; guard layout + sidebar + header komponen. Commits `5b29c4f`, `7395377`, `33d2681`, `29b06f6`.
  - **Routes**:
    - `/admin` overview: 8 stat cards (total users, new today, credits circulating, used today, paid orders today, revenue today IDR, gen attempts today, gen failures today); metrik dari `lib/admin/dashboard.ts#loadAdminDashboardMetrics`.
    - `/admin/users` + `/admin/users/[id]`: email search (`searchAdminUsers` → RPC `admin_search_users_v1`) + detail user (identity, ledger, orders, admin grants).
    - `/admin/credits`: credit overview + latest ledger + admin grants + `GrantCreditForm` (reusable).
    - `/admin/payments`: order monitoring dengan status filter (all / paid / created / dll) — read-only (no reconcile/refund).
    - `/admin/generation`: generation health (attempts, success, failures, events).
    - `/admin/settings` (T-ADMIN-3): read-only badge untuk admin; Edit dialogs untuk owner.
    - `/admin/consistency`: tetap dari M8 T8.1.
  - **Components**: `AdminShell`, `AdminSidebar`, `AdminHeader`, `AdminStatCard`, `AdminSectionCard`, `AdminEmptyState`, `AdminErrorState`, `StatusBadge` (map `paid/failed/active/inactive`).
  - **GrantCreditForm** (`components/admin/grant-credit-form.tsx`): search user by email dengan debounce 300ms (min 2 chars, max 10 hasil) + dropdown picker (email + prefix user_id); fallback raw UUID bila dibuka dari user detail page. Submit mengirim `user_id` dari user terpilih. Commit `29b06f6`.
  - **Backend helpers**: `lib/admin/dashboard.ts`, `lib/admin/users.ts` (`searchAdminUsers`, `loadAdminUserDetail`), `lib/admin/orders.ts` (`listAdminOrders`), `lib/admin/generation.ts` (`loadAdminGenerationMetrics + events`), `lib/admin/credits.ts`, `lib/admin/format.ts` (`idr`, `compactNumber`).
  - Smoke statis: `scripts/admin-panel-smoke.ts` (file existence semua rute, guard di `layout.tsx`, middleware matcher, sidebar links, no hardcoded email/admin, settings tidak punya write action di admin role, payments tidak reconcile/refund, service role tidak muncul di client components) — masuk `pnpm smoke`.
- [x] **T-ADMIN-5 Taste profile + analytics events** — dua fondasi data ops pra-M9 (untuk personalisasi onboarding + metrikproduk) hidup. Migrasi `20260711000000_reader_taste_profiles.sql` + `20260711000001_analytics_events.sql`. Commit `da0cf49`, `660a67d`.
  - **Reader taste profiles**: skema `reader_taste_profiles` + flow onboarding `components/onboarding/taste-profile-flow.tsx` + first-run gate `taste-profile-first-run-gate.tsx` + settings panel `components/profile-settings.tsx`. Action `actGetTasteProfile`, `actSaveTasteProfile` di `app/onboarding/selera/actions.ts`. Smoke `taste-profile`, `taste-profile-db`.
  - **Analytics events**: route POST `/api/analytics/track` (`lib/analytics/client.ts`, `lib/analytics/events.ts`) + migrasi `analytics_events` tabel; smoke `analytics-smoke`.



- [x] `MOBILE_DRAMA_RHYTHM` + `lib/prose/prompt-engine` + fixtures/smoke
- [x] Demo beat table 50 + beat-fit
- [x] Handcraft demo bab 1–3 + generator 4–50 + demo-local-smoke
- [x] LLM writer wired to `buildWriterPrompt`
- [ ] Reseed remote `demo:selasa-akhir` setelah docs
- [x] PRD §4/§6.3/§9/§23.3 (v0.6) + `docs/AMENDMENTS_v0.6.md`

## M6-WEB+ — Ownership per-user + Share Ending Card (AMENDMENTS v0.5)

Diagnosis (sebelum fix): tamu “Tamu” bisa melihat puluhan kartu CERITA BERJALAN + stats profil dari status global `stories` karena tidak ada filter owner dan stats menghitung katalog.

- [x] **T-OWN-0 Hotfix UI jujur** — profil/beranda/koleksiku pakai `listMyLibraryStories` / `listExploreStories`; tamu stats 0; Jelajahi = demo `demo:*` saja.
- [~] **T-OWN-1 Ownership shell** — migrasi SQL + persist `owner_user_id` + storyId `slug-shortid` anti-collision di compile; belum apply remote DB / RLS list filter penuh.
- [x] **T-OWN-2 Seed `reader_states` on start** — `ensureReaderStateStarted` di lock (BARU) + `startFirstChapter` (BERJALAN); tidak update `stories.status` global di start.
- [x] **T-SHARE-1 Ending Card konten** — `/akhir` tropes + big choices non-spoiler + ShareButton copy “Coba jalurmu sendiri”; link stabil `/s/[slug]` masih T-SHARE-2.
- [x] **T-SHARE-2 `shared_story_links` + `/s/[slug]`** — migrasi remote applied; landing + create share + public teaser di beranda.
- [x] **T-SHARE-3 Start-from-share** — CTA → record `shared_story_starts` → `/mulai` playthrough baru; attach story id setelah lock (MVP foundation-copy penuh = T-SHARE-4).
- [ ] **T-SHARE-4 (later) `story_seeds`** — foundation-copy aman.
- [ ] **T-SHARE-5 (later) Challenge Route** — challenge ending rahasia non-spoiler.
- [ ] **Exit Criteria M6-WEB+ MVP** — T-OWN-0..2 + T-SHARE-1..3 selesai & terverifikasi.
- **Catatan:** Rename penuh ke `story_instances` boleh belakangan; interim `stories.owner_user_id` sah selama isolasi ditegakkan.


## M7 — Story Foundation, Proposal, Opening Package, Reports

- [x] **T7.1 Story Foundation flow + proposal selection** — user buat cerita → pilih proposal → lock story contract.
  - **Alur foundation→proposal→lock lengkap** di wizard `components/brainstorm/brainstorm-wizard.tsx` (route `/brainstorm`, ditaut dari onboarding `components/mulai/onboarding-flow.tsx`): tahap IDE → `actProposePremises(idea)` menghasilkan **3 usulan premis** → **pemilihan proposal** eksplisit (`setPremise(p)` dari daftar kartu + "Lihat premis lain" untuk memilih ulang) → penyempurnaan opsional (`actRefinePremise`) → cast/mystery/world → REVIEW → **kunci story contract** (`doLock` → `lockStoryBible`).
  - **Lock = story contract otoritatif**: `app/brainstorm/actions.ts#lockStoryBible` menjalankan tangga kegagalan `runLockLadder` (validate → AI repair → deterministic transform → escalate `needsAuthor`); hanya saat LOCKED → `enrichOpeningVoiceSheets` (T7.2) lalu `persistStoryBible` commit canon. Spine (act/gate 12/20/32/45/ending) tak pernah diubah — hanya konten. `NEEDS_AUTHOR` ditampilkan reader-safe (findings berbahasa cerita, tanpa istilah teknis).
  - **Bukti**: alur end-to-end fungsional (bersama T7.2 opening→Bab 1 & Exit Criteria M7 yang lebih dulu hijau). Verifikasi surface: tsc 0, eslint 0 (`app/brainstorm`, `components/brainstorm`). Catatan lingkungan: verifikasi browser tertunda karena env Supabase (`NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`) belum ter-sync ulang pasca-pull (middleware 404 di semua route) — bukan cacat T7.1.
- [x] **T7.2 Opening package + voice sheets** — NTM G5-VOICE — opening package membuat `character_voice_sheets`; voice masuk T0; opening → Bab 1 utuh.
  - **Opening Package (authoring)** `lib/authoring/opening.ts` (logika murni) — `selectOpeningCharacters()` memilih tokoh `introducedChapter ≤ 1` (protagonis + tokoh Bab 1; fallback protagonis), `enrichOpeningVoiceSheets(compiled, author)` MEMPERKAYA voice sheet tokoh pembuka via `VoiceSheetAuthorFn` (DI) lalu MERGE immutable ke snapshot. `validateAuthoredVoice()` pagar aman-pembaca (`scanForLeaks`) + butuh substansi (speechHabits & sampleLines). Best-effort: author gagal/null/menolak/hasil cacat → voice DASAR (turunan cast) dipertahankan, alur kunci→Bab 1 tak pernah buntu. Voice tokoh non-pembuka tak disentuh.
  - **Voice authoring (LLM)** `lib/authoring/opening-model.ts` (server-only) — `makeVoiceSheetAuthor()` via `authorObject` (model JSON-capable T7.4): mengarang register khas, kebiasaan bicara, kata terlarang, contoh dialog agar suara antar-tokoh berbeda tajam sejak Bab 1; output divalidasi bentuk (Zod) lalu semantik saat merge.
  - **Voice masuk T0** `lib/ai-gateway/gateway-provider.ts` — `voiceGuidance()` merakit voice sheet tokoh aktif (deterministik dari canon, bukan model) ke prompt penulisan prosa, sehingga dialog tiap tokoh khas & konsisten mulai Bab 1. Aman-pembaca (di-scan ulang di boundary gateway).
  - **Wiring** `app/brainstorm/actions.ts` `lockStoryBible` → setelah ladder LOCKED, jalankan `enrichOpeningVoiceSheets(makeVoiceSheetAuthor())` SEBELUM `persistStoryBible` (voice kaya ikut ter-commit ke `character_voice_sheets`), lalu `startFirstChapter()` men-generate Bab 1 dengan voice T0 aktif → opening → Bab 1 utuh.
  - **Bukti** `scripts/m7d-opening-smoke.ts` **17/17 PASS** (seleksi pembuka, validasi voice terima/tolak, enrich sukses hanya sentuh pembuka + immutable, fallback null/throw/cacat). Regresi hijau: tsc 0, eslint 0, `m7-authoring` 10/10.
- [x] **T7.3 Reports + safe error states** — bahasa aman ("Cerita ini sedang dirapikan penulisnya"); bab rusak tak dipaksa publish.
  - [x] **Safe error states (reader-facing)** — bab yang belum terbit tak lagi dialihkan diam-diam ke halaman detail. Reader kini melihat layar reader-safe yang tepat: `PREPARING` (ada lease generasi aktif → "Bab ini sedang ditulis", progress bar, auto `router.refresh()` tiap 6 dtk) vs `UNAVAILABLE` ("Cerita ini sedang dirapikan penulisnya" + tombol Coba lagi / Kembali). TIDAK pernah membocorkan detail teknis (layer gagal, temuan validator, model). `FAILED_REVIEW_REQUIRED` di runtime melepas lease tanpa publish, jadi bab rusak tak pernah dipaksa tampil.
    - `@lakoku/contracts` `ChapterAvailability` (`PUBLISHED`/`PREPARING`/`UNAVAILABLE`, diekspor ulang via `lib/api/types.ts`); `lib/api/leases.ts` `isChapterPreparing()` (admin client, `generation_leases` RLS-locked); `lib/api/server.ts` `getChapterAvailability()`.
    - `components/chapter-unavailable.tsx` (reader-safe screen); `app/baca/[id]/page.tsx` mengganti `redirect()` diam-diam. Verifikasi browser: kedua state (PREPARING + UNAVAILABLE) tampil benar di viewport mobile.
  - [x] **Reports (laporan pembaca + referensi kanonik)** — inti fitur (ARCH §7.9/§11.1): laporan MENAUTKAN referensi kanonik bab, BUKAN mengandalkan screenshot pembaca. Migrasi `content_reports` (RLS deny-default) + RPC `record_content_report_v1` (atomik: simpan laporan + `story_events(REPORT_FILED)` dgn seq berikutnya). `lib/api/reports.ts` `buildCanonicalRefs()` menurunkan jangkar kanon bab (tokoh aktif, rahasia yg SUDAH terungkap gate<=N, fakta load-bearing, utas aktif) dari `CanonSnapshot` — best-effort, kerangka minimal bila canon belum ada — lalu `submitContentReport()` commit via service-role. `canonical_refs` bersifat ops-facing (tak pernah dikembalikan ke pembaca → tanpa risiko spoiler/istilah teknis).
    - Kategori ramah-pembaca (`ReportCategory` + `REPORT_CATEGORIES` di `@lakoku/contracts`, diekspor ulang via `lib/api/types.ts`); dialog `components/report-dialog.tsx` di-wire ke tombol "Laporkan Masalah Cerita" di `components/reader-view.tsx`; `app/api/stories/[id]/report/route.ts` (validasi body via `SubmitReportRequestSchema`, ambil `reporter_id` dari sesi Supabase); client `submitReport()`. Respons reader-safe ("Terima kasih. Laporanmu sudah kami terima.").
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

- [x] **T8.1 Dashboard konsistensi** — NTM G3-METRICS — `continuity_critical_rate` per bab, `repair_success_rate`, `review_required_rate`, thread staleness, `reader_inconsistency_report_rate`; tampil di dashboard.
  - **Engine metrik (murni)** `lib/observability/metrics.ts` — `aggregateConsistencyMetrics()` deterministik & bebas efek samping: `continuity_critical_rate` (total + PER BAB via `continuityCriticalByChapter`), `repair_success_rate` (hanya attempt ber-repair), `review_required_rate`, `thread_staleness` (thread aktif non-RESOLVED yang `stale`), `reader_inconsistency_report_rate` (laporan/bab published). Plus `criticalTrend` (deteksi naik-monoton + longest-increasing-run) sebagai fondasi alert T8.2. Guard pembagian nol di semua rate.
  - **Telemetri (server)** `lib/observability/telemetry.ts` — `recordGenerationAttempt()` memancarkan event `GENERATION_ATTEMPT` ke `story_events` (append ber-seq via service-role, NON-KRITIS/try-catch — tak pernah menggagalkan generasi); `loadConsistencyInputs()`/`loadConsistencyMetrics()` memuat attempts + `story_threads` (kolom `stale`/`stale_since_chapter`/`is_main_mystery`) + event `REPORT_FILED` & `CHAPTER_PUBLISHED`, lalu agregasi. Barrel `index.ts` (murni, aman client) + `server.ts` (server-only).
  - **Wiring runtime** `lib/runtime/story-generation.ts` — emit attempt di boundary: `PUBLISHED` (setelah publish, hindari lomba seq) & `REVIEW_REQUIRED` (setelah lease-release), membawa `repairAttempts` + findings tersisa per severity.
  - **Dashboard** `app/admin/consistency/page.tsx` (server component, `force-dynamic`, safe error state ala T7.3) + komponen `components/dashboard/{metric-card,critical-rate-chart,stale-threads-list}.tsx`. API `app/api/admin/metrics/route.ts` (`?storyId=` opsional) untuk konsumen alert T8.2.
  - **Bukti** `scripts/m8-metrics-smoke.ts` **29/29 PASS** (rate, guard nol, per-bab, tren naik & non-naik, staleness RESOLVED-excluded, reader rate). Regresi hijau: tsc 0, eslint 0. Verifikasi browser `/admin/consistency` render live terhadap data Supabase nyata (4 bab, 9 thread aktif).
- [x] **T8.2 Alert** — alert saat `continuity_critical_rate` naik monoton terhadap nomor bab; ter-trigger di fixture regresi kompaksi.
  - **Engine alert (murni)** `lib/observability/alerts.ts` — `evaluateCriticalRateAlert(metrics, opts)` deterministik & bebas efek samping menerjemahkan `criticalTrend.monotonicIncreasing` (dari T8.1) jadi keputusan alert `CONTINUITY_CRITICAL_MONOTONIC`. Severity pakai target beta NCS §3.3 (`betaTargetForChapter`: Bab 1–20 < 2%, Bab 21–50 < 5%): akhir seri melampaui target → **CRITICAL**, masih di bawah → **WARNING** (early-warning kompaksi). Guard noise `minChapters` (default 3) agar tren 2-titik tak jadi false positive. `fingerprint` stabil (cakupan+rentang bab+severity) untuk dedup; `message` ops-facing (boleh sebut "kompaksi", tanpa istilah reader-facing/brand internal). Diekspor via barrel publik `index.ts` (aman client).
  - **Dispatcher eksternal (server-only)** `lib/observability/alert-dispatch.ts` — `dispatchConsistencyAlert()` evaluasi → kirim ke webhook Slack-compatible (`CONSISTENCY_ALERT_WEBHOOK_URL`, payload `{text}`). Best-effort mutlak (TAK PERNAH melempar — observability tak menjatuhkan jalur generasi/dashboard). Brand guard (`FORBIDDEN_BRAND_TERMS`) menahan alert bila bocor "Narraza"/"AI generator". Dedup per-proses (jendela 6 jam) meredam spam; `no-sink` bukan error (tetap log ops). `resetAlertDedup()` untuk uji/ops. Barrel `server.ts`.
  - **Wiring** `app/api/admin/alerts/route.ts` (GET evaluasi read-only untuk banner; POST evaluasi + kirim ke sink, untuk cron/uji) + banner dashboard `components/dashboard/alert-banner.tsx` di `/admin/consistency` (render hanya bila ada sinyal; warna semantik, makna di teks; role="alert").
  - **Bukti** `scripts/m8-alert-smoke.ts` **24/24 PASS** — fixture regresi kompaksi: seri per-bab NAIK monoton (kompaksi gagal) → alert CRITICAL + breach target beta; naik-monoton di bawah target → WARNING; jalur sehat/rata & naik-lalu-turun → TANPA alert; guard `minChapters`; determinisme fingerprint+pesan. Regresi hijau: tsc 0, eslint 0 (file T8.2), `m8-metrics` 29/29. Verifikasi browser `/admin/consistency` render live (banner absen benar pada data sehat) + `GET /api/admin/alerts` → `{alert:null}` (tanpa false positive).
- [x] **T8.3 Entitlement + checkout webhook** — hanya webhook server terverifikasi memberi akses; tak ada entitlement otoritatif dari klien.
  - **Engine verifikasi (murni)** `lib/entitlement/webhook.ts` — `verifyCheckoutWebhook(rawBody, sigHeader, {secret, tolerance, now})` provider-agnostik (format `t=<unix>,v1=<hex>` kompatibel Stripe). HMAC-SHA256 atas `"{t}.{rawBody}"` dengan `crypto.timingSafeEqual` (anti timing-leak); anti-replay via toleransi stempel waktu (default 300s); parse+validasi skema payload → pemetaan `type` ke aksi `grant`/`revoke`. **Fail-closed** di tiap cabang: `MISSING/MALFORMED/BAD_SIGNATURE`, `STALE_TIMESTAMP`, `MALFORMED_PAYLOAD`, `UNKNOWN_EVENT_TYPE`. Bebas I/O → diuji penuh tanpa jaringan.
  - **Port + store** `lib/entitlement/store.ts` — kontrak `EntitlementStore` (rekam event idempoten + SATU perintah `applyEntitlement`) & `InMemoryEntitlementStore` untuk fixture (assert `applyCount`/aktif). `store.server.ts` (server-only) impl Supabase: `payment_events.event_id` UNIQUE → konflik `23505` = replay `firstSeen=false`; grant lewat RPC tunggal `grant_entitlement_v1` (SECURITY DEFINER) sesuai ARCH §8.4/§16. Skema commercial belum di-provision → gagal terkendali (route map ke 5xx untuk retry, TIDAK fail-open).
  - **Orkestrator + route** `lib/entitlement/process.ts` (`processCheckoutWebhook`: verifikasi → rekam idempoten → satu grant/revoke; hasil `applied`/`duplicate`/`rejected`) + `app/api/checkout/webhook/route.ts` (baca body MENTAH untuk HMAC byte-exact; `rejected→400`, `duplicate/applied→200`, error DB→500, secret absen→503). Satu-satunya jalur penerbitan akses — tak ada callback klien/mobile yang cukup (ARCH §26.8 poin 8, §29).
  - **Bukti** `scripts/m8-entitlement-smoke.ts` **22/22 PASS** — valid→grant (tepat 1 apply); no/malformed/wrong-secret/tampered signature→ditolak tanpa akses; **body tampered menaikkan hak→BAD_SIGNATURE** (tak ada grant premium); stale timestamp→ditolak; **replay eventId sama→duplicate, tanpa grant ganda**; payload klien tanpa HMAC valid→tak pernah otoritatif; revoke→cabut akses; unknown/incomplete payload→ditolak; edge toleransi 300s→diterima. Gate hijau: tsc 0, eslint 0 (file T8.3); regresi `m8-alert` 24/24 & `m8-metrics` 29/29. Route live fail-closed 503 saat `CHECKOUT_WEBHOOK_SECRET` belum diset (tak fail-open ke grant).
- [x] **Exit Criteria M8** — observability + alert + pembayaran aman-server berjalan.

## M9 — Hardening + Release Gate + Beta Cut

- [ ] **T9.1 Isi seluruh baris NTM ke `DONE`** — verifikasi kelima bukti per baris (NTM §4).
- [~] **T9.2 Release gate** — build ditolak bila ada baris in-scope belum `DONE`, jargon Narraza/AI bocor di client mana pun, soak 50 bab gagal NCS §8, atau web build / Android build / API contract gagal.
  - [x] Gate otomatis web: `scripts/m9-release-gate.ts` dicek di CI setelah smoke; memblokir synthetic choice fallback, hilangnya pending recovery smoke, brand leak publik web, dan staging QA artifact yang hilang.
  - [ ] Gate global penuh untuk seluruh NTM/Android/release beta belum final.
- [~] **T9.3 Staging QA end-to-end** di device nyata + privacy review data.
  - [x] Checklist staging dibuat di `docs/STAGING_QA_WEB_RELEASE.md`.
  - [ ] Eksekusi QA staging nyata + bukti commit/SHA belum diisi.
- [ ] **Exit Criteria M9 (beta-ready)** — ARCH §18.3 + NTM §2 hijau; soak 50 bab 3 jalur bersih; semua ending reachable; biaya/bab dalam guardrail.

---

## Sign-off per Milestone (wajib sebelum menandai milestone selesai)

Salin blok ini per milestone saat menutupnya (runbook §4):

- [ ] Semua task DoD terpenuhi (kode + unit test + migration/fixture/metrik sesuai lingkup).
- [ ] Semua ID baris NTM dalam lingkup milestone = `DONE` dengan bukti lengkap.
- [ ] CI hijau termasuk fixture terkait.
- [ ] Tidak ada pelanggaran ARCH §23 (23 rules).
- [ ] Exit Criteria milestone tertulis terpenuhi dan terverifikasi (bukan diasumsikan).
