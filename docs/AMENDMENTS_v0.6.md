# Lakoku — Amandemen Dokumen v0.6

Status: APPLIED — §A ke `docs/PRD_Lakoku_Interactive_v0.3.md`; implementasi di `lib/prose/*` + demo seed (Juli 2026).
Sumber: PRD v0.3, AMENDMENTS v0.3–v0.5 (tetap berlaku). NCS/NTM tidak diubah oleh amandemen ini kecuali band panjang bab di PRD.

Amandemen ini mengunci **kontrak ritme prosa mobile drama** (demo + quality target AI) dan **prompt-engine** sebagai sumber tunggal prompt writer.

---

## 0. Keputusan yang Dikunci

### LD-PROSE-RHYTHM — Mobile drama / web-novel scroll rhythm

| Metrik | Soft (target) | Hard (fail di luar) |
|---|---|---|
| Kata/bab | 850–950 | 800–1000 |
| Paragraf/bab | 38–48 | 35–50 |
| Kalimat/paragraf | mayoritas 1 | maks 2 (narasi); **dilarang** 4–6 |
| Dialog | 1 baris = 1 paragraf | — |
| Paragraf >45 kata | — | maks 2, tidak berturut |
| Dialog ratio | warn <0.18 | fail <0.10 kecuali `investigation` \| `reflection` |

Struktur ~900 kata: hook 3–5 · konflik 8–10 · dialog/konfrontasi 15–20 · reveal/emosi 6–8 · cliff 3–5.

POV default: **aku** (tokoh utama). Show-don't-tell. Larangan meta reader (`pilihan menunggumu`, dll.).

**Sumber kebenaran angka:** `lib/prose/mobile-drama-style.ts` → `MOBILE_DRAMA_RHYTHM`.

### LD-PROSE-PROMPT-ENGINE — Satu pintu prompt writer

- `lib/prose/prompt-engine/build-writer-prompt.ts` = system + user prompt LLM.
- `lib/prose/prompt-engine/evaluate-prose.ts` = **style-only** eval (bukan canon/choice).
- Beat/choice fit demo: `scripts/demo-prose/evaluate-beat-fit.ts` (terpisah).
- `gateway-provider` **wajib** memakai `buildWriterPrompt` (bukan prompt lokal duplikat).

### LD-DEMO-PROSE — Demo seed quality path

- Bab 1–3: handcraft premium (`scripts/demo-prose/handcraft/`).
- Bab 4–50: generator dari beat table (`scripts/demo-prose/generate-chapter-prose.ts`).
- Choices/outcomes: `scripts/demo-prose/chapter-beats.ts` (bukan 4-bucket generik).

### Production note (belum di-build)

Naik dari 500–800 → 800–1000 ≈ **1,5×** kata/story.  
`storyLengthTier` (`compact` 600–750 / `standard` 800–1000) **out of scope** sampai demo premium terbukti. Demo + quality target memakai kontrak v0.6 sekarang.

---

## A. Amandemen PRD

| Section | Perubahan |
|---|---|
| §4 Keputusan | Panjang bab + struktur paragraf → band v0.6 |
| §6.3 Konsep chapter | Definisi chapter 800–1000 kata |
| §9 Style Profile | Tabel aturan, style contract JSON, karakteristik ritme |
| §23.3 Style Acceptance | Acceptance angka v0.6 |

---

## B. Implementasi (repo)

| Path | Peran |
|---|---|
| `lib/prose/mobile-drama-style.ts` | `MOBILE_DRAMA_RHYTHM`, system/output prompt |
| `lib/prose/prompt-engine/*` | build + evaluate |
| `lib/prose/fixtures/*` | fixture evaluator |
| `scripts/prose-prompt-smoke.ts` | smoke engine |
| `scripts/demo-prose/*` | beats, handcraft 1–3, generator 4–50 |
| `lib/ai-gateway/gateway-provider.ts` | wire `buildWriterPrompt` |

---

## C. Yang tidak berubah

- 50 bab / spine / reveal gates / NCS
- Brand Midnight Drama
- Ownership + share MVP (v0.5)
- Larangan meniru dialog berhak cipta

---

## Acceptance

1. PRD §4/§6.3/§9/§23.3 selaras `MOBILE_DRAMA_RHYTHM`
2. `pnpm`/`npx tsx scripts/prose-prompt-smoke.ts` PASS
3. `npx tsx scripts/demo-prose/demo-local-smoke.ts` PASS (1,2,3,12,32,50)
4. LLM writer tidak punya salinan angka 500–800 di prompt lokal
