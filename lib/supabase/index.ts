/**
 * Public API paket @lakoku/db (ARCH §5.1).
 *
 * Pemilik: akses database (repository/RPC) dan — nantinya — migrasi & fixtures.
 * Satu-satunya paket yang boleh membuat teks perintah SQL.
 *
 * Hanya `createAdminClient` (service-role, server-side) yang diekspor sebagai
 * public API lintas-paket. Klien khusus-framework Next.js — `client` (browser),
 * `server` (RSC/SSR), dan `proxy` (middleware) — sengaja TIDAK di-barrel karena
 * merupakan seam framework dan memiliki nama `createClient` yang bertabrakan;
 * konsumsi langsung via `@/lib/supabase/{client,server,proxy}`.
 */
export { createAdminClient } from './admin'
