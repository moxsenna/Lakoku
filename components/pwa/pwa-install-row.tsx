'use client'

import { useState } from 'react'
import { Smartphone, ChevronRight } from 'lucide-react'
import { usePwaInstall } from './use-pwa-install'
import { IosInstallDialog } from './ios-install-dialog'

export function PwaInstallRow() {
  const { mounted, isStandalone, isAndroidApp, promptInstall } = usePwaInstall()
  const [showIosGuide, setShowIosGuide] = useState(false)
  const [isBusy, setIsBusy] = useState(false)

  // Jangan tampilkan jika sudah standalone atau di dalam wrapper APK Android
  if (!mounted || isStandalone || isAndroidApp) {
    return null
  }

  async function handleClick() {
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
      <button
        type="button"
        disabled={isBusy}
        onClick={handleClick}
        className="flex w-full items-center gap-4 rounded-2xl bg-card p-4 text-left transition-colors hover:bg-secondary/50"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
          <Smartphone className="size-5" aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium text-foreground">Pasang Aplikasi</span>
          <span className="text-xs text-muted-foreground">
            Akses langsung dari layar utama tanpa bilah peramban
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>

      <IosInstallDialog open={showIosGuide} onOpenChange={setShowIosGuide} />
    </>
  )
}
