## Scope: update docs dulu (belum kode app)

Kunci keputusan produk ownership + share ke dokumen normatif, supaya implementasi tidak lagi menganggap “list semua `stories`” benar.

---

## Diagnosis singkat (masuk amandemen)

Tamu lihat 14 cerita karena:
- `queryStories()` = semua row publik
- profil stats hitung status global
- `persistStoryBible` tanpa owner
- `startFirstChapter` polusi `stories.status` global

Cerita **belum** unik per user. Target PRD = `story_instances` per user + share teaser, bukan dump playthrough.

---

## Locked decisions (akan masuk AMENDMENTS v0.5)

1. **LD-STORY-OWNERSHIP** — playthrough milik satu user; Koleksiku/stats/Lanjutkan = personal; tamu stats 0
2. **LD-CATALOG-SHARE** — Jelajahi = demo resmi + share publik; B tidak baca 50 bab A; B buat instance baru
3. **LD-SHARE-MVP** — Ending Card + Bagikan + landing + CTA “Coba jalurmu sendiri”
4. **LD-SHARE-PRIVACY** — teaser sanitasi only; no source id as public read; no full prose/jejak spoiler

Later (bukan MVP): `story_seeds`, Challenge Route.

---

## File yang diubah

### 1. Baru: `docs/AMENDMENTS_v0.5.md`
Format sama v0.4: status APPLIED, locked decisions, §A PRD / §B ARCH / §C PLAN / §D CHECKLIST, diagnosis interim, acceptance criteria.

### 2. `docs/PRD_Lakoku_Interactive_v0.3.md`
- Header: catat AMENDMENTS v0.5 applied
- **§4** tabel locked: ownership, catalog/share, share MVP, privacy
- **§5.4 Non-Goals**: perjelas marketplace UGC vs share teaser; no fork 50 bab; seed/challenge later
- **§7.6 Koleksiku**: owned/started only; pisah dari Jelajahi
- **§7.x baru Jelajahi Cerita**: isi = demo + public shares; kartu teaser bukan progress orang lain
- **§10.5**: expand share steps
- **§10.x baru** Share Ending Card + Start-from-Share flow
- **§11**: screen Share Landing `/s/[slug]`; Ending Card wajib (tropes, ending, big choices, CTA); empty stats tamu
- **§15**: tabel `shared_story_links`, `story_seeds` (later), `shared_story_starts`; note interim mapping `stories.owner_user_id` ≈ `story_instances.user_id`

### 3. `docs/ARCHITECTURE_v1.1.md`
- Header: amandemen v0.5
- **§8.2**: access relationship library vs share (sanitized only)
- **§13**: domain Social/share + indexes; migrasi interim ownership di shell `stories`
- **§23**: rule tegas — no global list as library; no demo columns as personal progress login; no source id public read

### 4. `docs/IMPLEMENTATION_PLAN.md`
- Last updated + ref AMENDMENTS v0.5
- Task backlog:
  - **T-OWN-0** hotfix UI stats/list
  - **T-OWN-1** owner_user_id + visibility + list filter
  - **T-OWN-2** seed reader_states on start; stop global status as personal
  - **T-SHARE-1** Ending Card content
  - **T-SHARE-2** shared_story_links + `/s/[slug]`
  - **T-SHARE-3** start-from-share + shared_story_starts
  - **T-SHARE-4/5** later seeds + challenge

### 5. `docs/PROGRESS_CHECKLIST.md`
- Last updated note diagnosis + amandemen
- Checkbox T-OWN-* / T-SHARE-* (MVP vs later)
- Revisi catatan M1: “published content is public” **tidak** berlaku untuk seluruh playthrough user; publik = demo resmi + teaser share

### Tidak diubah
- NCS, NTM, Brand Guidelines
- Kode app (fase berikutnya setelah docs)

---

## Isi inti yang akan ditulis (preview)

**shared_story_links**
- owner_user_id, source_story_id, share_slug, share_type (`ending_card`|`story_seed`|`challenge`), visibility, title, teaser_json, spoiler_level, expires_at, revoked_at

**teaser_json (aman publik)**
- title, tagline, tropes, cover, endingName, bigChoices[], templateKey?, seedVersion, cta

**Flow MVP**
User A SELESAI → Ending Card → Bagikan → slug → User B landing → Coba jalurmu → instance baru milik B (bukan clone 50 bab A)

**Ending Card copy contoh**
> Aku menyelesaikan cerita ini dan mendapatkan Akhir: Kebebasan.  
> Aku memilih diam dulu, mengumpulkan bukti, lalu meninggalkan mereka…  
> Coba jalurmu sendiri?

---

## Setelah approve

1. Tulis `AMENDMENTS_v0.5.md`
2. Patch PRD / ARCH / PLAN / CHECKLIST sesuai §A–D
3. Laporkan diff singkat
4. **Belum** implementasi kode sampai kamu minta

Approve plan ini untuk mulai tulis docs.