# Lakoku — Rencana Implementasi Onboarding Selera → Cerita

**Status:** implementation-ready  
**Target repo:** `https://github.com/moxsenna/Lakoku`  
**Basis audit:** branch `main`, diperiksa 22 Juli 2026  
**Ruang lingkup:** onboarding awal `/onboarding/selera`, flow `/mulai`, authoring story bible, persistensi creative direction, dan penerapan preferensi pada generasi seluruh bab.

---

## 1. Tujuan

Perubahan ini harus membuat onboarding awal bukan sekadar formulir kosmetik. Jawaban pengguna harus benar-benar:

1. memengaruhi opsi yang muncul di `/mulai`;
2. memengaruhi tiga premis yang ditawarkan;
3. memengaruhi tokoh, relasi, misteri, dunia, dan arah konflik;
4. tersimpan sebagai snapshot khusus untuk cerita tersebut;
5. tetap dipakai saat menyusun Bab 1 sampai Bab 50;
6. membedakan preferensi lembut dengan batas konten tegas;
7. tidak mengalahkan canon, pilihan rute pengguna, atau aturan konsistensi naratif;
8. dapat dilacak dan diuji tanpa membocorkan prompt atau detail internal kepada pembaca.

---

## 2. Temuan kondisi repo saat ini

### 2.1 Onboarding selera

File utama:

- `components/onboarding/taste-profile-flow.tsx`
- `lib/taste-profile/schema.ts`
- `app/onboarding/selera/actions.ts`
- `lib/api/taste-profile.ts`

Masalah yang harus ditutup:

1. Pengguna dapat memilih beberapa genre, tetapi `buildOptionsFromGenres()` mengisi enam slot dari genre pertama sebelum genre berikutnya dipertimbangkan.
2. Tidak ada batas minimum atau maksimum pilihan.
3. `avoidedTropes` mencampur preferensi kualitas cerita dengan batas konten.
4. `avoidedTropes` kemudian diperlakukan sebagai hard constraint oleh `buildStorySetupIdea()`.
5. Schema memiliki `romanceLevel`, `pacing`, dan `languageStyle`, tetapi UI tidak benar-benar menanyakannya.
6. Judul langkah terakhir menyebut gaya bahasa, tetapi pilihannya hanya tipe ending.
7. Tombol `Lewati dulu` membuat profile default baru dan dapat membuang jawaban empat langkah sebelumnya.
8. Gagal menyimpan ke server diam-diam dialihkan ke `localStorage` tanpa memberi tahu pengguna.
9. Default profile seperti `subtle`, `sinematik`, dan `keadilan` dapat terlihat seperti preferensi pengguna walau pengguna tidak pernah memilihnya.

### 2.2 Flow `/mulai`

File utama:

- `components/mulai/onboarding-flow.tsx`
- `lib/onboarding/question-presets.ts`
- `lib/onboarding/story-setup.ts`
- `app/mulai/actions.ts`

Masalah yang harus ditutup:

1. Pertanyaan `/mulai` mengulang hal yang sudah ditanyakan pada onboarding selera.
2. Opsi default terlalu condong ke drama-romansa, misalnya `Pasangan yang berkhianat`.
3. `Pilihkan untukku` saat ini diselesaikan menjadi jawaban hard-coded di client.
4. Personalisasi profile terutama hanya mempromosikan, menurunkan, atau menyisipkan opsi statis.
5. Matching fuzzy berbasis substring dapat menghasilkan kecocokan lemah atau salah.
6. Opsi yang dihindari hanya diturunkan urutannya, sedangkan prompt kemudian melarangnya sepenuhnya.
7. `actProposeStorySetupPremises()` memakai profile untuk membuat premis, tetapi tahapan berikutnya:
   - `actProposeCast()`
   - `actProposeMystery()`
   - `actProposeWorld()`

   hanya menerima premis/cast/mystery dan tidak menerima creative direction yang lengkap.
8. `StoryBibleDraft` belum membawa snapshot preferensi cerita.
9. Preferensi bahasa, tempo, intensitas, dan batas konten belum terbukti ikut ke generasi seluruh bab.

### 2.3 Pipeline authoring dan runtime

File terkait:

- `lib/authoring/brainstorm.ts`
- `lib/authoring/schema.ts`
- `lib/authoring/compile.ts`
- `lib/authoring/persist.ts`
- `lib/runtime/story-generation.ts`
- pipeline personalized/generation contract yang sudah ada di repo

Kebutuhan utama:

- Creative direction harus menjadi sidecar story-level, bukan hanya string sementara untuk premis.
- Ia tidak boleh menggantikan canon.
- Ia harus tersedia untuk:
  - premise generation;
  - cast generation;
  - mystery generation;
  - world generation;
  - compile/blueprint;
  - chapter generation;
  - choice generation;
  - validation/repair.

---

## 3. Prinsip produk dan prioritas aturan

Gunakan urutan prioritas berikut.

### 3.1 Saat membangun story bible

1. **Batas konten tegas pengguna**
2. **Arahan khusus untuk cerita saat ini**
3. **Aturan canon, 50 bab, reveal gate, dan konsistensi**
4. **Preferensi selera global**
5. **Default engine**

Hard boundary tidak boleh dikalahkan oleh preferensi atau ide otomatis. Bila custom idea pengguna sendiri bertentangan dengan hard boundary yang masih aktif, minta pengguna mengubah salah satunya sebelum cerita dikunci.

### 3.2 Saat membuat bab

1. Canon dan fakta yang sudah terkunci
2. Reveal gate dan chapter blueprint
3. Route state serta pilihan pengguna sebelumnya
4. Batas konten tegas story snapshot
5. Creative direction khusus cerita
6. Preferensi gaya dan tempo
7. Default penulisan

Preferensi lembut tidak boleh memaksa cerita mengabaikan konsekuensi pilihan pengguna.

### 3.3 Arti jenis preferensi

| Jenis | Contoh | Perilaku |
|---|---|---|
| Preferensi lembut | suka misteri, ritme cepat, gaya puitis | diarahkan, tetapi boleh dikalahkan canon dan pilihan rute |
| Hal yang dikurangi | twist tanpa petunjuk, konflik berulang | hindari bila memungkinkan; bukan larangan mutlak |
| Batas konten | kekerasan seksual, menyakiti diri, kekerasan grafis | hard constraint; wajib dicegah atau diperbaiki |
| Arahan cerita saat ini | kali ini ingin menjadi pewaris kerajaan | lebih kuat daripada selera global |
| Pilihan pembaca di dalam cerita | memilih menyelamatkan sekutu | lebih kuat daripada preferensi global |

---

## 4. Arsitektur target

```text
Onboarding selera
    ↓
TasteProfile V2
    ↓
/mulai membaca profile + meminta detail khusus cerita
    ↓
ResolvedStorySetup
    ↓
StoryCreativeDirection snapshot
    ↓
3 premis
    ↓
premis terpilih
    ↓
cast → mystery → world
    ↓
validasi terhadap direction + boundaries
    ↓
lock story bible + persist creative direction
    ↓
Bab 1–50 selalu memuat:
canon + route state + chapter brief + creative direction
```

### 4.1 Sumber kebenaran

- `TasteProfile`: preferensi lintas cerita milik pengguna.
- `StoryCreativeDirection`: snapshot preferensi khusus satu cerita.
- `CanonSnapshot`: fakta naratif yang sudah terkunci.
- `RouteState`: perubahan akibat pilihan selama membaca.

Jangan membaca Taste Profile terbaru secara langsung untuk mengubah cerita lama. Setiap cerita memakai snapshot saat cerita dibuat, kecuali pengguna secara eksplisit memilih **“Terapkan selera terbaruku ke cerita ini”** pada fitur masa depan.

---

## 5. Model data Taste Profile V2

### 5.1 Gunakan stable ID, bukan label sebagai data

Label dapat berubah tanpa merusak data lama.

```ts
export const GenreIdSchema = z.enum([
  'family_drama',
  'romance',
  'mystery',
  'fantasy_kingdom',
  'slice_of_life',
  'survival_thriller',
])

export const DramaIntensitySchema = z.enum([
  'warm',
  'balanced',
  'intense',
])

export const PacingSchema = z.enum([
  'slow_deep',
  'balanced',
  'fast_eventful',
])

export const LanguageStyleSchema = z.enum([
  'clear_concise',
  'poetic_emotional',
  'cinematic_visual',
])

export const EndingBiasSchema = z.enum([
  'peaceful',
  'justice',
  'victory',
  'bittersweet',
])
```

### 5.2 Schema yang disarankan

```ts
export const TasteProfileV2Schema = z.object({
  version: z.literal(2),

  primaryGenreId: GenreIdSchema.nullable(),
  secondaryGenreId: GenreIdSchema.nullable(),

  likedConflictIds: z.array(z.string()).max(3),
  customLikedConflict: z.string().trim().max(160).nullable(),

  softAvoidanceIds: z.array(z.string()).max(4),
  contentBoundaryIds: z.array(z.string()).max(12),

  dramaIntensity: DramaIntensitySchema.nullable(),
  pacing: PacingSchema.nullable(),
  languageStyle: LanguageStyleSchema.nullable(),
  endingBias: EndingBiasSchema.nullable(),

  completedAt: z.string().nullable(),
  skippedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})
```

### 5.3 Jangan gunakan default semu

Profile kosong harus benar-benar kosong:

```ts
{
  version: 2,
  primaryGenreId: null,
  secondaryGenreId: null,
  likedConflictIds: [],
  customLikedConflict: null,
  softAvoidanceIds: [],
  contentBoundaryIds: [],
  dramaIntensity: null,
  pacing: null,
  languageStyle: null,
  endingBias: null,
  completedAt: null,
  skippedAt: null,
  updatedAt: null,
}
```

Default engine boleh tetap memiliki gaya internal, tetapi jangan disimpan seolah-olah itu pilihan pengguna.

### 5.4 `romanceLevel`

Jangan jadikan preferensi romansa sebagai default global tersembunyi.

Pilihan yang disarankan:

- keluarkan dari onboarding selera V2;
- tanyakan sebagai fokus hubungan khusus cerita di `/mulai`;
- pertahankan parser V1 untuk migrasi data lama;
- bila field masih diperlukan untuk kompatibilitas, ubah menjadi nullable dan jangan dipakai jika pengguna tidak pernah memilihnya.

### 5.5 Migrasi V1 → V2

Buat fungsi murni:

```ts
migrateTasteProfileToV2(raw: unknown): TasteProfileV2
```

Pemetaan genre:

| V1 label | V2 ID |
|---|---|
| Drama keluarga | `family_drama` |
| Romansa | `romance` |
| Misteri & rahasia | `mystery` |
| Fantasi & kerajaan | `fantasy_kingdom` |
| Slice of life | `slice_of_life` |
| Thriller & bertahan hidup | `survival_thriller` |

Aturan:

1. genre pertama V1 → `primaryGenreId`;
2. genre kedua V1 → `secondaryGenreId`;
3. genre selebihnya diabaikan dan dicatat hanya di telemetry migrasi, tanpa raw value;
4. mapped conflict/avoidance memakai registry alias;
5. nilai lama yang tidak dikenal tidak boleh membuat parse gagal;
6. `avoidedTropes` lama:
   - item kualitas cerita → `softAvoidanceIds`;
   - item sensitif/konten → `contentBoundaryIds`;
7. `completedAt`, `skippedAt`, `updatedAt` dipertahankan;
8. migrasi bersifat idempoten.

### 5.6 File yang disarankan

```text
lib/taste-profile/
  schema.ts
  catalog.ts
  migrate.ts
  resolver.ts
  storage.ts
```

---

## 6. Copywriting onboarding awal

## 6.1 Layar pembuka

**Eyebrow:**  
`SELERA CERITAMU`

**Judul:**  
`Biar ceritanya terasa lebih kamu`

**Deskripsi:**  
`Pilih beberapa hal yang kamu nikmati. Lakoku akan memakainya saat menyusun premis, tokoh, konflik, gaya penulisan, dan arah akhir. Semuanya bisa diubah nanti.`

**CTA utama:**  
`Atur seleraku`

**CTA sekunder:**  
`Nanti saja`

**Catatan UX:**

- “Nanti saja” tersedia sejak awal.
- Menekan “Nanti saja” menyimpan profile kosong dengan `skippedAt`.
- Jangan menyisipkan default preferensi ke profile kosong.

---

## 6.2 Langkah 1 — jenis cerita

**Eyebrow:**  
`LANGKAH 1 DARI 5`

**Judul:**  
`Jenis cerita apa yang paling kamu suka?`

**Deskripsi:**  
`Pilih maksimal 2. Pilihan pertama menjadi genre utama.`

**Counter:**  
`0 dari 2 dipilih`

### Pilihan

| ID | Label |
|---|---|
| `family_drama` | Drama keluarga |
| `romance` | Romansa |
| `mystery` | Misteri & rahasia |
| `fantasy_kingdom` | Fantasi & kerajaan |
| `slice_of_life` | Slice of life |
| `survival_thriller` | Thriller & bertahan hidup |

### State terpilih

Pilihan pertama:

- badge: `Utama`

Pilihan kedua:

- badge: `Pendamping`

### Aturan interaksi

1. maksimal dua;
2. saat primary dihapus dan secondary masih ada, secondary otomatis menjadi primary;
3. CTA `Lanjut` aktif setelah minimal satu dipilih;
4. tampilkan pesan ringan jika mencoba memilih ketiga:

`Pilih maksimal dua agar arah ceritanya tetap jelas.`

---

## 6.3 Langkah 2 — konflik yang disukai

**Eyebrow:**  
`LANGKAH 2 DARI 5`

**Judul:**  
`Konflik apa yang paling bikin kamu penasaran?`

**Deskripsi:**  
`Pilihan ini akan memengaruhi premis yang kami tawarkan. Pilih maksimal 3.`

**Counter:**  
`0 dari 3 dipilih`

**Aksi tambahan:**  
`Tulis konflik sendiri`

### Catalog konflik — Drama keluarga

| ID | Label |
|---|---|
| `family_inheritance_split` | Warisan yang memecah keluarga |
| `family_return_with_secret` | Anak yang pulang membawa rahasia |
| `family_parent_hidden_past` | Masa lalu orang tua yang sengaja ditutup |
| `family_sibling_rivalry` | Saudara yang berubah menjadi rival |
| `family_unknown_sacrifice` | Pengorbanan lama yang tak pernah diketahui |
| `family_chosen_vs_blood` | Memilih antara keluarga kandung dan keluarga yang menerima kita |

### Catalog konflik — Romansa

| ID | Label |
|---|---|
| `romance_enemies_allies` | Dua musuh yang terpaksa bekerja sama |
| `romance_old_love_returns` | Cinta lama kembali saat hidup sudah berubah |
| `romance_contract_relationship` | Hubungan kontrak yang perlahan menjadi nyata |
| `romance_friends_hidden_feelings` | Sahabat yang lama menyimpan perasaan |
| `romance_different_worlds` | Dua orang dari dunia yang sulit disatukan |
| `romance_second_chance` | Kesempatan kedua setelah hubungan yang hancur |

### Catalog konflik — Misteri & rahasia

| ID | Label |
|---|---|
| `mystery_hidden_identity` | Identitas asli yang sengaja disembunyikan |
| `mystery_old_death` | Kematian lama yang menyisakan kejanggalan |
| `mystery_old_object_clue` | Surat atau benda lama yang membuka rahasia |
| `mystery_conflicting_witness` | Saksi yang muncul dengan cerita berbeda |
| `mystery_missing_person` | Hilangnya seseorang yang terkait masa lalu |
| `mystery_family_coverup` | Keluarga besar yang bersama-sama menutup kebenaran |

### Catalog konflik — Fantasi & kerajaan

| ID | Label |
|---|---|
| `fantasy_throne_struggle` | Perebutan takhta yang mengancam kerajaan |
| `fantasy_forbidden_magic` | Sihir terlarang yang kembali bangkit |
| `fantasy_hidden_heir` | Pewaris yang tidak mengetahui asal-usulnya |
| `fantasy_misread_prophecy` | Ramalan yang selama ini dipahami dengan salah |
| `fantasy_fragile_alliance` | Aliansi dua kerajaan yang nyaris runtuh |
| `fantasy_curse_price` | Kutukan yang hanya bisa dipatahkan dengan harga besar |

### Catalog konflik — Slice of life

| ID | Label |
|---|---|
| `slice_new_life` | Memulai hidup baru di tempat yang asing |
| `slice_return_home` | Pulang dan menghadapi masa lalu yang belum selesai |
| `slice_adult_friendship` | Persahabatan dewasa yang tumbuh di saat sulit |
| `slice_small_dream` | Mimpi kecil yang perlahan menjadi nyata |
| `slice_community` | Menemukan keluarga baru di sebuah komunitas |
| `slice_second_career` | Kesempatan kedua untuk mengejar jalan hidup berbeda |

### Catalog konflik — Thriller & bertahan hidup

| ID | Label |
|---|---|
| `thriller_trapped` | Terjebak di tempat tanpa jalan keluar |
| `thriller_hunted_by_past` | Diburu oleh sesuatu dari masa lalu |
| `thriller_betrayer_inside` | Salah satu sekutu ternyata berkhianat |
| `thriller_race_against_time` | Berpacu dengan waktu sebelum semuanya terlambat |
| `thriller_survival_sacrifice` | Bertahan hidup dengan pilihan yang menuntut pengorbanan |
| `thriller_personal_conspiracy` | Konspirasi besar yang berpusat pada tokoh utama |

### Algoritme opsi

Jika satu genre dipilih:

- tampilkan enam opsi genre tersebut.

Jika dua genre dipilih:

- empat opsi dari primary;
- dua opsi dari secondary;
- gunakan round-robin kategori agar tidak semua opsi terasa serupa;
- deduplicate berdasarkan ID, bukan label;
- urutan stabil untuk testing;
- jangan mengambil enam opsi pertama dari genre pertama.

Contoh:

```text
Primary: Misteri
Secondary: Fantasi

1. Identitas asli yang sengaja disembunyikan
2. Perebutan takhta yang mengancam kerajaan
3. Kematian lama yang menyisakan kejanggalan
4. Sihir terlarang yang kembali bangkit
5. Surat atau benda lama yang membuka rahasia
6. Keluarga besar yang bersama-sama menutup kebenaran
```

Bobot tetap 4:2, tetapi penyajian diselingi agar genre kedua tidak terlihat sebagai tambahan yang tidak penting.

---

## 6.4 Langkah 3 — yang dikurangi dan batas konten

**Eyebrow:**  
`LANGKAH 3 DARI 5`

**Judul:**  
`Ada hal yang ingin kamu kurangi atau hindari?`

### Bagian A — preferensi lembut

**Heading:**  
`Kurangi dalam cerita`

**Deskripsi:**  
`Lakoku akan berusaha menguranginya, tetapi ini bukan larangan mutlak.`

**Pilihan maksimal:** 4

| ID | Label |
|---|---|
| `avoid_unearned_twist` | Twist yang muncul tanpa petunjuk |
| `avoid_plot_induced_stupidity` | Tokoh bertindak bodoh hanya demi plot |
| `avoid_repetitive_conflict` | Konflik yang berulang tanpa perkembangan |
| `avoid_unanswered_secret` | Rahasia penting dibiarkan tanpa jawaban |
| `avoid_excessive_melodrama` | Drama yang terlalu dipaksakan |
| `avoid_romance_takeover` | Romansa mengambil alih cerita utama |
| `avoid_shock_death` | Kematian tokoh hanya demi kejutan |
| `avoid_ambiguous_ending` | Akhir menggantung tanpa kepastian yang cukup |

### Bagian B — batas tegas

**Heading:**  
`Jangan tampilkan`

**Deskripsi:**  
`Pilihan ini menjadi batas tegas untuk cerita yang dibuat dari seleramu.`

| ID | Label pembaca |
|---|---|
| `boundary_graphic_violence` | Kekerasan yang digambarkan secara grafis |
| `boundary_sexual_violence` | Kekerasan seksual |
| `boundary_self_harm_suicide` | Menyakiti diri atau bunuh diri |
| `boundary_torture` | Penyiksaan |
| `boundary_intense_horror` | Horor atau jumpscare yang intens |
| `boundary_child_death` | Kematian anak |
| `boundary_protagonist_death` | Kematian tokoh utama |
| `boundary_partner_infidelity` | Perselingkuhan pasangan |
| `boundary_explicit_sexual_content` | Adegan seksual eksplisit |

**Opsi eksklusif:**  
`Tidak ada batas khusus`

Aturan:

- memilih `Tidak ada batas khusus` menghapus pilihan hard boundary lain;
- memilih hard boundary lain otomatis menghapus `Tidak ada batas khusus`;
- hard boundary tidak boleh disimpan sebagai `softAvoidanceIds`.

---

## 6.5 Langkah 4 — intensitas dan ritme

**Eyebrow:**  
`LANGKAH 4 DARI 5`

**Judul:**  
`Seberapa intens dan cepat ceritanya?`

### Bagian A — Intensitas

**Heading:**  
`Intensitas`

| ID | Label | Deskripsi |
|---|---|---|
| `warm` | Hangat | Konflik lebih ringan dengan banyak ruang bernapas |
| `balanced` | Seimbang | Emosi dan konflik terasa kuat tanpa terus menekan |
| `intense` | Intens | Taruhan tinggi, konflik tajam, dan emosi naik-turun |

### Bagian B — Ritme

**Heading:**  
`Ritme cerita`

| ID | Label | Deskripsi |
|---|---|---|
| `slow_deep` | Perlahan & mendalam | Lebih banyak ruang untuk relasi, suasana, dan detail |
| `balanced` | Seimbang | Adegan tenang dan kejadian besar bergantian |
| `fast_eventful` | Cepat & penuh kejadian | Cerita bergerak cepat dengan tekanan yang sering meningkat |

CTA aktif setelah satu intensitas dan satu ritme dipilih.

---

## 6.6 Langkah 5 — ending dan gaya penulisan

**Eyebrow:**  
`LANGKAH 5 DARI 5`

**Judul:**  
`Akhir dan gaya penulisan seperti apa yang kamu suka?`

### Bagian A — Arah akhir

**Heading:**  
`Arah akhir yang terasa paling memuaskan`

**Deskripsi:**  
`Ini menjadi kecenderungan. Pilihanmu selama membaca tetap menentukan hasil akhirnya.`

| ID | Label | Deskripsi |
|---|---|---|
| `peaceful` | Lega & damai | Luka lama selesai dan tokoh bisa melanjutkan hidup |
| `justice` | Keadilan | Kebenaran terbuka dan yang bersalah menerima akibat |
| `victory` | Kemenangan | Tokoh utama merebut kembali sesuatu yang sangat berarti |
| `bittersweet` | Pahit, tetapi bermakna | Ada kehilangan, namun perjalanan terasa berharga |

### Bagian B — Gaya penulisan

**Heading:**  
`Gaya penulisan`

| ID | Label | Deskripsi |
|---|---|---|
| `clear_concise` | Jernih & ringkas | Kalimat langsung, mudah diikuti, tidak bertele-tele |
| `poetic_emotional` | Puitis & emosional | Lebih banyak suasana, perasaan, dan pilihan kata lembut |
| `cinematic_visual` | Sinematik & visual | Adegan terasa hidup seperti rangkaian gambar dalam film |

**CTA utama:**  
`Simpan seleraku`

**CTA sekunder:**  
`Simpan yang sudah kupilih`

Jangan gunakan `Lewati dulu` pada langkah terakhir karena dapat disalahartikan sebagai membuang seluruh jawaban.

---

## 6.7 Ringkasan sebelum simpan

Tampilkan ringkasan kecil di atas CTA:

```text
Selera ceritamu

Misteri + Fantasi
Intens · Ritme seimbang
Gaya sinematik
Akhir damai
3 batas cerita
```

Aksi:

- `Ubah` pada tiap kelompok;
- tidak perlu modal baru;
- kembali ke step terkait.

---

## 6.8 Copy status simpan

### Berhasil tersimpan ke akun

`Seleramu sudah tersimpan.`

### Hanya tersimpan lokal

`Seleramu tersimpan di perangkat ini. Sinkronisasi akun belum berhasil.`

Aksi:

`Coba sinkronkan lagi`

### Gagal total

`Seleramu belum berhasil disimpan. Pilihanmu tetap ada di halaman ini.`

Aksi:

`Coba simpan lagi`

Jangan redirect bila penyimpanan server dan lokal sama-sama gagal.

---

## 7. State machine onboarding selera

```ts
type TasteOnboardingPhase =
  | 'intro'
  | 'genre'
  | 'conflicts'
  | 'boundaries'
  | 'tone'
  | 'ending_style'
  | 'saving'
  | 'save_error'
  | 'done'
```

### 7.1 Validasi per langkah

| Langkah | Minimum | Maksimum |
|---|---:|---:|
| Genre | 1 | 2 |
| Konflik | 1 | 3 |
| Soft avoidance | 0 | 4 |
| Hard boundary | 0 | 12 |
| Intensitas | 1 | 1 |
| Ritme | 1 | 1 |
| Ending | 1 | 1 |
| Gaya bahasa | 1 | 1 |

### 7.2 Perilaku back

- Back dari langkah pertama → intro.
- Back dari intro → route sebelumnya.
- Jawaban tidak hilang.
- Dynamic conflict list dibangun ulang saat genre berubah.
- Conflict terpilih yang tidak lagi relevan:
  - jangan diam-diam dihapus;
  - tampilkan konfirmasi kecil:

  `Dua pilihan konflik tidak cocok dengan genre baru dan akan dihapus.`

### 7.3 Skip dan partial save

- `Nanti saja` di intro → profile kosong + `skippedAt`.
- Keluar setelah mengisi sebagian → simpan draft lokal.
- Kembali ke onboarding → tawarkan:
  - `Lanjutkan pilihan sebelumnya`
  - `Mulai ulang`
- Tombol akhir selalu menyimpan pilihan yang sudah dibuat.

---

## 8. Perombakan flow `/mulai`

## 8.1 Tujuan

`/mulai` tidak mengulang kuis selera global. Halaman ini hanya menanyakan keputusan yang khusus untuk cerita yang sedang dibuat.

### Yang berasal dari Taste Profile

- genre utama dan pendamping;
- konflik yang biasa disukai;
- hal yang ingin dikurangi;
- hard boundaries;
- intensitas;
- pacing;
- language style;
- ending bias.

### Yang tetap ditanyakan per cerita

- konflik utama kali ini;
- peran protagonis;
- hubungan inti;
- gaya mengambil keputusan;
- override opsional untuk cerita ini.

---

## 8.2 Entry screen baru

### Bila profile tersedia

**Eyebrow:**  
`MULAI CERITA`

**Judul:**  
`Cerita seperti apa yang ingin kamu jalani kali ini?`

### Card ringkasan

**Heading:**  
`Selera yang akan dipakai`

**Contoh:**  
`Misteri + Fantasi · Intens · Sinematik · Akhir damai`

**Subcopy:**  
`Kami akan memakai selera ini untuk menyusun premis, tokoh, konflik, dan gaya cerita.`

**Aksi:**  
`Ubah untuk cerita ini`

### Pilihan mode

1. **Mulai cepat dari seleraku**  
   `Jawab beberapa detail khusus, lalu Lakoku menyiapkan 3 premis.`

2. **Aku sudah punya ide cerita**  
   `Tulis benih ceritamu. Selera dan batas ceritamu tetap ikut diterapkan.`

3. **Rancang perlahan**  
   `Tentukan premis, tokoh, misteri, dan dunia satu per satu.`

### Bila profile tidak tersedia

Tampilkan teaser:

`Belum ada selera tersimpan.`

Aksi utama:

`Atur selera dulu`

Aksi sekunder:

`Lanjut tanpa mengatur`

---

## 8.3 Quick setup adaptif

Buat builder yang mengembalikan pertanyaan berdasarkan data yang belum tersedia.

```ts
buildStorySpecificQuestions({
  tasteProfile,
  sessionOverrides,
})
```

Urutan:

1. `genre` — hanya bila profile tidak punya primary genre;
2. `coreConflict` — selalu;
3. `protagonistRole` — selalu;
4. `relationshipFocus` — selalu;
5. `agencyStyle` — selalu;
6. `endingDirection` — hanya bila profile tidak memiliki ending bias.

Dengan profile lengkap, pengguna hanya menjawab empat pertanyaan.

---

## 8.4 Pertanyaan `/mulai` dan copy

### Pertanyaan 1 — konflik utama kali ini

**Prompt:**  
`Masalah apa yang ingin menjadi pusat cerita kali ini?`

**Helper:**  
`Pilih satu. Kami akan mengembangkan tokoh, rahasia, dan dunianya dari sini.`

Opsi:

- ambil hingga tiga dari `likedConflictIds`;
- tambahkan hingga dua opsi baru dari genre primary/secondary;
- maksimal lima kartu;
- aksi terpisah:
  - `Pilihkan yang paling cocok`
  - `Tulis sendiri`

Jangan menyimpan `Pilihkan untukku` sebagai label jawaban.

Gunakan:

```ts
type AutoOrValue<T> =
  | { mode: 'auto' }
  | { mode: 'selected'; value: T }
  | { mode: 'custom'; text: string }
```

Server yang menyelesaikan `auto` berdasarkan profile dan jawaban lain.

---

### Pertanyaan 2 — peran protagonis

**Prompt:**  
`Kamu ingin menjadi tokoh seperti apa?`

**Helper:**  
`Peran ini menentukan posisi dan taruhanmu di dalam cerita.`

#### Role catalog — Drama keluarga

| ID | Label |
|---|---|
| `role_family_overlooked_heir` | Pewaris yang selama ini selalu diremehkan |
| `role_family_returning_child` | Anak yang pulang setelah lama menghilang |
| `role_family_parent_rebuilding` | Orang tua yang berusaha membangun hidup kembali |
| `role_family_outsider` | Orang luar yang tiba-tiba masuk ke keluarga berpengaruh |

#### Role catalog — Romansa

| ID | Label |
|---|---|
| `role_romance_rebuilding_life` | Seseorang yang sedang membangun hidup setelah patah hati |
| `role_romance_old_friend` | Sahabat lama yang kembali pada waktu yang tidak tepat |
| `role_romance_reluctant_partner` | Pasangan dalam kesepakatan yang tidak pernah direncanakan |
| `role_romance_ambitious_outsider` | Pendatang ambisius yang jatuh hati pada dunia yang berbeda |

#### Role catalog — Misteri

| ID | Label |
|---|---|
| `role_mystery_unexpected_heir` | Pewaris tak terduga dari keluarga penuh rahasia |
| `role_mystery_returning_witness` | Saksi lama yang kembali untuk mencari jawaban |
| `role_mystery_archive_keeper` | Penjaga arsip yang menemukan bukti terlarang |
| `role_mystery_family_outsider` | Orang luar yang terseret ke dalam rahasia keluarga |

#### Role catalog — Fantasi & kerajaan

| ID | Label |
|---|---|
| `role_fantasy_hidden_heir` | Pewaris tersembunyi yang diburu banyak pihak |
| `role_fantasy_royal_guard` | Pengawal kerajaan yang harus memilih kesetiaan |
| `role_fantasy_forbidden_mage` | Pengguna sihir terlarang yang menyembunyikan kekuatan |
| `role_fantasy_diplomat` | Utusan kerajaan yang terjebak di antara dua pihak |

#### Role catalog — Slice of life

| ID | Label |
|---|---|
| `role_slice_newcomer` | Pendatang baru yang ingin memulai dari nol |
| `role_slice_returning_home` | Seseorang yang pulang setelah hidupnya berantakan |
| `role_slice_small_business` | Pemilik usaha kecil yang mempertaruhkan impian terakhir |
| `role_slice_teacher_artist` | Pengajar atau seniman yang kehilangan arah hidup |

#### Role catalog — Thriller

| ID | Label |
|---|---|
| `role_thriller_survivor` | Penyintas yang tahu sesuatu yang seharusnya tetap terkubur |
| `role_thriller_witness` | Saksi yang menjadi target setelah melihat terlalu banyak |
| `role_thriller_rescuer` | Penolong yang masuk terlalu jauh ke dalam bahaya |
| `role_thriller_fugitive` | Buronan yang harus membuktikan bahwa dirinya dijebak |

Algoritme:

- tiga opsi dari primary;
- satu opsi dari secondary;
- satu `Pilihkan yang paling cocok`;
- satu `Tulis sendiri`;
- jangan tampilkan role yang bertentangan dengan hard boundary.

---

### Pertanyaan 3 — hubungan inti

**Prompt:**  
`Hubungan apa yang paling penting dalam perjalananmu?`

**Helper:**  
`Ini menentukan ikatan emosional utama, bukan selalu romansa.`

| ID | Label |
|---|---|
| `relationship_family` | Keluarga yang retak, tetapi masih ingin diselamatkan |
| `relationship_uncertain_ally` | Sekutu yang belum sepenuhnya bisa dipercaya |
| `relationship_slow_romance` | Seseorang yang perlahan menjadi cinta |
| `relationship_rival` | Rival yang terus memaksaku berubah |
| `relationship_self_growth` | Fokus pada perjalanan dan pemulihan diriku sendiri |

Aturan adaptif:

- bila `boundary_partner_infidelity` aktif, jangan menawarkan premis perselingkuhan;
- bila genre utama bukan romance, romansa tetap boleh muncul sebagai satu opsi, bukan asumsi default;
- bila memilih `relationship_self_growth`, authoring tidak wajib membuat satu love interest utama;
- hapus kalimat lama yang menjanjikan “Satu love interest utama akan hadir”.

---

### Pertanyaan 4 — gaya mengambil keputusan

**Prompt:**  
`Bagaimana kamu ingin menghadapi masalah dalam cerita ini?`

**Helper:**  
`Ini membantu Lakoku menyiapkan pilihan rute yang terasa cocok, tanpa membatasi keputusanmu nanti.`

| ID | Label |
|---|---|
| `agency_observe` | Mengamati dulu, lalu bergerak saat sudah yakin |
| `agency_direct` | Menghadapi masalah secara langsung |
| `agency_protective` | Melindungi orang lain meski harus berkorban |
| `agency_strategic` | Menyusun rencana dan menyimpan kartu terakhir |

Catatan:

- nilai ini adalah bias choice design;
- setiap bab tetap harus menawarkan pilihan yang benar-benar berbeda;
- jangan membuat semua pilihan mengikuti agency style yang sama;
- setidaknya satu opsi dapat menantang kecenderungan pengguna.

---

### Pertanyaan fallback — ending

Hanya tampil bila profile belum mempunyai ending bias.

**Prompt:**  
`Arah akhir mana yang paling ingin kamu kejar?`

**Helper:**  
`Ini bukan jaminan. Pilihanmu selama membaca tetap menentukan hasilnya.`

Gunakan empat copy ending dari onboarding selera.

---

## 8.5 Override khusus cerita

Pada card `Ubah untuk cerita ini`, tampilkan bottom sheet atau halaman kecil:

- intensitas;
- pacing;
- language style;
- ending direction;
- hard boundaries.

Copy:

**Judul:**  
`Atur khusus untuk cerita ini`

**Deskripsi:**  
`Perubahan ini hanya berlaku pada cerita baru ini dan tidak mengubah selera utamamu.`

CTA:

- `Pakai untuk cerita ini`
- `Gunakan selera utamaku`

Jangan simpan override ke Taste Profile kecuali pengguna menekan aksi eksplisit:

`Simpan juga sebagai selera utamaku`

---

## 8.6 Proposal premis

Sebelum tiga proposal, tampilkan chip ringkas:

```text
Misteri + Fantasi
Identitas tersembunyi
Tokoh: pewaris tak terduga
Hubungan: sekutu yang belum dipercaya
Intens · Sinematik
```

Pada setiap proposal, tambahkan alasan reader-safe:

`Cocok karena: misteri keluarga, perebutan kekuasaan, dan hubungan penuh kecurigaan.`

Jangan menyebut profile, prompt, model, atau AI.

Tiga proposal harus berbeda pada:

1. situasi pembuka;
2. taruhan utama;
3. sumber konflik;
4. bentuk relasi;
5. arah misteri.

Bukan tiga variasi tipis dari nama dan lokasi berbeda.

---

## 9. Kontrak `StoryCreativeDirection`

Buat schema server-owned:

```ts
export const StoryCreativeDirectionSchema = z.object({
  version: z.literal(1),
  sourceTasteProfileVersion: z.number().int(),

  genre: z.object({
    primary: GenreIdSchema.nullable(),
    secondary: GenreIdSchema.nullable(),
  }),

  preferences: z.object({
    likedConflictIds: z.array(z.string()),
    softAvoidanceIds: z.array(z.string()),
    dramaIntensity: DramaIntensitySchema.nullable(),
    pacing: PacingSchema.nullable(),
    languageStyle: LanguageStyleSchema.nullable(),
    endingBias: EndingBiasSchema.nullable(),
  }),

  hardBoundaries: z.array(z.string()),

  storySetup: z.object({
    coreConflict: z.object({
      id: z.string().nullable(),
      customText: z.string().nullable(),
      resolvedFromAuto: z.boolean(),
    }),
    protagonistRole: z.object({
      id: z.string().nullable(),
      customText: z.string().nullable(),
      resolvedFromAuto: z.boolean(),
    }),
    relationshipFocus: z.string(),
    agencyStyle: z.string(),
  }),

  source: z.enum([
    'taste_quick',
    'taste_custom_idea',
    'no_taste_quick',
    'brainstorm',
  ]),

  promptContractVersion: z.string(),
  createdAt: z.string(),
})
```

### 9.1 Jangan menyimpan label sebagai otoritas

Simpan stable ID. Label hanya dirender dari catalog.

Custom text disimpan sebagai text setelah:

- trim;
- max length;
- consumer-safe scan;
- tidak ditulis ke logs.

### 9.2 Fingerprint

Buat:

```ts
creativeDirectionFingerprint(direction): string
```

Gunakan hash stabil dari normalized JSON.

Log internal cukup menyimpan:

- storyId;
- correlationId;
- direction version;
- fingerprint;
- daftar field yang diterapkan.

Jangan log raw custom idea, raw boundaries, atau isi profile penuh.

---

## 10. Resolusi profile di server

Saat `actProposeStorySetupPremises()` dipanggil:

1. validasi session;
2. baca Taste Profile server untuk user;
3. baca guest profile hanya sebagai fallback terverifikasi;
4. server profile menang bila sudah complete;
5. migrasikan ke V2;
6. gabungkan story-specific override;
7. resolve semua `{ mode: 'auto' }`;
8. hasilkan `StoryCreativeDirection`;
9. gunakan direction untuk prompt premis;
10. return:
   - proposals;
   - normalized public summary;
   - opaque `setupToken` atau validated direction payload.

### 10.1 Hindari mempercayai client secara berlebihan

Karena action saat ini memerlukan login, profile akun seharusnya dibaca oleh server. `guestTasteProfile` dipakai hanya bila:

- server profile kosong;
- profile guest lolos schema;
- pengguna baru saja login dari flow guest.

### 10.2 Pilihan auto

Resolver auto harus:

- memakai primary genre;
- memakai konflik yang disukai;
- menghindari soft avoidance bila ada alternatif;
- tidak pernah melanggar hard boundaries;
- bersifat deterministik untuk input sama;
- mengembalikan ID hasil resolusi;
- tidak memakai default universal seperti `Pasangan yang berkhianat`.

---

## 11. Perbaikan prompt composer

Refactor `lib/onboarding/story-setup.ts`.

### 11.1 Pisahkan tiga blok

```text
HARD BOUNDARIES
CURRENT STORY DIRECTION
GLOBAL SOFT PREFERENCES
```

### 11.2 Prioritas yang benar

```text
Batas konten tegas wajib dipatuhi.

Arahan khusus cerita saat ini adalah arah kreatif utama.

Preferensi global hanya menjadi bias.
Jika preferensi global bertentangan dengan arahan khusus cerita,
ikuti arahan khusus cerita selama tidak melanggar batas tegas.
```

### 11.3 `softAvoidanceIds`

Jangan lagi menulis:

`JANGAN pakai trope`

Gunakan:

`Kurangi atau hindari bila tidak diperlukan: ...`

### 11.4 `hardBoundaries`

Gunakan instruksi eksplisit:

```text
BATAS KONTEN WAJIB:
- Jangan masukkan, menyiratkan sebagai kejadian utama, atau menjadikan payoff
  salah satu kategori berikut: ...
- Bila ide awal bertentangan dengan batas ini, ubah premis agar tetap koheren.
```

### 11.5 Structured setup answers

Jangan mengirim:

```text
- trope: ...
- sikap: ...
```

Gunakan label domain yang jelas:

```text
- Konflik utama cerita ini:
- Peran protagonis:
- Hubungan emosional utama:
- Kecenderungan mengambil keputusan:
- Intensitas:
- Ritme:
- Gaya penulisan:
- Arah ending:
```

---

## 12. Propagasi ke seluruh tahap authoring

## 12.1 `proposePremises`

Input:

```ts
proposePremises({
  direction,
  customIdea?,
})
```

Prompt harus menyebut:

- primary + secondary genre;
- core conflict;
- protagonist role;
- relationship focus;
- intensity;
- ending bias;
- boundaries;
- soft avoidances.

### Acceptance

Tiga proposal harus lolos:

```ts
validatePremiseAgainstCreativeDirection({
  proposal,
  direction,
})
```

Validasi minimal:

- role sesuai;
- tropes tidak generik seluruhnya;
- ada kaitan dengan konflik terpilih;
- tidak melanggar hard boundary;
- proposal cukup berbeda satu sama lain.

---

## 12.2 `proposeCast`

Ubah signature agar menerima direction.

```ts
proposeCast(premise, {
  direction,
  feedback?,
  previous?,
})
```

Direction memengaruhi:

- karakter pertama sesuai protagonist role;
- hubungan inti terlihat dalam minimal dua karakter;
- style/genre memengaruhi voice register secara wajar;
- hard boundaries tidak dimasukkan ke backstory;
- romance tidak wajib bila relationship focus bukan romance.

---

## 12.3 `proposeMystery`

Direction memengaruhi:

- konflik yang dipilih;
- soft avoidance `unanswered_secret`;
- ending bias;
- intensity;
- hard boundaries.

Jika `avoid_unanswered_secret` aktif:

- semua secret harus memiliki planned reveal/payoff;
- jangan menambah mystery tanpa payoff window.

Reveal gate tetap mengikuti aturan repo.

---

## 12.4 `proposeWorld`

Direction memengaruhi:

- genre blend;
- jenis thread;
- pacing;
- jumlah konflik paralel.

Contoh aturan:

| Pacing | Arah world/thread |
|---|---|
| `slow_deep` | thread lebih sedikit, tetapi relasi dan detail lebih dalam |
| `balanced` | jumlah thread standar |
| `fast_eventful` | tekanan adegan lebih sering, tanpa menambah reveal gate ilegal |

Jangan mengubah struktur 50 bab.

---

## 12.5 Compile dan blueprint

Creative direction tidak boleh mengganti template 50 bab, tetapi boleh memengaruhi isi:

- chapter goals;
- mandatory beats;
- allowed state delta;
- intensity curve;
- relationship beat density;
- ending payoff wording.

Pacing tidak boleh memindahkan reveal gate.

Ending bias bukan ending lock langsung. Ia hanya bias awal. Ending lock tetap mengikuti route state dan aturan existing.

---

## 13. Persistensi story-level

### 13.1 Jangan hanya menyimpan di client stash

Saat story dikunci, creative direction harus masuk database secara atomik atau dalam transaksi yang terkoordinasi.

### 13.2 Gunakan fondasi contract yang sudah ada

Sebelum membuat tabel baru, audit:

- `story_generation_contracts`;
- personalized story contract;
- bootstrap personalized story;
- schema/persist terkait.

**Preferensi:** perluas contract existing bila ownership-nya memang sesuai. Jangan membuat tabel paralel dengan konsep sama.

Bila contract existing tidak cocok, buat tabel:

```sql
story_creative_directions
- story_id uuid primary key references stories(id)
- owner_user_id uuid not null
- version int not null
- direction_json jsonb not null
- direction_fingerprint text not null
- prompt_contract_version text not null
- created_at timestamptz not null
- updated_at timestamptz not null
```

RLS:

- owner dapat membaca direction milik story sendiri melalui API server;
- client reader tidak perlu menerima raw direction;
- service role dapat membaca untuk generation;
- admin access mengikuti guard existing.

### 13.3 Snapshot

Perubahan Taste Profile di masa depan tidak mengubah story lama secara otomatis.

---

## 14. Penerapan pada generasi Bab 1–50

Refactor runtime agar memuat:

```ts
const direction = await loadStoryCreativeDirection(storyId)
```

Masukkan ke input `generateChapter()` sebagai typed contract, bukan string liar.

```ts
type ChapterCreativeDirection = {
  intensity: ...
  pacing: ...
  languageStyle: ...
  softAvoidances: ...
  hardBoundaries: ...
  relationshipFocus: ...
  agencyStyle: ...
  endingBias: ...
}
```

### 14.1 Pengaruh per field

| Field | Dampak |
|---|---|
| primary/secondary genre | atmosfer, jenis konflik, dunia |
| liked conflict | thread dan konflik utama |
| soft avoidances | repair hints, kualitas cerita |
| intensity | tekanan adegan dan emosi |
| pacing | kepadatan peristiwa vs ruang refleksi |
| language style | register prosa |
| ending bias | payoff direction, bukan jaminan |
| relationship focus | beat relasi dan stakes |
| agency style | variasi pilihan rute |
| hard boundaries | prompt + validator + repair |

### 14.2 Choice generation

Choice generator harus menerima direction bersama final prose.

```ts
generateChoiceBranch({
  finalDraft,
  routeState,
  choiceHistory,
  creativeDirection: {
    relationshipFocus,
    agencyStyle,
    hardBoundaries,
  },
})
```

Aturan:

1. pilihan tetap grounded pada final prose;
2. agency style menjadi salah satu sinyal, bukan template;
3. dua pilihan harus berbeda konsekuensi;
4. pilihan tidak boleh melanggar hard boundary;
5. route effect tetap disimpan;
6. tidak boleh kembali ke fallback generik hard-coded.

### 14.3 Batas konten tidak cukup hanya dengan prompt

Tambahkan validation/repair:

```ts
validateContentBoundaries({
  draft,
  choices,
  direction,
})
```

Jenis enforcement:

- aturan deterministik untuk:
  - kematian protagonis;
  - ending terlarang;
  - choice outcome yang jelas melanggar boundary;
- semantic safety check untuk:
  - kekerasan grafis;
  - kekerasan seksual;
  - penyiksaan;
  - self-harm;
- repair terarah bila finding dapat diperbaiki;
- `REVIEW_REQUIRED` bila tetap gagal.

Jangan publish draft yang melanggar hard boundary hanya agar proses terlihat berhasil.

---

## 15. Perubahan file yang diperkirakan

| File | Perubahan |
|---|---|
| `components/onboarding/taste-profile-flow.tsx` | flow baru, validation, copy, partial save, summary |
| `lib/taste-profile/schema.ts` | V2 schema dan neutral empty profile |
| `lib/taste-profile/catalog.ts` | seluruh stable ID + copy registry |
| `lib/taste-profile/migrate.ts` | migrasi V1 → V2 |
| `lib/taste-profile/resolver.ts` | profile usability dan normalized summary |
| `lib/taste-profile/storage.ts` | draft/partial profile, versioning |
| `app/onboarding/selera/actions.ts` | save V2, sync result yang jujur |
| `lib/api/taste-profile.ts` | read/write V2 dan migration-on-read |
| `components/mulai/onboarding-flow.tsx` | adaptive story-specific flow |
| `lib/onboarding/question-presets.ts` | ganti fuzzy promote/demote dengan typed builder |
| `lib/onboarding/story-setup.ts` | hard/soft/current direction blocks |
| `app/mulai/actions.ts` | server-resolved profile + creative direction |
| `app/brainstorm/actions.ts` | pass direction ke semua tahap |
| `lib/authoring/brainstorm.ts` | direction-aware prompts |
| `lib/authoring/schema.ts` | optional sidecar contract/type, bukan LLM prose field |
| `lib/authoring/compile.ts` | direction-aware blueprint content |
| `lib/authoring/persist.ts` | persist creative direction snapshot |
| generation contract files existing | extend contract, hindari duplikasi |
| `lib/runtime/story-generation.ts` | load/apply story creative direction |
| personalized generation runtime | gunakan contract yang sama bila relevan |
| validator/repair files | hard-boundary findings |
| migrations/RPC | hanya bila persistence contract perlu schema baru |
| smoke scripts | update prompt/profile contract checks |
| unit/integration tests | regression coverage |

---

## 16. Implementasi bertahap

## Fase 0 — Audit dan regression tests

Sebelum mengubah kode:

1. baca `AGENT_RULES.md`;
2. baca dokumen arsitektur dan narrative consistency;
3. identifikasi generation contract existing;
4. petakan semua tempat `TasteProfile` digunakan;
5. petakan semua call:
   - premise;
   - cast;
   - mystery;
   - world;
   - compile;
   - lock;
   - chapter generation;
6. buat failing tests untuk:
   - bug genre pertama;
   - `avoidedTropes` menjadi hard constraint;
   - skip membuang jawaban;
   - profile berhenti setelah premise;
   - `Pilihkan untukku` memakai default universal.

**Exit criteria:** test mereproduksi masalah saat ini.

---

## Fase 1 — Catalog dan schema V2

1. buat stable ID catalog;
2. buat V2 schema;
3. buat migration V1;
4. neutralize hidden defaults;
5. update local storage;
6. update server save/read;
7. pertahankan backward compatibility.

**Exit criteria:** seluruh profile V1 dapat dibaca sebagai V2.

---

## Fase 2 — Onboarding UI

1. tambahkan intro;
2. implementasi maksimal dua genre;
3. implementasi balanced conflict builder;
4. pisahkan soft avoidance dan hard boundary;
5. tambahkan intensity + pacing;
6. tambahkan ending + language style;
7. implementasi partial save;
8. perbaiki sync state;
9. sticky footer + safe area;
10. focus state tidak menyerupai selected state.

**Exit criteria:** flow mobile lengkap dapat dijalankan tanpa kehilangan jawaban.

---

## Fase 3 — `/mulai` adaptif

1. hapus pertanyaan global yang berulang;
2. buat typed adaptive question builder;
3. tambahkan story summary;
4. implementasi per-story override;
5. ganti hard-coded smart default dengan server auto resolver;
6. gunakan stable IDs;
7. update custom idea mode agar tetap memakai direction.

**Exit criteria:** profile lengkap menghasilkan empat pertanyaan story-specific, bukan kuis selera kedua.

---

## Fase 4 — Creative direction end-to-end authoring

1. buat `StoryCreativeDirectionSchema`;
2. resolve di server;
3. pass ke premise;
4. pass ke cast;
5. pass ke mystery;
6. pass ke world;
7. validate tiap tahap;
8. persist ketika lock;
9. simpan di draft stash untuk login resume.

**Exit criteria:** direction tidak hilang setelah user memilih premise.

---

## Fase 5 — Runtime Bab 1–50

1. load direction bersama canon;
2. pass typed preferences ke chapter generation;
3. pass ke choice generation;
4. implementasi hard-boundary validation/repair;
5. tambahkan traceability fingerprint;
6. pastikan observability tidak log raw profile/prose.

**Exit criteria:** Bab 2 dan seterusnya masih memakai preference snapshot yang sama.

---

## Fase 6 — Analytics, rollout, dan UX polish

1. funnel analytics;
2. feature flag;
3. dual-read V1/V2;
4. migration-on-read;
5. rollout internal;
6. smoke production;
7. monitor error, completion, dan premise selection.

---

## 17. Test matrix

## 17.1 Catalog dan schema

1. V2 empty profile tidak memiliki bias tersembunyi.
2. V1 genre labels dipetakan dengan benar.
3. V1 avoided content dipisahkan ke soft/hard.
4. unknown legacy item tidak merusak seluruh profile.
5. migrasi idempoten.
6. stable ID dapat dirender ke label Indonesia.

## 17.2 Balanced options

1. satu genre → enam opsi dari genre itu.
2. dua genre → empat primary + dua secondary.
3. secondary muncul sebelum seluruh list primary habis di UI.
4. duplicate ID tidak muncul.
5. selected conflict tetap stabil saat rerender.
6. perubahan genre memberi warning sebelum membuang pilihan.

## 17.3 Onboarding UI

1. CTA step 1 disabled tanpa genre.
2. genre ketiga ditolak.
3. konflik keempat ditolak.
4. soft/hard boundaries masuk field berbeda.
5. `Tidak ada batas khusus` eksklusif.
6. back mempertahankan jawaban.
7. partial save dapat dilanjutkan.
8. `Nanti saja` tidak menulis default preference.
9. final save tidak membuang jawaban.
10. server failure menampilkan local-only state.
11. focus ring berbeda dari selected state.
12. sticky footer aman di viewport kecil dan safe area.

## 17.4 `/mulai`

1. profile lengkap → empat pertanyaan inti.
2. profile tanpa genre → pertanyaan genre ditambahkan.
3. profile tanpa ending → pertanyaan ending ditambahkan.
4. profile summary benar.
5. per-story override tidak mengubah profile global.
6. `auto` tidak diselesaikan ke default di client.
7. role options berasal dari primary + secondary.
8. romance bukan asumsi wajib.
9. content boundary menghapus opsi yang jelas bertentangan.
10. custom idea tetap membawa hard boundaries.

## 17.5 Prompt composer

1. hard boundaries masuk blok hard.
2. soft avoidance tidak menggunakan kata `JANGAN`.
3. current story direction lebih kuat dari soft preferences.
4. custom idea tidak dapat mengalahkan hard boundary.
5. prompt tidak memuat internal labels yang tidak perlu.
6. raw profile tidak masuk logs.

## 17.6 Authoring pipeline

1. premise menerima direction.
2. cast menerima protagonist role dan relationship focus.
3. mystery menerima liked conflict, ending, boundaries.
4. world menerima genre blend dan pacing.
5. direction tidak hilang setelah premise selection.
6. invalid boundary di proposal ditolak/repair.
7. story lock menyimpan direction snapshot.
8. resume login mempertahankan direction.

## 17.7 Runtime

1. Bab 1 memuat direction.
2. Bab 2 memuat snapshot yang sama.
3. perubahan global profile tidak mengubah story lama.
4. language style muncul pada chapter prompt contract.
5. pacing memengaruhi chapter brief tanpa mengubah reveal gate.
6. ending bias tidak langsung menjadi ending lock.
7. hard boundary finding memicu repair/review.
8. choice generation menerima agency style dan relationship focus.
9. choices tetap grounded pada final prose.
10. observability menyimpan fingerprint, bukan raw profile.

## 17.8 Acceptance scenario end-to-end

Profile:

```text
Primary: Misteri
Secondary: Fantasi
Liked:
- Identitas asli yang disembunyikan
- Sihir terlarang yang kembali bangkit
Intensity: Intens
Pacing: Seimbang
Language: Sinematik
Ending: Damai
Boundary:
- Kekerasan grafis
- Kematian protagonis
```

Story setup:

```text
Role: Pewaris tersembunyi
Relationship: Sekutu yang belum dipercaya
Agency: Mengamati lalu bertindak
```

Harus terbukti:

1. `/mulai` menampilkan opsi misteri dan fantasi;
2. premis menggabungkan identitas + sihir, bukan drama perselingkuhan default;
3. cast pertama adalah pewaris tersembunyi;
4. relasi utama berupa sekutu yang belum dipercaya;
5. mystery memiliki payoff terjadwal;
6. world memiliki elemen kerajaan/sihir yang koheren;
7. prose Bab 1 sinematik dan intens;
8. pilihan akhir Bab 1 merespons kejadian konkret;
9. pilihan tidak selalu pasif meski agency pengguna observasional;
10. tidak ada kekerasan grafis;
11. protagonis tidak mati;
12. Bab berikutnya tetap memakai creative direction yang sama.

---

## 18. Smoke dan command validasi

Jalankan targeted test terlebih dahulu.

```bash
pnpm exec vitest run \
  tests/taste-profile \
  tests/onboarding \
  tests/authoring \
  tests/runtime
```

Update dan jalankan smoke existing:

```bash
pnpm run smoke:taste-profile
pnpm run smoke:taste-profile-db
pnpm run smoke:story-setup
pnpm run smoke:m7-authoring
pnpm run smoke:personalized-story
```

Gate umum:

```bash
pnpm typecheck
pnpm lint
pnpm run test:unit
pnpm build
```

Setelah targeted gate hijau:

```bash
pnpm test
```

Bila ada migration:

```bash
pnpm exec supabase db reset
pnpm exec supabase test db --local
pnpm exec supabase db push --linked --dry-run
```

Jangan menjalankan production `db push --linked` tanpa persetujuan eksplisit.

---

## 19. Analytics yang disarankan

Event reader-safe dan tanpa raw custom text:

```text
taste_onboarding_viewed
taste_onboarding_started
taste_onboarding_step_completed
taste_onboarding_skipped
taste_profile_saved
taste_profile_saved_local_only
story_setup_started
story_profile_applied
story_profile_overridden
story_setup_completed
story_premises_generated
story_premise_selected
story_creation_completed
```

Property yang boleh:

- profile version;
- count genre/conflict/boundary;
- step number;
- source mode;
- duration bucket;
- success/failure code terbatas.

Jangan kirim:

- custom idea;
- custom conflict;
- raw content boundaries;
- title/synopsis;
- prompt;
- prose;
- email.

---

## 20. Rollout

### 20.1 Feature flag

Gunakan flag:

```text
taste_profile_v2
story_creative_direction_v1
```

Tahapan:

1. local/dev;
2. internal account;
3. staging;
4. sebagian production;
5. seluruh pengguna baru;
6. migration-on-read untuk pengguna lama.

### 20.2 Backward compatibility

- V1 profile tetap terbaca.
- Story lama tanpa creative direction memakai neutral engine defaults.
- Jangan membuat story lama gagal generate karena contract tidak ada.
- Story baru setelah flag aktif wajib mempunyai direction snapshot, bahkan bila kosong.

### 20.3 Rollback

Rollback UI tidak boleh menghapus data V2.

- reader V1 harus mengabaikan field tambahan;
- migration bersifat forward-compatible;
- schema DB baru nullable untuk story lama;
- contract version menentukan parser.

---

## 21. Definition of Done

Task hanya selesai bila:

- [ ] bug genre pertama tertutup;
- [ ] pilihan memakai stable ID;
- [ ] onboarding mempunyai batas min/max;
- [ ] soft avoidance dan hard boundary terpisah;
- [ ] skip tidak menciptakan preferensi default palsu;
- [ ] jawaban parsial tidak hilang;
- [ ] langkah terakhir benar-benar menanyakan ending dan gaya bahasa;
- [ ] `/mulai` tidak mengulang kuis selera global;
- [ ] `Pilihkan untukku` diselesaikan di server, bukan default hard-coded client;
- [ ] custom idea tetap memakai profile dan boundaries;
- [ ] creative direction diteruskan ke premise, cast, mystery, dan world;
- [ ] creative direction dipersist sebagai snapshot story;
- [ ] Bab 1–50 memuat snapshot tersebut;
- [ ] choices menerima agency/relationship direction tetapi tetap grounded;
- [ ] hard boundary mempunyai validation/repair, bukan prompt-only;
- [ ] route state dan canon tetap lebih kuat dari soft preference;
- [ ] tidak ada raw profile/custom text/prose di logs;
- [ ] unit tests, smoke, typecheck, lint, dan build hijau;
- [ ] viewport mobile diverifikasi;
- [ ] production migration menunggu approval eksplisit;
- [ ] tersedia rollback plan.

---

## 22. Format laporan akhir agen

Agen harus melaporkan:

### Root cause

- bug logika lama;
- field yang tidak pernah diterapkan;
- tahap tempat profile sebelumnya hilang.

### Perubahan

| File | Perubahan | Alasan |
|---|---|---|

### Data contract

- schema V2;
- migrasi V1;
- creative direction version;
- persistence location.

### UX

- jumlah langkah;
- copy final;
- selection rules;
- skip/partial behavior;
- `/mulai` adaptive question count.

### End-to-end proof

Tampilkan satu contoh:

```text
Taste Profile
→ /mulai questions
→ normalized direction
→ premise
→ cast
→ mystery
→ world
→ persisted contract
→ chapter prompt contract
→ final chapter output
```

Jangan menampilkan prompt rahasia atau prose pengguna di laporan publik.

### Tests

- command aktual;
- jumlah passed;
- test baru;
- test gagal atau dilewati beserta alasan.

### Database

- migration name;
- local DB result;
- linked dry-run;
- status production approval.

### Deployment

- commit SHA;
- container;
- health check;
- smoke story ID/correlation ID;
- rollback path.

### Remaining risks

Tuliskan risiko nyata yang belum tertutup. Jangan menyatakan “selesai” hanya karena onboarding UI terlihat benar. Perubahan dianggap berhasil setelah preferensi dapat dibuktikan ikut sampai generasi bab dan pilihan rute.
