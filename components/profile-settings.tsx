'use client'

import { useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import {
  Check,
  ChevronRight,
  KeyRound,
  Minus,
  Moon,
  Palette,
  Plus,
  ShieldCheck,
  Sun,
  Ticket,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useReaderFontSize } from '@/components/font-size-provider'

const subscribeToMounted = () => () => {}
const getMountedSnapshot = () => true
const getServerMountedSnapshot = () => false

const disabledSettings = [
  { icon: Ticket, label: 'Akses Cerita', desc: 'Segera hadir' },
  { icon: ShieldCheck, label: 'Batas Konten', desc: 'Segera hadir' },
  { icon: KeyRound, label: 'Akun dan Privasi', desc: 'Segera hadir' },
]

export function ProfileSettings() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const { fontSize, decreaseFontSize, increaseFontSize } = useReaderFontSize()
  const mounted = useSyncExternalStore(
    subscribeToMounted,
    getMountedSnapshot,
    getServerMountedSnapshot,
  )

  const activeTheme = mounted ? (theme ?? resolvedTheme ?? 'dark') : 'dark'

  return (
    <section aria-labelledby="pengaturan-heading" className="flex flex-col gap-3">
      <h2 id="pengaturan-heading" className="text-sm font-semibold tracking-wide text-lavender">
        PENGATURAN
      </h2>
      <ul className="flex flex-col overflow-hidden rounded-2xl bg-card">
        <li>
          <div className="flex flex-col gap-4 px-5 py-4">
            <div className="flex items-start gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                <Palette className="size-5" aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-foreground">Tema dan Ukuran Teks</span>
                <span className="text-xs text-muted-foreground">Preferensi ini tersimpan di perangkatmu</span>
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tema aplikasi">
              <button
                type="button"
                onClick={() => setTheme('dark')}
                disabled={!mounted}
                aria-pressed={activeTheme === 'dark'}
                className={cn(
                  'flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-semibold transition-colors disabled:opacity-60',
                  activeTheme === 'dark'
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-secondary/50',
                )}
              >
                <Moon className="size-4" aria-hidden="true" />
                Gelap
                {activeTheme === 'dark' && <Check className="size-3.5" aria-hidden="true" />}
              </button>
              <button
                type="button"
                onClick={() => setTheme('light')}
                disabled={!mounted}
                aria-pressed={activeTheme === 'light'}
                className={cn(
                  'flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-semibold transition-colors disabled:opacity-60',
                  activeTheme === 'light'
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-secondary/50',
                )}
              >
                <Sun className="size-4" aria-hidden="true" />
                Terang
                {activeTheme === 'light' && <Check className="size-3.5" aria-hidden="true" />}
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
              <span className="text-xs font-medium text-muted-foreground">Ukuran teks reader</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={decreaseFontSize}
                  aria-label="Perkecil teks reader"
                  className="flex size-9 items-center justify-center rounded-full bg-muted text-foreground"
                >
                  <Minus className="size-4" aria-hidden="true" />
                </button>
                <span className="w-7 text-center text-sm text-foreground">{fontSize}</span>
                <button
                  type="button"
                  onClick={increaseFontSize}
                  aria-label="Perbesar teks reader"
                  className="flex size-9 items-center justify-center rounded-full bg-muted text-foreground"
                >
                  <Plus className="size-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </li>

        {disabledSettings.map(({ icon: Icon, label, desc }) => (
          <li key={label} className="border-t border-border">
            <button
              type="button"
              disabled
              className="flex w-full items-center gap-4 px-5 py-4 text-left opacity-50"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-foreground">{label}</span>
                <span className="truncate text-xs text-muted-foreground">{desc}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
