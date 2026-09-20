import { AdminStatCard } from '@/components/admin/admin-stat-card'
import { AdminSectionCard } from '@/components/admin/admin-section-card'
import { BroadcastForm } from '@/components/admin/push/broadcast-form'
import { getDeviceSummary } from './actions'

export const dynamic = 'force-dynamic'

/** Halaman Siaran: ringkasan perangkat + formulir broadcast (B). */
export default async function AdminPushPage() {
  const summary = await getDeviceSummary()

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-serif text-xl text-foreground">Siaran</h1>
        <p className="text-xs text-muted-foreground">
          Kirim pengingat ke aplikasi web dan Android pembaca.
        </p>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <AdminStatCard title="Perangkat" value={summary.total} />
        <AdminStatCard title="Android" value={summary.android} />
        <AdminStatCard title="Web" value={summary.web} />
      </div>

      <AdminSectionCard
        title="Siaran baru"
        subtitle="Terkirim ke semua perangkat pada audiens yang dipilih."
      >
        <BroadcastForm />
      </AdminSectionCard>
    </div>
  )
}
