import { redirect } from 'next/navigation'
import { getSupabasePublicConfig } from '@/lib/supabase/public-config'
import { getSessionUser } from '@/lib/api/user-state'
import { sanitizeNextPath } from '@/lib/auth/safe-next'
import { LoginForm } from './login-form'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string; next?: string }>
}) {
  const { reset, next } = await searchParams
  const user = await getSessionUser()
  if (user) {
    redirect(sanitizeNextPath(next))
  }

  return (
    <LoginForm
      supabaseConfig={getSupabasePublicConfig()}
      resetSuccess={reset === 'success'}
    />
  )
}

export const dynamic = 'force-dynamic'
