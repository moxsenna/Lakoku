import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, Coins } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { BuyCreditButton } from '@/components/kredit/buy-credit-button'
import { getSessionUser } from '@/lib/api/user-state'
import { listCreditProducts } from '@/lib/paycore/products'
import { getCreditBalance, getReadingPolicy } from '@/lib/credits/server'

const idr = (n: number) => `Rp${new Intl.NumberFormat('id-ID').format(n)}`

export default async function KreditPage() {
  const user = await getSessionUser()
  if (!user) redirect('/auth/login?next=%2Fkredit')

  const [balance, products, policy] = await Promise.all([
    getCreditBalance(user.id),
    listCreditProducts(),
    getReadingPolicy(),
  ])

  return (
    <AppShell>
      <main className="flex flex-col gap-6 px-5 pt-6 pb-8">
        <header className="flex items-center gap-3">
          <Link
            href="/profil"
            aria-label="Kembali ke profil"
            className="flex size-10 items-center justify-center rounded-full text-foreground hover:bg-muted"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </Link>
          <h1 className="font-serif text-2xl text-foreground">Kredit</h1>
        </header>

        <section className="flex items-center gap-4 rounded-2xl bg-card p-5">
          <span className="flex size-12 items-center justify-center rounded-xl bg-secondary text-gold">
            <Coins className="size-6" aria-hidden="true" />
          </span>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">Saldo kreditmu</span>
            <span className="font-serif text-3xl text-foreground">{balance}</span>
          </div>
        </section>

        <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
          {policy.freeChapters} bab pertama tiap cerita gratis. Bab berikutnya {policy.creditsPerChapter} kredit
          per bab. Kredit tak kedaluwarsa.
        </p>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-wide text-lavender">PILIH PAKET</h2>
          {products.length === 0 ? (
            <p className="rounded-2xl bg-card p-5 text-sm text-muted-foreground">
              Paket kredit belum tersedia. Coba lagi nanti.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {products.map((p) => (
                <li
                  key={p.productKey}
                  className="flex items-center justify-between gap-4 rounded-2xl bg-card p-4"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="text-sm font-semibold text-foreground">{p.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {p.credits} kredit · ≈ {Math.floor(p.credits / Math.max(policy.creditsPerChapter, 1))} bab
                    </span>
                    <span className="mt-1 text-sm font-medium text-foreground">{idr(p.priceIdr)}</span>
                  </div>
                  <BuyCreditButton productKey={p.productKey} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-center text-[11px] text-muted-foreground">
          Pembayaran diproses aman oleh PayCore. Kredit masuk otomatis setelah pembayaran berhasil.
        </p>
      </main>
    </AppShell>
  )
}

export const dynamic = 'force-dynamic'
