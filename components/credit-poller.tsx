'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

const MAX_POLLS = 5
const POLL_INTERVAL_MS = 3000

async function fetchBalance(): Promise<number | null> {
  const res = await fetch('/api/credits/balance', { cache: 'no-store' })
  if (!res.ok) return null
  const data = (await res.json().catch(() => ({}))) as { balance?: number }
  return typeof data.balance === 'number' ? data.balance : null
}

export function CreditPoller({ initialBalance }: { initialBalance: number | null }) {
  const [balance, setBalance] = useState<number | null>(initialBalance)
  const [initial] = useState(initialBalance)
  const [polls, setPolls] = useState(0)
  const [manualLoading, setManualLoading] = useState(false)

  useEffect(() => {
    let count = 0
    const timer = window.setInterval(async () => {
      count += 1
      setPolls(count)
      const next = await fetchBalance()
      if (next != null) setBalance(next)
      if (count >= MAX_POLLS) window.clearInterval(timer)
    }, POLL_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [])

  async function refresh() {
    setManualLoading(true)
    const next = await fetchBalance()
    if (next != null) setBalance(next)
    setManualLoading(false)
  }

  const finishedUnchanged = polls >= MAX_POLLS && balance === initial

  return (
    <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
      {balance != null && (
        <span>
          Saldo terbaru: <strong className="text-foreground">{balance}</strong>
        </span>
      )}
      {polls < MAX_POLLS ? (
        <span>Memeriksa saldo otomatis {polls}/{MAX_POLLS}</span>
      ) : (
        <span>Pemeriksaan otomatis selesai.</span>
      )}
      {finishedUnchanged && (
        <button
          type="button"
          onClick={refresh}
          disabled={manualLoading}
          className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-border px-3 text-xs font-semibold text-foreground transition-colors hover:bg-card disabled:opacity-60"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          {manualLoading ? 'Memeriksa...' : 'Refresh saldo'}
        </button>
      )}
    </div>
  )
}
