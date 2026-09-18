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

## 1. Migrasi DB (sudah applied di produksi)

Skema kredit **sudah live** di Supabase produksi (`db push --linked`):
`20260708000000_paycore_credit_model.sql` + bonus (`20260711010000`) + kanal
Android (`20260917120000_play_billing_channel_model.sql`). Jangan push ulang
tanpa dry-run (`--dry-run`) — push mendorong SEMUA migrasi pending.

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

## 3. Kredensial PayCore (terdaftar, live di VPS)

lakoku **sudah terdaftar** di PayCore (staging & production terpisah). Nilai live
ada di `.env` VPS shared (`/home/ubuntu/mox-apps/lakoku/.env`), dikelola owner:

- `app_id` (usul slug: **`lakoku`**)
- `key_id` (mis. `pk_prod_lakoku_01`)
- `PAYCORE_APP_SECRET` (rahasia sign request app)
- `PAYCORE_WEBHOOK_SECRET` (rahasia verifikasi event)
- Daftarkan `webhook_url` = `https://<domain-prod-lakoku>/api/checkout/webhook`
- Daftarkan `return_url` = `https://<domain-prod-lakoku>/payment/return` (atau rute pilihan)

> README PayCore melarang agen eksternal mengubah secret/DB PayCore — laporkan data
> di atas ke maintainer, jangan sentuh repo PayCore.

## 4. Secrets di VPS (`.env` service `mox-lakoku`)

Production Lakoku berjalan sebagai Next.js standalone di shared VPS (systemd user
`mox-lakoku`), bukan Docker. Secret di-set di `/home/ubuntu/mox-apps/lakoku/.env`
(di-source `run-lakoku.sh`); restart `mox-lakoku` untuk memuat ulang. Jangan commit `.env`.

```dotenv
# .env di /home/ubuntu/mox-apps/lakoku (VPS shared)
PAYCORE_WEBHOOK_SECRET=...   # inbound (WAJIB, jika tidak → webhook 503)
PAYCORE_BASE_URL=https://pay.appvibe.biz.id   # prod / pay-staging untuk staging
PAYCORE_APP_ID=lakoku
PAYCORE_KEY_ID=pk_prod_lakoku_01
PAYCORE_APP_SECRET=...        # outbound sign
PAYCORE_RETURN_URL=https://lakoku.biz.id/payment/return
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

## 6. Kanal Android — Google Play Billing (terpisah dari PayCore web)

PayCore **hanya untuk web**. Pembelian di aplikasi Android wajib lewat Play Billing
(kebijakan Google) dan TIDAK boleh menampilkan checkout PayCore di dalam app:

- Katalog: baris `channel='android'` di `credit_products` (mirror web, `active=false`
  sampai SKU Play terdaftar). Harga/kredit per kanal diatur admin via Dashboard.
- Verifikasi server-side: `POST /api/play-billing/verify`
  (`lib/paycore/play-billing.server.ts` → Google `androidpublisher`) lalu grant
  idempoten via RPC `play_billing_grant_v1` (`credit_ledger.ref = 'playbilling:{token}'`).
- Ledger & saldo sama dengan web → sinkron otomatis. Bonus first-topup/normal
  dihitung server-side seperti PayCore.
- Env VPS: `GOOGLE_PLAY_BILLING_ENABLED`, `GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL`,
  `GOOGLE_PLAY_PRIVATE_KEY`, `GOOGLE_PLAY_PACKAGE_NAME` (kill switch: tanpa ini → 503).
- Rilis: `docs/android/PLAY_STORE_RELEASE.md`; ledger `GATES.android*.md`.
