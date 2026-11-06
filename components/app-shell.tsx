import type { ReactNode } from 'react'
import { BottomNav } from '@/components/bottom-nav'
import { PwaInstallBanner } from '@/components/pwa/pwa-install-banner'
import { PullToRefresh } from '@/components/ui/pull-to-refresh'

export function AppShell({
  children,
  withNav = true,
}: {
  children: ReactNode
  withNav?: boolean
}) {
  const content = (
    <div
      className={`flex flex-1 flex-col ${withNav ? 'pb-[calc(6rem+env(safe-area-inset-bottom))]' : ''}`}
    >
      {children}
    </div>
  )

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-background pt-[env(safe-area-inset-top)]">
      {withNav ? <PullToRefresh>{content}</PullToRefresh> : content}
      {withNav && (
        <>
          <BottomNav />
          <PwaInstallBanner />
        </>
      )}
    </div>
  )
}
