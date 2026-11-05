import type { ReactNode } from 'react'
import { BottomNav } from '@/components/bottom-nav'
import { PwaInstallBanner } from '@/components/pwa/pwa-install-banner'

export function AppShell({
  children,
  withNav = true,
}: {
  children: ReactNode
  withNav?: boolean
}) {
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-background pt-[env(safe-area-inset-top)]">
      <div
        className={`flex flex-1 flex-col ${withNav ? 'pb-[calc(6rem+env(safe-area-inset-bottom))]' : ''}`}
      >
        {children}
      </div>
      {withNav && (
        <>
          <BottomNav />
          <PwaInstallBanner />
        </>
      )}
    </div>
  )
}
