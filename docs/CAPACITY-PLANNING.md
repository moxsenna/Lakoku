# Perencanaan Kapasitas VPS — Lakoku

**Terakhir diukur:** 2026-11-01, produksi `822c00d` di shared VPS `43.128.103.110`
(2 vCPU / 2 GB RAM + 4 GB swap, OpenCloudOS, co-tenant dengan 9router/narraza/wakonek/dll).
Dokumen ini acuan menyewa VPS di masa depan — ukur ulang dengan perintah di §7
sebelum memutuskan upgrade.

---

## 1. Karakteristik beban Lakoku (kenapa modelnya begini)

Lakoku **bukan** aplikasi berat CPU. Bebannya:

| Jalur | Pekerjaan VPS | Beban DB (Neon) | Catatan |
|---|---|---|---|
| Landing `/` | render statis | ~0 | bisa di-cache edge Cloudflare |
| `/beranda` (`force-dynamic`) | render RSC + ~6 query paralel + sesi | 6–8 query/req | halaman termahal |
| `/jelajah`, `/cerita/[id]` | render RSC + 2–4 query | 2–4 query/req | HTML ±32 KB |
| `/baca/[id]` | auth + story + bab + reader state | 4–6 query/req | tamu = redirect 307 murah |
| Advance pilihan (AI) | ** Hampir nol CPU ** — orchestration HTTP ke 9Router, tunggu upstream 10–60 s | job row + state update | memori idle ±5–15 MB per generation in-flight |
| Polling saat menunggu bab | read ringan | 1 query/req | 1 req tiap beberapa detik per pembaca yang menunggu |
| Aset (`/_next/static`, sampul) | ~nol | 0 | sampul di R2 (`covers.lakoku.biz.id`), `_next/static` immutable — keduanya ter-cache di edge Cloudflare, tidak memakan bandwidth/egress VPS |

Konsekuensi: **CPU per halaman kecil, RAM didominasi 1 proses Node + buffer render
per request konkuren, dan DB selalu di luar VPS (Neon)**. Bandwidth origin kecil
karena aset berat tidak lewat VPS.

## 2. Hasil ukur produksi (2026-11-01, `822c00d`)

| Metrik | Nilai terukur |
|---|---|
| Memori cgroup service saat idle-ish | **±117 MB** (anon 112 MB) |
| Memori setelah burst 50 request (konkurensi 4) | **±147 MB** (+27 MB, sebagian reclaimable) |
| Batas cgroup service (`MemoryMax`) | 768 MB — guard yang sehat, pertahankan |
| Latensi origin `/` (landing) | 33–151 ms |
| Latensi origin `/beranda` (dynamic, 6 query Neon) | 33–94 ms tunggal; **rata-rata 69 ms pada 14,5 req/s** (burst P=4) |
| Latensi `/cerita` (32 KB) & `/jelajah` | 20–23 ms |
| `/baca/...` tamu (redirect auth) | 7 ms |
| Load CPU saat burst | 0,17 dari 2 core → **±0,01 core per req/s** |
| Build `next build` di box 2 GB | muat (±4 menit, dengan swap) — tapi build terbaik dilakukan off-box |
| Swap | 4 GB dipakai box bersama — proses idle tertukar halaman (normal di shared box) |

**Turunan untuk model** (tandai: asumsi industri, belum tervalidasi traffic nyata
karena belum soft-launch penuh — kalibrasi ulang dari data funnel analytics saat
traffic mengalir):

- Puncak pembaca konkuren (PC) ≈ **4–6% dari DAU** (aplikasi baca mobile Indonesia, puncak 19:00–23:00 WIB).
- Setiap pembaca aktif ≈ **0,3–0,5 req/s** rata-rata di jam sibuk (navigasi + bab + polling).
- Generation AI konkuren ≈ **5–10% dari PC** (advance pilihan ±2–4 menit sekali per sesi baca, durasi 10–60 s).
- CPU per req/s ≈ 0,01 core (terukur) → **2 core sanggup ±100–150 req/s** untuk halaman
  sekelas Lakoku dengan DB cepat; 4 core ±250–300 req/s; sisanya jitter.
- RAM app ≈ **117 MB idle + 25–35 MB per 50 req/s** + 5–15 MB per generation in-flight;
  OS + sistem dasar butuh ±300–400 MB. Headroom build ±1–1,5 GB bila build di-box.
- Koneksi Neon: pool kecil per instance (≤10) — endpoint **pooled** Neon wajib.

## 3. Skenario & rekomendasi spesifikasi

### S1 — Soft launch · 50 DAU (PC ≈ 3, ±1,5 req/s, 0–1 generation)

| Komponen | Spesifikasi | Catatan |
|---|---|---|
| VPS | **1 vCPU / 1 GB / 20 GB SSD** | app ±150–200 MB; build jangan di-box (pakai artefak atau build off-peak) |
| Neon | Free/launch (±0,25 CU) | jauh di bawah limit |
| Referensi harga | ±$5/bln (Vultr/DO/IDCloudHost Jakarta) | |

Cocok untuk: kondisi sekarang. Shared box 2 GB saat ini pun masih longgar untuk beban ini.

### S2 — Pertumbuhan · 500 DAU (PC ≈ 25, ±12 req/s, 1–3 generation)

| Komponen | Spesifikasi | Catatan |
|---|---|---|
| VPS | **2 vCPU / 4 GB / 40 GB SSD** | app ±250–350 MB; 4 GB memberi ruang build + co-tenant ringan |
| Neon | Launch/Scale ±0,25–0,5 CU | masih santai |
| Referensi harga | ±$12–24/bln | region Jakarta/Singapore |

Pertama kali build on-box mulai terasa — sarankan build via CI/artefak (§7).

### S3 — Skala · 2.000 DAU (PC ≈ 100, ±50 req/s, 5–10 generation)

| Komponen | Spesifikasi | Catatan |
|---|---|---|
| VPS | **4 vCPU / 8 GB / 60–80 GB SSD** | CPU terpakai ±1,5–2 core di puncak; RAM app ±400–700 MB |
| Neon | ±1 CU, monitor connection count | pool ≤10 per instance aman |
| Referensi harga | ±$24–48/bln | |

Masih **satu instance**. Yang mulai jenuh lebih dulu: jumlah query per halaman
(beranda 6 query) dan throughput Neon — optimasi query/cache lebih murah daripada
tambah VPS.

### S4 — Lonjakan viral · 10.000 DAU (PC ≈ 500, ±250 req/s, 25–50 generation)

| Komponen | Spesifikasi | Catatan |
|---|---|---|
| VPS | **2 instance × 4 vCPU / 8 GB** (load balancing) | 1 instance 8 vCPU mungkin sanggup, tapi 2 instance memberi failover |
| Load balancer | Cloudflare Tunnel load balancer → 2 replica, atau Caddy/nginx | sesi sudah DB-backed (Better Auth) → aman multi-instance |
| Neon | ±2–4 CU + monitor koneksi; pertimbangkan read replica | |
| Antrean generation | batasi konkurensi (sudah ada di lib/runtime) | bottleneck sebenarnya = 9Router/upstream token, bukan VPS |
| Referensi harga | ±$60–120/bln total | |

Perubahan arsitektur minimal yang dibutuhkan: LB multi-origin + pisahkan
pekerja generation bila perlu. Tidak perlu Redis/memcached sebelum tahap ini.

## 4. Bandwidth & disk (semua skenario)

- **Bandwidth origin**: aset berat (sampul R2, `_next/static`) ter-cache di edge
  Cloudflare → origin hanya HTML/RSC (20–100 KB/halaman).
  500 DAU ≈ 0,3–0,5 GB/hari; 2.000 DAU ≈ 1,5 GB/hari; 10.000 DAU ≈ 7–8 GB/hari.
  Kuota VPS mana pun (≥1 TB/bln) tidak akan jadi masalah sebelum skenario S4.
- **Disk**: app + node_modules + `.next` + standalone ±1,5–2 GB; logs + backup lokal
  + headroom → 20 GB cukup untuk S1–S2, 40–80 GB untuk S3–S4. **Backup resmi simpan
  off-box** (aturan handoff: jangan tumpuk tarball besar di VPS).
- **Region**: audiens Indonesia + Cloudflare Tunnel → pilih region **Jakarta /
  Singapore**. Origin di EU/US menambah ±150–250 ms RTT edge→origin pada SETIAP
  halaman dynamic — lebih terasa daripada selisih CPU. (Box sekarang = Tencent,
  hostname `VM-4-231-opencloudos`.)

## 5. Apa yang pertama jenuh per skenario

| Skenario | Yang pertama jenuh | Gejala | Solusi murah dulu |
|---|---|---|---|
| S1–S2 | RAM saat **build** di-box | OOM/swap saat deploy, bukan saat melayani | build off-box / off-peak; `MemoryMax` cgroup tetap 768M |
| S3 | Query per halaman + Neon throughput | latensi `/beranda` naik >150–200 ms, Neon CU naik | kurangi query `/beranda`, cache bacaan panas, naikkan CU |
| S4 | Proses Node tunggal + koneksi Neon + antre generation | 5xx saat puncak, generation antre panjang | multi-instance + LB, pisahkan worker, naikkan Neon |

## 6. Catatan co-tenancy

Saat ini Lakoku berbagi box 2 GB dengan 9router, narraza, wakonek, hermes, gweb,
warp, cloudflared. Angka ukur §2 sudah mencakup kondisi penuh itu (load 0,17 saat
probe). Jika VPS berikutnya **dedikasi Lakoku**, angka rekomendasi §3 bisa dibaca
apa adanya; jika tetap co-tenant, jumlahkan kebutuhan tetangganya (9router sendiri
butuh RAM saat meneruskan generation) atau pisahkan 9router ke box sendiri sejak S3.

## 7. Cara mengukur ulang (5 menit, read-only)

```bash
# memori service & latensi (di VPS baru, sesuaikan cgroup path)
CG=$(find /sys/fs/cgroup -type d -name 'mox-lakoku*' | head -1)
cat $CG/memory.current
for i in 1 2 3; do curl -s -o /dev/null -w 'beranda %{http_code} %{time_total}s\n' http://127.0.0.1:5200/beranda; done
seq 1 50 | xargs -P4 -I{} curl -s -o /dev/null -w '%{time_total}\n' http://127.0.0.1:5200/beranda \
  | awk '{s+=$1; if($1>max)max=$1; n++} END{printf "burst50 avg=%.3fs max=%.3fs\n", s/n, max}'

# bandwidth harian aktual via tunnel (di VPS)
journalctl --user -u cloudflared --since today 2>/dev/null | wc -l   # indikatif; angka pasti di dashboard Cloudflare
```

Kalibrasi faktor PC/DAU dan req/pembaca dari **funnel analytics** (sudah terpasang
di `/mulai` + selera) setelah ≥2–4 minggu traffic nyata, lalu revisi tabel §3.
