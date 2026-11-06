'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
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
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const wasPendingRef = useRef(false)

  const finish = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setIsRefreshing(false)
    setPullOffset(0)
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  useEffect(() => {
    if (wasPendingRef.current && !isPending && isRefreshing) {
      finish()
    }
    wasPendingRef.current = isPending
  }, [isPending, isRefreshing, finish])

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (disabled || isRefreshing || isPending) return
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

      if (typeof window !== 'undefined' && window.scrollY > 0) {
        isPullingRef.current = false
        setPullOffset(0)
        return
      }

      const currentY = e.touches[0].clientY
      const diffY = currentY - startYRef.current

      if (diffY > 0) {
        setPullOffset(calculatePullOffset(diffY))
      } else {
        setPullOffset(0)
      }
    },
    [disabled, isRefreshing, isPending],
  )

  const executeRefresh = useCallback(() => {
    setIsRefreshing(true)
    setPullOffset(50)

    timerRef.current = setTimeout(finish, REFRESH_TIMEOUT_MS)

    try {
      startTransition(() => {
        const result = onRefresh?.()
        if (result && typeof (result as Promise<void>).then === 'function') {
          void (result as Promise<void>).finally(finish)
        }
      })
    } catch {
      finish()
    }
  }, [onRefresh, finish])

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
