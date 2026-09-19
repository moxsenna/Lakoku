import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/api/user-state'
import { getReferralStats, getRewardPolicy } from '@/lib/rewards/server'
import { RewardWalletView } from '@/components/rewards/reward-wallet-view'

export const dynamic = 'force-dynamic'

export default async function ImbalanPage() {
  const user = await getSessionUser()
  if (!user) {
    redirect('/auth/login?next=/profil/imbalan')
  }

  const [stats, policy] = await Promise.all([
    getReferralStats(user.id),
    getRewardPolicy(),
  ])

  return (
    <main className="flex flex-col gap-6 px-5 pt-8 pb-12">
      <RewardWalletView stats={stats} policy={policy} />
    </main>
  )
}
