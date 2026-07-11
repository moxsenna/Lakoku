'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { AdminSectionCard } from '@/components/admin/admin-section-card'
import { AdminEmptyState } from '@/components/admin/admin-empty-state'
import { isoDate } from '@/lib/admin/format'
import Link from 'next/link'
import { Search } from 'lucide-react'

interface UserResult {
  user_id: string
  email: string
}

interface UserItem {
  id: string
  email: string | null
  createdAt: string | null
  creditBalance: number
  paidOrdersCount: number
}

export default function AdminUsersPage() {
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<UserItem[]>([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const initialLoaded = useRef(false)

  const doSearch = useCallback(async (q?: string) => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/admin/users/search${q ? `?email=${encodeURIComponent(q)}` : ''}`,
      )
      if (res.ok) {
        const data = (await res.json()) as { users: UserResult[] }
        setUsers(
          (data.users ?? []).map((u) => ({
            id: u.user_id,
            email: u.email,
            createdAt: null,
            creditBalance: 0,
            paidOrdersCount: 0,
          })),
        )
      }
    } catch {/*swallow*/} finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (initialLoaded.current) return
    initialLoaded.current = true
    doSearch()
  }, [doSearch])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(query || undefined), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, doSearch])

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-serif text-xl text-foreground">Users</h1>
        <p className="text-xs text-muted-foreground">Cari user berdasarkan email.</p>
      </header>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari email user..."
          className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm"
        />
      </div>

      <AdminSectionCard title={`${users.length} hasil`}>
        {loading ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">Mencari...</div>
        ) : users.length === 0 ? (
          <AdminEmptyState message="Tidak ada user ditemukan." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left">
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">User ID</th>
                  <th className="px-3 py-2 font-medium">Joined</th>
                  <th className="px-3 py-2 font-medium text-right">Orders</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-border hover:bg-muted/20">
                    <td className="px-3 py-2 font-medium">{u.email ?? '-'}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
                      {u.id.slice(0, 12)}...
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {isoDate(u.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-right">{u.paidOrdersCount}</td>
                    <td className="px-3 py-2">
                      <Link href={`/admin/users/${u.id}`} className="text-lavender hover:underline">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminSectionCard>
    </div>
  )
}
