import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/api/user-state'
import { getCreditBalance } from '@/lib/credits/server'
import { getDailyMissions, getMissionPolicy } from '@/lib/missions/server'
import { MissionsView } from '@/components/missions/missions-view'

export const dynamic = 'force-dynamic'

export default async function MissionsPage() {
  const user = await getSessionUser()
  if (!user) {
    redirect('/auth/login?next=/misi')
  }

  const [snapshot, policy, creditBalance] = await Promise.all([
    getDailyMissions(user.id),
    getMissionPolicy(),
    getCreditBalance(user.id),
  ])

  return (
    <main className="flex flex-col gap-6 px-5 pt-8 pb-12">
      <MissionsView
        initialSnapshot={snapshot}
        policy={policy}
        creditBalance={creditBalance}
      />
    </main>
  )
}
