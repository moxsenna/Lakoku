'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { RefreshCw, Home, AlertCircle } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const isServerActionMismatch =
    error.message?.includes('Failed to find Server Action') ||
    error.message?.includes('older or newer deployment')

  useEffect(() => {
    if (isServerActionMismatch) {
      const key = 'lakoku:last_action_reload'
      const last = sessionStorage.getItem(key)
      const now = Date.now()
      if (!last || now - Number(last) > 10_000) {
        sessionStorage.setItem(key, String(now))
        window.location.reload()
      }
    }
  }, [isServerActionMismatch])

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
        <AlertCircle className="h-7 w-7" />
      </div>
      <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">
        Halaman Belum Bisa Dimuat
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {isServerActionMismatch
          ? 'Versi aplikasi baru telah diperbarui. Muat ulang halaman untuk melanjutkan.'
          : 'Terjadi kendala sementara saat memuat data. Silakan coba lagi.'}
      </p>
      <div className="mt-6 flex w-full flex-col gap-3">
        <Button
          onClick={() => {
            if (isServerActionMismatch) {
              window.location.reload()
            } else {
              reset()
            }
          }}
          className="w-full gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          {isServerActionMismatch ? 'Muat Ulang Halaman' : 'Coba Lagi'}
        </Button>
        <Link href="/" className={cn(buttonVariants({ variant: 'outline' }), 'w-full gap-2')}>
          <Home className="h-4 w-4" />
          Kembali ke Beranda
        </Link>
      </div>
    </main>
  )
}
