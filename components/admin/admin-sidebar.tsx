'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  Coins,
  CreditCard,
  Cpu,
  BarChart3,
  Settings,
} from 'lucide-react'

const navItems = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/credits', label: 'Credits', icon: Coins },
  { href: '/admin/payments', label: 'Payments', icon: CreditCard },
  { href: '/admin/generation', label: 'Generation', icon: Cpu },
  { href: '/admin/consistency', label: 'Consistency', icon: BarChart3 },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
]

export function AdminSidebar() {
  const pathname = usePathname()

  return (
    <aside className="hidden w-56 shrink-0 border-r border-border bg-card lg:flex lg:flex-col">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <Image
          src="/logo.png"
          alt="Lakoku Logo"
          width={28}
          height={28}
          className="h-7 w-7 rounded-full object-cover shadow-sm"
        />
        <span className="font-serif text-lg font-semibold text-foreground">Lakoku</span>
        <span className="rounded bg-lavender/15 px-1.5 py-0.5 text-[10px] font-medium text-lavender">
          Admin
        </span>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 p-2">
        {navItems.map((item) => {
          const active =
            item.href === '/admin'
              ? pathname === '/admin'
              : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                active
                  ? 'bg-lavender/10 text-lavender font-medium'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <item.icon className="size-4 shrink-0" aria-hidden="true" />
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
