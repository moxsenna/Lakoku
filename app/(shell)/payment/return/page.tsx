import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import { CreditPoller } from '@/components/credit-poller'
import { getSessionUser } from '@/lib/api/user-state'
import { getCreditBalance } from '@/lib/credits/server'

/**
 * Halaman balik setelah pembayaran (return_url PayCore). TIDAK menerbitkan
 * kredit — itu hanya lewat webhook terverifikasi. Halaman ini cuma menenangkan
 * pembeli sambil kredit diproses.
 */
export default async function PaymentReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ order_id?: string }>
}) {
  const { order_id } = await searchParams
  const user = await getSessionUser()
  const initialBalance = user ? await getCreditBalance(user.id) : null

  return (
    <main className="flex min-h-[70svh] flex-col items-center justify-center gap-6 px-8 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-secondary text-primary">
          <CheckCircle2 className="size-8" aria-hidden="true" />
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="font-serif text-2xl text-foreground text-balance">Terima kasih!</h1>
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
            Pembayaranmu sedang diproses. Kreditmu akan masuk otomatis begitu pembayaran
            dikonfirmasi — biasanya beberapa saat. Kamu bisa cek saldo di halaman Kredit.
          </p>
          {order_id && (
            <p className="text-[11px] text-muted-foreground">No. pesanan: {order_id}</p>
          )}
          <p className="text-[11px] font-medium text-foreground">Biasanya kurang dari 30 detik.</p>
        </div>
        <CreditPoller initialBalance={initialBalance} />
        <div className="flex w-full max-w-xs flex-col gap-3">
          <Link
            href="/kredit"
            className="flex min-h-13 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Lihat saldo kredit
          </Link>
          <Link
            href="/beranda"
            className="flex min-h-13 items-center justify-center rounded-2xl border border-border px-6 text-sm font-semibold text-foreground transition-colors hover:bg-card"
          >
            Kembali ke beranda
          </Link>
        </div>
    </main>
  )
}

export const dynamic = 'force-dynamic'
