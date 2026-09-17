# Dompet Imbalan — Komisi Referral 10%

**Tanggal:** 2026-09-17
**Status:** Design — menunggu review
**Lingkup:** M1 (akuisisi lewat referral), dengan rel yang siap menampung M2 (bagi hasil kreator)

---

## 1. Masalah

Lakoku belum punya cara apa pun bagi pembaca untuk memperoleh penghasilan.
Infrastruktur atribusi sudah separuh terpasang — `shared_story_links` dan
`shared_story_starts` mencatat pemilik tautan beserta pembaca baru yang mulai
dari tautan itu — tetapi tidak ada imbalan yang mengalir di atasnya.

Dua celah membuat jalur yang ada tidak layak dipakai sebagai corong referral:

1. **Tautan share hanya lahir dari ending card.** `ShareButton` hanya terpasang
   di `app/akhir/[id]/page.tsx`, sehingga user wajib menamatkan cerita 50 bab
   sebelum punya sesuatu untuk dibagikan.
2. **Atribusi menuntut sesi login lebih dulu.** `recordShareStart`
   (`lib/api/share.ts:295`) melempar error bila belum ada sesi, sehingga
   pengunjung yang mendaftar lewat jalur lain kehilangan atribusinya.

Desain ini menutup keduanya dengan memisahkan kode referral dari share cerita.

## 2. Keputusan yang sudah diambil

| Keputusan | Nilai | Alasan |
|---|---|---|
| Mesin | Referral (M1), rel siap untuk bagi hasil kreator (M2) | Atribusi sudah ada; M2 butuh fitur "seed bisa dipakai ulang" yang belum ada |
| Bentuk imbalan | Dompet rupiah terpisah dari kredit | Kredit yang dibeli tidak boleh pernah bisa dicairkan |
| Besaran komisi | 10% dari `price_idr` | Ditetapkan project lead |
| Cakupan | Semua top-up dalam 30 hari sejak atribusi | Berulang sehingga terasa sebagai penghasilan, tapi beban margin punya ujung |
| Pencairan rupiah | Ditunda; rilis pertama hanya tukar ke kredit | Menghindari KYC, pajak, dan rail disbursement sampai ada saldo yang layak diurus |

### 2.1 Invarian arus dana

**Kredit yang dibeli user tidak boleh pernah berpindah ke dompet imbalan, dan
tidak boleh pernah bisa dicairkan menjadi uang.** Arus sah hanya satu arah:

```
rupiah (top-up) ──> kredit ──> dibelanjakan untuk bab
                      │
                      └─ 10% dari nilai rupiahnya ──> dompet imbalan pengajak
                                                          │
                                                          └──> ditukar jadi kredit
```

Mencampur keduanya menempatkan Lakoku pada produk yang bisa diuangkan kembali,
yang membawa konsekuensi perizinan uang elektronik. Invarian ini wajib dijaga
oleh skema database, bukan hanya oleh kode aplikasi.

## 3. Model data

Empat tabel baru. Semua mengikuti pola yang sudah ada di repo.

### 3.1 `referral_codes`

Kode permanen per user, dibuat saat pendaftaran.

| Kolom | Tipe | Catatan |
|---|---|---|
| `user_id` | `uuid` PK | referensi `auth.users`, `on delete cascade` |
| `code` | `text` unique | 8 karakter, alfabet tanpa karakter ambigu (`0`/`O`, `1`/`I`/`l`) |
| `created_at` | `timestamptz` | default `now()` |

RLS: user hanya boleh membaca barisnya sendiri. Pemetaan kode ke pemilik
dilakukan server-side dengan admin client, tidak pernah dari klien.

### 3.2 `referral_attributions`

Ikatan permanen antara pengajak dan pembaca baru.

| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | `uuid` PK | |
| `referrer_user_id` | `uuid` | pengajak |
| `referred_user_id` | `uuid` **unique** | satu user hanya bisa diatribusikan sekali seumur hidup |
| `source` | `text` | `referral_code` atau `share_link` |
| `shared_link_id` | `uuid` null | terisi bila berasal dari share ending card |
| `attributed_at` | `timestamptz` | |
| `window_ends_at` | `timestamptz` | `attributed_at + interval '30 days'`, dibekukan saat penulisan |

Constraint: `referrer_user_id <> referred_user_id` — self-referral ditolak di
lapisan database.

`window_ends_at` disimpan sebagai kolom, bukan dihitung saat evaluasi. Mengubah
panjang jendela di `reward_policy` tidak boleh mengubah kontrak yang sudah
berjalan untuk atribusi lama.

### 3.3 `reward_ledger`

Meniru pola `credit_ledger` (`supabase/migrations/20260708000000_paycore_credit_model.sql`).

| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` | penerima imbalan |
| `delta_idr` | `integer` | positif untuk komisi, negatif untuk penukaran/pembalikan |
| `reason` | `text` | `commission`, `redeem_credits`, `reversal` |
| `ref` | `text` **unique** | kunci idempotensi |
| `created_at` | `timestamptz` | |

Pola `ref`:

- `commission:<order_id>` — komisi dari satu order
- `redeem:<uuid>` — penukaran ke kredit
- `reversal:<order_id>` — pembalikan komisi

RPC `reward_balance_v1(p_user_id uuid) returns integer` menjumlahkan `delta_idr`,
`security definer`, sejalan dengan `credit_balance_v1`.

Ledger dipakai alih-alih kolom saldo karena uang membutuhkan jejak audit, dan
karena keunikan `ref` itulah yang membuat webhook terulang tidak menggandakan
komisi.

### 3.4 `reward_policy`

Satu baris konfigurasi, mengikuti pola `reading_policy` supaya bisa diubah dari
Supabase Dashboard tanpa deploy.

| Kolom | Tipe | Default | Catatan |
|---|---|---|---|
| `id` | `boolean` PK | `true` | constraint `id = true` menjamin baris tunggal |
| `commission_percent` | `integer` | `10` | |
| `window_days` | `integer` | `30` | hanya berlaku untuk atribusi baru |
| `redeem_rate_idr_per_credit` | `integer` | `250` | setara paket terbaik; lihat §8.1 |
| `commission_enabled` | `boolean` | **`false`** | lihat §7 |
| `redeem_enabled` | `boolean` | `true` | |
| `payout_enabled` | `boolean` | `false` | belum diimplementasikan; kolom disiapkan |

Konstanta default cadangan hidup di `lib/rewards/policy.ts` sebagai logika murni
tanpa I/O, sejalan dengan `lib/credits/policy.ts`.

## 4. Penangkapan atribusi

### 4.1 Route handler `/r/[code]`

Tautan referral berbentuk `lakoku.app/r/ABCD1234`, ditangani oleh route handler
baru `app/r/[code]/route.ts`.

Mekanisme ini dipilih setelah dua alternatif gugur. Middleware tidak bisa
dipakai karena `middleware.ts` tidak mencakup root — matcher-nya hanya
`/baca`, `/akhir`, `/koleksiku`, `/mulai`, `/brainstorm`, `/admin`, `/beranda`,
`/profil`, `/kredit`, `/payment`, dan `/s` — sehingga `/?ref=CODE` tidak akan
pernah tertangkap. Menambahkan `/` ke matcher akan membebani landing page yang
justru perlu ringan. Server component juga tidak bisa dipakai karena RSC bersifat
baca-saja terhadap cookie. Route handler bebas dari kedua batasan itu dan
sekaligus menghasilkan tautan yang lebih rapi untuk dibagikan.

Alurnya:

1. Handler menerima `code`, menulis cookie `lakoku_ref`, lalu me-redirect ke `/`
   atau ke `next` bila disertakan.
2. Cookie `httpOnly`, `sameSite=lax`, `secure`, umur 30 hari. Tidak ditimpa bila
   sudah ada.
3. Kode yang tidak valid tetap me-redirect tanpa menulis cookie. Handler ini
   tidak boleh pernah menampilkan error kepada pengunjung.
4. Saat pendaftaran selesai (`app/auth/callback`), server membaca cookie,
   memetakan kode ke pemiliknya, dan menulis satu baris `referral_attributions`.
   Cookie lalu dihapus.
5. Insert yang gagal karena `referred_user_id` sudah ada diperlakukan sebagai
   no-op diam. Pendaftaran tidak boleh pernah gagal gara-gara referral.

Cookie ditulis sebelum ada sesi, sehingga pengunjung yang mendaftar lewat jalur
mana pun tetap terikat.

Atribusi pertama menang, bukan yang terakhir, karena penulis tautan pertamalah
yang melakukan kerja penemuan. Ini juga menutup celah pembajakan atribusi oleh
tautan yang dikirim belakangan.

### 4.2 Jalur share ending card

Untuk pengunjung yang **sudah login**, `recordShareStart` yang ada sudah cukup:
`shared_story_links.owner_user_id` langsung memberi pengajaknya, jadi atribusi
ditulis di sana tanpa perlu cookie sama sekali.

Untuk pengunjung yang **belum login**, halaman `/s/[slug]` menampilkan ajakan
mendaftar yang mengarah ke `/r/<kode-pemilik>?next=/s/<slug>`, sehingga jatuh ke
jalur §4.1. Alur share yang ada tidak berubah.

Tombol ShareButton juga dipasang di tempat yang tidak menuntut cerita tamat —
minimal di `/profil` — supaya corongnya tidak lagi tertutup.

## 5. Aliran komisi

Pemicu: webhook PayCore yang tanda tangannya terverifikasi
(`lib/entitlement/paycore.ts#processPayCoreWebhook`), setelah `grantCredits`
berhasil dan order ditandai `paid`. Tidak pernah dari klien, tidak pernah dari
return URL, tidak pernah dari order yang belum dibayar.

Langkah evaluasi, semuanya fail-closed:

1. Cari `referral_attributions` dengan `referred_user_id = event.userId`.
   Tidak ada → selesai.
2. `now() > window_ends_at` → selesai.
3. `reward_policy.commission_enabled = false` → selesai.
4. Ambil `price_idr` dari `credit_orders` untuk `order_id` tersebut.
   Tidak ada snapshot → selesai, dan catat log. Komisi tidak boleh pernah
   dihitung dari data event yang tidak tersnapshot.
5. Tulis `reward_ledger` sebesar `floor(price_idr * commission_percent / 100)`
   dengan `ref = commission:<order_id>`.

### 5.1 Komisi dihitung dari `price_idr`

Bukan dari `total_credits`. Bonus kredit adalah biaya, bukan pendapatan;
menghitung komisi di atasnya berarti membayar orang atas uang yang tidak pernah
masuk. `credit_orders.price_idr` sudah membekukan harga saat checkout, jadi
perubahan harga di `credit_products` tidak menggeser komisi lama.

### 5.2 Kegagalan komisi tidak boleh membatalkan top-up

Seluruh blok komisi dibungkus `try/catch` dan bersifat non-fatal, sejalan dengan
perlakuan `markOrderPaid` yang sudah ada. User yang membayar wajib menerima
kreditnya walaupun pencatatan komisi gagal. Kegagalan dicatat untuk rekonsiliasi
manual; `ref` yang idempoten membuat penulisan ulang aman.

## 6. Pembalikan dan anti-kecurangan

### 6.1 Refund tidak otomatis

Adapter PayCore yang aktif hanya menerima `payment.succeeded`; `parsePayload`
menolak tipe event lain. `EVENT_ACTION_MAP` yang memuat `charge.refunded` berada
di `lib/entitlement/webhook.ts`, engine generik yang tidak dipakai jalur
produksi.

Konsekuensinya, pembalikan komisi adalah **aksi admin manual**: satu tombol di
`/admin/payments` yang menulis `reward_ledger` negatif dengan
`ref = reversal:<order_id>`. Ini didokumentasikan sebagai utang yang diterima,
bukan celah yang tidak disadari. Bila PayCore kelak mengirim event refund,
pembalikan dapat dipindahkan ke webhook tanpa mengubah skema.

### 6.2 Permukaan kecurangan yang tersisa

- **Self-referral** — ditutup constraint database.
- **Atribusi ganda** — ditutup keunikan `referred_user_id`.
- **Webhook terulang** — ditutup keunikan `ref`.
- **Akun massal tanpa pembayaran** — tidak menghasilkan apa pun; komisi hanya
  lahir dari order berstatus `paid`.
- **Beli-lalu-refund** — hanya tertahan oleh pembalikan manual di §6.1. Ini
  risiko nyata dan disadari. Mitigasi: saldo tidak bisa dicairkan pada rilis
  pertama, sehingga nilai yang bisa diambil penyerang terbatas pada kredit.

Saldo yang tidak bisa dicairkan itu sendiri adalah pengendali kecurangan yang
paling kuat pada rilis ini.

## 7. Prasyarat rilis: margin belum terukur

`commission_enabled` **default `false`** dan tidak boleh dinyalakan sebelum biaya
inferensi nyata per bab terukur.

Alasannya konkret. Rute prosa produksi sekarang `gweb/gemini-3.1-pro` lewat
9Router (`supabase/migrations/20260915120000_update_chapter_prose_route_gemini31pro.sql`),
dan 9Router tidak melaporkan biaya per panggilan — seluruh transport tercatat
tanpa `cost_amount`. `lib/commercial/daily-cost-report.ts` menolak menurunkan
harga dari token dan melaporkannya sebagai `UNMEASURED`, bukan nol.

Angka biaya yang ada di repo — rata-rata $2,05 per bab terhadap plafon $2,10 di
`fixtures/m10-e/e0-budget-authority.ts` — berasal dari fase riset M10 dan memuat
overhead retry hingga 173% serta evaluasi judge. Itu bukan biaya produksi
steady-state. Pembandingnya: satu bab dijual 8 kredit, yang pada harga seed
berarti Rp2.000–4.000 atau sekitar $0,12–0,24.

Karena itu spec ini **tidak menetapkan bahwa komisi 10% menguntungkan**. Ia
menetapkan sakelar, dan menjadikan pengukuran biaya sebagai prasyarat
menyalakannya.

## 8. Antarmuka user

Halaman `/profil/imbalan`:

- Saldo rupiah
- Kode referral dengan tombol salin dan tautan siap bagikan
- Jumlah orang yang diajak, dan berapa di antaranya yang masih dalam jendela 30 hari
- Riwayat `reward_ledger`
- Tombol tukar ke kredit
- Tombol cairkan dalam keadaan terkunci, dengan penjelasan jujur bahwa
  pencairan belum tersedia

Alur penukaran: tulis `reward_ledger` negatif, lalu panggil `grant_credits_v1`
dengan `ref = reward-redeem:<uuid>`. Kedua penulisan berbagi UUID yang sama
supaya bisa direkonsiliasi. Sisa rupiah yang tidak cukup untuk satu kredit tetap
tinggal di dompet, tidak hangus.

### 8.1 Kurs penukaran

Kurs default Rp250 per kredit, setara paket terbaik di katalog (Paket Ultra,
Rp500.000 untuk 2.000 kredit). Paket termurah berada di Rp500 per kredit.

Memakai kurs paket termurah akan membuat penukaran terasa sebagai hukuman:
saldo imbalan dihargai seperti pembeli terkecil, padahal user sudah melakukan
kerja mendatangkan pembaca. Kurs paket terbaik membuat menukar tidak pernah
lebih buruk daripada membeli dengan cara apa pun, dan menjaga uang tetap di
dalam sistem alih-alih mendorong pencairan.

Konsekuensi biayanya harus disadari: Rp250 per kredit berarti setiap rupiah
imbalan menghasilkan dua kali lipat bab dibanding kurs Rp500, sehingga beban
inferensinya juga dua kali lipat. Ini alasan tambahan mengapa §7 menuntut biaya
nyata per bab terukur sebelum komisi dinyalakan. Angkanya bisa diubah dari
Supabase Dashboard tanpa deploy.

Bahasa halaman mengikuti brand guard: tanpa istilah teknis, tanpa menyebut AI,
model, atau token.

## 9. Batas paket

Modul baru `lib/rewards/`:

- `policy.ts` — logika murni tanpa I/O: hitung komisi, cek jendela, konversi
  kredit. Bisa diuji tanpa mock.
- `server.ts` — akses Supabase, `server-only`.
- `attribution.server.ts` — penangkapan cookie dan penulisan atribusi.

Komponen mengakses data lewat seam `lib/api/` sesuai AGENT_RULES.md, tidak
pernah menyentuh Supabase langsung.

## 10. Pengujian

**Unit, tanpa jaringan:**

- Perhitungan komisi, termasuk pembulatan ke bawah dan `price_idr` nol
- Batas jendela: tepat sebelum, tepat pada, dan sesudah `window_ends_at`
- Penolakan self-referral
- Konversi rupiah ke kredit, termasuk sisa yang tidak bulat
- Komisi tidak lahir saat `commission_enabled = false`

**Integrasi:**

- Webhook terulang dengan `order_id` sama menghasilkan tepat satu baris komisi
- Kegagalan penulisan komisi tidak membatalkan pemberian kredit
- Order tanpa snapshot `credit_orders` tidak menghasilkan komisi

**Database (`supabase/tests/`):**

- RLS: user tidak bisa membaca `reward_ledger` milik user lain
- Constraint self-referral dan keunikan `referred_user_id` benar-benar menolak

## 11. Di luar lingkup

- Bagi hasil kreator (M2) — butuh seed yang bisa dipakai ulang, yang belum ada
- Pencairan rupiah, KYC, dan pemotongan pajak
- Komisi berjenjang atau multi-level
- Pembalikan refund otomatis — manual dulu, lihat §6.1
- Ekspor naskah dan monetisasi di platform luar (M4)

## 12. Utang yang diterima

1. **Pembalikan refund manual.** Dibatasi risikonya oleh saldo yang tidak bisa
   dicairkan.
2. **Margin belum terukur.** Ditangani lewat sakelar mati secara default.
3. **Atribusi hilang bila cookie ditolak.** Pengguna yang memblokir cookie tidak
   akan terikat. Diterima; tidak ada alternatif yang tidak menuntut login lebih
   dulu.
