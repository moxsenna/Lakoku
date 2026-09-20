'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { clearStoredWebPush } from '@/components/push/web-registration'
import { clearAndroidPush } from '@/lib/android/push-bridge'

export function LogoutButton() {
  const router = useRouter()

  async function handleLogout() {
    await clearStoredWebPush()
    await clearAndroidPush()
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/beranda')
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="flex min-h-13 w-full items-center justify-center rounded-2xl border border-border px-6 text-sm font-semibold text-foreground transition-colors hover:bg-card"
    >
      Keluar
    </button>
  )
}
