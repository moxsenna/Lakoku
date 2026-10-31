import 'server-only'
import { getDb } from '@lakoku/db'
import type { ParsedAcquisition } from './policy'

/**
 * Catat atribusi akuisisi saat signup (OQ1=A).
 * Kontrak G1: TEPAT SATU baris per user — parsed null tetap menulis 'direct',
 * bukan melewatkan baris. Best-effort fail-open: kegagalan tidak pernah
 * menggagalkan signup (pola fire-and-forget `trackServerEvent`).
 */
export async function recordAcquisition(
  userId: string,
  parsed: ParsedAcquisition | null,
): Promise<void> {
  try {
    const db = getDb()
    await db
      .insertInto('user_acquisition')
      .values({
        user_id: userId,
        source: parsed?.channel ?? 'direct',
        utm_source: parsed?.utm_source ?? null,
        utm_campaign: parsed?.utm_campaign ?? null,
        referrer_host: parsed?.referrer_host ?? null,
      })
      // First-touch wins + idempoten: signup ulang/duplikat tidak menimpa.
      .onConflict((oc) => oc.column('user_id').doNothing())
      .execute()
  } catch (err) {
    console.warn(
      '[acquisition] recordAcquisition gagal (non-fatal):',
      err instanceof Error ? err.message : err,
    )
  }
}
