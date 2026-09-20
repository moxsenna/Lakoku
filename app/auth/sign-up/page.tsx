import { redirect } from 'next/navigation'
import { getSupabasePublicConfig } from '@/lib/supabase/public-config'
import { getSessionUser } from '@/lib/api/user-state'
import { sanitizeNextPath } from '@/lib/auth/safe-next'
import { SignUpForm } from './sign-up-form'

export default async function SignUpPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>
}) {
  const { next } = (await searchParams) ?? {}
  const user = await getSessionUser()
  if (user) {
    redirect(sanitizeNextPath(next))
  }

  return <SignUpForm supabaseConfig={getSupabasePublicConfig()} />
}

export const dynamic = 'force-dynamic'
