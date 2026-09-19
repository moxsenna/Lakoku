'use server'

import { revalidatePath } from 'next/cache'
import { getSessionUser } from '@/lib/api/user-state'
import { exchangeTintaForLakoin } from '@/lib/tinta/server'

export type ExchangeActionResult =
  | { ok: true; lakoinOut: number; tintaSpent: number }
  | { ok: false; error: string }

const KNOWN_BUSINESS_ERRORS = [
  'Saldo Tinta tidak mencukupi',
  'Transaksi penukaran sedang diproses',
  'Penukaran sedang dinonaktifkan.',
  'Kurs penukaran tidak valid.',
]

export async function actExchangeTinta(amount: number): Promise<ExchangeActionResult> {
  const user = await getSessionUser()
  if (!user) {
    return { ok: false, error: 'Silakan masuk terlebih dahulu' }
  }

  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Jumlah Tinta tidak valid' }
  }

  try {
    const result = await exchangeTintaForLakoin(user.id, Math.floor(amount))
    revalidatePath('/profil/tinta')
    revalidatePath('/profil')
    revalidatePath('/kredit')
    return {
      ok: true,
      lakoinOut: result.lakoinOut,
      tintaSpent: result.tintaSpent,
    }
  } catch (e) {
    const message = (e as Error)?.message ?? ''

    if (
      KNOWN_BUSINESS_ERRORS.includes(message) ||
      message.startsWith('Penukaran minimal')
    ) {
      return { ok: false, error: message }
    }

    return { ok: false, error: 'Terjadi kendala. Coba lagi.' }
  }
}
