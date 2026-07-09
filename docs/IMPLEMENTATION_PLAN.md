# Lakoku — Implementation Plan (Build Runbook) v1.0

**Status:** Executable build runbook untuk agen/engineer
**Last updated:** 10 Juli 2026 (AMENDMENTS v0.5 ownership + Share Ending Card MVP dikunci; UX Polish Batch A/B/C selesai, Poetry Lottie, CF Workers hardening)
**Owner:** Project lead
**Governs / mengikuti:** `PRD_Lakoku_Interactive_v0.3.md`, `ARCHITECTURE_v1.1.md`, `NARRATIVE_CONSISTENCY_SPEC.md` (NCS v1.0), `NARRATIVE_TRACEABILITY_MATRIX.md` (NTM v1.0), `AMENDMENTS_v0.5.md`

---

## 0. Cara Membaca & Menjalankan Dokumen Ini

Dokumen ini adalah **runbook**: urutan kerja dari repo kosong sampai beta 50 bab lolos soak test. Ia tidak mendefinisikan spesifikasi baru — spesifikasi tetap milik PRD/ARCH/NCS. Dokumen ini hanya mengubahnya menjadi **langkah yang bisa dieksekusi berurutan**.

**Aturan wajib untuk agen:**

1. Kerjakan **Milestone (M0–M9) secara berurutan**. Jangan mulai milestone berikutnya sebelum *Exit Criteria* milestone berjalan hijau.
2. Setiap task punya format tetap: **Deliverable · File/lokasi · Referensi spec · Definition of Done (DoD)**.
3. Setiap task yang menutup gap konsistensi **wajib mencantumkan ID baris NTM** (mis. `G2-LOADBEAR`) di PR, dan baris itu baru boleh jadi `DONE` bila kelima bukti di NTM §4 lengkap.
4. Patuhi **23 Non-Negotiable Engineering Rules** (ARCH §23) tanpa pengecualian. Jika sebuah langkah tampak melanggar salah satunya, berhenti dan minta keputusan produk.
5. Semua pekerjaan di satu monorepo (ARCH §5). Batas kepemilikan paket (ARCH §5.1) adalah aturan keras, bukan saran.
6. Jangan panggil provider AI dari client mana pun (web reader maupun Android); jangan commit state dari prosa tanpa validasi server + publish atomik; jangan pakai vector search sebagai sumber kebenaran canon.
7. **Client sequencing (AMENDMENTS v0.4, LD-CLIENT-SEQ):** web reader mobile-first adalah client produksi pertama (M6-WEB); Android native menyusul (M6) setelah metrik web terbukti. Semua client wajib mengakses data hanya lewat seam client-data async (`lib/api/`); komponen UI tidak boleh bergantung langsung pada sumber data. Brand guard (ARCH §16.3) berlaku identik untuk web dan Android.

**Definition of Done global (berlaku tiap task):** kode + test unit hijau + (bila menyentuh skema) migration test + (bila menyentuh gap) fixture di CI + (bila menyentuh metrik) muncul di dashboard, bukan sekadar log.

---

## 1. Peta Milestone (High-Level)

| Milestone | Nama | Fase ARCH §24 | Gap NTM yang ditutup | Gate keluar |
|---|---|---|---|---|
| M0 | Repo, tooling, CI skeleton | pra-Phase A | — | CI hijau, lint/typecheck/test jalan |
| M1 | Contracts + DB baseline + RLS | Phase A | — | Migrasi + RLS harness lulus |
| M2 | Runtime lifecycle + fake generation E2E | Phase A | — | Fixture chapter publish atomik & idempotent |
| M3 | Memory hierarchy + Layer A validator + alias | Phase B | G2, G3-LAYERA, G5-ALIAS | Simulasi deterministik ke Bab 50 (fixture) |
| M4 | Template `lakoku_drama_bangkit_v1` + provider gateway | Phase B | G3-LAYERB (awal) | Provider live, plan/prosa schema-valid |
| M5 | Reconciliation + thread lifecycle + Layer B penuh | Phase B/C | G1, G3-LAYERB, G4 | Soak 50 bab 3 jalur = NCS §8 hijau |
| M6-WEB | Web reader mobile-first (shell → reader → choice → koleksi/profil) sampai produksi ⭐ client pertama | Phase C | — | Reader E2E di browser mobile, seam `lib/api` terpasang, brand guard lolos |
| M6 | Android reader beta (shell → reader → choice) — client kedua, setelah metrik web terbukti | Phase C | — | Reader E2E di device nyata |
| M7 | Story Foundation, proposal, opening package, reports | Phase C | G5-VOICE | Onboarding → Bab 1 utuh |
| M8 | Observability, alert, entitlement/checkout webhook | Phase C | G3-METRICS | Dashboard + alert + webhook aman |
| M9 | Hardening + release gate + beta cut | Phase C | semua `DONE` | ARCH §18.3 + NTM §2 hijau |

---

## 2. Milestone Detail

### M0 — Repo, Tooling, CI Skeleton

**Tujuan:** kerangka monorepo bisa lint, typecheck, test, dan build sejak commit pertama.

- **T0.1 Monorepo scaffold**
  - Deliverable: struktur folder sesuai ARCH §5 (`apps/`, `packages/`, `infra/`, `fixtures/`, `docs/`).
  - Lokasi: root repo; workspace manager (pnpm workspaces).
  - Ref: ARCH §5.
  - DoD: `pnpm install` sukses; setiap paket punya `package.json` + `tsconfig` yang extend base.
- **T0.2 Tooling dasar**
  - Deliverable: TypeScript strict, ESLint, Prettier, Vitest, `AGENT_RULES.md` (ringkasan ARCH §23).
  - DoD: `pnpm lint && pnpm typecheck && pnpm test` hijau di repo kosong.
- **T0.3 CI skeleton**
  - Deliverable: `.github/workflows/ci.yml` menjalankan install, lint, typecheck, build, smoke deterministik; migration check menjadi tambahan saat harness DB formal siap.
  - Ref: ARCH §18, `infra/ci/`.
  - DoD: CI hijau di PR pertama.
- **Exit Criteria M0:** pipeline CI hijau; batas kepemilikan paket terdokumentasi; tidak ada kode produk lagi diperlukan untuk lolos.

---

### M1 — Contracts + DB Baseline + RLS (Phase A)

**Tujuan:** satu sumber kontrak API dan skema kanonik + isolasi antar-reader terbukti.

- **T1.1 `packages/contracts`**
  - Deliverable: Zod + JSON Schema/OpenAPI + tipe `z.infer` untuk endpoint ARCH §11.1 (`/v1/bootstrap`, `/v1/stories`, reader, choice, status, progress, catalog, report, assets). Implementasi saat ini sudah menutup reader API aktif (`stories`, `story`, `chapter`, `choices`, `report`) di `packages/contracts`; endpoint yang belum aktif tetap backlog.
  - Ref: ARCH §11.1, §5.1 (contracts = satu-satunya definisi bersama).
  - DoD: tipe ter-generate; larangan duplikasi tipe request/response ditegakkan lewat lint rule/review.
- **T1.2 Skema kanonik baseline (`packages/db` + `infra/supabase`)**
  - Deliverable: migrasi untuk domain ARCH §13.1 termasuk kolom/tabel amandemen: `character_aliases`, `character_voice_sheets`, `act_rollups`, `facts_ledger.salience`, `facts_ledger.load_bearing`, `story_threads.status`, `story_threads.payoff_window`, `chapter_blueprints.version/.reconciled_from_version/.reconciliation_reason`, event `BLUEPRINT_RECONCILED`.
  - Ref: ARCH §13.1 (B5), NCS §1/§2/§4/§5, NTM G1-VERSION, G2-*, G4-STATUS, G5-ALIAS/VOICE.
  - DoD: migration test naik-turun lulus; schema snapshot ter-review.
- **T1.3 RLS + ownership harness**
  - Deliverable: RLS policy tiap tabel reader-private + test harness cross-user.
  - Ref: ARCH §23 rule #7/#12, security section.
  - DoD: test membuktikan story instance user A tak terbaca user B.
- **Exit Criteria M1:** migrasi + RLS + ownership test lulus di CI; `packages/contracts` menjadi acuan tunggal.

---

### M2 — Runtime Lifecycle + Fake Generation E2E (Phase A)

**Tujuan:** lifecycle cerita berjalan atomik, idempoten, dan aman-gagal **tanpa AI** dulu.

- **T2.1 `packages/runtime` story commands**
  - Deliverable: Story Contract lock, canonical bootstrap, `story_events`, idempotency keys, outbox, generation lease.
  - Ref: ARCH §24 Phase A.3, §23 rule #2/#5/#13.
  - DoD: unit test untuk idempotensi (repeat tap, duplicate queue, workflow resume tidak double-advance).
- **T2.2 Fake generation workflow**
  - Deliverable: satu workflow E2E yang mem-publish chapter fixture deterministik lewat publish transaksional atomik.
  - Ref: ARCH §11.2 (steps 0–10, tanpa langkah AI), §23 rule #6.
  - DoD: chapter fixture ter-publish; retry setelah timeout tidak menduplikasi; publish gagal tidak meninggalkan state parsial.
- **T2.3 API contract + ownership tests**
  - Deliverable: test kontrak untuk semua endpoint reader di M1.
  - DoD: contract test hijau; ETag pada reader endpoint berfungsi.
- **Exit Criteria M2:** end-to-end fake publish jalan; semua invariant idempotensi & atomicity terbukti lewat test.

---

### M3 — Memory Hierarchy + Layer A Validator + Alias (Phase B) ⭐ fondasi konsistensi

**Tujuan:** prasyarat generasi panjang. Tanpa ini, generasi 50 bab dilarang dimulai.

- **T3.1 Context compiler + T0–T3 (`packages/narrative-core`)** — **NTM G2-TIERS, G2-BUDGET**
  - Deliverable: compiler membangun Chapter Context Packet (ARCH §12.2 field baru: `act_rollups`, `active_threads_with_status`, `load_bearing_facts`, `voice_sheets`, `context_budget_report`) sesuai budget policy NCS §2.2; T1 rollup otomatis saat act selesai (WF step 9).
  - Ref: ARCH §12.2/§12.3 (B3/B4), NCS §2.
  - DoD: fixture "context di Bab 45 = T0 + rollup + ±8 summary"; `context_budget_report` mencatat bagian yang dikompres.
- **T3.2 Load-bearing protection + retrieval log** — **NTM G2-LOADBEAR**
  - Deliverable: fakta `LOAD_BEARING` tidak pernah dipangkas sebelum dibayar; exclusion list ditulis ke `retrieval_logs`.
  - Ref: ARCH §12.3, §23 rule #16, NCS §2.3.
  - DoD: fixture fakta Bab 3 muncul benar di Bab 47.
- **T3.3 Layer A deterministic validator** — **NTM G3-LAYERA**
  - Deliverable: cek tanpa LLM: karakter hidup/terdaftar, no reveal pre-gate, knowledge scope, state delta ⊆ allowed, timeline monotonic, struktur bab, resolusi alias, larangan karakter baru > Bab 30.
  - Ref: ARCH §11.2 step 6 (Layer A), NCS §3.1.
  - DoD: seeded-contradiction fixture & prohibited-early-reveal fixture → CRITICAL memblokir publish.
- **T3.4 Alias registry** — **NTM G5-ALIAS**
  - Deliverable: WF step 5 me-resolve setiap mention ke `character_id`; unresolved = MAJOR (bukan karakter baru).
  - Ref: NCS §5.1.
  - DoD: alias fixture (3 sebutan, 1 bab) tidak memunculkan entitas ganda.
- **Exit Criteria M3:** simulasi deterministik ke Bab 50 (data fixture, belum AI) lolos Layer A; NTM sign-off penuh untuk G2-*, G3-LAYERA, dan G5-ALIAS. **Ini gate wajib sebelum Phase B lanjut** (NTM §3).

---

### M4 — Template + Provider Gateway (Phase B)

**Tujuan:** hidupkan generasi AI di atas fondasi yang sudah deterministik-aman.

- **T4.1 Planner/writer output schema + repair protocol**
  - Deliverable: skema plan & draft, protokol repair (maks 2/lapis → `FAILED_REVIEW_REQUIRED`). **NTM G3-REPAIR**
  - Ref: ARCH §11.2 step 8, NCS §3.2.
  - DoD: retry fixture; repair tidak menghapus canon.
- **T4.2 Template `lakoku_drama_bangkit_v1`**
  - Deliverable: blueprint 50 bab (8 act, batas 5/12/20/32/40/45/48), reveal gates, ending rules, fixture regresi.
  - Ref: PRD §6.2, ARCH §24 Phase B.3.
  - DoD: blueprint lulus validasi struktur; fixtures di `fixtures/narrative/`.
- **T4.3 `packages/ai-gateway`**
  - Deliverable: adapter provider di balik kontrak internal (`generatePlan()`, `writeChapter()`); integrasi hanya setelah lifecycle deterministik andal.
  - Ref: ARCH §5.1, §24 Phase B.5, §23 rule #1/#10.
  - DoD: provider live menghasilkan plan & prosa schema-valid; tidak ada string yang membocorkan model/prompt/token.
- **Exit Criteria M4:** generasi AI end-to-end satu bab lolos Layer A + repair; string consumer-safe.

---

### M5 — Reconciliation + Thread Lifecycle + Layer B (Phase B/C) ⭐ gate 50 bab

**Tujuan:** jaminan konsistensi bab jauh; ini yang menyelamatkan pembaca paling loyal.

- **T5.1 Reconciliation checkpoint (WF step R)** — **NTM G1-VERSION, G1-DRIFT, G1-REACH, G1-SPINE**
  - Deliverable: langkah R di akhir act (5/12/20/32/40/45/48) + on-demand dari step 3 saat drift ≥ 2; blueprint versioned; cek reachability semua ending; hard rule tak boleh langgar spine/reveal gate/ending.
  - Ref: ARCH §11.2 step R (B2), §23 rule #17, NCS §1.
  - DoD: drift fixture (state dibengkokkan di Bab 20) direkonsiliasi tanpa melanggar spine; ending tetap reachable.
  - **Status:** logika inti SELESAI di `lib/narrative/reconciliation.ts` (versioned regen, ending reachability, spine integrity); terbukti di `m5-soak`. Regenerasi goal ditingkatkan menjadi adaptif LLM-authored di **T7.5** (lihat M7). Wiring WF step R ke runtime nyata menyusul di M6.
- **T5.2 Layer B model validator** — **NTM G3-LAYERB**
  - Deliverable: cek kontradiksi lunak, voice, emosi vs relationship, memakai `character_voice_sheets`.
  - Ref: ARCH §11.2 step 6 (Layer B), NCS §3.
  - DoD: voice fixture lolos; kontradiksi lunak tertangkap.
- **T5.3 Thread lifecycle** — **NTM G4-STATUS, G4-BUDGET, G4-STALE, G4-BLOCK48**
  - Deliverable: status `OPEN→DEVELOPING→PAYOFF_DUE→RESOLVED|ABANDONED_APPROVED`; maks 7 thread; no new thread ≥ Bab 41; stale 6 bab → callback ≤ 3 bab; publish Bab 48 diblokir bila mystery utama non-RESOLVED.
  - Ref: ARCH §11.2 step 2 & 9, NCS §4.
  - DoD: thread fixture + Bab 48 unresolved fixture memblokir publish.
- **T5.4 Soak test 50 bab**
  - Deliverable: soak 3 jalur (high-trust, low-trust, mixed) di staging.
  - Ref: ARCH §18.2 (B7), NCS §7/§8, NTM §2.
  - DoD (mengikat): 0 kontradiksi CRITICAL; semua ending reachable tiap checkpoint; biaya/bab dalam guardrail (ARCH §20.2).
- **Exit Criteria M5:** NCS §8 Definition of Success hijau di soak test; NTM sign-off penuh untuk G1, G3-LAYERB, dan G4. **Gate wajib sebelum cerita AI nyata disajikan ke pembaca** (NTM §3) — berlaku untuk web reader (M6-WEB jalur cerita nyata) maupun Android (M6). Catatan: membangun UI/UX reader di atas *fixtures* (M6-WEB jalur UX) **tidak** dikunci gate ini.

---

### M6-WEB — Web Reader Mobile-First (Phase C) ⭐ client produksi pertama

**Tujuan:** membangun pengalaman baca web mobile-first (client produksi pertama, lihat AMENDMENTS v0.4 / `docs/CLIENT_SEQUENCING.md`) sampai siap produksi, di atas seam data client-agnostic `lib/api/`.

> **Dua-jalur (WAJIB dipahami agen):** M6-WEB punya dua jalur yang berbeda gate-nya.
> - **Jalur UX (fixtures)** — membangun & memvalidasi UI/UX reader web di atas data fixture deterministik. **Tidak** dikunci di belakang M3/M5; boleh dikerjakan lebih awal (repo saat ini sudah pada jalur ini). Syaratnya: tidak ada logika naratif di client dan tidak ada panggilan AI dari client.
> - **Jalur cerita nyata (AI ke pembaca)** — menyajikan bab hasil generasi AI kepada pembaca sungguhan. Ini **tetap** terkunci di belakang M5 NTM sign-off penuh (NTM §3), sama seperti M6 Android. M6-WEB "siap produksi" hanya boleh diumumkan ke pengguna setelah gate ini lolos.

- **T6W.1 Design system + app shell** — `apps/web` (Next.js App Router, mobile-first), sesuai Brand Guidelines v1.1.
  - DoD: layout mobile-first (`max-w-md`, bottom nav), token tema Midnight Drama + Paper Cream, aksesibilitas (aria, `prefers-reduced-motion`); tidak ada string "Narraza"/framing "AI generator" (brand guard ARCH §16.3).
  - **Status:** ✅ SELESAI. UX Polish Batch A (landing badge, onboarding defaults/ETA, reader tap feedback, font 16px, fallback banner, library empty CTA, numeric progress, profile greeting, credit pricing badge, payment polling, ending cleanup, guest pricing) menambahkan polish pada seluruh permukaan app shell. Batch B (theme + text-size settings) menjadikan pengaturan profil nyata, bukan placeholder.
- **T6W.2 Client-data seam `lib/api/`** — kontrak async client-agnostic (LD-CONTRACT-SEAM).
  - Deliverable: `packages/contracts` sebagai kontrak domain; `lib/api/types.ts` hanya compatibility re-export; `client.ts` (`listStories`/`getStory`/`getChapter`/`submitChoice`/`submitReport`), fixtures internal terpisah dari UI.
  - DoD: tidak ada komponen UI yang mengimpor sumber data langsung; mengganti implementasi `client.ts` ke Reader API nyata tidak menyentuh komponen; bentuk tipe konsisten dengan `packages/contracts` (ARCH §11.1).
  - **Status:** ✅ SELESAI. Onboarding building screen kini menampilkan Poetry Lottie animation (quill/parchment via `lottie-react ^2.4.1`, lazy-loaded `next/dynamic` ssr:false) menggantikan brand text statis. UX Polish Batch B (guest-to-login preservation) memastikan story tidak orphaned saat tamu melewati onboarding → login → persist.
- **T6W.3 Reader + progress** — beranda, detail cerita, reader per-bab, jejak pilihan.
  - DoD: reader menampilkan bab sesuai cerita (bukan sample statis); progress monotonic; loading state pakai bahasa naratif, bukan "AI sedang generate".
- **T6W.4 Choice submission + pending-choice recovery + generation status** — via `submitChoice`, selaras ARCH §10 & §23 rule #5.
  - DoD: repeat tap tidak double-advance; response gagal tidak membuat synthetic choice; pending choice disimpan dengan idempotency key stabil dan bisa retry setelah reload; status reader-safe tanpa metadata model; konsekuensi & bab berikutnya berasal dari outcome server/seam.
  - **Status:** ✅ SELESAI. UX Polish Batch A (A4 reader tap feedback + adaptive delay, A6 fallback banner) memperkuat UX choice & recovery. Guest-to-login preservation (B1) memastikan onboarding draft stash aman (no token/session/PII) sebelum `lockStoryBible`, resume setelah login, cleanup setelah sukses.
- **T6W.5 Verifikasi browser mobile** — agent-browser (viewport mobile).
  - DoD: alur beranda → baca → pilih → konsekuensi → lanjut lolos; type-check & lint hijau.
- **Exit Criteria M6-WEB:**
  - *Jalur UX:* reader web mobile-first E2E lolos di browser dengan fixtures; seam `lib/api` terpasang tanpa kebocoran sumber data ke UI; brand guard lolos.
  - *Jalur cerita nyata:* pengumuman "produksi ke pengguna" hanya setelah `client.ts` menunjuk Reader API nyata **dan** M5 NTM sign-off penuh (NTM §3).

---


---

### M6-WEB+ — Ownership per-user + Share Ending Card MVP (AMENDMENTS v0.5)

**Tujuan:** menutup bug katalog global (tamu/login melihat playthrough orang lain sebagai milik sendiri) dan menghadirkan share teaser yang aman.

Boleh dikerjakan setelah jalur UX M6-WEB; tidak menunggu rename penuh ke `story_instances`.

- **T-OWN-0 Hotfix UI jujur**
  - Deliverable: profil/beranda/koleksiku tidak menghitung seluruh row `stories` global. Tamu: stats 0 + CTA masuk. Login: stats & Lanjutkan dari `reader_states` / owned only.
  - Ref: AMENDMENTS v0.5 LD-STORY-OWNERSHIP; PRD §7.6, §11.5.
  - DoD: tamu tidak melihat “14 Cerita Berjalan” dari status demo global; login tanpa `reader_states` tidak mewarisi status global sebagai personal.
- **T-OWN-1 Ownership di shell story**
  - Deliverable: migrasi `owner_user_id` + `visibility` pada shell (`stories` interim); `persistStoryBible` / lock set owner = auth user; list library filter owner; RLS/authorization selaras.
  - Ref: ARCH §8.2, §13; PRD §15 mapping interim.
  - DoD: user B tidak melihat private instance user A di Koleksiku/list personal; story id collision slug diganti UUID atau slug+shortid.
- **T-OWN-2 Seed reader_states on start**
  - Deliverable: `startFirstChapter` (atau ekuivalen) menulis progress personal login; berhenti mengandalkan `stories.status` global sebagai personal progress.
  - DoD: start bab 1 oleh user A tidak menandai status personal user B / tamu.
- **T-SHARE-1 Ending Card konten**
  - Deliverable: `/akhir/[id]` menampilkan tropes, ending, 3–5 big choices non-spoiler, copy share.
  - Ref: PRD §10.5, §10.8.
  - DoD: card tidak bocor secret gate / full spoiler trail.
- **T-SHARE-2 shared_story_links + landing**
  - Deliverable: create/revoke share; route `/s/[slug]`; payload teaser sanitasi only.
  - Ref: LD-SHARE-MVP, LD-SHARE-PRIVACY.
  - DoD: landing tidak serve chapter prose sumber; source id tidak jadi public read.
- **T-SHARE-3 Start-from-share**
  - Deliverable: CTA “Coba jalurmu sendiri” → instance baru milik B + row `shared_story_starts`.
  - DoD: instance B independen; audit start tercatat.
- **T-SHARE-4 (later) story_seeds**
  - Foundation-copy aman dari contract snapshot; bukan MVP pertama.
- **T-SHARE-5 (later) Challenge Route**
  - Share challenge ending rahasia non-spoiler; bukan MVP pertama.
- **Exit Criteria M6-WEB+ MVP:** T-OWN-0..2 + T-SHARE-1..3 hijau; diagnosis tamu/katalog global tertutup; share ending card end-to-end aman.


### M6 — Android Reader Beta (Phase C)

**Tujuan:** pembaca bisa membaca, memilih, dan pulih dari kondisi gagal dengan aman.

- **T6.1 Design system + app shell** — `apps/android` (Compose, layered offline-first, ARCH §6).
  - DoD: navigation graph + DI + tema sesuai Brand Guidelines v1.1.
- **T6.2 Auth + library cache + reader + progress** — ARCH §6.1, §11.1.
  - DoD: reader render dari local data saat chapter tersedia; progress monotonic.
- **T6.3 Choice submission + pending-choice recovery + generation status** — ARCH §10 (choice sequence), §23 rule #5.
  - DoD: repeat tap tidak double-advance; status reader-safe tanpa metadata model.
- **Exit Criteria M6:** alur baca + pilih + recovery lolos di device Android nyata (agent-browser/emulator/manual QA).

---

### M7 — Story Foundation, Proposal, Opening Package, Reports (Phase C)

- **T7.1 Story Foundation flow + proposal selection** — PRD onboarding, ARCH §24 Phase C.3.
  - DoD: user membuat cerita → memilih proposal → lock story contract.
- **T7.2 Opening package + voice sheets** — **NTM G5-VOICE**
  - Deliverable: opening package membuat `character_voice_sheets`; voice masuk T0 untuk karakter yang tampil.
  - Ref: NCS §5.3.
  - DoD: voice fixture; opening → Bab 1 utuh.
- **T7.3 Reports + safe error states** — ARCH §7.9 (`FAILED_REVIEW_REQUIRED`), PRD §7.9. — ✅ SELESAI.
  - ✅ **Safe error states (reader-facing):** `ChapterAvailability` (`@lakoku/contracts`, diekspor ulang via `lib/api/types.ts`), `isChapterPreparing()` (`lib/api/leases.ts`, admin client karena `generation_leases` RLS-locked), `getChapterAvailability()` (`lib/api/server.ts`); layar `components/chapter-unavailable.tsx` (PREPARING dgn progress bar + auto `router.refresh()` vs UNAVAILABLE dgn tombol coba lagi). `app/baca/[id]/page.tsx` tak lagi `redirect()` diam-diam. Verifikasi browser dua state lolos (viewport mobile). Tanpa kebocoran metadata teknis; bab rusak (`FAILED_REVIEW_REQUIRED` melepas lease tanpa publish) tak pernah dipaksa tampil.
  - ✅ **Reports (laporan pembaca + referensi kanonik):** migrasi `content_reports` (RLS deny-default) + RPC `record_content_report_v1` (atomik: laporan + `story_events(REPORT_FILED)`). `lib/api/reports.ts` `buildCanonicalRefs()` (jangkar kanon bab dari `CanonSnapshot`, hormati batas bab, best-effort) + `submitContentReport()` (service-role). `canonical_refs` ops-facing, tak pernah dikembalikan ke pembaca. UI: `ReportCategory`/`REPORT_CATEGORIES` (`@lakoku/contracts`, diekspor ulang via `lib/api/types.ts`), `components/report-dialog.tsx` di-wire ke tombol di `reader-view.tsx`, `app/api/stories/[id]/report/route.ts` (validasi body via `SubmitReportRequestSchema` + `reporter_id` dari sesi), client `submitReport()`. Bukti: smoke `m7c-report-smoke` 17/17 + verifikasi browser end-to-end (toast sukses, baris DB, event tercatat).
  - DoD: bahasa aman ("Cerita ini sedang dirapikan penulisnya"); bab rusak tak pernah dipaksa publish. Laporan menautkan referensi kanonik, bukan screenshot pembaca.
- **T7.4 AI canon-authoring (brainstorm wizard)** — ✅ SELESAI.
  - Deliverable: modul `lib/authoring/` (schema draft zod, `model.ts` proposer via `generateObject`, `validate.ts`+`compile.ts` draft→`CanonSnapshot`/blueprint, `repair.ts` tangga kegagalan validate→AI repair→transform→escalate, `persist.ts` commit ke Supabase). Wizard 6-tahap `components/brainstorm/` + `app/brainstorm/` (idea→premis→cast→misteri→dunia→kunci). Entry point beranda/landing/bottom-nav → `/brainstorm`. Lock sukses → `startFirstChapter()` memicu `generateNextChapterReal(storyId,1)`, majukan `stories.status=BERJALAN`/`current_chapter=1`, redirect `/baca/{id}?bab=1`.
  - DoD: smoke `m7-authoring-smoke` 13/13 + roundtrip DB; alur end-to-end terverifikasi browser. Spine tak pernah diubah authoring.
- **T7.5 Reconciliation runtime-adaptif (regenerateGoal LLM-authored)** — ✅ SELESAI.
  - Deliverable: `runReconciliationAdaptive(input, goalAuthor?)` di `lib/narrative/reconciliation.ts` (DI `GoalAuthorFn`/`GoalAuthorContext`, meniru `AiRepairFn`); `lib/authoring/reconcile-goal.ts` (`makeGoalAuthor`/`authorChapterGoal` + `validateAuthoredGoal` anti-leak & anti reveal dini). Goal drift ≥ 2 ditulis ulang LLM dalam pagar spine; gagal/menolak → fallback deterministik (tak pernah buntu).
  - Ref: NCS §1.2 (step 3), §1.4.
  - DoD: smoke `m7b-reconcile-smoke` 23/23 (regresi deterministik, adaptif+spine utuh, fallback, ending unreachable→FAILED); regresi `m5-soak` 236 hijau.
- **Exit Criteria M7:** onboarding sampai Bab 1 mulus; laporan pembaca menautkan referensi kanonik.

---

### M8 — Observability, Alert, Entitlement/Checkout (Phase C)

- **T8.1 Dashboard konsistensi** — **NTM G3-METRICS**
  - Deliverable: `continuity_critical_rate` per nomor bab, `repair_success_rate`, `review_required_rate`, thread staleness, `reader_inconsistency_report_rate`.
  - Ref: ARCH §17.3 (B6), PRD §5.3.
  - DoD: metrik tampil di dashboard, bukan hanya log.
- **T8.2 Alert** — ARCH §17.4 (B6): alert saat `continuity_critical_rate` naik monoton terhadap nomor bab.
  - DoD: alert ter-trigger di fixture regresi kompaksi.
- **T8.3 Entitlement + checkout webhook** — ARCH §23 rule #4/#8.
  - DoD: hanya webhook server terverifikasi memberi akses; tak ada data entitlement dari klien yang otoritatif.
- **Exit Criteria M8:** observability + alert + pembayaran aman-server berjalan.

---

### M9 — Hardening + Release Gate + Beta Cut

- **T9.1 Isi seluruh baris NTM ke `DONE`** — verifikasi kelima bukti per baris (NTM §4).
- **T9.2 Release gate** — ARCH §18.3 (B8) + NTM §2: build ditolak bila ada baris in-scope belum `DONE`, jargon Narraza/AI bocor di client mana pun (web/Android), soak 50 bab gagal NCS §8, atau web build / Android build / API contract gagal. Web gate otomatis saat ini: `scripts/m9-release-gate.ts` setelah `pnpm smoke` di CI.
- **T9.3 Staging QA end-to-end** di device nyata + privacy review data. Checklist staging web: `docs/STAGING_QA_WEB_RELEASE.md`.
- **Exit Criteria M9 (beta-ready):** ARCH §18.3 + NTM §2 hijau; soak 50 bab 3 jalur bersih; semua ending reachable; biaya/bab dalam guardrail.

---

## 3. Dependency Graph (ringkas)

```
M0 → M1 → M2 → M3 → M4 → M5 ─────────────→ M9
     │               └→ M6 → M7 → M8 → M9
     └→ M6-WEB (jalur UX, fixtures) ┄┄┄ menyajikan cerita AI ke pembaca menunggu M5 NTM sign-off
```

- M3 adalah **prasyarat keras** untuk semua generasi panjang (NTM §3).
- M5 NTM sign-off penuh adalah **prasyarat keras** untuk menyajikan cerita AI nyata ke pengguna — baik lewat web reader (M6-WEB jalur cerita nyata) maupun Android (M6) (NTM §3).
- **M6-WEB jalur UX (fixtures)** hanya bergantung pada kontrak di M1 dan boleh dimulai lebih awal, paralel dengan M2–M5. Yang dikunci di belakang M5 adalah *menyajikan bab AI ke pembaca*, bukan membangun UI/UX di atas fixtures.
- M6–M8 boleh berjalan paralel dengan penyelesaian M5 **hanya** untuk pekerjaan UI yang tidak bergantung pada output naratif final; integrasi penuh menunggu M5 NTM sign-off penuh.

---

## 4. Checklist Sign-off per Milestone (untuk agen)

> **Tracker task hidup:** status per-task M0–M9 dicentang di `docs/PROGRESS_CHECKLIST.md`.
> Agen wajib memeriksa tracker itu sebelum mulai bekerja agar task yang terlewat ketahuan,
> dan memperbaruinya di PR yang sama saat sebuah task selesai.

Untuk setiap milestone, agen menandai selesai hanya bila:

- [ ] Semua task DoD terpenuhi (kode + unit test + migration/fixture/metrik sesuai lingkup).
- [ ] Semua ID baris NTM dalam lingkup milestone = `DONE` dengan bukti lengkap.
- [ ] CI hijau termasuk fixture terkait.
- [ ] Tidak ada pelanggaran ARCH §23 (23 rules).
- [ ] Exit Criteria milestone tertulis terpenuhi dan terverifikasi (bukan diasumsikan).

---

## 5. Aturan Anti-Drift Dokumen

- Bila PRD/ARCH/NCS berubah, perbarui runbook ini di PR yang sama.
- Runbook tidak boleh menambah requirement baru; jika sebuah langkah butuh keputusan yang belum ada di spec, eskalasi ke project lead sebelum menulis kode.
- Nomor bab, spine, dan terminologi publik tidak boleh diubah tanpa persetujuan produk eksplisit (ARCH §23 rule #9).
