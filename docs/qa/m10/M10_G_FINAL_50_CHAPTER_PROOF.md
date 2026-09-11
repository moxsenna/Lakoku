# M10-G Final 50-Chapter Proof — Formal Evidence Record V1

**Status: EVIDENCE RECORD — bukan COMPLETE.**
**Tanggal evidence:** 2026-09-11.
**Otoritas:** PM directive 2026-09-11 — no G-4, no hard limit baru, no G-1 reopen, no rerun, no merge ke `main` sebelum reconciliation + closeout.
**Commit referensi:** `920fbc492ceb28ff5ec3761b0291da5b5fb9d22e` (`feat/m10-g-final-proof`), diverifikasi ada di `moxsenna/Lakoku`.

## 1. Apa yang dibuktikan (dan bagaimana diverifikasi)

Tiga jalur novel 50 bab + matriks fork G.2.2 dijalankan eksklusif via **9Router VPS**
(`NINEROUTER_BASE_URL` reverse proxy; writer `gweb/gemini-3.1-pro`, choice/continuity
`gweb/gemini-3.8-flash`), in-memory, **zero production DB write**, tanpa commit/push
selama run. Nomenklatur 9Router dipertahankan — ini BUKAN rute OpenRouter.

| Jalur | Kontrak | Bab | Kata (ukur ulang dari checkpoint) | Ending lock Bab 45 |
|---|---|---|---|---|
| Novel 1 | `nadia-raka:bingkai-kosong` | 50/50 | 801–994, avg 900,5, OOB 0 | `court-justice` |
| Novel 2 | `sinta-bagas:keris-hilang` | 50/50 | 808–999, avg 909,5, OOB 0 | `adat-justice` |
| Novel 3 + fork | `kirana-gilang:arsip-kapal` | 62 record | 800–999, avg 909,7, OOB 0 | `harbor-justice` (late-A dan late-B) |

Checkpoint (lokal, bukan artefak repo — hash SHA-256 diukur 2026-09-11):

| File | Records | SHA-256 |
|---|---|---|
| `m10g-full-proof-50.jsonl` | 50 | `b2a00232485f63cf9dcdaf5cf6712ce480d25169b7a82bd794e06b5b32b1dd0c` |
| `m10g-sinta-50.jsonl` | 50 | `042c3c27c192e021f443578eb89c055fe3e353c0f9c450ec483ad6dfb827e6f0` |
| `m10g-fork-50.jsonl` | 62 | `fb79655f84d8a1f0a176ffd7e826c0e683a73ac23d97027d131c1bbc6f86a22d` |

Runner yang committed di `920fbc4`: `scripts/m10-g-9router-full-proof.ts`
(multi-kontrak, `--contract=`, retry choice 3x), `scripts/m10-g-9router-fork-proof.ts`
(early Bab 10→12, late Bab 44→50), `scripts/m10-g-9router-fork-resume-late-b.ts`
(resume khusus), `scripts/verify-full-proof-design.mjs` (verifier zero-inference).

## 2. Bukti fork G.2.2 (diukur dari checkpoint, bukan klaim)

- **Early fork Bab 10** (ke Bab 12, batas act berikutnya): A vs B memilih label berbeda → DIVERGED.
- **Late fork Bab 44** (keduanya ke Bab 50): A menyusup ke gudang bersegel rusak vs B
  menyerahkan berkas ke kantor hukum pelabuhan → DIVERGED.
- **Isolasi:** choiceId berbeda antar cabang, tidak ada cross-containment label/ID;
  judul Bab 45/46/50 berbeda antara late-A dan late-B. Satu-satunya judul bersama
  adalah Bab 44 itu sendiri (prosa bersama titik fork, paragraf identik — sesuai desain).
- **Kebijakan ending:** kedua cabang late mengunci `harbor-justice` di Bab 45 via
  `resolveEnding` deterministik; Bab 50 memenuhi closure (late-A 849 kata
  "Fajar di Ujung Dermaga", late-B 991 kata "Segel yang Terbuka di Ruang Kedap").

## 3. Anomali live yang dicatat (bukan disembunyikan)

- Novel 1: ~15 prose retry terserap; 3 segmen resume. Novel 2: retry choice 3x
  ditambahkan ke runner setelah `actions.0.label >90` dan `question >120`.
- Late-B Bab 48: 5x `AI_NoOutputGeneratedError` beruntun (retryable,
  `isRetryable:true`) pada `gweb/gemini-3.1-pro`; pulih via resume dengan backoff
  15 dtk + cooldown 2 mnt — tanpa ganti model/konfigurasi.
- Paragraf: rata-rata ~30/bab; Bab 12 novel-1 tercatat 12 paragraf @74,3 kata/par —
  sah sebagai style ceiling (batas 35 adalah stop splitter, bukan bound validasi).

## 4. Batasan eksplisit (apa yang record ini TIDAK klaim)

1. **Desain vs eksekusi:** `docs/M10-G-9ROUTER-FULL-50-PROOF-DESIGN.md` masih
   berstatus `DESAIN (belum dieksekusi)` — document/evidence state tertinggal dari
   execution state. Record ini menutup kesenjangan itu untuk run yang terjadi,
   tanpa mengubah status desain tahap berikutnya.
2. **CI exact-head:** tidak ada GitHub Actions run yang terasosiasi dengan
   `920fbc4`; angka test lokal BUKAN bukti CI exact-head.
3. **Deterministik vs semantik:** PASS run bersifat evidence prose/transport;
   gerbang deterministik B dan semantik D tetap terbuka.
4. **Human read:** golden human read 50 bab belum dilakukan.
5. **Economics:** `hardInferenceLimit` tetap `null`; G-1 economics TIDAK BOLEH
   dipromosikan dari topology saja.
6. **NTM closure:** masih pending.
7. **Ancestry:** branch divergen — 188 ahead / 71 behind `main` pada merge-base
   `52d47ad` (remote-tracking refs yang benar; hitungan awal 1-behind berasal dari
   refname `origin/main` yang ambigu, sudah dikoreksi). Trial-merge kering ke
   current `main` (worktree sekali pakai, sudah dihapus) menghasilkan **4 file
   konflik**: `run-phase2.sh` (add/add), migrasi living-canon
   `20260805020000…` (sisi main 145 KB vs sisi branch 1,5 KB — divergensi besar),
   `tests/runtime/personalized-generation.test.ts` (V4-mock vs V6-mock),
   `vitest.config.ts` (proyek heavy/unit/contention-sensitive vs versi lama).
   **JANGAN merge sebelum konflik ini diselesaikan dalam closeout.**
8. **Aktivasi produksi:** BLOCKED. Tidak ada deployment/activation dari record ini.

## 5. Keputusan

- G-1 topology/code: cukup maju untuk proof evidence.
- 3 × 50 chapter: evidence run ada; formal closeout dilengkapi oleh record ini.
- Fork matrix: evidence runner + hasil ada.
- M10-G COMPLETE: **BELUM** — menunggu closeout candidate vs plan §G.2–G.8
  (trust profiles, gerbang B/D/E, golden human read, economics, NTM, CI exact-head).
