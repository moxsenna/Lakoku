'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, LibraryBig, CirclePlus, User } from 'lucide-react'
import { cn } from '@/lib/utils'

const items = [
  { href: '/beranda', label: 'Beranda', icon: Home },
  { href: '/koleksiku', label: 'Koleksiku', icon: LibraryBig },
  { href: '/mulai', label: 'Mulai Cerita', icon: CirclePlus },
  { href: '/profil', label: 'Profil', icon: User },
]

export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Navigasi utama"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md border-t border-border bg-background/95 backdrop-blur"
    >
      <ul className="flex items-stretch justify-around">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-5" aria-hidden="true" />
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
