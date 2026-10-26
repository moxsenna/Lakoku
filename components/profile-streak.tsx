'use client'

import { useSyncExternalStore } from 'react'
import { Flame } from 'lucide-react'
import {
  displayStreak,
  getReadingStreak,
  subscribeStreak,
} from '@/lib/reading-streak'

const subscribe = (cb: () => void) => subscribeStreak(cb)
const getSnapshot = () => displayStreak(getReadingStreak())
const getServerSnapshot = () => 0

/** Kartu streak baca di profil — perangkat ini, tanpa sinkronisasi. */
export function ProfileStreak() {
  const days = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return (
    <div className="flex flex-col items-center gap-1 rounded-2xl bg-card p-4 text-center">
      <Flame className="size-5 text-gold" aria-hidden="true" />
      <span className="font-serif text-2xl text-foreground">{days}</span>
      <span className="text-[11px] text-muted-foreground">Hari Baca Beruntun</span>
    </div>
  )
}
