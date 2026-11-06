# Pull-to-Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a native-feeling pull-to-refresh interaction on main navigation pages (Beranda, Jelajah, Koleksiku, Misi, Profil) using soft refresh (`router.refresh()`) styled consistently in both light and dark mode.

**Architecture:** Touch gesture helpers calculate dampened offset and trigger threshold. A custom hook (`usePullToRefresh`) manages touch listeners, lifecycle transitions, and Next.js router transitions. A container component (`PullToRefresh`) renders the floating pill indicator and is wired into `AppShell` only when `withNav === true`.

**Tech Stack:** Next.js 16 (React 19 App Router), TypeScript, Tailwind CSS, Lucide icons (`RotateCw`), Vitest.

## Global Constraints

- Branding: Semantic tokens `bg-card/90`, `border-border`, `text-primary`, `shadow-md`, `backdrop-blur` consistent across light and dark mode.
- Isolation: Active only when `withNav === true` in `components/app-shell.tsx`. Reader pages (`withNav === false`) never load or trigger pull-to-refresh.
- Scroll Safety: Only triggers when touch starts at top of page (`scrollY === 0`). Does not block native upward or downward scrolling.
- Zero New Dependencies: Uses standard React touch events and CSS transitions without external npm packages.

---

### Task 1: Core Physics & State Helpers

**Files:**
- Create: `lib/ui/pull-to-refresh-state.ts`
- Test: `tests/ui/pull-to-refresh-state.test.ts`

**Interfaces:**
- Produces:
  - `PULL_THRESHOLD_PX = 60`
  - `MAX_PULL_OFFSET_PX = 80`
  - `REFRESH_TIMEOUT_MS = 2500`
  - `calculatePullOffset(diffY: number): number`
  - `isPullThresholdMet(offset: number): boolean`
  - `calculateRotationDegrees(offset: number): number`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/ui/pull-to-refresh-state.test.ts
import { describe, expect, it } from 'vitest'
import {
  calculatePullOffset,
  isPullThresholdMet,
  calculateRotationDegrees,
  PULL_THRESHOLD_PX,
  MAX_PULL_OFFSET_PX,
  REFRESH_TIMEOUT_MS,
} from '@/lib/ui/pull-to-refresh-state'

describe('Pull-to-Refresh State Helpers', () => {
  it('has expected constants', () => {
    expect(PULL_THRESHOLD_PX).toBe(60)
    expect(MAX_PULL_OFFSET_PX).toBe(80)
    expect(REFRESH_TIMEOUT_MS).toBe(2500)
  })

  it('calculates pull offset with 0.4 damping and clamps to MAX_PULL_OFFSET_PX', () => {
    expect(calculatePullOffset(-20)).toBe(0)
    expect(calculatePullOffset(0)).toBe(0)
    expect(calculatePullOffset(50)).toBe(20) // 50 * 0.4
    expect(calculatePullOffset(150)).toBe(60) // 150 * 0.4
    expect(calculatePullOffset(300)).toBe(MAX_PULL_OFFSET_PX) // Clamped at 80
  })

  it('detects when threshold is met', () => {
    expect(isPullThresholdMet(0)).toBe(false)
    expect(isPullThresholdMet(59)).toBe(false)
    expect(isPullThresholdMet(60)).toBe(true)
    expect(isPullThresholdMet(80)).toBe(true)
  })

  it('calculates rotation degrees proportionally', () => {
    expect(calculateRotationDegrees(0)).toBe(0)
    expect(calculateRotationDegrees(30)).toBe(90) // (30 / 60) * 180
    expect(calculateRotationDegrees(60)).toBe(180)
    expect(calculateRotationDegrees(80)).toBe(240) // Clamped or proportional
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/ui/pull-to-refresh-state.test.ts`
Expected: FAIL (Cannot find module `@/lib/ui/pull-to-refresh-state`)

- [ ] **Step 3: Implement minimal code**

```typescript
// lib/ui/pull-to-refresh-state.ts
export const PULL_THRESHOLD_PX = 60
export const MAX_PULL_OFFSET_PX = 80
export const REFRESH_TIMEOUT_MS = 2500

/**
 * Menghitung jarak tarikan dengan redaman gesekan 0.4, batas maksimal 80px.
 */
export function calculatePullOffset(diffY: number): number {
  if (diffY <= 0) return 0
  return Math.min(MAX_PULL_OFFSET_PX, Math.round(diffY * 0.4))
}

/**
 * Menentukan apakah tarikan telah melewati ambang batas untuk memicu reload.
 */
export function isPullThresholdMet(offset: number): boolean {
  return offset >= PULL_THRESHOLD_PX
}

/**
 * Menghitung derajat rotasi panah indikator (proporsional terhadap jarak tarikan).
 */
export function calculateRotationDegrees(offset: number): number {
  if (offset <= 0) return 0
  return Math.round((offset / PULL_THRESHOLD_PX) * 180)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/ui/pull-to-refresh-state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/ui/pull-to-refresh-state.ts tests/ui/pull-to-refresh-state.test.ts
git commit -m "feat(ui): helpers kalkulasi fisika dan ambang batas pull to refresh"
```

---

### Task 2: React Hook `usePullToRefresh`

**Files:**
- Create: `components/ui/use-pull-to-refresh.ts`

**Interfaces:**
- Consumes:
  - `lib/ui/pull-to-refresh-state.ts`
- Produces:
  - `usePullToRefresh({ onRefresh, disabled }): { pullOffset, isRefreshing, containerProps }`

- [ ] **Step 1: Write `usePullToRefresh` hook**

```typescript
// components/ui/use-pull-to-refresh.ts
'use client'

import { useCallback, useRef, useState, useTransition } from 'react'
import {
  calculatePullOffset,
  isPullThresholdMet,
  REFRESH_TIMEOUT_MS,
} from '@/lib/ui/pull-to-refresh-state'

interface UsePullToRefreshOptions {
  onRefresh?: () => Promise<void> | void
  disabled?: boolean
}

export function usePullToRefresh({
  onRefresh,
  disabled = false,
}: UsePullToRefreshOptions = {}) {
  const [pullOffset, setPullOffset] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isPending, startTransition] = useTransition()

  const startYRef = useRef<number | null>(null)
  const isPullingRef = useRef(false)

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (disabled || isRefreshing || isPending) return
      // Hanya aktif jika posisi scroll berada di pucuk atas layar
      if (typeof window !== 'undefined' && window.scrollY > 0) return

      if (e.touches.length === 1) {
        startYRef.current = e.touches[0].clientY
        isPullingRef.current = true
      }
    },
    [disabled, isRefreshing, isPending],
  )

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isPullingRef.current || startYRef.current === null) return
      if (disabled || isRefreshing || isPending) return

      // Jika user scroll ke bawah sebelum menarik, batalkan
      if (typeof window !== 'undefined' && window.scrollY > 0) {
        isPullingRef.current = false
        setPullOffset(0)
        return
      }

      const currentY = e.touches[0].clientY
      const diffY = currentY - startYRef.current

      if (diffY > 0) {
        const offset = calculatePullOffset(diffY)
        setPullOffset(offset)
      } else {
        setPullOffset(0)
      }
    },
    [disabled, isRefreshing, isPending],
  )

  const executeRefresh = useCallback(() => {
    setIsRefreshing(true)
    setPullOffset(50) // Kunci indikator di posisi aktif saat berputar

    let completed = false
    const finish = () => {
      if (!completed) {
        completed = true
        setIsRefreshing(false)
        setPullOffset(0)
      }
    }

    // Timeout pengaman agar indikator tidak macet jika jaringan lambat
    const timer = setTimeout(finish, REFRESH_TIMEOUT_MS)

    try {
      startTransition(async () => {
        try {
          if (onRefresh) {
            await onRefresh()
          }
        } finally {
          clearTimeout(timer)
          finish()
        }
      })
    } catch {
      clearTimeout(timer)
      finish()
    }
  }, [onRefresh])

  const handleTouchEnd = useCallback(() => {
    if (!isPullingRef.current) return
    isPullingRef.current = false
    startYRef.current = null

    if (isPullThresholdMet(pullOffset) && !isRefreshing && !isPending) {
      executeRefresh()
    } else {
      setPullOffset(0)
    }
  }, [pullOffset, isRefreshing, isPending, executeRefresh])

  return {
    pullOffset,
    isRefreshing: isRefreshing || isPending,
    containerProps: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      onTouchCancel: handleTouchEnd,
    },
  }
}
```

- [ ] **Step 2: Typecheck codebase**

Run: `pnpm typecheck`
Expected: PASS with 0 errors.

- [ ] **Step 3: Commit**

```bash
git add components/ui/use-pull-to-refresh.ts
git commit -m "feat(ui): hook usePullToRefresh untuk mengelola gestur sentuhan"
```

---

### Task 3: Component `PullToRefresh` Container & Indicator

**Files:**
- Create: `components/ui/pull-to-refresh.tsx`

**Interfaces:**
- Consumes:
  - `components/ui/use-pull-to-refresh.ts`
  - `lib/ui/pull-to-refresh-state.ts`
- Produces:
  - `PullToRefresh({ children, onRefresh }): JSX.Element`

- [ ] **Step 1: Write `PullToRefresh` component**

```typescript
// components/ui/pull-to-refresh.tsx
'use client'

import { type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCw } from 'lucide-react'
import { usePullToRefresh } from './use-pull-to-refresh'
import { calculateRotationDegrees } from '@/lib/ui/pull-to-refresh-state'

interface PullToRefreshProps {
  children: ReactNode
  onRefresh?: () => Promise<void> | void
  disabled?: boolean
}

export function PullToRefresh({
  children,
  onRefresh,
  disabled = false,
}: PullToRefreshProps) {
  const router = useRouter()

  const handleRefresh = onRefresh ?? (() => router.refresh())
  const { pullOffset, isRefreshing, containerProps } = usePullToRefresh({
    onRefresh: handleRefresh,
    disabled,
  })

  const isVisible = pullOffset > 0 || isRefreshing
  const rotation = calculateRotationDegrees(pullOffset)

  return (
    <div {...containerProps} className="relative flex flex-1 flex-col">
      {/* Floating Indicator Pill */}
      <div
        aria-hidden="true"
        style={{
          transform: `translateY(${pullOffset}px)`,
          opacity: isVisible ? Math.min(1, pullOffset / 30) : 0,
        }}
        className={`pointer-events-none fixed inset-x-0 top-3 z-30 mx-auto flex size-10 items-center justify-center rounded-full border border-border bg-card/90 shadow-md backdrop-blur transition-transform ${
          !pullOffset ? 'duration-300' : 'duration-75'
        }`}
      >
        <RotateCw
          style={{
            transform: !isRefreshing ? `rotate(${rotation}deg)` : undefined,
          }}
          className={`size-4 text-primary ${isRefreshing ? 'animate-spin' : 'transition-transform'}`}
        />
      </div>

      {children}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck codebase**

Run: `pnpm typecheck`
Expected: PASS with 0 errors.

- [ ] **Step 3: Commit**

```bash
git add components/ui/pull-to-refresh.tsx
git commit -m "feat(ui): komponen visual container dan pill pull to refresh"
```

---

### Task 4: Wire into `AppShell`

**Files:**
- Modify: `components/app-shell.tsx`

- [ ] **Step 1: Wire `PullToRefresh` into `components/app-shell.tsx`**

```typescript
// components/app-shell.tsx
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
```

- [ ] **Step 2: Typecheck and unit tests**

Run:
```bash
pnpm typecheck
pnpm exec vitest run tests/ui/pull-to-refresh-state.test.ts
```
Expected: PASS with 0 errors.

- [ ] **Step 3: Commit**

```bash
git add components/app-shell.tsx
git commit -m "feat(app-shell): bungkus navigasi utama dengan pull to refresh"
```

---

## Self-Review Checklist

- Spec coverage: All requirements met (physics helpers, hook with friction & timeout, indicator with brand tokens light/dark, AppShell conditional wiring).
- No placeholders: All code blocks contain complete, copy-pasteable TypeScript code.
- Type consistency: Signatures match between `pull-to-refresh-state.ts`, `use-pull-to-refresh.ts`, `pull-to-refresh.tsx`, and `app-shell.tsx`.
