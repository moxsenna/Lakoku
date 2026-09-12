# M10-G Unit Economics — BLOCKED Evidence Record

**Tanggal:** 2026-09-11. **Status: BLOCKED — bukan PASS.**
**`hardInferenceLimit = null`** (mengikat, per PM directive CLOSEOUT).
Dokumen ini mencatat angka observasional run + blocker authority yang dibekukan.
TIDAK mengubah model, retry policy, matrix, atau M10-E ceiling untuk memaksa PASS.

## Angka observasional (dari checkpoint, bukan proyeksi biaya)

| Metrik | Novel 1 (nadia-raka) | Novel 2 (sinta-bagas) |
|---|---|---|
| Bab prosa | 50 | 50 |
| Bab choice | 49 (Bab 50 tanpa choice) | 49 |
| Total waktu prosa | 1388 dtk (~23,1 mnt) | 1103 dtk (~18,4 mnt) |
| Total waktu choice | 386 dtk (~6,4 mnt) | 301 dtk (~5,0 mnt) |
| Rata-rata prosa/bab | ~27,8 dtk | ~22,1 dtk |
| Kata/bab | 801–994 (avg 900,5) | 808–999 (avg 909,5) |

Catatan: checkpoint fork (`m10g-fork-50.jsonl`) tidak mencatat `proseSeconds` /
`choiceSeconds`, sehingga latensi fork = UNKNOWN (dicatat, bukan diisi).
Retry counts per-bab tidak tercatat di checkpoint — retry overhead = UNKNOWN.
Token counts / biaya moneter per panggilan = UNKNOWN (tidak ada metering pada run).

## Mengapa bukan PASS: blocker authority yang dibekukan

| Blocker | Status | Arti |
|---|---|---|
| `BLOCKED_GENERATION_POLICY_AUTHORITY_SOURCE` | FROZEN | DB mutable tidak bisa jadi otoritas policy |
| `BLOCKED_TOKENIZER_OR_TOKEN_BOUND_AUTHORITY` | FROZEN | Tidak ada tokenizer resmi → token input tak terbatas |
| `BLOCKED_OUTPUT_TOKEN_AUTHORITY_UNBOUND` | FROZEN | Output cap omitted pada rute long-horizon |
| `BLOCKED_PRICING_AUTHORITY_MISSING` | FROZEN | `/models` tak membuktikan worst-case billed rate rute beku |
| `G1_EXECUTE_CHAPTER_TOPOLOGY_UNBOUND` | FROZEN | Transport maksimum topologi belum terikat |

Seluruh kolom plan §G.6 (writer cost, repair/fallback cost, choice cost, judge
cost, total cost/chapter, total cost/novel, p50/p95, retry overhead, latency
distribution, cost by act/runway) = **UNAVAILABLE** sampai kelima blocker di atas
ditutup oleh otoritas yang sah. Menetapkan biaya dari jumlah transport × tebakan
tarif adalah tepat jenis promosi topology-menjadi-economics yang dilarang PM.

## Keputusan

- E reliability/economics gate: **BLOCKED** (bukan PASS, bukan FAIL run).
- `hardInferenceLimit`: tetap `null`.
- M10-E ceiling: tidak disentuh.

## Addendum — E0-INTERIM-CAP-2026-09-12 (keputusan PM arah launch)

Direktif PM 2026-09-12 ("kerjakan seluruh fase") mengadopsi otoritas E0 R1 yang
sudah diratifikasi sebagai **trip-wire biaya produksi interim**:

- Binding: `lib/commercial/e0-budget-authority.server.ts` memuat ceiling
  `maxExpectedCostPerChapter = 2.10000000 USD` dan `p95CostGuardrail =
  200.00000000 USD` **verbatim dari** `fixtures/m10-e/e0-budget-authority.ts`
  (decision ref `LAKOKU-E0-2026-08-26-LOOSE-200-R1`); tidak ada angka yang
  didefinisikan ulang.
- Inti enforcement: `lib/ai-gateway/e0-cost-guard.ts` — akumulasi biaya
  terukur (BigInt, 8 desimal, pembulatan ke atas), scope per-attempt bab,
  error terminal `E0_CHAPTER_COST_CEILING_EXCEEDED` /
  `E0_PROCESS_COST_CEILING_EXCEEDED`; worker memetakannya terminal (tidak
  pernah di-retry) dan klasifikasi terminal ada di
  `TERMINAL_REASONS` (`generation-job-execution.ts`).
- Biaya hanya diterima dari **laporan provider** (`usage.cost`); tidak ada
  derivasi token→harga di mana pun. Transport tanpa laporan biaya dihitung
  `E0_COST_UNMEASURED` dan tidak pernah dihargai pakai tebakan.
- **CI-5 DITUTUP (2026-09-12):** Seam pengukuran biaya provider ke guard E0
  telah tersambung di `lib/ai-gateway/observed-model-call.server.ts` via
  `providerMetadata[providerId].cost` dan `.currency` (memerlukan keduanya
  sekaligus). Klaim historis bahwa "AI SDK tidak mengekspos `usage.cost`"
  dicabut sebagai kekeliruan analisis awal. Teruji via
  `tests/ai-gateway/e0-cost-measurement-seam.test.ts`.
- **GAP BARU TERBUKA (CI-6, 2026-09-12):** Audit data produksi nyata
  (`generation_provider_calls`) menemukan 722/722 transport produksi terekam
  (2026-07-23 s.d. 2026-09-02) berstatus `cost_source='unavailable'` dan 0
  `provider_actual` di seluruh 22 kombinasi provider|model. Guard E0 tetap
  inert di produksi karena provider tidak mengembalikan `usage.cost`. Akar
  masalah: `openAICompatibleFetch` di `lib/ai-gateway/gateway-provider.ts` tidak
  menyertakan `usage: { include: true }` pada outbound request body (prasyarat
  OpenRouter untuk mengembalikan kalkulasi biaya).
- **Pemantauan Biaya Harian Soft Launch:**
  Implementasi monitor operasional di `scripts/daily-cost-monitor.ts` (`pnpm cost:daily`)
  dan `lib/commercial/daily-cost-report.ts`.
  Status monitor:
  - `BREACH`: Melewati ceiling bab ($2.10) atau novel ($200.00). Exit code 1.
  - `WATCH`: Melewati ambang watchpoint bab (≥97% dari $2.10 = $2.037) atau novel. Exit code 0.
  - `UNMEASURED`: Ada transport tanpa data biaya terukur (`cost_source != provider_actual`).
    Diprioritaskan di atas `WATCH` dan `OK` agar operator menyadari biaya riil
    belum tercatat oleh provider. Exit code 0.
  - `OK`: Seluruh transport terukur dan berada di bawah ambang watchpoint. Exit code 0.
- `hardInferenceLimit` G-1 **tetap `null`** — addendum ini tidak mengubah
  otoritas topologi/ekonomi G-1 dan tidak menerbitkan limit baru.
- Guardrail moneter bisnis saat launch tetap sistem kredit/kuota komersial
  (`authorize_commercial_generation_intent_v1`), yang sudah teruji. Selama
  CI-6 terbuka, rekonsiliasi manual via dashboard OpenRouter/9Router wajib
  dilakukan setiap hari.
