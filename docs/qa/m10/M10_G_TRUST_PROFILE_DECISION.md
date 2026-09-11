# M10-G Trust-Profile Decision (Formal, Evidence-Based)

**Tanggal:** 2026-09-11. **Otoritas:** PM directive CLOSEOUT (no rerun, no auto-promosi).
**Keputusan: G.2.1 trust-profile = GAP. Tidak di-waive oleh dokumen ini.**

## Syarat normatif (existing, bukan interpretasi)

1. Plan §G.2.1: tiga novel dengan profil rute **high-trust / low-trust / mixed**.
2. `M10G_ENTRY_GATE_AND_PROOF_BASELINE_V1.md:141-163`: Novel G-1 high-trust,
   G-2 low-trust, G-3 mixed; manifest membawa `routeClass: HIGH_TRUST | LOW_TRUST | MIXED`.
3. `lib/narrative-qa/contracts/m10-g-semantic-contract.ts:21-29` (frozen):
   `M10GNovelIdentitySchema` mengikat `G1→HIGH_TRUST`, `G2→LOW_TRUST`, `G3→MIXED`
   plus storyId `m10c-m10g-g[123]-*`. Mismatch = validation issue.

## Bukti aktual run

- Ketiga novel memakai **satu profil rute 9Router yang sama**
  (writer `gweb/gemini-3.1-pro`, choice/continuity `gweb/gemini-3.8-flash`).
- Checkpoint: `routeFlags={}` (kosong) di semua 162 record — tidak ada
  `routeClass` yang tercatat.
- Story ID run (`story-nadia-raka`-style / kontrak `nadia-raka:bingkai-kosong`)
  tidak cocok dengan pola `m10c-m10g-g[123]-*`.
- Pencarian repo tidak menemukan artefak existing lain yang membuktikan tiga
  profil rute berbeda untuk ketiga novel tersebut.

## Keputusan

- Run 9Router yang sudah dilakukan **TIDAK BOLEH** otomatis dipromosikan menjadi
  high/low/mixed. Pelabelan ulang tanpa perbedaan rute aktual adalah fabricasi.
- G.2.1 tetap **GAP** sampai salah satu terjadi:
  (a) otoritas PM me-waive dimensi trust-profile secara tertulis dengan alasan;
  (b) artefak existing ditemukan yang membuktikan tiga profil (pencarian sudah
  dilakukan — tidak ada); atau
  (c) run profil berbeda dilakukan di masa depan (DILARANG dalam closeout ini
  karena no-rerun; hanya boleh atas directive PM baru).
- Sesuai directive, **jangan rerun novel hanya untuk memenuhi label profile**.

## Dampak ke acceptance gate

Baris `trust-profile requirement` pada acceptance gate = **GAP** (bukan PASS,
bukan waived). M10-G tetap IN CLOSEOUT.

## Addendum — SINGLE-PROFILE-LAUNCH-2026-09-12 (keputusan PM arah launch)

Launch berjalan dengan **satu trust profile**: writer
`gweb/gemini-3.1-pro` + choice/continuity `gweb/gemini-3.8-flash` via 9Router
VPS (qualified end-to-end, bukti M10-G proof runs). Profil high/low/mixed
TIDAK diaktifkan saat launch; promosi G.2.1 tetap GAP pasca-launch dan tidak
menjadi blocker launch karena hanya satu provider yang melayani.
