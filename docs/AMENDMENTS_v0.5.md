# Lakoku — Amandemen Dokumen v0.5

Status: APPLIED — §A diterapkan ke `docs/PRD_Lakoku_Interactive_v0.3.md`, §B ke `docs/ARCHITECTURE_v1.1.md`, §C ke `docs/IMPLEMENTATION_PLAN.md`, §D ke `docs/PROGRESS_CHECKLIST.md` (10 Juli 2026).
Dokumen sumber: PRD v0.3, ARCHITECTURE v1.1, IMPLEMENTATION_PLAN v1.0, PROGRESS_CHECKLIST v1.0, AMENDMENTS v0.3–v0.4 (tetap berlaku).
Dokumen normatif naratif (NCS/NTM) **tidak berubah**. Brand Guidelines tidak berubah.

Amandemen ini mengunci **ownership per-user**, **model katalog/share**, dan **MVP Share Ending Card**. Ia menutup celah antara PRD target (`story_instances` milik user) dan implementasi interim saat ini (shell `stories` global + `reader_states`).

---

## 0. Keputusan yang Dikunci (Locked Decision)

### LD-STORY-OWNERSHIP — Setiap playthrough milik satu user

1. Satu **story instance** = satu playthrough milik **satu** `user_id`.
2. **Koleksiku**, **profil stats** (Cerita Berjalan / Akhir Dicapai / Pilihan Penting), dan **Lanjutkan Cerita** hanya menghitung instance / progress **milik user yang login**.
3. Tamu (**Mode tamu**) **tidak** punya library personal di server. Stats tamu = **0**; UI menampilkan CTA masuk, bukan angka katalog global.
4. Membuat / mengunci story bible **wajib** sesi login. Draft pre-login boleh di localStorage sementara; persist server hanya setelah auth.
5. Interim implementasi boleh memetakan `story_instances` PRD ke tabel `stories` + kolom `owner_user_id` (+ `reader_states` untuk progress), selama isolasi antar-user ditegakkan di query **dan** RLS/authorization. Rename skema penuh ke `story_instances` boleh belakangan (expand → backfill → switch).

### LD-CATALOG-SHARE — Jelajahi ≠ dump playthrough orang lain

1. **Jelajahi Cerita** **bukan** daftar seluruh baris `stories` di database.
2. Jelajahi menampilkan:
   - seed/demo **resmi** Lakoku (bila ada), dan/atau
   - kartu **share publik** yang user pilih untuk dibagikan (Ending Card / nanti Story Seed / Challenge).
3. User B **tidak** membaca 50 bab prosa versi User A.
4. User B yang tertarik membuat **playthrough baru** miliknya dari fondasi/seed yang diizinkan share — pilihan, state, dan ending B terpisah total dari A.
5. Janji produk tetap: *“versi cerita saya berbeda karena pilihan saya”* — tanpa menjadikan cerita personal orang lain konten publik mentah.

### LD-SHARE-MVP — Share Ending Card dulu

**MVP (wajib dulu):**
- Setelah Chapter 50 / status selesai: **Ending Card**.
- Isi card (reader-facing): cover, judul, tropes/tags, ending yang didapat, 3–5 pilihan besar **non-spoiler**, CTA **“Coba jalurmu sendiri”**.
- User menekan **Bagikan** → membuat `shared_story_links` (`share_type = ending_card`) + teaser sanitasi.
- Link publik `/s/{share_slug}` membuka landing teaser, **bukan** reader 50 bab sumber.
- CTA landing: login (bila perlu) → buat **story instance baru** milik user baru → mulai dari fondasi/seed aman (MVP boleh dari metadata teaser; foundation-copy penuh menyusul lewat `story_seeds`).

**Contoh copy share (boleh diadaptasi):**
> Aku menyelesaikan cerita ini dan mendapatkan **Akhir: Kebebasan**.  
> Aku memilih diam dulu, mengumpulkan bukti, lalu meninggalkan mereka saat semua rahasia terbuka.  
> Kamu akan memilih jalan yang sama? **Coba jalurmu sendiri.**

**Bukan MVP (nanti, setelah conversion share terbukti):**
- **Shared Story Seed** (`story_seeds` + contract snapshot aman).
- **Challenge Route** (“Bisakah kamu membuka Ending Rahasia…?”) tanpa bocor syarat ending.

### LD-SHARE-PRIVACY — Payload publik disanitasi

1. Link publik **hanya** membaca payload share yang sudah disanitasi (`teaser_json` / setara).
2. **Jangan** expose `source_story_instance_id` / `source_story_id` ke client publik sebagai hak baca.
3. **Jangan** publish full chapter prose, full jejak spoiler, secrets, facts ledger, atau contract mentah user A di landing share.
4. `visibility`: `unlisted` (link saja) atau `public` (boleh masuk Jelajahi). `revoked_at` / `expires_at` didukung.
5. Attribution creator **opsional** dan tidak wajib menampilkan identitas akun mentah.

---

## 1. Diagnosis interim (kenapa bug Tamu muncul)

Implementasi web saat amandemen ini ditulis:

| Perilaku | Penyebab |
|---|---|
| Tamu lihat banyak “Cerita Berjalan” | `listStories()` / `queryStories()` membaca **semua** row `stories` publik |
| Profil Tamu “14 / 1 / 0” | Stats hitung `stories.status` global; `Pilihan Penting` dari `reader_states` (kosong untuk tamu) |
| Cerita tidak unik per user | `persistStoryBible` upsert shell tanpa `owner_user_id`; `startFirstChapter` menulis `stories.status` global |
| Share | `ShareButton` hanya Web Share URL `/akhir/...`; belum ada link seed / playthrough baru |

Ini **bukan** perilaku produk yang diinginkan. Amandemen v0.5 mengunci koreksi.

---

## A. Amandemen PRD (v0.3)

### A1. §4 Keputusan Produk yang Dikunci
Tambah baris locked:
- Ownership playthrough per-user.
- Koleksiku / stats / Lanjutkan = milik user login saja; tamu tanpa library server.
- Jelajahi = demo resmi + share publik, bukan katalog seluruh playthrough.
- Share MVP = Ending Card + CTA “Coba jalurmu sendiri”.
- Privasi share: teaser sanitasi only.

### A2. §5.4 Non-Goals
Perjelas:
- Marketplace author UGC **bukan** MVP.
- **Boleh** share Ending Card / teaser (bukan full novel orang lain).
- Fork 50 bab prosa user lain **bukan** fitur.
- Challenge Route & full Story Seed **bukan** commercial MVP pertama; backlog pasca-MVP share.

### A3. §7.6 Koleksiku + § baru Jelajahi
- Koleksiku = library **owned/started** saja.
- Beranda memisahkan: Lanjutkan (personal) vs Jelajahi (share/demo).
- Kartu Jelajahi menampilkan teaser share, bukan progress personal orang lain sebagai milikmu.

### A4. §10.5 Story Completion Flow
Perluas langkah share:
1. Ending Card.
2. Bagikan → `shared_story_links`.
3. Penerima buka landing → mulai playthrough **baru**.
4. Instance sumber tetap private kecuali teaser yang di-share.

### A5. §10.8 Share & Start-from-Share Flow (baru)
Urutan normatif create-share, open-share, start-new-instance, catat `shared_story_starts`.

### A6. §11 Screen
- Tambah screen **Share Landing** (`/s/[slug]`).
- Ending Card elemen wajib: tropes, ending, big choices non-spoiler, CTA coba jalurmu.
- Empty state Jelajahi & stats tamu.

### A7. §15 Data Model
Tambah tabel:
- `shared_story_links`
- `story_seeds` (later)
- `shared_story_starts`
Catat mapping interim: `stories.owner_user_id` ≈ `story_instances.user_id` sampai rename.

---

## B. Amandemen ARCHITECTURE (v1.1)

### B1. §8.2 Authorization
- Access relationship yang sah untuk list library: `owner_user_id = auth.uid()` atau progress row milik user.
- Access relationship untuk share: baca **hanya** row `shared_story_links` aktif + payload sanitasi; **bukan** baca instance sumber.
- Rule #12 tetap: instance privat A tidak mempengaruhi/terbaca B.

### B2. §13 Data Architecture
- Domain baru **Social/share** (minimal tables di atas).
- Index: library by owner; share by slug; starts by link.
- Migrasi interim: kolom ownership di shell `stories` dulu; rename ke `story_instances` mengikuti expand→backfill→switch.

### B3. §23 Engineering Rules
Tambah penegasan:
- Jangan list seluruh `stories` publik sebagai library user.
- Jangan andalkan kolom demo global `stories.status/current_chapter/jejak` sebagai progress personal login.
- Jangan expose source story id sebagai capability baca publik.

---

## C. Amandemen IMPLEMENTATION_PLAN (v1.0)

Sisip backlog eksekusi (boleh paralel setelah M6-WEB jalur UX, sebelum/bersamaan hardening M9):

| Task | Inti |
|---|---|
| **T-OWN-0** | Hotfix UI: stats/list jujur untuk tamu & login (`reader_states` / owner only) |
| **T-OWN-1** | Migrasi `owner_user_id` + `visibility` pada shell story; persist set owner; list filter |
| **T-OWN-2** | Seed `reader_states` saat start bab 1; hentikan polusi status global sebagai personal |
| **T-SHARE-1** | Ending Card konten (tropes, big choices non-spoiler, copy) |
| **T-SHARE-2** | `shared_story_links` + create/revoke + `/s/[slug]` landing |
| **T-SHARE-3** | Start-from-share → instance baru + `shared_story_starts` |
| **T-SHARE-4** (later) | `story_seeds` + foundation-copy aman |
| **T-SHARE-5** (later) | Challenge Route |

---

## D. Amandemen PROGRESS_CHECKLIST

- Catat diagnosis bug Tamu / katalog global.
- Checkbox T-OWN-* dan T-SHARE-* (MVP vs later).
- Revisi catatan M1: model “published content is public” untuk **seluruh playthrough user** **dibatalkan** oleh LD-STORY-OWNERSHIP / LD-CATALOG-SHARE; yang publik hanyalah demo resmi + teaser share.

---

## 2. Aturan yang **tidak** berubah

- 50 bab, bounded branching, NCS/NTM, brand Midnight Drama.
- AI tidak disebut di UI pembaca.
- Reader API client-agnostic; tidak ada AI call dari client.
- Monetisasi entitlement per cerita (PayCore) tetap.
- Guest-to-login draft preservation tetap; yang berubah: **setelah** login, instance harus ber-owner.

---

## 3. Acceptance criteria dokumen

Amandemen ini dianggap terserap bila:
1. PRD memuat locked decision ownership + share MVP.
2. ARCH memuat access relationship share vs private instance.
3. IMPLEMENTATION_PLAN + PROGRESS_CHECKLIST memuat task T-OWN / T-SHARE.
4. Implementer tidak lagi menganggap “list semua `stories`” sebagai perilaku benar.
