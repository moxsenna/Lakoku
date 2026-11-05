# PWA Install Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an in-app PWA install experience for Lakoku readers including a floating bottom banner, a permanent row in profile settings, and step-by-step instructions for iOS Safari.

**Architecture:** Centralized helper & hook (`usePwaInstall`) managing browser install events, standalone mode detection, platform checks, and dismiss cooldown; UI components consume the hook to trigger native Chromium installation or iOS modal guidance.

**Tech Stack:** Next.js (React 19), TypeScript, Tailwind CSS, Lucide icons, Vitest.

## Global Constraints

- Brand Guard: Tanpa jargon teknis ("PWA", "Service Worker", "Cache"). Bahasa Indonesia ramah pembaca ("Pasang Lakoku", "Layar Utama").
- Mobile-First: Aman notch dan gesture bar, berada di atas BottomNav.
- Non-Intrusif: Cooldown tombol "Nanti" selama 7 hari via `localStorage`.
- Sembunyi otomatis jika sudah standalone atau di dalam wrapper Android Capacitor (`LakokuAndroid`).
- Zero Build Friction: Native browser APIs, tanpa dependency build tambahan.

---

### Task 1: Core PWA State Detection Helpers

**Files:**
- Create: `lib/pwa/install-state.ts`
- Test: `tests/pwa/install-state.test.ts`

**Interfaces:**
- Produces:
  - `isStandaloneDisplay(): boolean`
  - `isAndroidCapacitorApp(): boolean`
  - `isIosDevice(): boolean`
  - `isInstallDismissed(storage: Storage | null, now?: number): boolean`
  - `dismissInstall(storage: Storage | null, now?: number): void`
  - `PWA_DISMISS_KEY: string`
  - `PWA_DISMISS_DURATION_MS: number`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/pwa/install-state.test.ts
import { describe, expect, it } from 'vitest'
import {
  isInstallDismissed,
  dismissInstall,
  PWA_DISMISS_KEY,
  PWA_DISMISS_DURATION_MS,
  isStandaloneDisplay,
  isAndroidCapacitorApp,
  isIosDevice,
} from '@/lib/pwa/install-state'

describe('PWA Install State Helpers', () => {
  it('detects dismissed status within 7 days', () => {
    const mockStorage: Record<string, string> = {}
    const storage = {
      getItem: (k: string) => mockStorage[k] ?? null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v
      },
      removeItem: (k: string) => {
        delete mockStorage[k]
      },
      clear: () => {},
      key: () => null,
      length: 0,
    } as Storage

    const now = 1_700_000_000_000
    expect(isInstallDismissed(storage, now)).toBe(false)

    dismissInstall(storage, now)
    expect(isInstallDismissed(storage, now)).toBe(true)

    // After 6 days, still dismissed
    expect(isInstallDismissed(storage, now + 6 * 24 * 60 * 60 * 1000)).toBe(true)

    // After 8 days, cooldown expired
    expect(isInstallDismissed(storage, now + 8 * 24 * 60 * 60 * 1000)).toBe(false)
  })

  it('detects Android Capacitor user agent', () => {
    expect(isAndroidCapacitorApp('Mozilla/5.0 LakokuAndroid Mobile')).toBe(true)
    expect(isAndroidCapacitorApp('Mozilla/5.0 Chrome/120.0 Mobile')).toBe(false)
  })

  it('detects iOS devices from user agent', () => {
    expect(isIosDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true)
    expect(isIosDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe(true)
    expect(isIosDevice('Mozilla/5.0 (Linux; Android 14)')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/pwa/install-state.test.ts`
Expected: FAIL (Cannot find module `@/lib/pwa/install-state`)

- [ ] **Step 3: Implement minimal code**

```typescript
// lib/pwa/install-state.ts
export const PWA_DISMISS_KEY = 'lakoku-pwa-dismissed-at'
export const PWA_DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000 // 7 hari

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  const isMatchMediaStandalone = window.matchMedia('(display-mode: standalone)').matches
  // iOS Safari legacy check
  const isIosNavigatorStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true
  return isMatchMediaStandalone || isIosNavigatorStandalone
}

export function isAndroidCapacitorApp(ua?: string): boolean {
  const targetUa = ua ?? (typeof window !== 'undefined' ? window.navigator.userAgent : '')
  return targetUa.includes('LakokuAndroid')
}

export function isIosDevice(ua?: string): boolean {
  const targetUa = ua ?? (typeof window !== 'undefined' ? window.navigator.userAgent : '')
  return /iPad|iPhone|iPod/.test(targetUa)
}

export function isInstallDismissed(
  storage: Storage | null,
  now: number = Date.now(),
): boolean {
  if (!storage) return false
  try {
    const raw = storage.getItem(PWA_DISMISS_KEY)
    if (!raw) return false
    const dismissedAt = Number.parseInt(raw, 10)
    if (Number.isNaN(dismissedAt)) return false
    return now - dismissedAt < PWA_DISMISS_DURATION_MS
  } catch {
    return false
  }
}

export function dismissInstall(
  storage: Storage | null,
  now: number = Date.now(),
): void {
  if (!storage) return
  try {
    storage.setItem(PWA_DISMISS_KEY, now.toString())
  } catch {
    // Ignore quota or private mode errors
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/pwa/install-state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/pwa/install-state.ts tests/pwa/install-state.test.ts
git commit -m "feat(pwa): helpers status deteksi dan cooldown dismiss pwa"
```

---

### Task 2: React Hook `usePwaInstall`

**Files:**
- Create: `components/pwa/use-pwa-install.ts`

**Interfaces:**
- Consumes:
  - `lib/pwa/install-state.ts` (`isStandaloneDisplay`, `isAndroidCapacitorApp`, `isIosDevice`, `isInstallDismissed`, `dismissInstall`)
- Produces:
  - `interface BeforeInstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }`
  - `usePwaInstall(): { canInstall: boolean; isStandalone: boolean; isIos: boolean; isDismissed: boolean; promptInstall: () => Promise<'accepted' | 'dismissed' | 'ios' | 'unavailable'>; dismiss: () => void }`

- [ ] **Step 1: Write `usePwaInstall` implementation**

```typescript
// components/pwa/use-pwa-install.ts
'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  isStandaloneDisplay,
  isAndroidCapacitorApp,
  isIosDevice,
  isInstallDismissed,
  dismissInstall,
} from '@/lib/pwa/install-state'

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isStandalone, setIsStandalone] = useState(false)
  const [isAndroidApp, setIsAndroidApp] = useState(false)
  const [isIos, setIsIos] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const standalone = isStandaloneDisplay()
    const androidApp = isAndroidCapacitorApp()
    const ios = isIosDevice()
    const dismissed = isInstallDismissed(typeof window !== 'undefined' ? window.localStorage : null)

    setIsStandalone(standalone)
    setIsAndroidApp(androidApp)
    setIsIos(ios)
    setIsDismissed(dismissed)

    if (standalone || androidApp) return

    function handleBeforeInstallPrompt(e: Event) {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }

    function handleAppInstalled() {
      setDeferredPrompt(null)
      setIsStandalone(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'ios' | 'unavailable'> => {
    if (isIos && !isStandalone) {
      return 'ios'
    }

    if (!deferredPrompt) {
      return 'unavailable'
    }

    try {
      await deferredPrompt.prompt()
      const choice = await deferredPrompt.userChoice
      if (choice.outcome === 'accepted') {
        setDeferredPrompt(null)
        setIsStandalone(true)
      }
      return choice.outcome
    } catch {
      return 'unavailable'
    }
  }, [deferredPrompt, isIos, isStandalone])

  const dismiss = useCallback(() => {
    if (typeof window !== 'undefined') {
      dismissInstall(window.localStorage)
    }
    setIsDismissed(true)
  }, [])

  const canInstall =
    mounted &&
    !isStandalone &&
    !isAndroidApp &&
    (deferredPrompt !== null || isIos)

  return {
    mounted,
    canInstall,
    isStandalone,
    isIos,
    isDismissed,
    hasPrompt: deferredPrompt !== null,
    promptInstall,
    dismiss,
  }
}
```

- [ ] **Step 2: Typecheck codebase**

Run: `pnpm typecheck`
Expected: PASS with 0 errors.

- [ ] **Step 3: Commit**

```bash
git add components/pwa/use-pwa-install.ts
git commit -m "feat(pwa): hook usePwaInstall untuk kelola event install dan platform"
```

---

### Task 3: iOS Install Guide Dialog Component

**Files:**
- Create: `components/pwa/ios-install-dialog.tsx`

**Interfaces:**
- Produces:
  - `IosInstallDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): JSX.Element`

- [ ] **Step 1: Write `IosInstallDialog` component**

```typescript
// components/pwa/ios-install-dialog.tsx
'use client'

import { Share, PlusSquare, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface IosInstallDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function IosInstallDialog({ open, onOpenChange }: IosInstallDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-3xl border-border bg-card p-6 text-foreground">
        <DialogHeader className="text-left">
          <DialogTitle className="font-serif text-lg text-foreground">
            Pasang di Layar Utama iPhone/iPad
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Buka Lakoku langsung dari layar utama tanpa bilah navigasi Safari.
          </DialogDescription>
        </DialogHeader>

        <div className="my-3 space-y-4 text-xs text-foreground">
          <div className="flex items-start gap-3 rounded-2xl bg-secondary/60 p-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-background text-primary">
              <Share className="size-4" aria-hidden="true" />
            </span>
            <div>
              <p className="font-semibold text-foreground">1. Ketuk tombol Bagikan</p>
              <p className="mt-0.5 text-muted-foreground">
                Tombol panah ke atas di bilah menu bawah Safari.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-2xl bg-secondary/60 p-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-background text-primary">
              <PlusSquare className="size-4" aria-hidden="true" />
            </span>
            <div>
              <p className="font-semibold text-foreground">2. Tambah ke Layar Utama</p>
              <p className="mt-0.5 text-muted-foreground">
                Gulir ke bawah menu dan ketuk <strong>Tambah ke Layar Utama</strong> (Add to Home Screen).
              </p>
            </div>
          </div>
        </div>

        <Button
          type="button"
          onClick={() => onOpenChange(false)}
          className="w-full rounded-2xl bg-primary text-xs font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Mengerti
        </Button>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Typecheck codebase**

Run: `pnpm typecheck`
Expected: PASS with 0 errors.

- [ ] **Step 3: Commit**

```bash
git add components/pwa/ios-install-dialog.tsx
git commit -m "feat(pwa): dialog panduan instalasi ios safari"
```

---

### Task 4: Floating Install Banner Component

**Files:**
- Create: `components/pwa/pwa-install-banner.tsx`

**Interfaces:**
- Consumes:
  - `components/pwa/use-pwa-install.ts`
  - `components/pwa/ios-install-dialog.tsx`
- Produces:
  - `PwaInstallBanner(): JSX.Element | null`

- [ ] **Step 1: Write `PwaInstallBanner` component**

```typescript
// components/pwa/pwa-install-banner.tsx
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
        role="dialog"
        aria-live="polite"
        className="fixed inset-x-4 bottom-20 z-40 mx-auto max-w-md rounded-2xl border border-primary/20 bg-card/95 p-4 shadow-2xl backdrop-blur"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="size-5" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">
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
```

- [ ] **Step 2: Typecheck codebase**

Run: `pnpm typecheck`
Expected: PASS with 0 errors.

- [ ] **Step 3: Commit**

```bash
git add components/pwa/pwa-install-banner.tsx
git commit -m "feat(pwa): banner melayang saran pemasangan aplikasi"
```

---

### Task 5: Profile Settings Install Row Component

**Files:**
- Create: `components/pwa/pwa-install-row.tsx`

**Interfaces:**
- Consumes:
  - `components/pwa/use-pwa-install.ts`
  - `components/pwa/ios-install-dialog.tsx`
- Produces:
  - `PwaInstallRow(): JSX.Element | null`

- [ ] **Step 1: Write `PwaInstallRow` component**

```typescript
// components/pwa/pwa-install-row.tsx
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
```

- [ ] **Step 2: Typecheck codebase**

Run: `pnpm typecheck`
Expected: PASS with 0 errors.

- [ ] **Step 3: Commit**

```bash
git add components/pwa/pwa-install-row.tsx
git commit -m "feat(pwa): tombol pasang aplikasi di menu profil"
```

---

### Task 6: Wire into AppShell Layout & Profile Settings

**Files:**
- Modify: `components/app-shell.tsx:1-22`
- Modify: `components/profile-settings.tsx:20-65`

- [ ] **Step 1: Wire `PwaInstallBanner` into `components/app-shell.tsx`**

Tambahkan `import { PwaInstallBanner } from '@/components/pwa/pwa-install-banner'` dan letakkan `<PwaInstallBanner />` tepat saat `withNav === true`.

- [ ] **Step 2: Wire `PwaInstallRow` into `components/profile-settings.tsx`**

Tambahkan `import { PwaInstallRow } from '@/components/pwa/pwa-install-row'` dan tempatkan `<PwaInstallRow />` di dalam grup Pengaturan.

- [ ] **Step 3: Run typecheck and unit tests**

Run:
```bash
pnpm typecheck
pnpm exec vitest run tests/pwa/install-state.test.ts
```
Expected: PASS with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add components/app-shell.tsx components/profile-settings.tsx
git commit -m "feat(pwa): pasang banner di app shell dan tombol di profil"
```

---

## Self-Review Checklist

- Spec coverage: All 5 requirements from spec covered (usePwaInstall, PwaInstallBanner, PwaInstallRow, IosInstallDialog, integration into layout & profile).
- No placeholders: All code blocks contain complete, copy-pasteable TypeScript code.
- Type consistency: Consistent signatures across `lib/pwa/install-state.ts`, `use-pwa-install.ts`, and UI components.
