# M10-G CLOSEOUT — EXACT-HEAD CI RECORD

**Tanggal:** 2026-09-11
**Branch:** `closeout/m10-g-integration-evidence` (isolated; TIDAK di-merge ke `main`)
**HEAD dasar:** `28e3b89` + 3 perbaikan harness (§1, §2)
**Comparators:**

| Ref | SHA | Peran |
|---|---|---|
| Pre-merge closeout | `eb00658` | baseline evidence-only |
| Ancestry source | `refs/remotes/origin/main` = `ff842f2` | commercial-cutover lineage |
| Proof commit | `920fbc4` | sumber pelanggaran blob M10-E (§4) |
| Penyebab CI-2 | `1965c97` (di `main`) | commit yang merename call-site worker |

Semua run: **zero completion inference, zero DB write, zero publication, zero deployment.**

---

## 1. Typecheck

Run pertama **FAIL** — 6 error di `scripts/m10-b-qa.ts`:

```
TS2300: Duplicate identifier 'headShaOfWorkingTree'   (baris 21, 28)
TS2451: Cannot redeclare 'headSha' / 'workingTreeDirty' (baris 183, 185)
```

**Sebab:** merge auto-resolve tanpa marker (git tidak menandai konflik) menggandakan satu
import dan satu destructuring statement. Bukan konflik yang dilaporkan, jadi tidak terlihat
di `git ls-files -u`.

**Perbaikan:** hapus duplikat (3 baris). Tidak ada perubahan semantik — kedua salinan identik.

Run kedua dan run akhir (sesudah perbaikan §2): **PASS**, exit 0, output kosong.

> Pelajaran yang direkam: 4 konflik bermarker bukan permukaan risiko penuh sebuah merge.
> Auto-resolve senyap wajib diverifikasi typecheck sebelum dianggap bersih.

## 2. Perbaikan CI-2 — mock `finishAttemptAndFinalizeIfTerminal`

### 2.1 Koreksi terhadap revisi pertama dokumen ini

Revisi pertama dokumen ini menulis **"Defect baru akibat merge: 0"** dengan dasar
*jumlah kegagalan per file* yang cocok antara merged head dan `origin/main`. Dasar itu
tidak cukup. Ketika **nama test** dibandingkan, merged head punya 8 kegagalan di
`tests/runtime/generation-worker.test.ts` sedangkan `origin/main` punya 6, dengan dua
nama yang hanya ada di merged head:

```
× M10G_GLOBAL_INFERENCE_BUDGET_EXHAUSTED is terminal and never redispatched
× M10G_GLOBAL_INFERENCE_BUDGET_REQUIRED is terminal and never redispatched
```

Klaim "0" itu dicabut. Yang menggantikannya adalah pembuktian sebab di bawah.

### 2.2 Sebab sebenarnya: cacat milik `main`, bukan produk merge

Bukti terarah:

| Ref | `tests/runtime/generation-worker.test.ts` terisolasi |
|---|---|
| `eb00658` (pre-merge, proof branch) | **23/23 passed**, exit 0 |
| `ff842f2` (`origin/main`) | **6 failed / 15 passed (21)**, exit 1 |
| `28e3b89` (merged) | 8 failed / 15 passed (23), exit 1 |

`origin/main` gagal sendirian pada file ini. Pesan identik di ketiga kelas kegagalan:

```
[vitest] No "finishAttemptAndFinalizeIfTerminal" export is defined on the
"@/lib/runtime/generation-jobs" mock. Did you forget to return it from "vi.mock"?
```

Asal-usul tepat:

```
git log -S finishAttemptAndFinalizeIfTerminal origin/main -- lib/runtime/generation-worker.ts
→ 1965c97
```

Commit `1965c97` di `main` memindahkan 4 call-site worker dari `finishGenerationJobAttempt`
ke wrapper `finishAttemptAndFinalizeIfTerminal`, tetapi tidak pernah menambahkan fungsi itu
ke blok `vi.mock('@/lib/runtime/generation-jobs')` di dua file test. Enam test `main` rusak
sejak saat itu.

Dua kegagalan ekstra di merged head bukan kerusakan baru: keduanya test M10-G yang
**melintasi call-site yang sama** dan karena itu ikut menabrak mock yang sudah rusak.
`eb00658` hijau karena pada SHA itu worker masih memanggil `finishGenerationJobAttempt`,
yang memang ter-mock.

### 2.3 Perbaikan yang diterapkan

| File | Perubahan |
|---|---|
| `tests/runtime/generation-worker.test.ts` | rename kunci mock `finishGenerationJobAttempt` → `finishAttemptAndFinalizeIfTerminal` (21 sitasi; worker HEAD tidak lagi mengimpor nama lama) |
| `tests/runtime/commercial-worker-preflight.test.ts` | tambah `finishAttemptAndFinalizeIfTerminal: vi.fn(async () => ({ ok: true, status: 'FAILED' }))` |

Tidak ada baris produksi yang disentuh. `lib/runtime/generation-jobs.ts` di HEAD tetap
**identik byte** dengan `main`.

Hasil sesudah perbaikan:

```
tests/runtime/generation-worker.test.ts + tests/runtime/commercial-worker-preflight.test.ts
Test Files  2 passed (2)
     Tests  31 passed (31)          exit 0
```

## 3. Gate deterministik closeout (evidence-only)

| Gate | Hasil |
|---|---|
| `scripts/m10-g-closeout-b-evidence.mjs` atas 3 checkpoint | **ALL CHECKS PASS (162 chapters)**, exit 0 |
| `tests/narrative-qa/m10-g-closeout-b-evidence.test.ts` | **6/6 passed**, exit 0 |
| `pnpm typecheck` | **PASS**, exit 0 |
| ESLint atas 3 file yang diubah | **PASS**, exit 0 |
| `git diff --check` | **CLEAN** |
| Secret scan (`origin/main...HEAD`) | **0 rahasia nyata** — lihat §6 |
| 7 artefak evidence closeout byte-identik vs `eb00658` | **7/7 UNCHANGED** |

Merge ancestry **tidak mengubah satu byte pun** bukti M10-G.

## 4. Regresi — hasil dan pemisahan sebab

Full suite di `28e3b89` sebelum perbaikan §2:
**22 file gagal / 240 lulus / 16 skip (278)**; **59 test gagal / 3488 lulus / 44 skip (3591)**; 1872s.

22 file yang sama dijalankan ulang **terisolasi** sesudah perbaikan §2:

```
Test Files  11 failed | 11 passed (22)
     Tests  37 failed | 385 passed | 2 skipped (424)
```

11 file berpindah ke hijau. Dua di antaranya karena perbaikan §2
(`generation-worker`, `commercial-worker-preflight`); sembilan sisanya hijau tanpa
perubahan kode apa pun — lihat §4.3.

### 4.1 Kelas 1 — pre-existing milik `origin/main` (6 file, 26 test)

| File | Gagal di HEAD | Gagal di `ff842f2` |
|---|---|---|
| `tests/api/generation-recover` | 17 | 17 |
| `tests/api/personalized-choice` | 4 | 4 |
| `tests/integration/authoring-race-lifecycle` | 2 | 2 |
| `tests/api/generation-continuation` | 1 | 1 |
| `tests/integration/commercial-failure-no-burn` | 1 | 1 |
| `tests/integration/commercial-story2-e2e-real` | 1 | 1 |

Dijalankan sebagai kelompok, `generation-continuation` + `generation-recover` +
`personalized-choice` memberi **22 failed / 31 passed (53)** yang identik di HEAD dan di
`ff842f2`. Sebab yang terbaca:

```
TypeError: cookieClient.rpc is not a function
Error: This module cannot be imported from a Client Component module.
AssertionError: expected 500 to be 200
```

Ini cacat kode/harness milik jalur commercial-cutover, bukan mock satu baris, dan **tidak
diperbaiki di sini** karena berada di luar batas closeout proof.

Sebagian kegagalan integration murni lingkungan: Supabase lokal mati
(`connect ECONNREFUSED 127.0.0.1:55321`), diverifikasi dengan probe HTTP (kode `000`).

### 4.2 Kelas 2 — pre-existing di cabang proof (5 file, 11 test)

`m10-e-e3a-e4-counted-comparison` (5), `m10-e-e3a-e4-runner` (4),
`m10-e-e1-e2-closure-regression` (2), `m10-e2-telemetry-reference` (1),
`m10-e-e3a-e4-allowlist` (1).

Gagal **sama persis di `eb00658`**, jadi bukan produk merge. Pesan dominan:

```
M10E_E3A_E4_CLOSURE_AUTHORITY_FAILED: protected blob mismatch at HEAD
for lib/narrative-qa/fault/e2/rows-1-9.ts
```

Penelusuran blob:

| Ref | Blob `lib/narrative-qa/fault/e2/rows-1-9.ts` |
|---|---|
| `fixtures/m10-e/e1-e2-closure-authority.json` (otoritas beku) | `55296b93af03a84b7be5be7d1574fd3b64ab13e3` |
| `920fbc4^` (`1769fe4`, "freeze final proof baseline") | `55296b93…` ✅ cocok |
| `920fbc4` (commit proof M10-G) | `064432a0bd530edf6b3986cb54e1a3c670587b10` ❌ |
| `eb00658`, `28e3b89` | `064432a0…` ❌ |

Commit proof `920fbc4` menambahkan dua baris ke file yang dibekukan otoritas M10-E:

```ts
if (candidate.kind === 'semantic') throw new Error('SEMANTIC_CANDIDATE_UNEXPECTED')
```

Otoritas beku `e1-e2-closure-authority.json` tidak diperbarui, sehingga gate M10-E
fail-closed — **persis sesuai desainnya**. Gate bekerja benar; yang salah adalah
mutasi blob terlindungi di commit proof.

### 4.3 Kelas 3 — artefak kontensi full-suite (9 file, 0 test gagal terisolasi)

`gateway-fetch-injection`, `chapter-status`, `standard-choice-guard`,
`actions-authorization`, `m10-b-evaluators`, `m10-g-g1-live-authority-failclosed`,
`m10-g-g1-policy-guard-binding`, `personalized-generation`,
`story-generation-post-publish`.

Gagal di full suite, **hijau penuh saat dijalankan terisolasi tanpa perubahan kode apa
pun**. Ini defect harness (starvation worker / timeout 5000ms di bawah beban), bukan defect
produk. Dicatat sebagai **CI-4** dan tidak ditutup oleh dokumen ini.

### 4.4 Defect yang benar-benar disebabkan oleh merge

**0 — sesudah pembuktian arah, bukan sesudah pencocokan jumlah.**

Setiap kegagalan di merged head terlacak ke `ff842f2` (Kelas 1 + CI-2), ke `eb00658`
(Kelas 2), atau ke harness (Kelas 3). Dua kegagalan yang semula tampak baru terbukti
adalah paparan cacat `main` `1965c97` oleh test M10-G, dan kini nol setelah §2.

## 5. Verdict

| Gate | Status |
|---|---|
| Typecheck | PASS |
| ESLint (file yang diubah) | PASS |
| B deterministic evidence extractor | PASS |
| B evidence test 6/6 | PASS |
| `git diff --check` | PASS |
| Secret scan | PASS |
| Evidence byte-unchanged 7/7 | PASS |
| CI-2 (mock worker) | **RESOLVED** — 31/31 hijau |
| Regresi penuh | **FAIL** — 0 disebabkan merge; 37 test di 3 kelas pre-existing/harness |

**Exact-head CI: CONDITIONAL PASS untuk tujuan closeout evidence, FAIL untuk promosi.**

Merge ancestry aman dan tidak menyentuh semantik proof. HEAD ini **tidak boleh
dipromosikan** selama CI-1, CI-2b, CI-3, dan CI-4 masih terbuka.

## 6. Catatan secret scan

Satu hit pola:

```
tests/narrative-qa/writer-qualification-fixture-v2.test.ts:996
['api key', 'sk-1234567890abcdef1234567890'],
```

Bukan rahasia. Itu literal sintetis dalam tabel `it.each` negative-test yang membuktikan
detektor `PRIVACY_PRIVATE_IDENTIFIER` menyala. Dibiarkan.

## 7. Defect terbuka

| ID | Kelas | Deskripsi | Status | Pemilik |
|---|---|---|---|---|
| CI-1 | 2 | `920fbc4` memutasi blob terlindungi M10-E tanpa memperbarui `fixtures/m10-e/e1-e2-closure-authority.json`. Perlu keputusan PM: re-freeze otoritas, atau kembalikan dua baris itu. | **OPEN** | PM M10-E |
| CI-2 | 1 | `1965c97` merename call-site worker ke `finishAttemptAndFinalizeIfTerminal` tanpa memperbarui mock di 2 file test. | **RESOLVED** di cabang ini (§2.3); masih rusak di `main` | pemilik commercial-cutover |
| CI-2b | 1 | `generation-recover` (17), `personalized-choice` (4), `generation-continuation` (1): `cookieClient.rpc is not a function`, import Client Component, 500≠200. Identik di `ff842f2`. | **OPEN** | pemilik commercial-cutover |
| CI-3 | Lingkungan | 4 test integration butuh Supabase lokal di `127.0.0.1:55321`; tidak berjalan. Bukan cacat kode. | **OPEN** | infra CI |
| CI-4 | Harness | 9 file gagal hanya di full suite, hijau terisolasi. Starvation worker vitest. | **OPEN** | infra CI |

CI-1, CI-2b, CI-3, CI-4 **tidak ditutup** oleh run mana pun di dokumen ini.
CI-2 ditutup hanya berdasarkan bukti terarah (§2.2) plus run hijau (§2.3), tidak
berdasarkan test PASS saja.

## 8. Batas yang tetap berlaku

```
M10-G                = IN CLOSEOUT
activation           = BLOCKED
hardInferenceLimit   = null
production inference = STOP
DB write/publication = STOP
merge to main        = STOP
```
