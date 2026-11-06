'use client'

import { useState } from 'react'
import { Download, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePwaInstall } from './use-pwa-install'
import { IosInstallDialog } from './ios-install-dialog'

export function PwaInstallBanner() {
  const { canInstall, isDismissed, promptInstall, dismiss } = usePwaInstall()
  const [showIosGuide, setShowIosGuide] = useState(false)
  const [isBusy, setIsBusy] = useState(false)

  if (!canInstall || isDismissed) {
    return null
  }

  async function handleInstall() {
    setIsBusy(true)
    try {
      const outcome = await promptInstall()
      if (outcome === 'ios') {
        setShowIosGuide(true)
      }
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <>
      <div
        role="region"
        aria-live="polite"
        aria-label="Saran pemasangan aplikasi"
        className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md rounded-2xl border border-primary/20 bg-card/95 p-4 shadow-2xl backdrop-blur"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="size-5" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <p id="pwa-install-title" className="text-sm font-semibold text-foreground">
              Pasang Lakoku di Layar Utama
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Akses cerita lebih cepat, layar penuh tanpa bilah peramban.
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Tutup saran pemasangan"
            className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={dismiss}
            className="h-8 rounded-xl px-3 text-xs text-muted-foreground hover:text-foreground"
          >
            Nanti
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isBusy}
            onClick={handleInstall}
            className="flex h-8 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Download className="size-3.5" aria-hidden="true" />
            <span>Pasang</span>
          </Button>
        </div>
      </div>

      <IosInstallDialog open={showIosGuide} onOpenChange={setShowIosGuide} />
    </>
  )
}
