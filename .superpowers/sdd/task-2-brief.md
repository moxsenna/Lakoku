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

