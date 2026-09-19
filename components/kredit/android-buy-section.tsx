'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  buildVerifyBody,
  interpretOrderError,
  interpretVerifyResponse,
  purchaseResultMessage,
  type ApprovedPurchaseInfo,
} from '@/lib/play-billing/purchase-client'

interface AndroidProduct {
  productKey: string
  playSku: string | null
  name: string
  referencePriceIdr: number
  baseCredits: number
  displayBonusCredits: number
  displayTotalCredits: number
  marketingBadge: string | null
}

/** Bentuk minimal store cordova-plugin-purchase yang dipakai komponen ini. */
interface BillingStore {
  register: (products: Array<{ id: string; type: string; platform: string }>) => void
  initialize: () => void
  order: (productId: string) => Promise<{ isError?: boolean; code?: string | number } | null>
  when: () => {
    approved: (cb: (tx: {
      products: Array<{ id: string }>
      purchaseToken?: string
      transactionId?: string
      finish: () => void
    }) => void) => void
  }
}

function getBillingStore(): BillingStore | null {
  const w = window as unknown as { CdvPurchase?: { store: BillingStore } }
  return w.CdvPurchase?.store ?? null
}

const idr = (n: number) => `Rp${new Intl.NumberFormat('id-ID').format(n)}`

/**
 * Bagian beli khusus aplikasi Android: katalog kanal android + purchase native
 * Play Billing. Dipakai hanya bila UA request mengandung marker aplikasi.
 */
export function AndroidBuySection({ products }: { products: AndroidProduct[] }) {
  const router = useRouter()
  const [buyingSku, setBuyingSku] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [storeMissing, setStoreMissing] = useState(false)
  const registeredRef = useRef(false)

  useEffect(() => {
    const store = getBillingStore()
    if (!store) {
      setStoreMissing(true)
      return
    }
    if (registeredRef.current) return
    registeredRef.current = true
    try {
      store.register(
        products
          .filter((p) => p.playSku)
          .map((p) => ({ id: p.playSku as string, type: 'consumable', platform: 'google_play' })),
      )
      store.initialize()
      store.when().approved((tx) => {
        void (async () => {
          const info: ApprovedPurchaseInfo = {
            productId: tx.products[0]?.id ?? '',
            purchaseToken: tx.purchaseToken ?? '',
            orderId: tx.transactionId ?? null,
          }
          try {
            const res = await fetch('/api/play-billing/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(buildVerifyBody(info)),
            })
            const outcome = interpretVerifyResponse(await res.json().catch(() => null))
            if (outcome.ok) {
              tx.finish()
              setMessage(
                outcome.alreadyGranted
                  ? `Lakoin sudah masuk sebelumnya (+${outcome.totalCredits}).`
                  : `Pembayaran berhasil! +${outcome.totalCredits} Lakoin masuk.`,
              )
              router.refresh()
            } else {
              setMessage('Pembayaran belum terverifikasi. Coba lagi nanti.')
            }
          } catch {
            setMessage('Gagal terhubung. Coba lagi.')
          } finally {
            setBuyingSku(null)
          }
        })()
      })
    } catch {
      setStoreMissing(true)
    }
  }, [products, router])

  const buy = useCallback(async (playSku: string) => {
    const store = getBillingStore()
    if (!store) {
      setStoreMissing(true)
      return
    }
    setBuyingSku(playSku)
    setMessage(null)
    try {
      const result = await store.order(playSku)
      if (result?.isError) {
        const mapped = interpretOrderError(result.code)
        setMessage(purchaseResultMessage(mapped))
        setBuyingSku(null)
        return
      }
      // Sukses: hasil final datang lewat handler approved (verify → finish).
    } catch {
      setMessage('Gagal terhubung. Coba lagi.')
      setBuyingSku(null)
    }
  }, [])

  if (storeMissing) {
    return (
      <p role="alert" className="rounded-2xl bg-card p-5 text-sm text-muted-foreground">
        Pembelian dalam aplikasi belum tersedia di versi ini. Perbarui aplikasi ke versi terbaru.
      </p>
    )
  }

  if (products.length === 0) {
    return (
      <p className="rounded-2xl bg-card p-5 text-sm text-muted-foreground">
        Paket Lakoin belum tersedia. Coba lagi nanti.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {products.map((p) => (
          <li
            key={p.productKey}
            className="flex items-center justify-between gap-4 rounded-2xl bg-card p-4"
          >
            <div className="flex min-w-0 flex-col">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{p.name}</span>
                {p.marketingBadge && (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                    {p.marketingBadge}
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {p.baseCredits} Lakoin
                {p.displayBonusCredits > 0 && (
                  <span className="text-emerald-600 dark:text-emerald-400">
                    {' + bonus '}{p.displayBonusCredits}
                  </span>
                )}
              </span>
              <span className="mt-1 text-sm font-medium text-foreground">{idr(p.referencePriceIdr)}</span>
            </div>
            <div className="flex flex-col items-end gap-1">
              <button
                type="button"
                onClick={() => p.playSku && void buy(p.playSku)}
                disabled={buyingSku !== null || !p.playSku}
                className="min-h-10 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {buyingSku === p.playSku ? 'Memproses…' : 'Beli'}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {message && (
        <p role="status" className="text-center text-sm text-foreground">
          {message}
        </p>
      )}
      <p className="text-center text-[11px] text-muted-foreground">
        Pembayaran diproses aman oleh Google Play. Lakoin masuk otomatis setelah pembayaran berhasil.
      </p>
    </div>
  )
}
