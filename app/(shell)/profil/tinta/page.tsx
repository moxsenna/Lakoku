import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/api/user-state'
import { getTintaBalance, getTintaPolicy, listTintaHistory } from '@/lib/tinta/server'
import { TintaWalletView } from '@/components/tinta/tinta-wallet-view'

export const dynamic = 'force-dynamic'

export default async function TintaPage() {
  const user = await getSessionUser()
  if (!user) {
    redirect('/auth/login?next=/profil/tinta')
  }

  const [balance, policy, history] = await Promise.all([
    getTintaBalance(user.id),
    getTintaPolicy(),
    listTintaHistory(user.id, 30),
  ])

  return (
    <main className="flex flex-col gap-6 px-5 pt-8 pb-12">
      <TintaWalletView balance={balance} policy={policy} history={history} />
    </main>
  )
}
