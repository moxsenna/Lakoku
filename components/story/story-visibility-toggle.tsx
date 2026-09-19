'use client'

import { useState } from 'react'
import { Globe, Lock, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { setStoryVisibility } from '@/lib/api/client'
import { cn } from '@/lib/utils'

export interface StoryVisibilityToggleProps {
  storyId: string
  initialVisibility: 'private' | 'public' | 'unlisted' | string
  owned?: boolean
  className?: string
}

export function StoryVisibilityToggle({
  storyId,
  initialVisibility,
  owned = false,
  className,
}: StoryVisibilityToggleProps) {
  const [visibility, setVisibility] = useState<'private' | 'public'>(
    initialVisibility === 'public' ? 'public' : 'private',
  )
  const [isPending, setIsPending] = useState(false)

  if (!owned) {
    return null
  }

  const handleToggle = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (isPending) return

    const previous = visibility
    const next = previous === 'public' ? 'private' : 'public'

    // Optimistic update
    setVisibility(next)
    setIsPending(true)

    try {
      const res = await setStoryVisibility(storyId, next)
      if (!res.ok) {
        setVisibility(previous)
        toast.error(res.error || 'Gagal mengubah visibilitas cerita.')
      } else {
        toast.success(
          next === 'public' ? 'Cerita diatur ke Publik.' : 'Cerita diatur ke Privat.',
        )
      }
    } catch {
      setVisibility(previous)
      toast.error('Gagal mengubah visibilitas cerita.')
    } finally {
      setIsPending(false)
    }
  }

  const isPublic = visibility === 'public'

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isPublic}
      aria-label={`Ubah visibilitas cerita. Saat ini ${isPublic ? 'Publik' : 'Privat'}`}
      disabled={isPending}
      onClick={handleToggle}
      className={cn(
        'inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isPublic
          ? 'bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25 dark:text-emerald-400'
          : 'bg-secondary text-muted-foreground hover:bg-secondary/80',
        isPending && 'cursor-not-allowed opacity-70',
        className,
      )}
    >
      {isPending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      ) : isPublic ? (
        <Globe className="size-3.5" aria-hidden="true" />
      ) : (
        <Lock className="size-3.5" aria-hidden="true" />
      )}
      <span>{isPublic ? 'Publik' : 'Privat'}</span>
    </button>
  )
}
