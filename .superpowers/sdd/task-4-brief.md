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
