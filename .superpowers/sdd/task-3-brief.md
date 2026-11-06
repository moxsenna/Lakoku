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

