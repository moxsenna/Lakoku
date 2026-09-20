# Desain Teknis: Honorifik Kultural Indonesia & Pemecahan Paragraf Mobile

**Tanggal:** 2026-09-21  
**Status:** Approved  
**Target Komponen:** `lib/prose/prompt-engine/`, `lib/ai-gateway/`, `lib/prose/`

---

## 1. Latar Belakang & Masalah

Pada generasi prosa cerita di Lakoku:
1. **Paragraf Masih Tebal di Mobile**: Ditemukan banyak paragraf berisi 3–5 kalimat panjang. Ini membuat tampilan mobile terasa seperti dinding teks yang melelahkan. Penyebabnya adalah instruksi prompt P3 yang melarang pemotongan kalimat tanpa batas kalimat per paragraf yang tegas, serta proses ingestion `parseChapterWriterProse` yang hanya melakukan `split(/\n\s*\n/)` tanpa jaring pengaman pemecah kalimat.
2. **Sapaan Kultural Janggal**: Tokoh dengan peran orang tua (misal: "Ragil" yang berstatus ayah dari tokoh utama) sering disebut dengan nama telanjang baik dalam dialog maupun narasi ("Ragil berkata...", "Aku menatap Ragil..."). Dalam budaya tutur Indonesia, anak memanggil orang tua dengan "Bapak/Ibu/Ayah/Mama", bukan nama asli. Selain itu, panggilan relasi seperti `kak`, `mas`, `mbak`, `dek`, `say`, `beb` belum terpetakan dengan legal di prompt P0 dan P4.
3. **Kebutuhan Isolasi Bahasa (Language/Locale Scoping)**: Lakoku saat ini berfokus pada pasar Indonesia, tetapi arsitektur ke depan akan berekspansi ke pasar global (bahasa Inggris, dsb.). Konvensi honorifik dan sapaan kekerabatan Indonesia ini harus terisolasi secara eksplisit (hanya aktif jika `language === 'id'`) agar tidak mengontaminasi model prompt global di masa depan.

---

## 2. Sasaran & Batasan

### Sasaran (Goals)
1. **Mobile Readability**: Setiap blok paragraf narasi maksimal 1–2 kalimat pendek (≤30 kata), dialog mandiri di paragraf terpisah.
2. **Kultural Sapaan Indonesia Tepat**: POV "aku" wajib menyapa orang tua dengan "Bapak/Ibu/Ayah", serta panggilan kakak/adik/pasangan disesuaikan secara natural (`Kak`, `Mas`, `Mbak`, `Dek`, `Sayang`, `Beb`).
3. **Canon Invariant Tetap Terjaga**: Panggilan honorifik/kekerabatan diakui secara sah di P0 sebagai sebutan resmi tokoh kanonik bersangkutan, bukan tokoh baru.
4. **Zero Content Loss**: Pemecahan paragraf deterministik di lapisan ingestion tidak boleh mengubah, memotong, atau menghilangkan satu kata pun dari prosa asli LLM.
5. **Isolasi Bahasa**: Aturan honorifik Indonesia hanya disuntikkan bila bahasa cerita adalah `'id'`.

### Non-Sasaran (Non-Goals)
- Mengubah alur cerita atau 50-chapter fixed story spine.
- Mengubah struktur database Supabase atau migrasi tabel (semua metadata diderivasi dari data yang sudah ada di `CanonSnapshot.characters`, `CanonSnapshot.aliases`, dan `CanonSnapshot.voiceSheets`).

---

## 3. Detail Desain & Arsitektur

### 3.1 Ekstraksi Modul Kultural (`lib/prose/cultural-conventions.ts`)

Membuat modul baru untuk menampung aturan sapaan dan honorifik berdasarkan bahasa:

```ts
export type SupportedLanguage = 'id' | 'en'

export interface CharacterDescriptor {
  name: string
  role?: string
  relation?: string
  honorifics?: string[]
}

/**
 * Membangun deskripsi karakter yang diperkaya peran dan sapaan sah.
 */
export function buildCharacterDescriptors(
  characters: Array<{ canonicalName: string; role?: string }>,
  aliases: Array<{ characterId?: string; alias: string; aliasType: string }>,
  language: SupportedLanguage = 'id',
): CharacterDescriptor[]

/**
 * Menghasilkan aturan prompt kultural sapaan Indonesia.
 * Mengembalikan string kosong jika language !== 'id'.
 */
export function buildCulturalHonorificDirectives(
  descriptors: CharacterDescriptor[],
  language: SupportedLanguage = 'id',
): string
```

Pemetaan Relasi Kultural Otomatis untuk `language === 'id'`:
- **Orang Tua / Figur Ayah/Ibu** (`role` mengandung ayah/bapak/papa/ibu/mama/orang tua):
  - Honorifik: `Bapak / Pak / Ayah` atau `Ibu / Bu / Mama`.
  - Aturan: POV "aku" WAJIB menyapa dan menyebut figur ini sebagai "Bapak / Ibu" di narasi dan dialog. DILARANG menyebut nama langsung tanpa gelar hormat.
- **Kakak / Usia Lebih Tua** (`role` mengandung kakak/abang/mas/mbak):
  - Honorifik: `Kak / Mas / Mbak / Bang`.
- **Adik / Usia Lebih Muda** (`role` mengandung adik/dek):
  - Honorifik: `Dek / Adik`.
- **Pasangan / Romansa** (`role` mengandung suami/istri/kekasih/pacar/tunangan):
  - Honorifik: `Sayang / Say / Mas / Dek / Beb` sesuai usia dan karakter.

### 3.2 Pembaruan Prompt Engine (`lib/prose/prompt-engine/`)

1. **`lib/prose/prompt-engine/types.ts`**:
   - Menambahkan field `language?: SupportedLanguage` (default `'id'`).
   - Menambahkan field `characterDescriptors?: CharacterDescriptor[]` pada `BuildWriterPromptInput`.

2. **`lib/prose/prompt-engine/build-writer-prompt.ts`**:
   - **P0 (Canon Invariant)**:
     Bila `language === 'id'`, format daftar tokoh menyertakan peran dan sapaan sah:
     `- Tokoh yang boleh tampil: Ragil (Peran: Ayah, sapaan sah: Bapak / Pak / Ayah), Nadia (Peran: Istri, sapaan sah: Nadia / Sayang / Dek).`
     `- Panggilan honorifik/kekerabatan di atas adalah sebutan sah untuk tokoh bersangkutan, BUKAN tokoh baru.`
   - **P3 & P5 (Ritme Paragraf Mobile)**:
     - Menghapus kalimat ambigu yang membuat LLM ragu menekan enter.
     - Menegaskan aturan keras:
       - 1 paragraf narasi berisi 1–2 kalimat pendek (maksimal 25–30 kata).
       - DILARANG menumpuk 3 kalimat atau lebih dalam 1 blok narasi.
       - Setiap baris ucapan dialog wajib berdiri sendiri dalam paragraf mandiri.
   - **P4 (Suara Tokoh & Tata Krama Indonesia)**:
     Menyuntikkan `buildCulturalHonorificDirectives(descriptors, language)`.

3. **`lib/ai-gateway/chapter-writer-contract.ts`**:
   - Pada `buildProductionChapterWriterPrompt`, bangun `characterDescriptors` dari `snapshot.characters` dan `snapshot.aliases`.
   - Teruskan `characterDescriptors` dan `language: 'id'` ke `buildWriterPrompt`.

### 3.3 Pemecah Paragraf Deterministik (`lib/prose/mobile-paragraph-splitter.ts`)

Jaring pengaman pada lapisan ingestion (`parseChapterWriterProse`):
1. Menerima array paragraf teks mentah hasil parser baris.
2. Memisahkan dialog yang masih menempel di narasi menjadi paragraf tersendiri.
3. Memecah blok narasi yang memiliki > 2 kalimat menjadi sub-paragraf (1–2 kalimat per blok) dengan pemisah spasi ganda / enter ganda.
4. Menjaga isi kata 100% utuh tanpa mutasi isi kata (deterministik, zero word loss).

---

## 4. Rencana Pengujian (Test & Acceptance)

1. **Unit Test: `tests/prose/cultural-conventions.test.ts`**:
   - Verifikasi pemetaan role ayah/ibu/kakak/pasangan ke honorifik sah.
   - Verifikasi isolasi bahasa: jika `language === 'en'`, direktif kultural Indonesia kosong.
   - Verifikasi jika `language === 'id'`, direktif kultural Indonesia terisi lengkap.
2. **Unit Test: `tests/prose/mobile-paragraph-splitter.test.ts`**:
   - Verifikasi paragraf 4–5 kalimat terpecah menjadi beberapa paragraf ≤ 2 kalimat.
   - Verifikasi dialog di tengah narasi berhasil dipisahkan.
   - Verifikasi `countParagraphWords(before) === countParagraphWords(after)`.
3. **Integration Test Prompt Engine: `tests/prose/prompt-engine/writer-prompt-architecture-v2.test.ts`**:
   - Verifikasi output prompt memuat sapaan sah di P0 dan direktif sapaan di P4.
4. **Regresi Suite**:
   - `pnpm typecheck` wajib exit 0.
   - `pnpm test:unit` wajib lolos tanpa regresi.
