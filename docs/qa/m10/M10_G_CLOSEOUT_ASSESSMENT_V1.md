# M10-G Closeout Candidate — Assessment vs Plan §G.2–G.8 (V1)

**Tanggal:** 2026-09-11. **Basis run:** commit `920fbc4`. **Evidence:**
`docs/qa/m10/M10_G_FINAL_50_CHAPTER_PROOF.md`.
**Keputusan PM yang mengikat:** no G-4, no hard limit baru (`null`), no G-1 reopen,
no rerun, no merge sebelum closeout, no activation.
**Rekomendasi dokumen ini: BELUM LAYAK PR ke `main`. M10-G BELUM COMPLETE.**

## DoD checklist (11 baris plan §G.8)

| # | DoD | Status | Bukti / gap |
|---|---|---|---|
| 1 | 3 distinct novels × 50 | **EVIDENCE ADA, formalisasi parsial** | 50/50/62-record, pita kata 800–1000 OOB 0, hash tercatat. Tiga kontrak distinct (galeri/keris/arsip). |
| 2 | high-trust / low-trust / mixed profiles | **GAP** | Ketiga novel memakai profil rute 9Router yang SAMA. Dimensi trust-profile tidak terbukti. Perlu keputusan PM: apakah profil 9Router tunggal memenuhi, atau perlu run profil berbeda. |
| 3 | Fork matrix + late fork ke 50 | **EVIDENCE ADA** | Early Bab 10→12 + late Bab 44→50, diverged + isolated, endings policy-valid. |
| 4 | B deterministic gate final set | **GAP** | Hasil evaluator B per-novel tidak ditangkap sebagai artefak formal (hanya prose/choice evidence). |
| 5 | D semantic gate thresholds beku | **GAP** | Agregat rubrik D per-novel tidak ada. |
| 6 | Golden human read 50 bab + sign-off | **GAP** | Belum dilakukan. Deliverable `M10_G_GOLDEN_NOVEL_HUMAN_READ.md` belum ada. Novel golden belum ditunjuk. |
| 7 | Ending/payoff/arc/repetition/pacing dievaluasi eksplisit | **GAP** | Mengikuti 4–6. |
| 8 | E reliability + cost guardrails | **GAP** | `M10_G_UNIT_ECONOMICS.md` belum ada; G-1 economics BLOCKED; `hardInferenceLimit=null` (per PM, tetap). |
| 9 | No P0/P1 unresolved | **TERBUKA** | Perlu sweep defect eksplisit terhadap baseline final. |
| 10 | NTM rows updated dari evidence | **GAP** | `M10_G_NTM_CLOSURE.md` belum ada; baris G1/G2/G4/G5 belum direvisit. |
| 11 | Exact-head CI/release gate | **GAP** | Tidak ada Actions run untuk `920fbc4`; angka lokal ≠ bukti CI. |

STOP/FAIL conditions: tidak ada yang terpicu oleh run (no manual DB/prose patch,
no BLOCKER escape, isolasi cabang utuh, mystery/closure terpenuhi per runner).
Namun STOP/FAIL ≠ DoD — checklist di atas yang menentukan.

## Pertanyaan yang hanya PM yang bisa menjawab (bukan temuan teknis)

1. Apakah profil rute 9Router tunggal memenuhi dimensi trust-profile G.2.1, atau
   diperlukan run profil berbeda (DoD #2)?
2. Apakah run via 9Router VPS memenuhi baris "Real production model ≥3 novels"
   pada matriks cross-stage, mengingat rute produksi beku G-1 menunjuk
   kandidat OpenRouter? Jawaban ini menentukan apakah G.2.1 terpenuhi secara
   prinsip atau perlu jembatan otoritas rute.
3. Novel mana yang ditunjuk golden untuk human read (DoD #6)?

## Ancestry blocker (independen dari DoD konten)

Trial-merge kering `920fbc4` → current `main` (merge-base `52d47ad`, di worktree
sekali pakai yang sudah dihapus): **4 file konflik** — `run-phase2.sh` (add/add),
migrasi living-canon `20260805020000…` (145 KB vs 1,5 KB),
`tests/runtime/personalized-generation.test.ts` (mock V4 vs V6),
`vitest.config.ts` (proyek heavy/unit/contention vs lama). Resolusi konflik adalah
pekerjaan closeout tersendiri dan TIDAK BOLEH mencampuradukkan perubahan proof
dengan perubahan commercial-cutover dari sisi `main`.

## Urutan closeout yang diusulkan (tanpa inferensi baru, tanpa aktivasi)

1. PM menjawab 3 pertanyaan di atas.
2. Tangkap artefak B + D per-novel dari checkpoint yang ada (deterministik,
   zero-inference) — menutup DoD #4/#5 sebagian atau buktikan gap-nya.
3. Tunjuk novel golden → human read 50 bab → `M10_G_GOLDEN_NOVEL_HUMAN_READ.md`.
4. Susun `M10_G_UNIT_ECONOMICS.md` dari data run (tanpa mempromosikan economics
   G-1 yang BLOCKED) + sweep P0/P1 + `M10_G_NTM_CLOSURE.md`.
5. Resolusi 4 konflik ancestry di branch closeout khusus.
6. CI exact-head hijau → baru rekomendasikan PR ke `main`.
