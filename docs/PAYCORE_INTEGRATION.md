# PayCore Integration (lakoku)

Integrasi pembayaran lakoku ↔ PayCore untuk **kredit** (dibeli via PayCore, dibelanjakan
untuk membuka bab). Referensi kontrak: `D:/Coding/paycore/docs/external/`.

## Arsitektur

- **Outbound** (`lib/paycore/client.ts`, `app/api/checkout/create`): user login pilih
  paket → lakuko buat order di PayCore (`POST /v1/orders`, ditandatangani) → balikkan
  `checkout_url`. Harga & kredit diambil dari katalog DB (`credit_products`), bukan klien.
- **Inbound** (`lib/entitlement/paycore.ts`, `app/api/checkout/webhook`): PayCore kirim
  `payment.succeeded` (ditandatangani) → verifikasi HMAC + anti-replay → `grant_credits_v1`
  idempoten (`ref = paycore:{order_id}`). **Satu-satunya** jalur yang menerbitkan kredit.
- **Model kredit** (`supabase/migrations/20260708000000_paycore_credit_model.sql`):
  `credit_ledger` append-only + `grant_credits_v1` / `spend_credits_v1` / `credit_balance_v1`.

## 1. Terapkan migrasi DB (WAJIB dulu)

Skema kredit belum ada di Supabase. Terapkan salah satu cara:

```bash
# A. Supabase CLI (butuh SUPABASE_ACCESS_TOKEN dari dashboard → Account → Access Tokens)
export SUPABASE_ACCESS_TOKEN=sbp_xxx
npx supabase link --project-ref <ref>   # <ref> = subdomain SUPABASE_URL
npx supabase db push
```

Atau **B. Dashboard**: buka Supabase → SQL Editor → paste isi
`supabase/migrations/20260708000000_paycore_credit_model.sql` → Run.

Verifikasi: tabel `credit_products` (6 baris seed) & `credit_ledger` ada; fungsi
`grant_credits_v1` terdaftar.

## 2. Katalog produk (edit harga kapan pun)

SKU **placeholder** (ubah `price_idr` / `credits` / `name` / `active` langsung di
Supabase Dashboard → Table `credit_products`, tanpa deploy ulang):

| product_key | name | price_idr | credits |
|---|---|---|---|
| credits_starter | Paket Pemula | 15.000 | 30 |
| credits_basic | Paket Dasar | 30.000 | 70 |
| credits_plus | Paket Plus | 50.000 | 130 |
| credits_pro | Paket Pro | 100.000 | 300 |
| credits_max | Paket Maksi | 200.000 | 700 |
| credits_ultra | Paket Ultra | 500.000 | 2.000 |

## 3. Data yang harus diminta ke maintainer PayCore

lakoku **belum terdaftar** di PayCore. Minta maintainer mendaftarkan app baru dan
memberi nilai berikut (staging & production terpisah — README PayCore §11):

- `app_id` (usul slug: **`lakoku`**)
- `key_id` (mis. `pk_prod_lakoku_01`)
- `PAYCORE_APP_SECRET` (rahasia sign request app)
- `PAYCORE_WEBHOOK_SECRET` (rahasia verifikasi event)
- Daftarkan `webhook_url` = `https://<domain-prod-lakoku>/api/checkout/webhook`
- Daftarkan `return_url` = `https://<domain-prod-lakoku>/payment/return` (atau rute pilihan)

> README PayCore melarang agen eksternal mengubah secret/DB PayCore — laporkan data
> di atas ke maintainer, jangan sentuh repo PayCore.

## 4. Secrets di VPS (`.env` container `lakoku-web`)

Production Lakoku berjalan sebagai Next.js standalone di VPS (Docker), bukan Cloudflare Worker.
Secret di-set lewat file `.env` yang dibaca `docker-compose.yml` (`env_file: .env`), lalu
`docker compose up -d --build`. Jangan commit `.env`.

```dotenv
# .env di /opt/lakoku (VPS)
PAYCORE_WEBHOOK_SECRET=...   # inbound (WAJIB, jika tidak → webhook 503)
PAYCORE_BASE_URL=https://pay.appvibe.biz.id   # prod / pay-staging untuk staging
PAYCORE_APP_ID=lakoku
PAYCORE_KEY_ID=pk_prod_lakoku_01
PAYCORE_APP_SECRET=...        # outbound sign
PAYCORE_RETURN_URL=https://<domain>/payment/return
```

Webhook & create-order **fail-closed 503** bila secret kurang → aman (tak ada grant/order palsu).

## 5. E2E sebelum production (PayCore checklist §11)

1. `GET {PAYCORE_BASE_URL}/health` OK.
2. `POST /api/checkout/create` (user login) → dapat `checkout_url`.
3. Bayar di sandbox Duitku → PayCore kirim `payment.succeeded` → 1 baris `credit_ledger`.
4. Minta operator resend callback → tetap 1 baris (idempoten).
5. Cek saldo lewat `credit_balance_v1(user)`.

Staging dulu sampai lolos; production hanya beda nilai env (kode identik).

## Test

- `pnpm run smoke:paycore-webhook` — verifikasi tanda tangan, anti-replay, idempotensi (21).
- `pnpm run smoke:paycore-client` — canonical signing outbound (6).
