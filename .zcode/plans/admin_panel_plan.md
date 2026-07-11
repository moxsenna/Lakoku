# PLAN IMPLEMENTASI ADMIN PANEL LAKOKU

## Tujuan

Bangun **Admin Panel MVP** untuk Lakoku agar owner/admin bisa mengelola operasional dasar tanpa langsung membuka database, endpoint manual, atau halaman admin terpisah.

Fokus utama admin panel ini:

1. Melihat kondisi produk secara cepat.
2. Mencari user.
3. Melihat saldo dan riwayat kredit user.
4. Memberikan kredit manual dengan audit trail.
5. Memantau order/topup.
6. Memantau AI generation/generation failure.
7. Mengintegrasikan halaman `/admin/consistency` yang sudah ada ke dalam layout admin.
8. Menyiapkan fondasi security, role guard, sidebar, dan smoke test.

Jangan membangun CMS besar dulu. Ini adalah **Ops Admin Panel**, bukan content management system penuh.

---

## Kondisi Repo Saat Ini

Repo menggunakan Next.js App Router. Script utama sudah tersedia di `package.json`, termasuk:

```bash
pnpm typecheck
pnpm test:unit
pnpm smoke
pnpm test
```

Admin-related yang sudah ada:

1. `lib/admin/auth.ts`

   * Sudah ada `requireAdminUser()`.
   * Role admin berasal dari tabel `admin_users`.
   * Role valid: `owner` dan `admin`.

2. `app/api/admin/credits/grant/route.ts`

   * Sudah ada endpoint POST untuk grant kredit.
   * Auth utama memakai session admin.
   * Fallback masih memakai runtime token untuk backward compatibility.
   * Body:

     ```ts
     {
       targetUserId: string
       credits: number
       reason: string
       requestId?: string
     }
     ```

3. `lib/admin/credits.ts`

   * Sudah ada helper `adminGrantCredits()`.
   * Memakai RPC `admin_grant_credits_v1`.
   * Atomic: insert audit row + insert credit ledger.
   * Idempotent via `ledger_ref`.

4. `app/admin/consistency/page.tsx`

   * Sudah ada halaman observability konsistensi naratif.
   * Belum berada dalam admin layout/sidebar utuh.

5. `middleware.ts`

   * Saat ini matcher hanya mencakup:

     ```ts
     ['/baca/:path*', '/akhir/:path*', '/koleksiku/:path*']
     ```
   * Tambahkan `/admin/:path*` agar session refresh juga berjalan di route admin.

6. Migration `20260711010000_ops_credit_config.sql`

   * Sudah menambahkan:

     * `credit_orders`
     * `admin_credit_grants`
     * `admin_grant_credits_v1`
     * `generation_policy`
     * `ai_model_routes`
     * `feature_credit_costs`

---

## Prinsip Implementasi

### 1. Server-first

Utamakan Server Components untuk halaman admin. Client Component hanya untuk bagian interaktif seperti:

* form grant kredit
* search input bila memakai client-side behavior
* confirm dialog
* toast

Data sensitif harus diambil dari server memakai `createAdminClient()` atau helper server-only.

### 2. Guard terpusat

Semua halaman `/admin/*` harus melewati guard di:

```txt
app/admin/layout.tsx
```

Jangan mengulang guard di setiap page kecuali ada kebutuhan role khusus.

### 3. Role-based action

Role:

```ts
type AdminRole = 'owner' | 'admin'
```

MVP rule:

* `owner`: semua akses dan semua action.
* `admin`: boleh melihat dashboard, user, kredit, orders, generation, consistency.
* `admin`: boleh grant kredit jika endpoint yang ada memang mengizinkan.
* Dangerous action seperti refund manual, delete, suspend, edit config production: jangan dibuat dulu.

### 4. Read-heavy first

Admin panel MVP harus dominan read-only. Write action hanya:

* grant kredit manual
* nanti bisa ditambah reconcile/refund/suspend setelah audit log matang

### 5. Jangan membuat schema baru jika data sudah ada

Gunakan tabel yang sudah ada dulu:

* `auth.users`
* `profiles` bila ada
* `credit_ledger`
* `credit_orders`
* `admin_credit_grants`
* `generation_policy`
* `ai_model_routes`
* `feature_credit_costs`
* tabel/event observability yang dipakai `loadConsistencyMetrics()`

Jika nama tabel berbeda di repo, sesuaikan berdasarkan schema aktual. Jangan mengarang nama final tanpa mengecek migration lama.

---

# Target Struktur File

Buat struktur berikut:

```txt
app/admin/layout.tsx
app/admin/page.tsx

app/admin/users/page.tsx
app/admin/users/[id]/page.tsx

app/admin/credits/page.tsx
app/admin/payments/page.tsx
app/admin/generation/page.tsx
app/admin/settings/page.tsx

app/admin/consistency/page.tsx
```

Komponen pendukung:

```txt
components/admin/admin-shell.tsx
components/admin/admin-sidebar.tsx
components/admin/admin-header.tsx
components/admin/admin-stat-card.tsx
components/admin/admin-section-card.tsx
components/admin/admin-empty-state.tsx
components/admin/admin-error-state.tsx
components/admin/grant-credit-form.tsx
components/admin/user-search-form.tsx
components/admin/status-badge.tsx
```

Server helpers:

```txt
lib/admin/dashboard.ts
lib/admin/users.ts
lib/admin/orders.ts
lib/admin/generation.ts
lib/admin/settings.ts
lib/admin/format.ts
```

Smoke test:

```txt
scripts/admin-panel-smoke.ts
```

Tambahkan script package:

```json
"smoke:admin-panel": "node scripts/run-smoke.cjs scripts/admin-panel-smoke.ts"
```

Lalu masukkan ke rangkaian `smoke` utama.

---

# Phase 1 — Admin Layout dan Security Guard

## Tujuan

Semua route `/admin/*` harus aman, konsisten, dan memakai layout admin yang sama.

## File yang dibuat/diubah

```txt
app/admin/layout.tsx
components/admin/admin-shell.tsx
components/admin/admin-sidebar.tsx
components/admin/admin-header.tsx
middleware.ts
```

## Detail Implementasi

### 1. Update `middleware.ts`

Tambahkan `/admin/:path*` ke matcher.

Target:

```ts
export const config = {
  matcher: ['/baca/:path*', '/akhir/:path*', '/koleksiku/:path*', '/admin/:path*'],
}
```

Tujuan: session Supabase tetap di-refresh ketika admin membuka halaman admin.

### 2. Buat `app/admin/layout.tsx`

Layout harus:

* server component
* memanggil `requireAdminUser()`
* jika unauthenticated/forbidden, tampilkan halaman akses ditolak atau redirect ke login
* render admin shell
* passing `admin` ke header/sidebar jika perlu

Pseudocode:

```tsx
import { requireAdminUser } from '@/lib/admin/auth'
import { AdminShell } from '@/components/admin/admin-shell'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminUser()

  return (
    <AdminShell admin={admin}>
      {children}
    </AdminShell>
  )
}
```

Catatan:

* Jika pattern repo lebih cocok memakai `redirect('/login')`, gunakan itu.
* Jika error boundary sudah ada, sesuaikan.

### 3. Admin Sidebar

Menu MVP:

```ts
const adminNav = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/credits', label: 'Credits' },
  { href: '/admin/payments', label: 'Payments' },
  { href: '/admin/generation', label: 'Generation' },
  { href: '/admin/consistency', label: 'Consistency' },
  { href: '/admin/settings', label: 'Settings' },
]
```

Sidebar harus sederhana. Jangan membuat animasi kompleks.

### 4. Header

Tampilkan:

* title area
* admin email
* role badge: `owner` / `admin`

## Acceptance Criteria

* `/admin` tidak bisa dibuka user non-admin.
* `/admin/consistency` tetap bisa berjalan, tapi sekarang berada dalam admin layout.
* Sidebar muncul di semua halaman admin.
* No TypeScript error.
* Middleware matcher mencakup `/admin/:path*`.

---

# Phase 2 — Admin Overview `/admin`

## Tujuan

Membuat halaman ringkasan operasional. Halaman ini harus menjawab:

* Ada berapa user?
* Berapa kredit yang beredar?
* Berapa order/topup hari ini/bulan ini?
* Ada generation failure?
* Ada masalah consistency?

## File

```txt
app/admin/page.tsx
lib/admin/dashboard.ts
components/admin/admin-stat-card.tsx
components/admin/admin-section-card.tsx
```

## Data yang Ditampilkan

### Stat Cards

Minimal tampilkan:

1. Total Users
2. New Users Today
3. Total Credits Circulating
4. Credits Used Today
5. Paid Orders Today
6. Revenue Today
7. Generation Attempts Today
8. Generation Failures Today
9. Consistency Critical Rate
10. Pending Review / Reports jika datanya tersedia

Jika sebagian data belum ada tabelnya, buat fallback aman:

```ts
{
  value: 0,
  note: 'No data source yet'
}
```

Tapi jangan membuat data palsu.

## Helper `lib/admin/dashboard.ts`

Buat fungsi:

```ts
export interface AdminDashboardMetrics {
  totalUsers: number
  newUsersToday: number
  totalCreditsCirculating: number
  creditsUsedToday: number
  paidOrdersToday: number
  revenueTodayIdr: number
  generationAttemptsToday: number
  generationFailuresToday: number
  consistencyCriticalRate: number | null
}

export async function loadAdminDashboardMetrics(): Promise<AdminDashboardMetrics>
```

Gunakan `createAdminClient()`.

Query awal yang disarankan:

* `auth.admin.listUsers()` jika client mendukung dan aman.
* Jika tidak, gunakan tabel profile/public user yang sudah tersedia di schema.
* `credit_ledger`:

  * total kredit beredar: sum delta
  * used today: sum delta negatif hari ini
* `credit_orders`:

  * paid orders today
  * revenue today
* observability:

  * reuse `loadConsistencyMetrics()` untuk consistency critical rate.

## UI

Buat grid card:

```txt
Admin Overview
Ringkasan operasional Lakoku hari ini.

[Total Users] [New Users Today] [Revenue Today]
[Credits Circulating] [Credits Used Today] [Paid Orders]
[Generation Attempts] [Generation Failures] [Consistency Critical]
```

Tambahkan section:

1. “Perlu Perhatian”

   * generation failures > 0
   * paid order tanpa kredit jika bisa dicek
   * consistency critical rate tinggi
2. “Shortcut”

   * Grant Credit
   * Search User
   * Payment Monitor
   * Consistency Dashboard

## Acceptance Criteria

* `/admin` tampil.
* Data kosong tidak crash.
* Error query ditangani dengan fallback error card.
* Semua angka diformat rapi.
* Tidak ada client-side fetch untuk data sensitif.

---

# Phase 3 — Users List dan Search `/admin/users`

## Tujuan

Admin bisa mencari user berdasarkan email atau user ID.

## File

```txt
app/admin/users/page.tsx
app/admin/users/[id]/page.tsx
lib/admin/users.ts
components/admin/user-search-form.tsx
```

## `/admin/users`

Fitur:

* Search by email
* Search by user ID
* List recent users jika query kosong
* Table sederhana

Kolom:

```txt
Email
User ID
Created At
Last Sign In
Credit Balance
Total Paid Orders
Action: View
```

## Helper

Buat:

```ts
export interface AdminUserListItem {
  id: string
  email: string | null
  createdAt: string | null
  lastSignInAt: string | null
  creditBalance: number
  paidOrdersCount: number
}

export async function searchAdminUsers(query?: string): Promise<AdminUserListItem[]>
```

Catatan implementasi:

* Jika Supabase Auth admin API sulit dipakai untuk search email, gunakan strategy:

  1. Coba ambil dari profile table jika ada.
  2. Kalau tidak ada profile/email mirror, tampilkan search by user ID dulu.
  3. Jangan expose service role ke client.

## `/admin/users/[id]`

Tampilkan user detail:

1. Identity

   * user ID
   * email
   * created at
   * last login

2. Credit Summary

   * current balance
   * total purchased credits
   * total bonus credits
   * total admin granted credits
   * total spent credits

3. Credit Ledger

   * recent 50 rows
   * delta
   * reason
   * ref
   * created_at

4. Orders

   * recent orders
   * order_id
   * product_key
   * price_idr
   * total_credits
   * status
   * paid_at

5. Admin Grants

   * grant date
   * admin_user_id
   * credits
   * reason
   * ledger_ref

6. Generation History jika tabel tersedia

   * latest generation attempts
   * status
   * model/use_case
   * error

7. Actions

   * Grant Credit form
   * Tidak ada delete/suspend dulu

## Helper

```ts
export interface AdminUserDetail {
  id: string
  email: string | null
  createdAt: string | null
  lastSignInAt: string | null
  creditBalance: number
  creditStats: {
    purchased: number
    bonus: number
    adminGranted: number
    spent: number
  }
  ledger: AdminCreditLedgerRow[]
  orders: AdminOrderRow[]
  grants: AdminCreditGrantRow[]
}

export async function loadAdminUserDetail(userId: string): Promise<AdminUserDetail>
```

## Acceptance Criteria

* Admin bisa cari user.
* Admin bisa buka detail user.
* Jika user tidak ditemukan, tampilkan not found state.
* User detail tetap aman jika sebagian tabel kosong.
* Tidak ada raw JSON dump di UI.

---

# Phase 4 — Credits Panel `/admin/credits`

## Tujuan

Membuat pusat operasional kredit.

## File

```txt
app/admin/credits/page.tsx
components/admin/grant-credit-form.tsx
lib/admin/credits.ts
```

`lib/admin/credits.ts` sudah ada. Jangan rusak fungsi yang sudah ada. Tambahkan helper read-only di file yang sama atau buat file baru:

```txt
lib/admin/credit-queries.ts
```

Pilih salah satu yang paling rapi.

## Data yang Ditampilkan

### Credit Overview

Cards:

1. Total Credits Circulating
2. Credits Purchased
3. Credits Bonus
4. Credits Admin Granted
5. Credits Spent
6. Grants Today

### Latest Ledger

Table:

```txt
Created At
User ID
Delta
Reason
Ref
```

### Latest Admin Grants

Table:

```txt
Created At
Target User
Admin User
Credits
Reason
Ledger Ref
```

### Grant Credit Form

Fields:

```txt
targetUserId
credits
reason
```

Optional:

```txt
requestId
```

Validasi client-side:

* targetUserId required
* credits integer 1..100000
* reason 3..500 chars

Server tetap source of truth. Jangan bergantung pada validasi client.

## Grant Flow

Form submit ke endpoint existing:

```txt
POST /api/admin/credits/grant
```

Body:

```json
{
  "targetUserId": "...",
  "credits": 100,
  "reason": "Kompensasi user karena pembayaran sukses tapi kredit terlambat masuk"
}
```

Setelah sukses:

* tampilkan toast
* refresh page/router
* tampilkan `ref`

Jika duplicate:

* tampilkan warning, bukan error fatal

## Acceptance Criteria

* Admin bisa melihat ledger terbaru.
* Admin bisa grant kredit.
* Grant masuk ke `admin_credit_grants`.
* Grant masuk ke `credit_ledger`.
* Duplicate `requestId` tidak menggandakan kredit.
* Reason wajib dan tersimpan.

---

# Phase 5 — Payments Panel `/admin/payments`

## Tujuan

Admin bisa memantau topup/order tanpa membuka database.

## File

```txt
app/admin/payments/page.tsx
lib/admin/orders.ts
```

## Data yang Ditampilkan

Table:

```txt
Created At
Order ID
User ID
Product Key
Price
Base Credits
Bonus Credits
Total Credits
Bonus Kind
Status
Paid At
```

Filter:

```txt
status=all|created|paid|duplicate|failed
```

Optional query param:

```txt
?status=paid
```

## Helper

```ts
export interface AdminOrderRow {
  id: string
  orderId: string
  userId: string
  productKey: string
  priceIdr: number
  baseCredits: number
  bonusCredits: number
  totalCredits: number
  bonusKind: 'none' | 'normal' | 'first_topup'
  status: 'created' | 'paid' | 'duplicate' | 'failed'
  createdAt: string
  paidAt: string | null
}

export async function listAdminOrders(args?: {
  status?: string
  limit?: number
}): Promise<AdminOrderRow[]>
```

## Tambahan Detection

Jika feasible, tampilkan warning:

* order `paid` tapi tidak ada ledger `paycore:%`
* duplicate order
* order created terlalu lama belum paid

Jangan buat tombol reconcile dulu kecuali sudah ada RPC/flow aman.

## Acceptance Criteria

* `/admin/payments` tampil.
* Bisa filter status.
* Data terbaru di atas.
* Format IDR rapi.
* Tidak ada write action.

---

# Phase 6 — Generation Monitor `/admin/generation`

## Tujuan

Admin bisa melihat kesehatan AI generation dan failure.

## File

```txt
app/admin/generation/page.tsx
lib/admin/generation.ts
```

## Data yang Ditampilkan

Karena nama tabel generation bisa berbeda, agent wajib cek schema/migration terkait generation sebelum implementasi final.

Cari tabel/log yang mungkin bernama:

```txt
generation_events
generation_attempts
ai_generations
chapter_generations
story_generation_logs
observability_events
```

Jika belum ada tabel dedicated, gunakan event observability yang sudah dipakai consistency dashboard.

## UI Minimal

Cards:

1. Attempts Today
2. Success Today
3. Failed Today
4. Failure Rate
5. Average Duration jika tersedia
6. Most Used Model jika tersedia

Table latest attempts/events:

```txt
Created At
User ID
Story ID
Chapter ID
Use Case
Model
Status
Error
Duration
```

Jika field tidak tersedia, jangan mengarang. Tampilkan kolom yang ada.

## Helper

```ts
export interface AdminGenerationMetric {
  attemptsToday: number
  successToday: number
  failedToday: number
  failureRate: number
}

export interface AdminGenerationEvent {
  id: string
  createdAt: string
  userId?: string | null
  storyId?: string | null
  chapterId?: string | null
  useCase?: string | null
  model?: string | null
  status: string
  error?: string | null
  durationMs?: number | null
}

export async function loadAdminGenerationMetrics(): Promise<AdminGenerationMetric>
export async function listAdminGenerationEvents(limit?: number): Promise<AdminGenerationEvent[]>
```

## Acceptance Criteria

* Halaman tidak crash walau tabel generation belum lengkap.
* Jika data source belum ada, tampilkan empty state yang jujur.
* Tidak ada data palsu.
* Bisa melihat error generation terbaru bila data tersedia.

---

# Phase 7 — Settings Read-only `/admin/settings`

## Tujuan

Admin bisa melihat konfigurasi produk, generation policy, model route, dan credit cost.

Jangan buat edit UI dulu.

## File

```txt
app/admin/settings/page.tsx
lib/admin/settings.ts
```

## Data yang Ditampilkan

### Credit Products

Dari `credit_products`:

```txt
Product Key
Name
Price IDR
Credits
Normal Bonus
First Topup Bonus
Marketing Badge
Active
```

### Generation Policy

Dari `generation_policy`:

```txt
target_words_min
target_words_max
target_scenes
updated_at
```

### AI Model Routes

Dari `ai_model_routes`:

```txt
use_case
provider
model_id
fallback_models
temperature
max_output_tokens
is_active
route_version
notes
```

### Feature Credit Costs

Dari `feature_credit_costs`:

```txt
feature_key
credits_required
is_active
pricing_version
metadata
updated_at
```

## Acceptance Criteria

* `/admin/settings` read-only tampil.
* Tidak ada tombol edit.
* Active/inactive jelas.
* Config kosong tidak crash.

---

# Phase 8 — Integrasi `/admin/consistency`

## Tujuan

Halaman consistency yang sudah ada tetap berjalan, tapi masuk sebagai bagian dari admin panel.

## File

```txt
app/admin/consistency/page.tsx
```

## Perubahan

1. Jangan hapus logic existing.
2. Pastikan page tampil di dalam `app/admin/layout.tsx`.
3. Tambahkan heading/description yang konsisten dengan admin page lain bila perlu.
4. Jangan gandakan sidebar di page ini.
5. Pastikan `dynamic = 'force-dynamic'` tetap ada.

## Acceptance Criteria

* `/admin/consistency` tetap load metrik.
* Sidebar admin muncul.
* Tidak ada regression pada chart/list/alert.
* Jika metrik gagal load, error state tetap aman.

---

# Phase 9 — Komponen UI Standar

## Tujuan

Menghindari UI admin yang berantakan dan inkonsisten.

## Komponen

### `AdminStatCard`

Props:

```ts
interface AdminStatCardProps {
  title: string
  value: string | number
  description?: string
  tone?: 'default' | 'good' | 'warn' | 'bad'
}
```

### `StatusBadge`

Props:

```ts
interface StatusBadgeProps {
  status: string
}
```

Mapping:

```txt
paid -> good
created/pending -> warn
failed -> bad
duplicate -> warn
active -> good
inactive -> default
```

### `AdminEmptyState`

Untuk data kosong.

### `AdminErrorState`

Untuk query error.

## Style

Gunakan komponen UI yang sudah ada di repo:

```txt
components/ui/card
components/ui/button
components/ui/input
```

Jangan menambah library UI baru.

---

# Phase 10 — Smoke Test

## File

```txt
scripts/admin-panel-smoke.ts
```

## Tujuan

Smoke test harus mengecek struktur dan invariant statis, bukan menjalankan browser.

## Checks Minimal

1. `app/admin/layout.tsx` ada.
2. `app/admin/page.tsx` ada.
3. `app/admin/users/page.tsx` ada.
4. `app/admin/users/[id]/page.tsx` ada.
5. `app/admin/credits/page.tsx` ada.
6. `app/admin/payments/page.tsx` ada.
7. `app/admin/generation/page.tsx` ada.
8. `app/admin/settings/page.tsx` ada.
9. `app/admin/layout.tsx` meng-import `requireAdminUser`.
10. `middleware.ts` matcher mencakup `/admin/:path*`.
11. `components/admin/admin-sidebar.tsx` punya link `/admin/consistency`.
12. `components/admin/grant-credit-form.tsx` submit ke `/api/admin/credits/grant`.
13. Tidak ada hardcoded admin email seperti `moxsenna@gmail.com` di guard.
14. Tidak ada service-role key di client component.
15. `app/admin/settings/page.tsx` tidak memiliki write action/edit form.
16. `app/admin/payments/page.tsx` tidak memiliki reconcile/refund button.
17. `app/admin/credits/page.tsx` memakai grant flow existing.
18. `app/admin/consistency/page.tsx` tetap ada.

Tambahkan script ke `package.json`:

```json
"smoke:admin-panel": "node scripts/run-smoke.cjs scripts/admin-panel-smoke.ts"
```

Masukkan ke script `smoke`.

## Acceptance Criteria

Command berikut lulus:

```bash
pnpm typecheck
pnpm test:unit
pnpm smoke:admin-panel
pnpm smoke
```

Jika `pnpm smoke` terlalu berat saat development, minimal pastikan:

```bash
pnpm typecheck
pnpm smoke:admin-panel
```

---

# Phase 11 — Final Verification

Setelah implementasi selesai, jalankan:

```bash
pnpm typecheck
pnpm test:unit
pnpm smoke:admin-panel
pnpm smoke
```

Lalu laporkan:

```txt
Gate:
- typecheck:
- test:unit:
- smoke:admin-panel:
- smoke:

Files created:
- ...

Files modified:
- ...

Admin routes:
- /admin
- /admin/users
- /admin/users/[id]
- /admin/credits
- /admin/payments
- /admin/generation
- /admin/consistency
- /admin/settings

Known limitations:
- ...
```

---

# Non-goals

Jangan implementasikan dulu:

1. Refund manual.
2. Delete user.
3. Ban/suspend user.
4. Edit pricing dari admin UI.
5. Edit model route dari admin UI.
6. Reconcile payment manual.
7. Full CMS story editor.
8. Role management UI.
9. Export CSV.
10. Complex analytics chart.

Semua itu bisa fase berikutnya setelah admin MVP stabil.

---

# Prioritas Pengerjaan

Urutan wajib:

1. Admin layout + guard.
2. Middleware matcher `/admin/:path*`.
3. Admin sidebar/header.
4. `/admin` overview.
5. `/admin/users`.
6. `/admin/users/[id]`.
7. `/admin/credits` + grant form.
8. `/admin/payments`.
9. `/admin/generation`.
10. `/admin/settings`.
11. Integrasi consistency ke sidebar.
12. Smoke test.
13. Full gate.

---

# Definisi Selesai

Admin panel dianggap selesai jika:

1. Admin login bisa membuka `/admin`.
2. Non-admin tidak bisa membuka `/admin`.
3. Owner/admin bisa melihat overview.
4. Owner/admin bisa mencari user.
5. Owner/admin bisa melihat detail user.
6. Owner/admin bisa melihat saldo dan ledger kredit.
7. Owner/admin bisa grant kredit manual dengan reason.
8. Grant kredit tercatat di audit table dan ledger.
9. Owner/admin bisa melihat daftar order/topup.
10. Owner/admin bisa melihat generation monitor.
11. Owner/admin bisa melihat settings read-only.
12. `/admin/consistency` tetap berfungsi.
13. Tidak ada hardcoded email admin di kode.
14. Tidak ada service role key di client component.
15. `pnpm typecheck` lulus.
16. `pnpm smoke:admin-panel` lulus.
17. `pnpm smoke` lulus atau jika gagal, kegagalan harus jelas tidak terkait admin panel.

---

# Catatan Implementasi Penting

1. Jangan ubah kontrak endpoint `/api/admin/credits/grant` kecuali benar-benar perlu.
2. Jangan menghapus fallback runtime token di endpoint grant karena disebut masih untuk backward compatibility.
3. Jangan expose service role ke client.
4. Jangan hardcode `moxsenna@gmail.com` sebagai admin.
5. Role admin harus tetap dari tabel `admin_users`.
6. Gunakan `force-dynamic` untuk halaman admin yang membaca data operasional.
7. Semua query admin harus toleran terhadap data kosong.
8. Semua angka uang pakai format IDR.
9. Semua tanggal tampil dalam timezone lokal user/app jika helper sudah ada.
10. Jangan menambahkan dependency baru tanpa alasan kuat.
