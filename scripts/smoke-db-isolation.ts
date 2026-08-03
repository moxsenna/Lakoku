/**
 * Isolasi kredensial DB untuk smoke provider-only.
 *
 * Modul ini sengaja tidak mengimpor apa pun dari `lib/` agar bisa diuji
 * langsung tanpa menarik gateway/Supabase ke dalam test runner.
 *
 * Latar: `executeObservedModelCall()` SELALU menjalankan telemetry recorder,
 * baik provider call sukses maupun gagal. Recorder default
 * `recordGenerationProviderCall` membuat `createAdminClient()` lalu memanggil
 * RPC `record_generation_provider_call_v2` yang langsung insert ke
 * `generation_provider_calls`. Artinya smoke real-model yang berjalan dengan
 * env production akan menulis telemetry sintetis ke production meski tidak
 * pernah menyentuh tabel story/chapter.
 *
 * Penanganannya dilakukan di sisi smoke, bukan dengan mengubah kontrak
 * observability produksi: blast radius jauh lebih kecil.
 */

/**
 * Env yang, bila ada, memungkinkan `createAdminClient()` berhasil dan menulis
 * ke DB. Service-role key paling berbahaya karena melewati RLS.
 */
export const DB_CREDENTIAL_ENV_KEYS = [
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const

/**
 * Lucuti kredensial DB dari process. Wajib dipanggil SEBELUM provider dibuat,
 * sehingga tidak ada jalur — termasuk telemetry recorder — yang bisa
 * membentuk admin client. `createAdminClient()` membaca env saat dipanggil,
 * jadi ia throw sebelum client/network terbentuk.
 *
 * @returns nama env yang benar-benar terisi lalu dihapus.
 */
export function stripDbCredentials(env: Record<string, string | undefined>): string[] {
  const removed: string[] = []
  for (const key of DB_CREDENTIAL_ENV_KEYS) {
    if (env[key] != null && env[key] !== '') removed.push(key)
    delete env[key]
  }
  return removed
}

/**
 * Bukti positif bahwa proses tidak lagi memegang kredensial DB. Kegagalan di
 * sini berarti ada jalur env yang terlewat — lebih baik berhenti daripada
 * menjalankan gateway nyata dengan kemampuan menulis ke DB.
 */
export function assertNoDbCredentials(env: Record<string, string | undefined>): void {
  const leaked = DB_CREDENTIAL_ENV_KEYS.filter((k) => env[k] != null && env[k] !== '')
  if (leaked.length > 0) {
    throw new Error(
      `provider-only smoke masih memegang kredensial DB: ${leaked.join(', ')}. ` +
        'Menolak menjalankan real gateway karena telemetry recorder bisa menulis ke DB.',
    )
  }
}
