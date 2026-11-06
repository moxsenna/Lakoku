# Desain: MCP Seed Server Lakoku — Gemini Agent Seeding

**Tanggal:** 2026-11-07
**Status:** Disetujui konsep (menunggu review spec)
**Pemilik:** PM (moxsenna)

## 1. Latar belakang & tujuan

Pembuatan novel katalog resmi saat ini 100% manual via CLI (`scripts/catalog-generate.ts`) dengan writer `gweb/gemini-3.1-pro` via 9Router — berbiaya per-token dan butuh operator pegang terminal.

Tujuan: PM bisa memerintahkan seeding novel katalog langsung dari Gemini web ("seed 1 novel <genre>") dengan **kuota Google AI Pro sendiri** (model Argon) sebagai penulis prosa, sementara **ketentuan Lakoku tetap dipaksa server-side** — guard, struktur 62 unit, status `review`, publish manual.

Dasar kelayakan: Gemini web kini mendukung custom MCP connector (Connected Apps, dialog "Connect to an MCP server", OAuth Client ID/Secret manual) — terverifikasi tampil di akun PM (screenshot 2026-11-07). Mode Task (eks "Spark", rename 12 Okt 2026) tersedia untuk v2.

## 2. Non-goals

- Tidak mengubah struktur 50 bab / 62 unit (44 spine + 18 varian) — arsitek mutlak.
- Tidak ada publish otomatis. `seed_finalize_novel` paling jauh men-set status `review`.
- Tidak menggantikan CLI generator — kedua jalur berbagi mesin yang sama.
- Tidak menulis logika naratif baru; prompt-builder & validator yang sudah lolos kualifikasi (M10-G full 50/50) dipakai ulang apa adanya.
- v2 (Task mode terjadwal) di luar spec ini — hanya disiapkan agar tidak terblokir.

## 3. Arsitektur

```
Gemini web (Argon, kuota AI Pro PM)
   │  Connected Apps → https://<domain-produksi>/api/mcp/seed
   ▼
app/api/mcp/seed/route.ts        ← endpoint MCP streamable HTTP
app/api/mcp/seed/oauth/*         ← authorize + token (OAuth 2.1, PKCE)
lib/mcp-seed/                    ← tool handlers + gate + provenance (*.server.ts)
lib/catalog/generator.server.ts  ← ekstraksi: buildUnitSpec() + validateAndStoreUnit()
                                   (CLI generator & MCP path berbagi mesin identik)
```

- Endpoint tinggal di app produksi Next.js yang sudah live di VPS; Caddy tidak berubah (path baru di origin sama).
- **Tidak ada refactor `generator.server.ts`.** Penulisan plan menemukan seam yang lebih bersih: `CatalogGeneratorDeps.provider` sudah pluggable — jalur MCP memakai **dekorator `GenerationProvider`** (`mcp-gemini-agent-v1`) yang hanya menggantikan `writeChapter` (prosa di-park sebagai unit spec yang diambil agent), sementara `generatePlan`/choices/reactions/kontrak/judge tetap delegasi ke provider 9Router terkualifikasi. Jalur CLI tak tersentuh (smoke lama otomatis tetap hijau). Detail implementasi: `docs/superpowers/plans/2026-11-07-gemini-mcp-seed.md`.
- Prosa = agent Gemini (kuota PM). Choices, fork 3 ending, continuity check = server-side dengan mesin yang ada (flash via 9Router, diikat E0CostGuard).

## 4. Tool surface (kontrak)

Semua tool menerima & mengembalikan JSON. Nomor unit `0-61`.

### `seed_assign_novel`
- Input: `{ genre, judul?, premis_hint? }`. Genre wajib salah satu genre katalog terdaftar (daftar dari registry genre yang sama dengan generator).
- Validasi gate: `MCP_SEED_ENABLED=1`, kuota bulanan, maks 1 novel `drafting` aktif milik agent.
- Output: `{ novel_id, judul, premis, total_units: 62, source: "gemini-agent" }`.
- Membuat draft via `createCatalogDraft` (status awal seperti CLI).

### `seed_get_unit_spec`
- Input: `{ novel_id, unit_index? }` — `unit_index` kosong = unit wajib berikutnya.
- Output: `{ unit_index, unit_type: "spine"|"varian", prompt, word_count_range, cliffhanger_target, branch_context?, characters, threads_state }`. `prompt` adalah writer prompt penuh hasil `buildUnitSpec()` — memuat direktif genre, aturan sapaan Indonesia, gaya paragraf mobile.
- Read-only.

### `seed_submit_unit`
- Input: `{ novel_id, unit_index, prose_markdown }`.
- Validasi berurutan: `assertCatalogChapterConsumerSafe` (reader-safe + brand guard) → panjang kata sesuai range → struktur unit. Lolos → server menghitung choices & continuity (mesin generator) lalu menyimpan (upsert idempoten per `(novel_id, unit_index)`).
- Output sukses: `{ status: "accepted", unit_index, next_unit_index, progress: { stored: n, total: 62 } }`.
- Output tolak: `{ status: "rejected", errors: [{ code, message, detail }] }` — pesan detail boleh teknis (ditujukan ke agent, bukan pembaca) agar agent bisa memperbaiki dan submit ulang.

### `seed_get_novel_status`
- Input: `{ novel_id }`.
- Output: `{ novel_id, status: "drafting"|"review", units: [{ index, type, state: "missing"|"rejected"|"stored"|"approved" }], next_unit_index }`.

### `seed_finalize_novel`
- Input: `{ novel_id }`.
- Syarat: semua 62 unit state `stored` dan lolos continuity. Output siap: `{ status: "review", blockers: [] }` — status novel jadi `review`, identik dengan akhir `generateCatalogNovel`. Belum siap: `{ status: "not_ready", blockers: [...] }` tanpa perubahan status.
- Hard rule: tidak ada jalur ke `published` dari tool mana pun.

### Anotasi tool (jujur)
- `seed_get_unit_spec`, `seed_get_novel_status` → `readOnlyHint: true`.
- `seed_assign_novel`, `seed_submit_unit`, `seed_finalize_novel` → `readOnlyHint: false`. Tidak ada pengelabuan anotasi untuk menghindari konfirmasi manual Gemini.

## 5. Auth (OAuth 2.1)

- Gemini memakai OAuth 2.1; jalur yang dipakai: **Client ID + Secret manual** (server tidak mendaftar Dynamic Client Registration — sesuai dialog Connected Apps).
- Implementasi utama: plugin OAuth Provider Better Auth (authorize + token + PKCE + consent). Fallback: authorization server minimal buatan sendiri (~200 LOC) bila plugin tak memenuhi (diputus di spike, tahap 1).
- Discovery: siapkan metadata resource MCP (`/.well-known/oauth-protected-resource` dan turunannya) sesuai spec auth MCP; diverifikasi saat spike.
- Consent screen: "Izinkan Gemini akses Seed Lakoku" — hanya user dengan role `admin`/`owner` (Better Auth) yang boleh lanjut; allowlist via env `MCP_SEED_ALLOWED_USER_IDS`.
- Access token umur pendek (≤1 jam) + refresh token (≤30 hari), dapat dicabut lewat "disconnect" di Gemini / penghapusan di sisi server.
- Rate limit endpoint via `lib/security/rate-limit.ts`.

## 6. Gate biaya & volume

| Env var | Default | Arti |
|---|---|---|
| `MCP_SEED_ENABLED` | `0` | Master switch; hanya `1` di VPS |
| `MCP_SEED_MAX_NOVELS_PER_MONTH` | `3` | Hitung novel `source='gemini-agent'` per bulan kalender |
| `MCP_SEED_MAX_ACTIVE_DRAFTS` | `1` | Novel `drafting` aktif milik agent |
| `MCP_SEED_ALLOWED_USER_IDS` | — | Allowlist Better Auth user id |

- Biaya prosa = Rp 0 (kuota AI Pro PM). Biaya server: panggilan continuity/choice flash kecil per submit — diikat E0CostGuard yang sudah ada ($2.10/bab, plafon proses $200 tetap berlaku untuk panggilan server-side).
- Provenance: migrasi kecil menambah kolom `source` (default `'cli'`; agent menulis `'gemini-agent'`) pada tabel novel katalog yang dipakai `lib/catalog/generator-db.server.ts` — admin QC bisa memfilter sumber.

## 7. Error handling & resumability

- Submit idempoten per `(novel_id, unit_index)` — retry aman, tidak ada double-store.
- Agent/koneksi putus di tengah novel → novel tetap `drafting`; dilanjutkan kapan pun via `seed_get_novel_status` + `seed_get_unit_spec` (pola state persistence + resume, serupa perbaikan Cloudflare 524).
- Penolakan validasi mengembalikan error terstruktur; agent memperbaiki prosa lalu submit ulang unit yang sama.
- Semua tool call di-audit (log + provenance DB: user id, novel, unit, verdict, timestamp).

## 8. Gemini Skill (v1.5 — setelah MCP terverifikasi)

- Skill markdown "Lakoku Seed" dibuat di tab **Skills** Gemini web, dipasang di akun PM.
- Isi skill: *workflow* pemakaian tool (assign → loop get_unit_spec → tulis sesuai prompt → submit → tangani `rejected` dengan revisi → lapor progres tiap 10 bab → finalize saat 62/62), larangan (tidak mencoba publish, tidak skip validasi, tidak mengarang unit di luar spec), dan format pelaporan ringkas.
- Aturan gaya & naratif **tidak diduplikasi** di skill — tetap satu sumber kebenaran di unit spec server-side; skill hanya prosedur.
- Format persis skill (nama file/field) diverifikasi saat implementasi karena fitur Gemini masih bergerak cepat.

## 9. Testing & verifikasi

- **Unit (Vitest):** handler tool, gate volume/enable, verifier token OAuth; pola mengikuti `tests/` yang ada. Validator unit-spec mewarisi cakupan test generator yang sudah ada.
- **Smoke tanpa kuota:** `scripts/mcp-seed-smoke.ts` — jalankan handler MCP in-process, isi 62 unit dengan provider `deterministic` (sudah ada di `scripts/catalog-generate.ts`), assert akhir status `review`; nol panggilan jaringan.
- **OAuth roundtrip:** authorize → code → token dengan PKCE via fetch, assert token sah & token salah ditolak.
- **Acceptance nyata:** hubungkan connector via Developer Mode (`gemini.google.com/devmode`), komando "seed 1 novel <genre>", verifikasi unit pertama masuk berprovenance `gemini-agent`; lalu pilot 1 novel penuh → QC admin (62 approved) → publish manual.
- **Reticle: skip** — tidak ada permukaan UI pembaca yang berubah.

## 10. Deployment

- Env baru di VPS (ikuti checklist `docs/VPS_DEPLOY.md`; ingat pitfall ownership: file .env wajib `chown ubuntu:ubuntu`).
- Tidak ada perubahan infra: origin sama, Caddy sama, Docker build sama.
- Rollback: set `MCP_SEED_ENABLED=0` (connector otomatis gagal tertutup), tanpa deploy ulang.

## 11. Risiko & hal terbuka

1. **Konfirmasi manual write action** (~62× per novel) — diukur saat pilot; kalau mengganggu, pertimbangkan tool batch (`seed_submit_batch`) dengan anotasi jujur. v2 Task mode butuh otonomi penuh — jadi kriteria penting untuk dievaluasi.
2. **Task mode × custom connector** belum terverifikasi Google — ditunda ke v2, desain tidak bergantung padanya.
3. **Batas region/bahasa custom apps** (dok Google menyebut US/English/Activity on) — dialog sudah tampak di akun PM; kalau nanti terblokir, fallback jalur C (MCP stdio untuk Gemini CLI) sudah teridentifikasi.
4. **Ukuran payload unit spec** (konteks kontinuitas bisa besar) — dipantau via Developer Mode; jika melebihi, rampingkan ke ringkasan threads.
5. Plugin OAuth Provider Better Auth harus mendukung authorization code flow + PKCE — diputus di spike; fallback sudah disiapkan.

## 12. Tahapan implementasi

1. **Spike auth:** OAuth 2.1 (Better Auth provider / fallback) + hello-world MCP tool tersambung dari Developer Mode.
2. **Dekorator provider agent:** `lib/mcp-seed/agent-provider.server.ts` + pump per novel — `generator.server.ts` tidak diubah; smoke katalog yang ada wajib tetap hijau.
3. **Endpoint + 5 tool:** route MCP, gate env, rate limit, migrasi `source`.
4. **Smoke + unit test** hijau penuh (deterministic, nol kuota).
5. **Deploy VPS** + hubungkan connector nyata + 1 unit Argon sukses.
6. **Pilot 1 novel penuh** → QC admin → publish manual → evaluasi friction konfirmasi.
7. **v1.5:** Gemini Skill "Lakoku Seed".
8. **v2 (spec terpisah):** Task mode terjadwal.

Keputusan terbuka yang selesai saat implementasi: pilihan plugin OAuth vs buatan, nama kolom/tabel provenance final, format skill final.
