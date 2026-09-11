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
- **GAP terbuka (CI-5):** semua transport produksi mengalir lewat
  `streamText` (SSE), dan AI SDK tidak mengekspos `usage.cost` dari chunk
  akhir — sehingga seam pengukuran biaya nyata belum terikat. Guard aktif
  namun tercatat inert sampai seam SSE selesai dirancang (ruang lingkup
  sama dengan blocker G-1 `BLOCKED_PRICING_AUTHORITY_MISSING`).
- `hardInferenceLimit` G-1 **tetap `null`** — addendum ini tidak mengubah
  otoritas topologi/ekonomi G-1 dan tidak menerbitkan limit baru.
- Guardrail moneter bisnis saat launch tetap sistem kredit/kuota komersial
  (`authorize_commercial_generation_intent_v1`), yang sudah teruji.
