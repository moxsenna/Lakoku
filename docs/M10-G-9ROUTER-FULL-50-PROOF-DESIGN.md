# M10-G 9Router Full 50-Chapter Proof — Desain

Tanggal: 2026-09-10. Status: DESAIN (belum dieksekusi).
Konteks: staged proof Bab 2–5 PASS via 9Router VPS
(`scripts/m10-g-9router-staged-proof.ts`, kontrak `fixtures/contracts/nadia-raka.ts`).
Batasan: inferensi produksi 0 tanpa otorisasi eksplisit; tulis DB 0; tanpa commit/push.

## 1. Tujuan

Membuktikan rantai generasi 50 bab penuh (Bab 1→50) via 9Router VPS bekerja end-to-end:
prosa → pilihan → pilihan pembaca → bab berikut, dengan kontinuitas, ending lock,
dan gate closure runway — semuanya in-memory, zero DB.

## 2. Rute beku (tidak berubah)

| Peran      | Model                  | Timeout | Catatan                        |
|------------|------------------------|---------|--------------------------------|
| writer     | `gweb/gemini-3.1-pro`  | 120 dtk | maxOutput 4096, repair V1 ON   |
| choices    | `gweb/gemini-3.8-flash`| 45 dtk  | 2 opsi, workflow maks 5 call    |
| continuity | `gweb/gemini-3.8-flash`| 30 dtk  | judge Lapis B/C                |

Otoritas: `M10_G_G1_9ROUTER_ROUTE_AUTHORITY`
(`fixtures/m10-g/g1-route-authority-9router.ts`). Batas kata produksi 800–1000 tetap.

## 3. Celah runner saat ini yang harus ditutup

Runner staged (`m10-g-9router-staged-proof.ts`) memakai jalan pintas yang sah untuk
Bab 2–5 tetapi tidak benar untuk 50 bab:

1. **Bab 1 tidak digenerate.** Rantai mulai dari fixture `NADIA_RAKA_CONTINUATION_A`
   (ending Bab 1 statis). Full proof butuh Bab 1 nyata: `previousChapter: null`,
   `previousChoice: null`, dan brief Bab 1 dari kontrak.
2. **Blueprint generik untuk Bab 3+** (`blueprintForChapter` memakai goal generik).
   Full proof butuh blueprint per bab dari `chapterTargets` kontrak nadia-raka
   (goal, mustInclude, mustNotReveal per nomor bab) — `buildChapterBrief` menolak
   bila blueprint bab tidak ada di snapshot (`Missing canon blueprint`).
3. **Snapshot statis per bab.** Tiap bab memakai `nadiaRakaSnapshot()` kosong
   (tanpa threads/facts/timeline). Full proof harus mengakumulasi state kanon
   minimal: `choiceHistory` penuh (maks 49 entry, dibatasi skema), `previousChoice`
   nyata per bab, dan `routeState` yang berevolusi (flags per bab, bukan reset `{}`).
4. **Ending lock tidak dimodelkan.** `lockedEndingKey` selalu null. Kontrak
   nadia-raka mengunci ending di Bab 45 (`closureRunway.endingLockChapter: 45`).
   Runner full harus meneruskan `lockedEndingKey` dari `buildChapterBrief` Bab N
   ke `readerState` Bab N+1, dan memverifikasi lock terjadi tepat di Bab 45.
5. **Bab 50 tanpa pilihan.** `generateChoiceBranch` mengembalikan null untuk Bab 50
   (`currentChapter === 50`). Runner harus berhenti meminta pilihan di Bab 50 dan
   memverifikasi closure ending (`requiredClosure` kandidat terkunci) terpenuhi.
6. **Batas `--chapters` maks 5.** Naikkan ke 50.

## 4. Arsitektur runner full

```
Bab 1 (previousChapter=null, previousChoice=null)
  → generateChapter → draft_1
  → Bab 1 tidak punya pilihan masuk; langsung susun continuation Bab 2
Untuk N = 2..50:
  continuation_N = { previousChapter: ending draft_{N-1},
                     previousChoice: pilihan bab N-1 (null hanya N=1),
                     routeStateSummary, anchorFacts, timeline, ... }
  brief_N = buildChapterBrief({ storyContract: nadiaRakaContract,
             snapshot: snapshot_N (blueprint bab N terisi dari chapterTargets),
             readerState: { routeState_N, choiceHistory[0..N-1], lockedEndingKey },
             chapterNumber: N, previousChoice })
  → generateChapter → draft_N (retry maks 5, repair V1)
  → bila N < 50: generateChoiceBranch → pilih opsi 1 → catat history
  → lockedEndingKey_{N+1} = brief_N hasil / resolveEnding di Bab ≥45
  → routeState_{N+1} = routeState_N + flags {chN_path}
```

State yang dibawa antarbab: `choiceHistory` (tumbuh s/d 49), `routeState`
(akumulasi flags), `lockedEndingKey` (null → terkunci di Bab 45), `timeline`
(ringkasan per bab, dibatasi CAP 5 di continuation), ending draft (5 paragraf
verbatim terakhir).

## 5. Estimasi biaya dan waktu

Dari observasi staged (4 bab, semua first-pass ACCEPTED pada run final):

- Prosa: ~20 dtk/bab → 50 bab ≈ 17 menit.
- Pilihan: ~6,5 dtk × 49 ≈ 5 menit.
- Total inferensi: 50 prosa + 49 pilihan = 99 call (+ retry fluktuasi over-length
  ~10–20%: ≈ 110–120 call).
- Estimasi durasi: 25–40 menit satu run berurutan.

Retry: writer berfluktuasi over-length antar-run (observasi: 1007/1058/1092/1589
kata pada run berbeda, lalu 803–919 first-pass ACCEPTED pada run final).
Dengan retry 5 dan repair V1, probabilitas lolos per bab tinggi; ekspektasi
kegagalan total run rendah tetapi bukan nol — runner harus checkpoint per bab.

## 6. Checkpoint dan resume (wajib untuk 50 bab)

Run 30+ menit tidak boleh mengulang dari Bab 1 bila Bab 47 gagal:

- Tulis file checkpoint JSONL per bab selesai (di luar repo, mis. `/tmp/`):
  `{ chapterNumber, title, wordCount, paragraphs, choiceLabels, chosenLabel,
     lockedEndingKey, routeFlags }` + paragraf ending untuk rantai.
- Flag `--resume=<path>` membaca checkpoint dan melanjutkan dari bab berikut.
- Prosa lengkap per bab disimpan (untuk audit kontinuitas), bukan hanya ending.
- Evaluasi akhir membaca semua 50 bab: konsistensi tokoh, tidak ada reset,
  closure ending terpenuhi.

## 7. Kriteria PASS full proof

1. 50/50 bab PUBLISHED, tiap bab 800–1000 kata, 35–50 paragraf, 2–4 scenes,
   terminal closure ada.
2. 49/49 choice branch valid (2 opsi + outcomes).
3. Ending terkunci tepat di Bab 45; Bab 50 memenuhi `requiredClosure`.
4. Tidak ada `WRITER_*`/`CHOICE_*` yang lolos tanpa validasi (fail-closed utuh).
5. Tokoh konsisten (Nadia/Raka) di semua brief pilihan — kontrak nadia-raka.
6. Zero DB writes (kredensial di-strip, seperti staged).
7. Durasi dan jumlah retry tercatat per bab untuk kualifikasi model.

## 8. Langkah implementasi

1. Perluas `scripts/m10-g-9router-staged-proof.ts` (atau salin ke
   `scripts/m10-g-9router-full-proof.ts`): Bab 1 nyata, blueprint per bab dari
   `chapterTargets`, akumulasi `choiceHistory`+`routeState`+`lockedEndingKey`,
   stop-pilihan di Bab 50, checkpoint JSONL + `--resume`, `--chapters` s/d 50.
2. Dry-run Bab 1–2 untuk memvalidasi jalur Bab 1 (previousChapter null).
3. Eksekusi bertahap yang sama seperti staged: 2–10 dulu (validasi gate fase
   Bab 5 + reveal Bab 12 bila mencapai), lalu 2–50 penuh.
4. Simpan ringkasan + observasi kualifikasi ke memori.

## 9. Risiko yang diketahui

- **Fluktuasi over-length writer** (data staged): retry 5 + repair V1 menutupinya;
  bila Bab N gagal 5×, run berhenti dengan checkpoint — resume setelah jeda.
- **Reveal gate Bab 12/20/32/45**: brief menuntut buka rahasia terjadwal; writer
  harus menaatinya (kegagalan = temuan validasi, bukan bug runner).
- **Ending lock Bab 45**: `resolveEnding` memakai `routeState.endingBias`;
  runner akumulasi flags saja (bias 0) → kandidat pertama (`court-justice`)
  menang deterministik. Sah untuk proof rantai; bukan klaim kualitas ending.
- **Durasi**: ~30 menit; jalankan di background dengan log file seperti staged.

## 10. Catatan verifikasi desain (2026-09-10, zero inference)

- Brief Bab 1 TERBUKTI terbentuk dari kontrak nadia-raka (`previousChoice: null`,
  fase Pijakan, goal Nadia) — via skrip verifikasi sekali pakai yang sudah dihapus.
- `plotDebtsToProgress` Bab 1 kosong adalah perilaku kontrak yang benar: milestone
  debt pertama (`main_mystery`) jatuh di Bab 5. Bab 1–4 digerakkan oleh
  `mandatoryBeats` chapterTargets, bukan kewajiban debt.
