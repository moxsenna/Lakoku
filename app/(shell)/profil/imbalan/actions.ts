'use server'

import { getSessionUser } from '@/lib/api/user-state'
import { redeemRewardCredits } from '@/lib/rewards/server'
import { revalidatePath } from 'next/cache'

export type RedeemActionResult =
  | { ok: true; creditsGranted: number; deductedIdr: number; newBalance: number }
  | { ok: false; error: string }

export async function actRedeemCredits(amountIdr: number): Promise<RedeemActionResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, error: 'Silakan masuk terlebih dahulu' }

  try {
    const result = await redeemRewardCredits(user.id, amountIdr)
    revalidatePath('/profil/imbalan')
    revalidatePath('/profil')
    revalidatePath('/kredit')
    return {
      ok: true,
      creditsGranted: result.creditsGranted,
      deductedIdr: result.deductedIdr,
      newBalance: result.remainingIdr,
    }
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? 'Gagal menukarkan Lakoin' }
  }
}
